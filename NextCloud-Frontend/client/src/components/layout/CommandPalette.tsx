import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, FolderOpen, MessageSquare, CalendarDays, StickyNote,
  Users, Kanban, Mail, Activity, Image, Settings, Search, FileText,
  Plus, Upload, Sparkles, Loader2, ArrowLeft,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/", category: "Navigation" },
  { label: "Files", icon: FolderOpen, href: "/files", category: "Navigation" },
  { label: "Talk", icon: MessageSquare, href: "/talk", category: "Navigation" },
  { label: "Calendar", icon: CalendarDays, href: "/calendar", category: "Navigation" },
  { label: "Notes", icon: StickyNote, href: "/notes", category: "Navigation" },
  { label: "Contacts", icon: Users, href: "/contacts", category: "Navigation" },
  { label: "Deck", icon: Kanban, href: "/deck", category: "Navigation" },
  { label: "Mail", icon: Mail, href: "/mail", category: "Navigation" },
  { label: "Activity", icon: Activity, href: "/activity", category: "Navigation" },
  { label: "Media", icon: Image, href: "/media", category: "Navigation" },
  { label: "Settings", icon: Settings, href: "/settings", category: "Navigation" },
];

const QUICK_ACTIONS = [
  { label: "New note", icon: Plus, href: "/notes", category: "Quick action" },
  { label: "Compose email", icon: Mail, href: "/mail", category: "Quick action" },
  { label: "New event", icon: CalendarDays, href: "/calendar", category: "Quick action" },
  { label: "Upload file", icon: Upload, href: "/files", category: "Quick action" },
];

type ResultItem = { label: string; icon: typeof Search; href: string; category: string };
type CloudFileResult = { name: string; path: string };
type ContactResult = { id: number; name: string };
type NoteResult = { id: number; title: string };

type AskSource = { type: string; title: string; snippet: string; href: string };
type AskResult = { answer: string; sources: AskSource[]; aiPowered: boolean };

