import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  StickyNote, Plus, Search, MoreVertical, Pin, PinOff, Trash2,
  Bold, Italic, Strikethrough, Heading1, Heading2, List,
  ListOrdered, ListChecks, Code, Quote, Eye, EyeOff, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { formatRelative } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingList } from "@/components/ui/loading-list";
import { ErrorState, getQueryErrorMessage } from "@/components/ui/query-state";
import type { Note } from "@shared/schema";

/** Safely parse a note's JSON tags column; never throws on malformed data. */
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

// ─── Markdown Renderer ──────────────────────────────────────
function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMarkdown(text: string): string {
  const safe = escapeHtml(text);
  return safe
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
    .replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-4 border-primary/40 pl-3 text-muted-foreground italic my-2">$1</blockquote>')
    .replace(/^- \[ \] (.+)$/gm, '<div class="flex items-center gap-2 my-1"><input type="checkbox" disabled /><span>$1</span></div>')
    .replace(/^- \[x\] (.+)$/gm, '<div class="flex items-center gap-2 my-1"><input type="checkbox" checked disabled /><span class="line-through text-muted-foreground">$1</span></div>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/\n/g, "<br />");
}

function stripMarkdown(text: string): string {
  return text.replace(/^#{1,3}\s+/gm, "").replace(/\*+/g, "").replace(/~~/g, "").replace(/^[-\d.]+\s/gm, "").trim();
}

// ─── Toast ──────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const show = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

// ─── Note Row ───────────────────────────────────────────────
function NoteRow({
  note,
  isActive,
  onClick,
  onPin,
  onDelete,
}: {
  note: Note;
  isActive: boolean;
  onClick: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const firstLine = note.content?.split("\n")[0] || "";
  const preview = stripMarkdown(firstLine);

  return (
    <div
      onClick={onClick}
      className={cn(
        "group px-3 py-2.5 cursor-pointer rounded-lg mx-1 transition-colors relative",
        isActive ? "bg-accent" : "hover:bg-muted/60"
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium truncate flex-1">{note.title || "Untitled"}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
              <MoreVertical size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPin(); }}>
              {note.isPinned ? <><PinOff size={14} className="mr-2" /> Unpin</> : <><Pin size={14} className="mr-2" /> Pin</>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-destructive focus:text-destructive">
              <Trash2 size={14} className="mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {preview && <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>}
      <p className="text-[11px] text-muted-foreground mt-1">{formatRelative(note.updatedAt)}</p>
    </div>
  );
}

// ─── Formatting Toolbar ─────────────────────────────────────
interface FormatAction {
  icon: React.ElementType;
  label: string;
  action: "wrap" | "prepend";
  syntax: string;
}

const FORMAT_ACTIONS: (FormatAction | "sep")[] = [
  { icon: Bold, label: "Bold", action: "wrap", syntax: "**" },
  { icon: Italic, label: "Italic", action: "wrap", syntax: "*" },
  { icon: Strikethrough, label: "Strikethrough", action: "wrap", syntax: "~~" },
  "sep",
  { icon: Heading1, label: "Heading 1", action: "prepend", syntax: "# " },
  { icon: Heading2, label: "Heading 2", action: "prepend", syntax: "## " },
  "sep",
  { icon: List, label: "Bullet list", action: "prepend", syntax: "- " },
  { icon: ListOrdered, label: "Numbered list", action: "prepend", syntax: "1. " },
  { icon: ListChecks, label: "Checklist", action: "prepend", syntax: "- [ ] " },
  "sep",
  { icon: Code, label: "Code block", action: "wrap", syntax: "```" },
  { icon: Quote, label: "Quote", action: "prepend", syntax: "> " },
];

function FormatToolbar({
  textareaRef,
  content,
  setContent,
  previewMode,
  setPreviewMode,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  setContent: (v: string) => void;
  previewMode: boolean;
  setPreviewMode: (v: boolean) => void;
}) {
  const handleFormat = (action: FormatAction) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end);

    if (action.action === "wrap") {
      const newText = content.substring(0, start) + action.syntax + selected + action.syntax + content.substring(end);
      setContent(newText);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + action.syntax.length, end + action.syntax.length);
      });
    } else {
      // Prepend to current line
      const lineStart = content.lastIndexOf("\n", start - 1) + 1;
      const newText = content.substring(0, lineStart) + action.syntax + content.substring(lineStart);
      setContent(newText);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + action.syntax.length, end + action.syntax.length);
      });
    }
  };

  return (
    <div className="border-b px-2 py-1.5 flex items-center gap-0.5 flex-shrink-0 bg-muted/30">
      {FORMAT_ACTIONS.map((item, i) => {
        if (item === "sep") return <Separator key={i} orientation="vertical" className="h-5 mx-1" />;
        const Icon = item.icon;
        return (
          <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleFormat(item)}
                className="size-7 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                disabled={previewMode}
              >
                <Icon size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
      <Separator orientation="vertical" className="h-5 mx-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={cn(
              "size-7 rounded flex items-center justify-center hover:bg-muted transition-colors",
              previewMode ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {previewMode ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{previewMode ? "Edit mode" : "Preview"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Main Notes Page ────────────────────────────────────────
export default function Notes() {
  const queryClient = useQueryClient();
  const { toast, show: showToast } = useToast();

  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Queries
  const { data: notesData, isLoading: notesLoading, error: notesError } = useQuery({
    queryKey: ["/api/notes"],
    queryFn: () => fetchJson<{ data: Note[] }>("/api/notes"),
  });

  const notes = notesData?.data || [];
  const activeNote = notes.find((n) => n.id === activeNoteId);

  // Declared before the effects below that reference it (otherwise the dependency array
  // reads `saveMutation` before its const is initialized → TDZ crash on mount).
  const saveMutation = useMutation({
    mutationFn: async ({ id, title: t, content: c }: { id: number; title: string; content: string }) => {
      const response = await apiRequest("PATCH", `/api/notes/${id}`, { title: t, content: c });
      return response.json() as Promise<{ data: Note }>;
    },
    onSuccess: async (result) => {
      setActiveNoteId(result.data.id);
      setTitle(result.data.title);
      setContent(result.data.content);
      await queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setLastSaved("just now");
    },
  });

  // Set first note as active on load
  useEffect(() => {
    if (notes.length && !activeNoteId && !isCreatingNote) {
      const first = notes[0];
      setActiveNoteId(first.id);
      setTitle(first.title);
      setContent(first.content);
    }
  }, [notes, activeNoteId, isCreatingNote]);

  useEffect(() => {
    if (!activeNoteId) return;
    const nextActive = notes.find((note) => note.id === activeNoteId);
    if (!nextActive) return;

    if (!saveMutation.isPending) {
      setTitle(nextActive.title);
      setContent(nextActive.content);
    }
  }, [notes, activeNoteId]);

  // Auto-save
  const activeNoteIdRef = useRef(activeNoteId);
  activeNoteIdRef.current = activeNoteId;
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  useEffect(() => {
    const noteId = activeNoteIdRef.current;
    const note = activeNoteRef.current;
    if (!noteId || !note) return;
    if (title === note.title && content === note.content) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMutation.mutate({ id: noteId, title, content });
    }, 1500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, content, saveMutation]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const res = await apiRequest("POST", "/api/notes", {
        title: "Untitled",
        content: "",
        tags: "[]",
        updatedAt: now,
        createdAt: now,
      });
      return res.json() as Promise<{ data: Note }>;
    },
    onMutate: () => {
      setIsCreatingNote(true);
    },
    onSuccess: async (result) => {
      setActiveNoteId(result.data.id);
      setTitle(result.data.title);
      setContent(result.data.content);
      setPreviewMode(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      requestAnimationFrame(() => titleRef.current?.focus());
    },
    onSettled: () => {
      setIsCreatingNote(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/notes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setActiveNoteId(null);
      setTitle("");
      setContent("");
      setDeleteConfirmOpen(false);
      showToast("Note deleted");
    },
  });

  const pinMutation = useMutation({
    mutationFn: async ({ id, isPinned }: { id: number; isPinned: boolean }) => {
      await apiRequest("PATCH", `/api/notes/${id}`, { isPinned });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notes"] }),
  });

  const handleSelectNote = useCallback((note: Note) => {
    // Save current note before switching
    if (activeNoteId && activeNote && (title !== activeNote.title || content !== activeNote.content)) {
      saveMutation.mutate({ id: activeNoteId, title, content });
    }
    setActiveNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setPreviewMode(false);
    setLastSaved(null);
  }, [activeNoteId, activeNote, title, content, saveMutation]);

  const handleAddTag = useCallback(() => {
    if (!tagInput.trim() || !activeNoteId) return;
    const currentTags = parseTags(activeNote?.tags);
    if (!currentTags.includes(tagInput.trim())) {
      const newTags = [...currentTags, tagInput.trim()];
      apiRequest("PATCH", `/api/notes/${activeNoteId}`, { tags: JSON.stringify(newTags) }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      });
    }
    setTagInput("");
  }, [tagInput, activeNoteId, activeNote, queryClient]);

  const handleRemoveTag = useCallback((tag: string) => {
    if (!activeNoteId || !activeNote) return;
    const currentTags = parseTags(activeNote.tags);
    const newTags = currentTags.filter((t) => t !== tag);
    apiRequest("PATCH", `/api/notes/${activeNoteId}`, { tags: JSON.stringify(newTags) }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
    });
  }, [activeNoteId, activeNote, queryClient]);

  // Filter notes by search
  const filteredNotes = notes.filter((n) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
  });

  const pinnedNotes = filteredNotes.filter((n) => n.isPinned);
  const unpinnedNotes = filteredNotes.filter((n) => !n.isPinned);
  const tags = parseTags(activeNote?.tags);

  return (
    <>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-fade-in bg-foreground text-background rounded-lg px-4 py-3 shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="flex h-[calc(100vh-var(--topbar-height,56px))] overflow-hidden">
        {/* ─── Left Panel: Note List ─── */}
        <div className="w-[280px] flex-shrink-0 border-r flex flex-col bg-background">
          <div className="p-3 flex items-center gap-2">
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 h-9 rounded-lg bg-muted border-0"
            />
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="New note" onClick={() => createMutation.mutate()}>
              <Plus size={16} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notesLoading ? (
              <div className="p-3">
                <LoadingList count={6} rowClassName="h-12 w-full" />
              </div>
            ) : notesError ? (
              <ErrorState message={getQueryErrorMessage(notesError) ?? "Unable to load notes."} className="py-12" />
            ) : filteredNotes.length === 0 ? (
              <EmptyState
                icon={searchQuery ? Search : StickyNote}
                title={searchQuery ? "No notes match your search" : "No notes yet"}
                description={searchQuery ? undefined : "Create your first note to get started."}
                className="py-12"
              />
            ) : (
              <>
                {pinnedNotes.length > 0 && (
                  <>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">
                      Pinned
                    </p>
                    {pinnedNotes.map((n) => (
                      <NoteRow
                        key={n.id}
                        note={n}
                        isActive={n.id === activeNoteId}
                        onClick={() => handleSelectNote(n)}
                        onPin={() => pinMutation.mutate({ id: n.id, isPinned: false })}
                        onDelete={() => { setActiveNoteId(n.id); setDeleteConfirmOpen(true); }}
                      />
                    ))}
                  </>
                )}
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">
                  All Notes
                </p>
                {unpinnedNotes.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    isActive={n.id === activeNoteId}
                    onClick={() => handleSelectNote(n)}
                    onPin={() => pinMutation.mutate({ id: n.id, isPinned: true })}
                    onDelete={() => { setActiveNoteId(n.id); setDeleteConfirmOpen(true); }}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* ─── Right Panel: Editor ─── */}
        {activeNote ? (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Editor TopBar */}
            <div className="border-b px-4 h-12 flex items-center gap-2 flex-shrink-0">
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
                className="flex-1 text-base font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground"
              />
              <div className="flex-1" />
              {lastSaved && (
                <span className="text-xs text-muted-foreground">Saved · {lastSaved}</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => pinMutation.mutate({ id: activeNote.id, isPinned: !activeNote.isPinned })}>
                    {activeNote.isPinned ? <><PinOff size={14} className="mr-2" /> Unpin</> : <><Pin size={14} className="mr-2" /> Pin</>}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const blob = new Blob([content], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${title || "note"}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Export as .txt
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDeleteConfirmOpen(true)} className="text-destructive focus:text-destructive">
                    <Trash2 size={14} className="mr-2" /> Delete note
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Formatting Toolbar */}
            <FormatToolbar
              textareaRef={textareaRef}
              content={content}
              setContent={setContent}
              previewMode={previewMode}
              setPreviewMode={setPreviewMode}
            />

            {/* Editor / Preview */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {previewMode ? (
                <div
                  className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed prose-like"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                />
              ) : (
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Start writing... (Markdown supported)"
                  className="flex-1 resize-none p-4 text-sm leading-relaxed bg-background outline-none font-mono min-h-0"
                />
              )}
            </div>

            {/* Tags */}
            <div className="border-t px-4 py-2 flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">Tags:</span>
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} className="ml-0.5 hover:text-destructive">
                    <X size={10} />
                  </button>
                </Badge>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                placeholder="Add tag..."
                className="text-xs bg-transparent border-none outline-none placeholder:text-muted-foreground w-20"
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/10">
            <div className="text-center space-y-3">
              <StickyNote size={48} className="text-muted-foreground/30 mx-auto" />
              <p className="font-medium text-muted-foreground">No note selected</p>
              <p className="text-sm text-muted-foreground/60">Choose a note or create a new one</p>
              <Button size="sm" onClick={() => createMutation.mutate()}>
                <Plus size={14} className="mr-1.5" /> New note
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Delete note</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this note? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => activeNoteId && deleteMutation.mutate(activeNoteId)}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
