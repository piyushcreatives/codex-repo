import Anthropic from "@anthropic-ai/sdk";

export type AskContext = {
  userName: string;
  notes: { title: string; content: string }[];
  events: { title: string; startAt: string; location?: string | null }[];
  files: { name: string; path: string; modifiedAt: string }[];
  contacts: { name: string; email?: string | null; phone?: string | null }[];
  conversations: { name: string; lastMessage?: string | null }[];
};

export type AskSource = { type: string; title: string; snippet: string; href: string };
export type AskResult = { answer: string; sources: AskSource[]; aiPowered: boolean };

// Flatten the context into searchable records (for both citations and the heuristic fallback).
type Record = { type: string; title: string; text: string; href: string };

function toRecords(ctx: AskContext): Record[] {
  const records: Record[] = [];
  for (const n of ctx.notes) records.push({ type: "note", title: n.title, text: `${n.title}\n${n.content}`, href: "/notes" });
  for (const e of ctx.events) {
    const when = (() => { try { return new Date(e.startAt).toLocaleString(); } catch { return e.startAt; } })();
    records.push({ type: "event", title: e.title, text: `${e.title} ${when} ${e.location || ""}`, href: "/calendar" });
  }
  for (const f of ctx.files) records.push({ type: "file", title: f.name, text: `${f.name} ${f.path}`, href: "/files" });
  for (const c of ctx.contacts) records.push({ type: "contact", title: c.name, text: `${c.name} ${c.email || ""} ${c.phone || ""}`, href: "/contacts" });
  for (const c of ctx.conversations) records.push({ type: "chat", title: c.name, text: `${c.name} ${c.lastMessage || ""}`, href: "/talk" });
  return records;
}

function topMatches(question: string, ctx: AskContext, limit = 5): AskSource[] {
  const terms = question.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (!terms.length) return [];
  const scored = toRecords(ctx)
    .map((r) => {
      const hay = r.text.toLowerCase();
      const score = terms.reduce((sum, t) => sum + (hay.includes(t) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ r }) => ({
    type: r.type,
    title: r.title,
    snippet: r.text.replace(/\s+/g, " ").trim().slice(0, 160),
    href: r.href,
  }));
}

function buildContextText(ctx: AskContext): string {
  const sections: string[] = [];
  if (ctx.events.length) {
    sections.push(
      "UPCOMING EVENTS:\n" +
        ctx.events.map((e) => `- ${e.title} @ ${(() => { try { return new Date(e.startAt).toLocaleString(); } catch { return e.startAt; } })()}${e.location ? ` (${e.location})` : ""}`).join("\n"),
    );
  }
  if (ctx.notes.length) {
    sections.push("NOTES:\n" + ctx.notes.map((n) => `- ${n.title}: ${n.content.replace(/\s+/g, " ").slice(0, 400)}`).join("\n"));
  }
  if (ctx.files.length) {
    sections.push("RECENT FILES:\n" + ctx.files.map((f) => `- ${f.name} (${f.path})`).join("\n"));
  }
  if (ctx.contacts.length) {
    sections.push("CONTACTS:\n" + ctx.contacts.map((c) => `- ${c.name}${c.email ? ` <${c.email}>` : ""}${c.phone ? ` ${c.phone}` : ""}`).join("\n"));
  }
  if (ctx.conversations.length) {
    sections.push("RECENT CHATS:\n" + ctx.conversations.map((c) => `- ${c.name}${c.lastMessage ? `: ${c.lastMessage}` : ""}`).join("\n"));
  }
  return sections.join("\n\n") || "(no data available)";
}

async function claudeAnswer(question: string, ctx: AskContext): Promise<AskResult> {
  const client = new Anthropic();
  const today = new Date().toLocaleString();
  const system =
    `You are the CloudSpace assistant for ${ctx.userName}. Answer the user's question using ONLY the context below ` +
    "about their own files, notes, calendar, contacts, and chats. Be concise and direct. If the answer isn't in the " +
    `context, say you couldn't find it in their data. Today is ${today}.`;
  const userText = `${buildContextText(ctx)}\n\nQuestion: ${question}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: userText }],
  });

  const answer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { answer: answer || "I couldn't find an answer in your data.", sources: topMatches(question, ctx), aiPowered: true };
}

function heuristicAnswer(question: string, ctx: AskContext): AskResult {
  const sources = topMatches(question, ctx, 6);
  const answer = sources.length
    ? `AI answers aren't configured (no ANTHROPIC_API_KEY), so here are the most relevant items from your CloudSpace data:`
    : `AI answers aren't configured, and I couldn't find anything in your data matching that. Try different keywords.`;
  return { answer, sources, aiPowered: false };
}

export async function answerQuestion(question: string, ctx: AskContext): Promise<AskResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeAnswer(question, ctx);
    } catch (error) {
      console.warn("[ask] Claude failed, using heuristic:", error instanceof Error ? error.message : error);
    }
  }
  return heuristicAnswer(question, ctx);
}