const SOURCE_ICON: Record<string, typeof Search> = {
  note: StickyNote,
  file: FileText,
  event: CalendarDays,
  contact: Users,
  chat: MessageSquare,
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [askLoading, setAskLoading] = useState(false);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askQuestion, setAskQuestion] = useState("");

  const { data: filesData } = useQuery({
    queryKey: ["/api/files", "/"],
    queryFn: () => fetchJson<{ data: CloudFileResult[] }>("/api/files?path=%2F"),
  });
  const { data: contactsData } = useQuery({
    queryKey: ["/api/contacts"],
    queryFn: () => fetchJson<{ data: ContactResult[] }>("/api/contacts"),
  });
  const { data: notesData } = useQuery({
    queryKey: ["/api/notes"],
    queryFn: () => fetchJson<{ data: NoteResult[] }>("/api/notes"),
  });

  const resetAsk = useCallback(() => {
    setAskLoading(false);
    setAskResult(null);
    setAskQuestion("");
  }, []);

  const runAsk = useCallback(async (question: string) => {
    if (!question.trim()) return;
    setAskQuestion(question);
    setAskResult(null);
    setAskLoading(true);
    try {
      const res = await fetchJson<{ data: AskResult }>("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      setAskResult(res.data);
    } catch {
      setAskResult({ answer: "Sorry, I couldn't answer that right now.", sources: [], aiPowered: false });
    } finally {
      setAskLoading(false);
    }
  }, []);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    const liveFiles: ResultItem[] = (filesData?.data || []).slice(0, 8).map((file) => ({
      label: file.name, icon: FileText, href: "/files", category: "File",
    }));
    const liveContacts: ResultItem[] = (contactsData?.data || []).slice(0, 8).map((contact) => ({
      label: contact.name, icon: Users, href: "/contacts", category: "Contact",
    }));
    const liveNotes: ResultItem[] = (notesData?.data || []).slice(0, 8).map((note) => ({
      label: note.title, icon: StickyNote, href: "/notes", category: "Note",
    }));

    if (!q) {
      return [
        { group: "Quick actions", items: QUICK_ACTIONS },
        { group: "Navigation", items: NAV_ITEMS },
        { group: "Recent files", items: liveFiles.slice(0, 5) },
      ];
    }

    const askItem: ResultItem = { label: `Ask CloudSpace: “${query.trim()}”`, icon: Sparkles, href: "__ask__", category: "Assistant" };

    const matched: ResultItem[] = [
      ...NAV_ITEMS, ...QUICK_ACTIONS, ...liveFiles, ...liveContacts, ...liveNotes,
    ].filter((item) => item.label.toLowerCase().includes(q));

    const groups = new Map<string, ResultItem[]>();
    for (const item of matched) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category)!.push(item);
    }
    return [
      { group: "Assistant", items: [askItem] },
      ...Array.from(groups.entries()).map(([group, items]) => ({ group, items })),
    ];
  }, [contactsData?.data, filesData?.data, notesData?.data, query]);

  const flatResults = useMemo(() => results.flatMap((g) => g.items), [results]);

  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { if (query) resetAsk(); }, [query, resetAsk]);

  const handleSelect = useCallback(
    (item: ResultItem) => {
      if (item.href === "__ask__") {
        void runAsk(query.trim());
        return;
      }
      navigate(item.href);
      onOpenChange(false);
      setQuery("");
      resetAsk();
    },
    [navigate, onOpenChange, query, runAsk, resetAsk],
  );

  const inAskView = askLoading || !!askResult;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (inAskView) {
        if (e.key === "Escape") { e.preventDefault(); resetAsk(); }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && flatResults[selectedIndex]) {
        e.preventDefault();
        handleSelect(flatResults[selectedIndex]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, flatResults, selectedIndex, handleSelect, inAskView, resetAsk]);

  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setQuery(""); resetAsk(); } }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 top-[25%] translate-y-0" hideClose>
        {/* Search input */}
        <div className="flex items-center border-b px-3">
          {inAskView ? (
            <button onClick={resetAsk} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Back to search">
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && query.trim()) {
                e.preventDefault();
                void runAsk(query.trim());
              }
            }}
            placeholder="Search, or ask a question…"
            className="flex-1 h-12 px-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Ask view */}
        {inAskView ? (
          <div className="max-h-96 overflow-y-auto p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Ask CloudSpace
            </p>
            <p className="mb-3 text-sm font-medium">{askQuestion}</p>
            {askLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking through your data…
              </div>
            ) : askResult ? (
              <>
                <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm leading-relaxed">{askResult.answer}</div>
                {askResult.sources.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</p>
                    <div className="space-y-1">
                      {askResult.sources.map((s, i) => {
                        const Icon = SOURCE_ICON[s.type] || FileText;
                        return (
                          <button
                            key={i}
                            onClick={() => { navigate(s.href); onOpenChange(false); setQuery(""); resetAsk(); }}
                            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
                          >
                            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{s.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">{s.snippet}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!askResult.aiPowered && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Tip: set <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code> on the server for full AI answers.
                  </p>
                )}
              </>
            ) : null}
          </div>
        ) : (
          /* Results */
          <div className="max-h-80 overflow-y-auto py-2">
            {flatResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No results found</p>
            ) : (
              results.map((group) => (
                <div key={group.group}>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">
                    {group.group}
                  </p>
                  {group.items.map((item) => {
                    flatIndex++;
                    const idx = flatIndex;
                    const Icon = item.icon;
                    const isAsk = item.href === "__ask__";
                    return (
                      <button
                        key={`${item.category}-${item.label}`}
                        onClick={() => handleSelect(item)}
                        className={cn(
                          "flex items-center gap-3 w-full px-3 py-2 text-sm text-left hover:bg-accent",
                          idx === selectedIndex && "bg-accent",
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", isAsk ? "text-primary" : "text-muted-foreground")} />
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {item.category}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
