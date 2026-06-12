import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Inbox, Star, Send, FileEdit, ShieldAlert, Trash2,
  Search, ArrowUpDown, SquarePen, Paperclip, Smile,
  Mail as MailIcon, MailOpen, Reply, ReplyAll, Forward,
  FolderInput, Printer, X, ChevronDown,
} from "lucide-react";
import { cn, getAvatarColor, getInitials } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { Email, Contact } from "@shared/schema";

// ─── Toast ─────────────────────────────────────────────────
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

// ─── Compose Dialog ────────────────────────────────────────
function ComposeDialog({
  open,
  onOpenChange,
  currentUserName,
  currentUserEmail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentUserName: string;
  currentUserEmail: string;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState<string[]>([]);
  const [toInput, setToInput] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: contactsData } = useQuery<{ data: Contact[] }>({
    queryKey: ["/api/contacts"],
    queryFn: () => fetchJson<{ data: Contact[] }>("/api/contacts"),
  });
  const contacts = contactsData?.data ?? [];

  const filteredContacts = useMemo(() => {
    if (!toInput) return [];
    const q = toInput.toLowerCase();
    return contacts.filter(c =>
      (c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)) &&
      !to.includes(c.email ?? "")
    ).slice(0, 5);
  }, [toInput, contacts, to]);

  const sendMutation = useMutation({
    mutationFn: (folder: string) =>
      apiRequest("POST", "/api/emails", {
        folder,
        from: currentUserName,
        fromEmail: currentUserEmail,
        to: to.join(", "),
        subject: subject || "(no subject)",
        preview: body.substring(0, 100),
        body,
        receivedAt: new Date().toISOString(),
        isRead: true,
      }),
    onSuccess: (_, folder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails/counts"] });
      onOpenChange(false);
      showToast(folder === "drafts" ? "Saved to Drafts" : "Message sent");
    },
  });

  const addRecipient = (email: string) => {
    if (email && !to.includes(email)) setTo([...to, email]);
    setToInput("");
    setShowSuggestions(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {/* To */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="w-8 text-xs text-muted-foreground">To</Label>
              <div className="flex-1 flex flex-wrap gap-1 items-center border rounded-md px-2 py-1 min-h-[36px]">
                {to.map(email => (
                  <Badge key={email} variant="secondary" className="gap-1 pr-1">
                    {email}
                    <button onClick={() => setTo(to.filter(e => e !== email))}><X size={12} /></button>
                  </Badge>
                ))}
                <div className="relative flex-1 min-w-[120px]">
                  <Input
                    className="border-0 shadow-none h-7 px-1 focus-visible:ring-0"
                    value={toInput}
                    onChange={e => { setToInput(e.target.value); setShowSuggestions(true); }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && toInput.includes("@")) { e.preventDefault(); addRecipient(toInput.trim()); }
                      if (e.key === "Backspace" && !toInput && to.length > 0) setTo(to.slice(0, -1));
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder={to.length === 0 ? "Recipients…" : ""}
                  />
                  {showSuggestions && filteredContacts.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-[200] mt-1 bg-popover border rounded-lg shadow-lg py-1">
                      {filteredContacts.map(c => (
                        <button
                          key={c.id}
                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                          onMouseDown={e => { e.preventDefault(); addRecipient(c.email ?? ""); }}
                        >
                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold", getAvatarColor(c.name))}>
                            {getInitials(c.name)}
                          </div>
                          <span>{c.name}</span>
                          <span className="text-muted-foreground text-xs ml-auto">{c.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {!showCcBcc && (
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowCcBcc(true)}>Cc Bcc</button>
              )}
            </div>
          </div>

          {showCcBcc && (
            <>
              <div className="flex items-center gap-2">
                <Label className="w-8 text-xs text-muted-foreground">Cc</Label>
                <Input value={cc} onChange={e => setCc(e.target.value)} className="flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-8 text-xs text-muted-foreground">Bcc</Label>
                <Input value={bcc} onChange={e => setBcc(e.target.value)} className="flex-1" />
              </div>
            </>
          )}

          <Input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />

          <Separator />

          <Textarea
            className="min-h-[240px] resize-none"
            placeholder="Write your message…"
            value={body}
            onChange={e => setBody(e.target.value)}
          />

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => showToast("Attachment feature coming soon")}>
                <Paperclip size={14} />
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => sendMutation.mutate("drafts")}>
                Save draft
              </Button>
              <Button size="sm" className="gap-1" onClick={() => sendMutation.mutate("sent")} disabled={to.length === 0}>
                <Send size={14} /> Send
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Folder config ─────────────────────────────────────────
const FOLDERS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "starred", label: "Starred", icon: Star },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileEdit },
  { key: "spam", label: "Spam", icon: ShieldAlert },
  { key: "trash", label: "Trash", icon: Trash2 },
];

const LABELS = [
  { name: "Work", color: "bg-indigo-500" },
  { name: "Personal", color: "bg-green-500" },
  { name: "Finance", color: "bg-amber-500" },
];

// ─── Main Mail Page ────────────────────────────────────────
export default function Mail() {
  const queryClient = useQueryClient();
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [activeEmailId, setActiveEmailId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "sender" | "unread">("newest");
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [replyText, setReplyText] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const { data: currentUserData } = useQuery<{ data: { name?: string; email?: string } }>({
    queryKey: ["/api/user"],
    queryFn: () => fetchJson<{ data: { name?: string; email?: string } }>("/api/user"),
  });
  const currentUserName = currentUserData?.data?.name || "You";
  const currentUserEmail = currentUserData?.data?.email || "";

  // Fetch emails for current folder
  const folderToFetch = activeFolder === "starred" ? "inbox" : activeFolder;
  const { data: emailsData } = useQuery<{ data: Email[] }>({
    queryKey: ["/api/emails", folderToFetch],
    queryFn: () => fetchJson<{ data: Email[] }>(`/api/emails?folder=${folderToFetch}`),
  });

  // Also fetch sent for starred
  const { data: sentData } = useQuery<{ data: Email[] }>({
    queryKey: ["/api/emails", "sent"],
    queryFn: () => fetchJson<{ data: Email[] }>("/api/emails?folder=sent"),
    enabled: activeFolder === "starred",
  });

  const { data: countsData } = useQuery<{ data: { inbox: number; drafts: number; spam: number } }>({
    queryKey: ["/api/emails/counts"],
    queryFn: () => fetchJson<{ data: { inbox: number; drafts: number; spam: number } }>("/api/emails/counts"),
    staleTime: 30_000,
  });
  const counts = countsData?.data ?? { inbox: 0, drafts: 0, spam: 0 };

  // Active email detail
  const { data: activeEmailData } = useQuery<{ data: Email }>({
    queryKey: ["/api/emails", activeEmailId],
    queryFn: () => fetchJson<{ data: Email }>(`/api/emails/${activeEmailId}`),
    enabled: activeEmailId !== null,
  });
  const activeEmail = activeEmailData?.data;

  // Mutations
  const patchEmail = useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<Email>) => apiRequest("PATCH", `/api/emails/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails/counts"] });
    },
  });

  const deleteEmail = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/emails/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails/counts"] });
      setActiveEmailId(null);
      showToast("Email deleted");
    },
  });

  const replyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/emails", {
        folder: "sent",
        from: currentUserName,
        fromEmail: currentUserEmail,
        to: activeEmail?.fromEmail ?? "",
        subject: `Re: ${activeEmail?.subject ?? ""}`,
        preview: replyText.substring(0, 100),
        body: replyText,
        receivedAt: new Date().toISOString(),
        isRead: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      setReplyText("");
      showToast("Reply sent");
    },
  });

  // Filter & sort emails
  const emails = useMemo(() => {
    let list: Email[] = [];
    if (activeFolder === "starred") {
      const inbox = emailsData?.data ?? [];
      const sent = sentData?.data ?? [];
      list = [...inbox, ...sent].filter(e => e.isStarred);
    } else {
      list = emailsData?.data ?? [];
    }

    // Label filter
    if (labelFilter) {
      list = list.filter(e => e.subject.toLowerCase().includes(labelFilter.toLowerCase()));
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.subject.toLowerCase().includes(q) ||
        e.from.toLowerCase().includes(q) ||
        e.preview.toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sortBy) {
      case "newest": list.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)); break;
      case "oldest": list.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)); break;
      case "sender": list.sort((a, b) => a.from.localeCompare(b.from)); break;
      case "unread": list.sort((a, b) => (a.isRead === b.isRead ? 0 : a.isRead ? 1 : -1)); break;
    }

    return list;
  }, [emailsData, sentData, activeFolder, search, sortBy, labelFilter]);

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectEmail = (id: number) => {
    setActiveEmailId(id);
    // invalidate so it gets re-fetched and marked as read
    queryClient.invalidateQueries({ queryKey: ["/api/emails", id] });
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails/counts"] });
    }, 300);
  };

  return (
    <div className="flex h-[calc(100vh-var(--topbar-height))] overflow-hidden">
      {/* ─── Left Panel: Folders ─────────────────── */}
      <div className="w-[200px] flex-shrink-0 border-r flex flex-col">
        <div className="p-3">
          <Button className="w-full gap-2" onClick={() => setComposeOpen(true)}>
            <SquarePen size={16} /> Compose
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-1">
          {FOLDERS.map(f => {
            const Icon = f.icon;
            const badge = f.key === "inbox" ? counts.inbox : f.key === "drafts" ? counts.drafts : null;
            return (
              <button
                key={f.key}
                onClick={() => { setActiveFolder(f.key); setActiveEmailId(null); setSelectedIds(new Set()); setLabelFilter(null); }}
                className={cn(
                  "w-full px-3 py-1.5 rounded-lg mx-0 cursor-pointer text-sm flex items-center justify-between",
                  activeFolder === f.key ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted/60"
                )}
              >
                <span className="flex items-center gap-2"><Icon size={16} /> {f.label}</span>
                {badge !== null && badge > 0 && (
                  <span className="bg-primary text-primary-foreground text-[10px] rounded-full px-1.5 min-w-[18px] text-center">{badge}</span>
                )}
              </button>
            );
          })}

          <Separator className="my-2" />

          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">Labels</p>
          {LABELS.map(l => (
            <button
              key={l.name}
              onClick={() => setLabelFilter(labelFilter === l.name ? null : l.name)}
              className={cn(
                "w-full px-3 py-1.5 rounded-lg cursor-pointer text-sm flex items-center gap-2",
                labelFilter === l.name ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              <span className={cn("w-2.5 h-2.5 rounded-full", l.color)} />
              {l.name}
            </button>
          ))}
        </div>

        {/* Storage indicator */}
        <div className="mt-auto p-3 border-t">
          <p className="text-[11px] text-muted-foreground mb-1">Mail storage</p>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: "34%" }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">1.7 GB of 5 GB used</p>
        </div>
      </div>

      {/* ─── Center Panel: Message List ──────────── */}
      <div className="w-[320px] flex-shrink-0 border-r flex flex-col">
        {/* Header */}
        <div className="px-3 py-2.5 border-b flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-semibold flex-1 capitalize">{activeFolder}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowSearch(!showSearch)}>
            <Search size={16} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowUpDown size={16} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("newest")}>Newest first</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("oldest")}>Oldest first</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("sender")}>Sender A-Z</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("unread")}>Unread first</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {showSearch && (
          <div className="px-3 py-2 border-b">
            <Input placeholder="Search messages…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm" />
          </div>
        )}

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="px-3 py-1.5 border-b bg-muted/30 flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
            <Checkbox
              checked={selectedIds.size === emails.length}
              onCheckedChange={c => setSelectedIds(c ? new Set(emails.map(e => e.id)) : new Set())}
            />
            <span>{selectedIds.size} selected</span>
            <div className="flex-1" />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
              selectedIds.forEach(id => patchEmail.mutate({ id, isRead: true }));
              setSelectedIds(new Set());
            }}><MailOpen size={12} /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
              selectedIds.forEach(id => patchEmail.mutate({ id, isStarred: true }));
              setSelectedIds(new Set());
            }}><Star size={12} /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
              selectedIds.forEach(id => deleteEmail.mutate(id));
              setSelectedIds(new Set());
            }}><Trash2 size={12} /></Button>
          </div>
        )}

        {/* Message rows */}
        <div className="flex-1 overflow-y-auto">
          {emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-12">
              <MailOpen size={40} className="text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground text-center">No messages here</p>
            </div>
          ) : (
            emails.map(email => (
              <div
                key={email.id}
                className={cn(
                  "px-3 py-3 border-b cursor-pointer flex items-start gap-3 relative group",
                  activeEmailId === email.id ? "bg-accent" : "hover:bg-muted/40"
                )}
                onClick={() => handleSelectEmail(email.id)}
              >
                {/* Unread dot */}
                {!email.isRead && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
                )}

                {/* Checkbox (hover) */}
                <div className="hidden group-hover:flex items-center pt-1" onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(email.id)}
                    onCheckedChange={() => toggleSelect(email.id)}
                  />
                </div>
                <div className="group-hover:hidden pt-1">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0", getAvatarColor(email.from))}>
                    {getInitials(email.from)}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-sm truncate", !email.isRead ? "font-semibold" : "text-muted-foreground")}>{email.from}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{format(parseISO(email.receivedAt), "MMM d")}</span>
                  </div>
                  <p className={cn("text-sm truncate", !email.isRead && "font-medium")}>{email.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">{email.preview}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {email.hasAttachment && <Paperclip size={12} className="text-muted-foreground" />}
                    {email.isStarred && <Star size={12} className="text-amber-500 fill-amber-500" />}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ─── Right Panel: Detail ─────────────────── */}
      {!activeEmail ? (
        <div className="flex-1 flex items-center justify-center bg-muted/10">
          <div className="text-center space-y-2">
            <MailIcon size={48} className="text-muted-foreground/30 mx-auto" />
            <p className="font-medium text-muted-foreground">Select a message</p>
            <p className="text-sm text-muted-foreground/60">Choose an email from the list</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Email header */}
          <div className="px-6 pt-5 pb-4 border-b flex-shrink-0">
            <h2 className="text-xl font-semibold mb-3">{activeEmail.subject}</h2>
            <div className="flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0", getAvatarColor(activeEmail.from))}>
                {getInitials(activeEmail.from)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{activeEmail.from}</p>
                <p className="text-xs text-muted-foreground">{activeEmail.fromEmail}</p>
              </div>
              <p className="text-xs text-muted-foreground flex-shrink-0">
                {format(parseISO(activeEmail.receivedAt), "EEE, d MMM yyyy, h:mm a")}
              </p>
            </div>
            <p className="text-sm text-muted-foreground mt-1">To: {currentUserName}</p>

            {activeEmail.hasAttachment && (
              <div className="flex gap-2 mt-3">
                <div className="flex items-center gap-1.5 text-xs bg-muted px-3 py-1.5 rounded-lg cursor-pointer hover:bg-accent">
                  <Paperclip size={12} /> attachment.pdf · 240 KB
                </div>
              </div>
            )}
          </div>

          {/* Action toolbar */}
          <div className="flex gap-2 px-6 py-3 border-b bg-muted/20 flex-shrink-0">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => showToast("Reply clicked")}>
              <Reply size={14} /> Reply
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => showToast("Reply All clicked")}>
              <ReplyAll size={14} /> Reply All
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => showToast("Forward clicked")}>
              <Forward size={14} /> Forward
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
              patchEmail.mutate({ id: activeEmail.id, isStarred: !activeEmail.isStarred });
              queryClient.invalidateQueries({ queryKey: ["/api/emails", activeEmail.id] });
            }}>
              <Star size={16} className={activeEmail.isStarred ? "text-amber-500 fill-amber-500" : ""} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8"><FolderInput size={16} /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {["inbox", "sent", "drafts", "spam", "trash"].map(f => (
                  <DropdownMenuItem key={f} onClick={() => {
                    patchEmail.mutate({ id: activeEmail.id, folder: f });
                    setActiveEmailId(null);
                    showToast(`Moved to ${f}`);
                  }}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteEmail.mutate(activeEmail.id)}>
              <Trash2 size={16} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showToast("Printing…")}>
              <Printer size={16} />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground max-w-prose">
              {activeEmail.body}
            </div>

            {/* Inline reply */}
            <div className="mt-6 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2">Reply to {activeEmail.from}</p>
              <div className="border rounded-lg overflow-hidden">
                <textarea
                  className="w-full p-3 text-sm resize-none bg-background outline-none min-h-[100px]"
                  placeholder="Write a reply…"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                />
                <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/30">
                  <div className="flex gap-1">
                    <button className="p-1.5 rounded hover:bg-muted"><Paperclip size={14} /></button>
                    <button className="p-1.5 rounded hover:bg-muted"><Smile size={14} /></button>
                  </div>
                  <Button size="sm" onClick={() => replyMutation.mutate()} disabled={!replyText.trim()}>
                    Send Reply
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compose dialog */}
      {composeOpen && (
        <ComposeDialog
          open={composeOpen}
          onOpenChange={setComposeOpen}
          currentUserName={currentUserName}
          currentUserEmail={currentUserEmail}
        />
      )}
    </div>
  );
}
