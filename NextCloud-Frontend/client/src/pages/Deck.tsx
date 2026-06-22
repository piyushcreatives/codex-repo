import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { format, parseISO } from "date-fns";
import {
  Plus, Columns3, MoreVertical, Calendar, Trash2, X,
  GripVertical, Check,
} from "lucide-react";
import { cn, getAvatarColor, getInitials } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Board, Stack, Card } from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────
type StackWithCards = Stack & { cards: Card[] };
type BoardMember = { uid: string; displayName: string };
type BoardData = { board: Board; stacks: StackWithCards[]; members?: BoardMember[] };

// ─── Toast helper ──────────────────────────────────────────
let toastTimeout: ReturnType<typeof setTimeout>;
function showToast(msg: string) {
  const existing = document.getElementById("cs-toast");
  if (existing) existing.remove();
  clearTimeout(toastTimeout);
  const el = document.createElement("div");
  el.id = "cs-toast";
  el.className = "fixed bottom-4 right-4 z-50 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm animate-fade-in";
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimeout = setTimeout(() => el.remove(), 2500);
}

// ─── Priority Badge ────────────────────────────────────────
function PriorityBadge({ priority }: { priority: string }) {
  const config = {
    low: { label: "Low", class: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
    medium: { label: "Medium", class: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" },
    high: { label: "High", class: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" },
  }[priority] ?? { label: priority, class: "bg-muted text-muted-foreground" };

  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", config.class)}>
      {config.label}
    </span>
  );
}

function isOverdue(dueDate: string): boolean {
  return parseISO(dueDate) < new Date();
}

const COLUMN_COLORS: Record<string, string> = {
  "Backlog": "border-t-slate-300 dark:border-t-slate-600",
  "In Progress": "border-t-amber-400",
  "In Review": "border-t-blue-400",
  "Done": "border-t-green-400",
};

// ─── Card Detail Modal ─────────────────────────────────────
function CardDetailModal({
  card, stacks, open, onOpenChange, members,
}: {
  card: Card;
  stacks: StackWithCards[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: BoardMember[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");

  const patchCard = useMutation({
    mutationFn: (data: Partial<Card>) => apiRequest("PATCH", `/api/cards/${card.id}`, data),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards/"] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 1500);
    },
    onError: () => { setSaveStatus(""); showToast("Failed to save"); },
  });

  const deleteCard = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cards/${card.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards/"] });
      onOpenChange(false);
      showToast("Card deleted");
    },
  });

  // Parse labels
  const labels: string[] = card.labels ? (() => { try { return JSON.parse(card.labels); } catch { return []; } })() : [];
  const [labelInput, setLabelInput] = useState("");
  const [localLabels, setLocalLabels] = useState(labels);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Card Detail</DialogTitle>
        </DialogHeader>
        <div className="flex gap-6">
          {/* Left column */}
          <div className="flex-1 min-w-0">
            <Input
              className="text-lg font-semibold border-0 px-0 focus-visible:ring-0 shadow-none"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => { if (title !== card.title) patchCard.mutate({ title }); }}
            />
            <div className="mt-4">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea
                className="mt-1 min-h-[100px]"
                placeholder="Add a description…"
                value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={() => { if (description !== (card.description ?? "")) patchCard.mutate({ description }); }}
              />
            </div>

          </div>

          {/* Right column */}
          <div className="w-[200px] flex-shrink-0 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select
                value={String(card.stackId)}
                onValueChange={v => patchCard.mutate({ stackId: Number(v) })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stacks.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Priority</Label>
              <Select
                value={card.priority}
                onValueChange={v => patchCard.mutate({ priority: v })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">🟢 Low</SelectItem>
                  <SelectItem value="medium">🟡 Medium</SelectItem>
                  <SelectItem value="high">🔴 High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Assignee</Label>
              <Select
                value={card.assignee ?? "unassigned"}
                onValueChange={v => patchCard.mutate({ assignee: v === "unassigned" ? null : v })}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {members.map(m => (
                    <SelectItem key={m.uid} value={m.uid}>{m.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Due date</Label>
              <Input
                type="date"
                className="mt-1"
                value={card.dueDate ?? ""}
                onChange={e => patchCard.mutate({ dueDate: e.target.value || null })}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Labels</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {localLabels.map(l => (
                  <Badge key={l} variant="secondary" className="gap-1 pr-1 text-[10px]">
                    {l}
                    <button onClick={() => {
                      const next = localLabels.filter(x => x !== l);
                      setLocalLabels(next);
                      patchCard.mutate({ labels: JSON.stringify(next) });
                    }}>
                      <X size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                className="mt-1"
                placeholder="Add label…"
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const t = labelInput.trim();
                    if (t && !localLabels.includes(t)) {
                      const next = [...localLabels, t];
                      setLocalLabels(next);
                      patchCard.mutate({ labels: JSON.stringify(next) });
                    }
                    setLabelInput("");
                  }
                }}
              />
            </div>

            <Button
              variant="destructive"
              size="sm"
              className="w-full gap-2 mt-4"
              onClick={() => deleteCard.mutate()}
            >
              <Trash2 size={14} /> Delete card
            </Button>

            {saveStatus && (
              <p className="text-xs text-muted-foreground text-center">
                {saveStatus === "saving" ? "Saving…" : "Saved ✓"}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Kanban Card ───────────────────────────────────────────
function KanbanCard({ card, index, onClick, assigneeName }: { card: Card; index: number; onClick: () => void; assigneeName: string }) {
  const labels: string[] = card.labels ? (() => { try { return JSON.parse(card.labels); } catch { return []; } })() : [];

  return (
    <Draggable draggableId={String(card.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={cn(
            "bg-card border rounded-lg p-3 mb-2 cursor-grab active:cursor-grabbing",
            "hover:shadow-sm hover:border-primary/30 transition-all",
            snapshot.isDragging && "shadow-2xl ring-2 ring-primary/30 rotate-2 scale-105"
          )}
          onClick={onClick}
        >
          {/* Labels */}
          {labels.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {labels.map((label: string) => (
                <span key={label} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {label}
                </span>
              ))}
            </div>
          )}

          <p className="text-sm font-medium leading-snug">{card.title}</p>

          <div className="flex items-center justify-between mt-2.5">
            <div className="flex items-center gap-2">
              <PriorityBadge priority={card.priority} />
              {card.dueDate && (
                <span className={cn(
                  "text-[11px] flex items-center gap-1",
                  isOverdue(card.dueDate) ? "text-red-500" : "text-muted-foreground"
                )}>
                  <Calendar size={10} />
                  {format(parseISO(card.dueDate), "MMM d")}
                </span>
              )}
            </div>
            {card.assignee && (
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0",
                  getAvatarColor(assigneeName || card.assignee)
                )}
                title={assigneeName || card.assignee}
              >
                {getInitials(assigneeName || card.assignee)}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ─── Kanban Column ─────────────────────────────────────────
function KanbanColumn({
  stack, cards, onCardClick, onAddCard, onRename, onDelete, getMemberName,
}: {
  stack: Stack;
  cards: Card[];
  onCardClick: (c: Card) => void;
  onAddCard: (stackId: number, title: string) => void;
  onRename: (stackId: number, title: string) => void;
  onDelete: (stack: StackWithCards) => void;
  getMemberName: (uid: string | null | undefined) => string;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(stack.title);

  const handleAdd = () => {
    if (newTitle.trim()) {
      onAddCard(stack.id, newTitle.trim());
      setNewTitle("");
      setAdding(false);
    }
  };

  const commitRename = () => {
    const t = renameValue.trim();
    if (t && t !== stack.title) onRename(stack.id, t);
    setRenaming(false);
  };

  const colorClass = COLUMN_COLORS[stack.title] ?? "border-t-primary";

  return (
    <div className={cn("w-72 flex-shrink-0 flex flex-col max-h-full rounded-lg border-t-2", colorClass)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 gap-1">
        {renaming ? (
          <Input
            autoFocus
            className="h-7 text-sm"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setRenameValue(stack.title); setRenaming(false); }
            }}
          />
        ) : (
          <span className="text-sm font-semibold truncate">{stack.title}</span>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="bg-muted text-muted-foreground text-xs rounded-full px-2 py-0.5">{cards.length}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setRenameValue(stack.title); setRenaming(true); }}>Rename column</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => onDelete({ ...stack, cards })}>Delete column</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={String(stack.id)}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex-1 overflow-y-auto px-2 py-2 min-h-[200px] transition-colors",
              snapshot.isDraggingOver ? "bg-accent/50" : "bg-muted/20"
            )}
          >
            {cards.map((card, index) => (
              <KanbanCard key={card.id} card={card} index={index} onClick={() => onCardClick(card)} assigneeName={getMemberName(card.assignee)} />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {/* Add card */}
      {adding ? (
        <div className="p-2">
          <div className="bg-card border rounded-lg p-2 shadow-sm">
            <Input
              autoFocus
              placeholder="Card title…"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
            />
            <div className="flex gap-1 mt-2">
              <Button size="sm" onClick={handleAdd}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-b-lg transition-colors"
        >
          <Plus size={14} /> Add card
        </button>
      )}
    </div>
  );
}

// ─── Main Deck Page ────────────────────────────────────────
export default function Deck() {
  const queryClient = useQueryClient();

  // Fetch boards list
  const { data: boardsData } = useQuery<{ data: Board[] }>({
    queryKey: ["/api/boards"],
    queryFn: () => fetchJson<{ data: Board[] }>("/api/boards"),
  });
  const boards = boardsData?.data ?? [];
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [showNewBoard, setShowNewBoard] = useState(false);
  const resolvedBoardId = activeBoardId ?? boards[0]?.id ?? null;

  // Set first board as default
  useEffect(() => {
    if (boards.length > 0 && activeBoardId === null) {
      setActiveBoardId(boards[0].id);
    }
  }, [boards, activeBoardId]);

  // Fetch board data
  const { data: boardData } = useQuery<{ data: BoardData }>({
    queryKey: ["/api/boards/", resolvedBoardId],
    queryFn: () => fetchJson<{ data: BoardData }>(`/api/boards/${resolvedBoardId}`),
    enabled: resolvedBoardId !== null,
  });

  const board = boardData?.data?.board;
  const apiStacks = boardData?.data?.stacks ?? [];
  const members = boardData?.data?.members ?? [];
  // Resolve an assignee uid to a display name (Deck stores assignees by uid).
  const memberName = useCallback(
    (uid: string | null | undefined) => (uid ? (members.find((m) => m.uid === uid)?.displayName || uid) : ""),
    [members],
  );

  // Local state for optimistic drag-and-drop
  const [localStacks, setLocalStacks] = useState<StackWithCards[]>([]);
  useEffect(() => {
    if (apiStacks.length > 0) setLocalStacks(apiStacks);
  }, [apiStacks]);

  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [newStackName, setNewStackName] = useState("");
  const [showNewStack, setShowNewStack] = useState(false);
  const [confirmDeleteStack, setConfirmDeleteStack] = useState<StackWithCards | null>(null);

  // Derive the open card from live board data so edits (priority, status, due date)
  // reflect immediately instead of showing a frozen snapshot.
  const activeCard = useMemo(() => {
    if (activeCardId == null) return null;
    for (const s of localStacks) {
      const found = s.cards.find((c) => c.id === activeCardId);
      if (found) return found;
    }
    return null;
  }, [localStacks, activeCardId]);

  // All unique assignees
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const s of localStacks) {
      for (const c of s.cards) {
        if (c.assignee) set.add(c.assignee);
      }
    }
    return Array.from(set);
  }, [localStacks]);

  // Filter cards by assignee
  const filteredStacks = useMemo(() => {
    if (!filterAssignee) return localStacks;
    return localStacks.map(s => ({
      ...s,
      cards: s.cards.filter(c => c.assignee === filterAssignee),
    }));
  }, [localStacks, filterAssignee]);

  // Mutations
  const moveCardMutation = useMutation({
    mutationFn: (data: { id: number; stackId: number; order: number }) =>
      apiRequest("PATCH", `/api/cards/${data.id}`, { stackId: data.stackId, order: data.order }),
    onError: () => {
      // Revert
      if (apiStacks.length > 0) setLocalStacks(apiStacks);
      showToast("Failed to move card");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards/", activeBoardId] });
    },
  });

  const addCardMutation = useMutation({
    mutationFn: ({ stackId, title }: { stackId: number; title: string }) =>
      apiRequest("POST", `/api/boards/${resolvedBoardId}/stacks/${stackId}/cards`, {
        title,
        priority: "medium",
        order: localStacks.find(s => s.id === stackId)?.cards.length ?? 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards/", resolvedBoardId] });
    },
  });

  const addStackMutation = useMutation({
    mutationFn: (title: string) =>
      apiRequest("POST", `/api/boards/${resolvedBoardId}/stacks`, {
        title,
        order: localStacks.length,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards/", resolvedBoardId] });
      setShowNewStack(false);
      setNewStackName("");
    },
  });

  const renameStackMutation = useMutation({
    mutationFn: ({ stackId, title }: { stackId: number; title: string }) =>
      apiRequest("PATCH", `/api/boards/${resolvedBoardId}/stacks/${stackId}`, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/boards/", resolvedBoardId] }),
    onError: () => showToast("Failed to rename column"),
  });

  const deleteStackMutation = useMutation({
    mutationFn: (stackId: number) => apiRequest("DELETE", `/api/boards/${resolvedBoardId}/stacks/${stackId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards/", resolvedBoardId] });
      setConfirmDeleteStack(null);
      showToast("Column deleted");
    },
    onError: () => showToast("Failed to delete column"),
  });

  const createBoardMutation = useMutation({
    mutationFn: async (title: string) => {
      const response = await apiRequest("POST", "/api/boards", {
        title,
        color: "#4F46E5",
      });
      return response.json() as Promise<{ data: Board }>;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/boards"] });
      setActiveBoardId(result.data.id);
      setShowNewBoard(false);
      setNewBoardName("");
      showToast("Board created");
    },
    onError: () => {
      showToast("Unable to create board");
    },
  });

  // Drag end handler
  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const cardId = parseInt(draggableId);
    const srcStackId = parseInt(source.droppableId);
    const destStackId = parseInt(destination.droppableId);

    // Optimistic update
    setLocalStacks(prev => {
      const next = prev.map(s => ({ ...s, cards: [...s.cards] }));
      const srcStack = next.find(s => s.id === srcStackId);
      const destStack = next.find(s => s.id === destStackId);
      if (!srcStack || !destStack) return prev;

      const [moved] = srcStack.cards.splice(source.index, 1);
      if (!moved) return prev;
      moved.stackId = destStackId;
      destStack.cards.splice(destination.index, 0, moved);

      // Update order values
      destStack.cards.forEach((c, i) => { c.order = i; });
      if (srcStackId !== destStackId) {
        srcStack.cards.forEach((c, i) => { c.order = i; });
      }

      return next;
    });

    moveCardMutation.mutate({ id: cardId, stackId: destStackId, order: destination.index });
  }, [moveCardMutation]);

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height))]">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b flex items-center gap-3 flex-shrink-0">
        <Select
          value={resolvedBoardId ? String(resolvedBoardId) : ""}
          onValueChange={v => setActiveBoardId(Number(v))}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select board" />
          </SelectTrigger>
          <SelectContent>
            {boards.map(b => (
              <SelectItem key={b.id} value={String(b.id)}>{b.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {board && (
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: board.color }} />
        )}

        <div className="flex-1" />

        {/* Assignee filter */}
        <div className="flex items-center gap-1">
          {assignees.map(a => (
            <button
              key={a}
              onClick={() => setFilterAssignee(filterAssignee === a ? null : a)}
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all",
                getAvatarColor(memberName(a) || a),
                filterAssignee === a && "ring-2 ring-primary ring-offset-1"
              )}
              title={memberName(a) || a}
            >
              {getInitials(memberName(a) || a)}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowNewBoard(true)}>
          <Plus size={14} /> New Board
        </Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowNewStack(true)}>
          <Columns3 size={14} /> New Stack
        </Button>
      </div>

      {/* New stack inline */}
      {showNewStack && (
        <div className="px-4 py-2 border-b flex items-center gap-2 bg-muted/30">
          <Input
            autoFocus
            className="max-w-xs"
            placeholder="Stack name…"
            value={newStackName}
            onChange={e => setNewStackName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newStackName.trim()) addStackMutation.mutate(newStackName.trim());
              if (e.key === "Escape") { setShowNewStack(false); setNewStackName(""); }
            }}
          />
          <Button size="sm" onClick={() => { if (newStackName.trim()) addStackMutation.mutate(newStackName.trim()); }}>Create</Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowNewStack(false); setNewStackName(""); }}>Cancel</Button>
        </div>
      )}

      {showNewBoard && (
        <div className="px-4 py-2 border-b flex items-center gap-2 bg-muted/30">
          <Input
            autoFocus
            className="max-w-xs"
            placeholder="Board name…"
            value={newBoardName}
            onChange={e => setNewBoardName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newBoardName.trim()) createBoardMutation.mutate(newBoardName.trim());
              if (e.key === "Escape") { setShowNewBoard(false); setNewBoardName(""); }
            }}
          />
          <Button size="sm" onClick={() => { if (newBoardName.trim()) createBoardMutation.mutate(newBoardName.trim()); }}>Create</Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowNewBoard(false); setNewBoardName(""); }}>Cancel</Button>
        </div>
      )}

      {/* Board */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 p-4 overflow-x-auto flex-1 items-start">
          {filteredStacks.map(stack => (
            <KanbanColumn
              key={stack.id}
              stack={stack}
              cards={stack.cards}
              onCardClick={c => setActiveCardId(c.id)}
              onAddCard={(stackId, title) => addCardMutation.mutate({ stackId, title })}
              onRename={(stackId, title) => renameStackMutation.mutate({ stackId, title })}
              onDelete={(s) => setConfirmDeleteStack(s)}
              getMemberName={memberName}
            />
          ))}
          {resolvedBoardId === null ? (
            <div className="flex items-center justify-center flex-1 h-full">
              <div className="text-center">
                <p className="text-muted-foreground text-sm">No boards yet</p>
                <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={() => setShowNewBoard(true)}>
                  <Plus size={14} /> Create board
                </Button>
              </div>
            </div>
          ) : filteredStacks.length === 0 && !showNewStack ? (
            <div className="flex items-center justify-center flex-1 h-full">
              <p className="text-muted-foreground text-sm">Select a board to get started</p>
            </div>
          ) : null}
        </div>
      </DragDropContext>

      {/* Card detail modal */}
      {activeCard && (
        <CardDetailModal
          card={activeCard}
          stacks={localStacks}
          members={members}
          open={!!activeCard}
          onOpenChange={v => { if (!v) setActiveCardId(null); }}
        />
      )}

      {/* Delete column confirmation */}
      <Dialog open={!!confirmDeleteStack} onOpenChange={(v) => { if (!v) setConfirmDeleteStack(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete column?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            This deletes <span className="font-medium text-foreground">{confirmDeleteStack?.title}</span>
            {confirmDeleteStack && confirmDeleteStack.cards.length > 0
              ? <> and its <span className="font-medium text-foreground">{confirmDeleteStack.cards.length}</span> card{confirmDeleteStack.cards.length === 1 ? "" : "s"}</>
              : null}. This can't be undone.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setConfirmDeleteStack(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteStackMutation.isPending}
              onClick={() => { if (confirmDeleteStack) deleteStackMutation.mutate(confirmDeleteStack.id); }}
            >
              {deleteStackMutation.isPending ? "Deleting…" : "Delete column"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
