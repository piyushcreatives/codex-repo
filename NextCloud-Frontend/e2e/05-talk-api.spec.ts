import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./helpers";

const API_BASE_URL = process.env.VITE_API_PROXY_TARGET || `http://localhost:${process.env.PORT || "5000"}`;
const TALK_USER_1 = process.env.E2E_EMAIL || "Test01";
const TALK_PASSWORD_1 = process.env.E2E_PASSWORD || "CloudSpace!Test01!2026";
const TALK_USER_2 = process.env.TALK_E2E_USER_2 || "Test02";
const TALK_PASSWORD_2 = process.env.TALK_E2E_PASSWORD_2 || "CloudSpace!Test02!2026";

async function createTalkSession(email: string, password: string) {
  const context = await request.newContext({
    baseURL: API_BASE_URL,
    ignoreHTTPSErrors: BASE_URL.startsWith("https://"),
  });

  const response = await context.post("/api/auth/login", {
    data: { email, password },
  });

  expect(response.ok()).toBeTruthy();
  return context;
}

async function getConversationByName(context: APIRequestContext, name: string) {
  const response = await context.get("/api/conversations");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { data: Array<{ id: number; name: string; type: string }> };
  const conversation = payload.data.find((item) => item.name === name);
  expect(conversation, `Missing conversation ${name}`).toBeTruthy();
  return conversation!;
}

test.describe("Talk API integration", () => {
  test("DM message send persists for Talk", async () => {
    const context = await createTalkSession(TALK_USER_1, TALK_PASSWORD_1);
    const dm = await getConversationByName(context, "Test02");

    const content = `Talk DM API ${Date.now()}`;
    const send = await context.post(`/api/conversations/${dm.id}/messages`, {
      data: { content },
    });
    expect(send.ok()).toBeTruthy();

    const messages = await context.get(`/api/conversations/${dm.id}/messages`);
    expect(messages.ok()).toBeTruthy();
    const payload = await messages.json() as { data: Array<{ content: string }> };
    expect(payload.data.some((message) => message.content === content)).toBeTruthy();

    await context.dispose();
  });

  test("Group message send persists for Talk", async () => {
    const context = await createTalkSession(TALK_USER_1, TALK_PASSWORD_1);
    const group = await getConversationByName(context, "Wholesome Group");

    const content = `Talk Group API ${Date.now()}`;
    const send = await context.post(`/api/conversations/${group.id}/messages`, {
      data: { content },
    });
    expect(send.ok()).toBeTruthy();

    const messages = await context.get(`/api/conversations/${group.id}/messages`);
    expect(messages.ok()).toBeTruthy();
    const payload = await messages.json() as { data: Array<{ content: string }> };
    expect(payload.data.some((message) => message.content === content)).toBeTruthy();

    await context.dispose();
  });

  test("Native DM call starts, accepts, and ends cleanly", async () => {
    const context1 = await createTalkSession(TALK_USER_1, TALK_PASSWORD_1);
    const context2 = await createTalkSession(TALK_USER_2, TALK_PASSWORD_2);
    const dm = await getConversationByName(context1, "Test02");

    const start = await context1.post(`/api/conversations/${dm.id}/call/start`, {
      data: { type: "voice", initiatorName: TALK_USER_1 },
    });
    expect(start.ok()).toBeTruthy();
    const started = await start.json() as {
      data: {
        nativeAvailable: boolean;
        nativeSignalingMode: string;
        participants: Array<{ username: string; status: string }>;
        iceServers: Array<{ urls: string | string[] }>;
      };
    };
    expect(started.data.nativeAvailable).toBeTruthy();
    expect(started.data.nativeSignalingMode).toBeTruthy();
    expect(started.data.iceServers.length).toBeGreaterThan(0);

    const accept = await context2.post(`/api/conversations/${dm.id}/call/accept`);
    expect(accept.ok()).toBeTruthy();
    const accepted = await accept.json() as {
      data: {
        participants: Array<{ username: string; status: string }>;
      };
    };
    const statuses = new Map(accepted.data.participants.map((participant) => [participant.username, participant.status]));
    expect(statuses.get("Test01")).toBe("joined");
    expect(statuses.get("Test02")).toBe("joined");

    const end = await context1.post(`/api/conversations/${dm.id}/call/end`, {
      data: { endedBy: TALK_USER_1 },
    });
    expect(end.ok()).toBeTruthy();

    const current = await context1.get(`/api/conversations/${dm.id}/call`);
    expect(current.ok()).toBeTruthy();
    const currentPayload = await current.json() as { data: null | object };
    expect(currentPayload.data).toBeNull();

    await context1.dispose();
    await context2.dispose();
  });

  test("Non-callable Talk conversation is rejected cleanly", async () => {
    const context = await createTalkSession(TALK_USER_1, TALK_PASSWORD_1);
    const noteToSelf = await getConversationByName(context, "Note to self");

    const start = await context.post(`/api/conversations/${noteToSelf.id}/call/start`, {
      data: { type: "voice", initiatorName: TALK_USER_1 },
    });
    expect(start.status()).toBe(409);
    const payload = await start.json() as { error?: string };
    expect(payload.error).toBe("This conversation does not support calls.");

    await context.dispose();
  });
});
