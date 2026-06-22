import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, Search, LayoutGrid, List, Upload, Download, UserPlus,
  Mail, Phone, Building2, Tag, MessageSquare, UserX,
  MoreVertical, Pencil, Trash2, X, ChevronDown,
} from "lucide-react";
import { cn, getAvatarColor, getInitials } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingList } from "@/components/ui/loading-list";
import { ErrorState, getQueryErrorMessage } from "@/components/ui/query-state";
import type { Contact } from "@shared/schema";

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

// ─── Contact Form Dialog ───────────────────────────────────
function ContactDialog({
  open, onOpenChange, contact, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact?: Contact | null;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [company, setCompany] = useState(contact?.company ?? "");
  const [group, setGroup] = useState(contact?.group ?? "All");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(() => {
    if (contact?.tags) {
      try { return JSON.parse(contact.tags); } catch { return []; }
    }
    return [];
  });

  useEffect(() => {
    setName(contact?.name ?? "");
    setEmail(contact?.email ?? "");
    setPhone(contact?.phone ?? "");
    setCompany(contact?.company ?? "");
    setGroup(contact?.group ?? "All");
    setTagInput("");
    if (contact?.tags) {
      try { setTags(JSON.parse(contact.tags)); } catch { setTags([]); }
    } else {
      setTags([]);
    }
  }, [contact]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, email, phone, company, group, tags: JSON.stringify(tags) };
      if (contact) {
        return apiRequest("PATCH", `/api/contacts/${contact.id}`, body);
      }
      return apiRequest("POST", "/api/contacts", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      onOpenChange(false);
      onSaved();
      showToast(contact ? "Contact updated" : "Contact created");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "Unable to save contact");
    },
  });

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "New Contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Live avatar preview */}
          <div className="flex justify-center">
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold",
              getAvatarColor(name || "?")
            )}>
              {name ? getInitials(name) : "?"}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" />
          </div>
          <div className="space-y-2">
            <Label>Group</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                <SelectItem value="Work">Work</SelectItem>
                <SelectItem value="Personal">Personal</SelectItem>
                <SelectItem value="Friends">Friends</SelectItem>
                <SelectItem value="Family">Family</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1 mb-1">
              {tags.map(t => (
                <Badge key={t} variant="secondary" className="gap-1 pr-1">
                  {t}
                  <button onClick={() => setTags(tags.filter(x => x !== t))} className="hover:text-destructive">
                    <X size={12} />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              placeholder="Type and press Enter"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
              {save.isPending ? "Saving…" : "Save contact"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Contacts Page ────────────────────────────────────
export default function Contacts() {
  const queryClient = useQueryClient();
  const { data: contactsData, isLoading: contactsLoading, error: contactsError } = useQuery<{ data: Contact[] }>({
    queryKey: ["/api/contacts"],
    queryFn: () => fetchJson<{ data: Contact[] }>("/api/contacts"),
  });

  const contacts = contactsData?.data ?? [];

  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"name-asc" | "name-desc" | "company" | "recent">("name-asc");
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setActiveContact(null);
      setConfirmDelete(null);
      showToast("Contact deleted");
    },
    onError: () => showToast("Unable to delete contact"),
  });

  const importMutation = useMutation({
    mutationFn: (vcard: string) =>
      fetchJson<{ data: { imported: number; failed: number } }>("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vcard }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      const { imported, failed } = res.data;
      showToast(`Imported ${imported} contact${imported === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`);
    },
    onError: () => showToast("Import failed"),
  });

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (!/BEGIN:VCARD/i.test(text)) { showToast("That doesn't look like a .vcf file"); return; }
      importMutation.mutate(text);
    };
    reader.readAsText(file);
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/contacts/export", { credentials: "include" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cloudspace-contacts.vcf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Export failed");
    }
  };

  // Derived data
  const groups = useMemo(() => {
    const tagGroups: Record<string, number> = {};
    const letterGroups = new Set<string>();
    for (const c of contacts) {
      const letter = c.name[0]?.toUpperCase();
      if (letter) letterGroups.add(letter);
      if (c.group && c.group !== "All") {
        tagGroups[c.group] = (tagGroups[c.group] || 0) + 1;
      }
    }
    return {
      letters: Array.from(letterGroups).sort(),
      tagGroups,
    };
  }, [contacts]);

  const filtered = useMemo(() => {
    let list = [...contacts];

    // Group filter
    if (selectedGroup !== "all") {
      if (selectedGroup.length === 1 && selectedGroup >= "A" && selectedGroup <= "Z") {
        list = list.filter(c => c.name[0]?.toUpperCase() === selectedGroup);
      } else {
        list = list.filter(c => c.group === selectedGroup);
      }
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.phone?.includes(q)
      );
    }

    // Sort
    switch (sortBy) {
      case "name-asc": list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": list.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "company": list.sort((a, b) => (a.company ?? "").localeCompare(b.company ?? "")); break;
      case "recent": list.sort((a, b) => b.id - a.id); break;
    }

    return list;
  }, [contacts, selectedGroup, search, sortBy]);

  const openNewDialog = () => { setEditContact(null); setDialogOpen(true); };
  const openEditDialog = (c: Contact) => { setEditContact(c); setDialogOpen(true); };

  return (
    <div className="flex h-[calc(100vh-var(--topbar-height))] overflow-hidden">
      {/* ─── Left Panel: Groups ──────────────────── */}
      <div className="w-[180px] flex-shrink-0 border-r flex flex-col overflow-y-auto">
        <p className="text-sm font-semibold px-3 pt-4 pb-2">Contacts</p>

        {/* All Contacts */}
        <button
          onClick={() => setSelectedGroup("all")}
          className={cn(
            "px-3 py-1.5 rounded-lg mx-1 cursor-pointer text-sm flex items-center justify-between",
            selectedGroup === "all" && "bg-accent text-accent-foreground font-medium"
          )}
        >
          <span className="flex items-center gap-2"><Users size={14} /> All</span>
          <span className="text-xs text-muted-foreground">{contacts.length}</span>
        </button>

        <Separator className="my-2 mx-2" />

        {/* Alpha groups */}
        {groups.letters.map(letter => (
          <button
            key={letter}
            onClick={() => setSelectedGroup(letter)}
            className={cn(
              "px-3 py-1 rounded-lg mx-1 cursor-pointer text-sm flex items-center justify-between",
              selectedGroup === letter && "bg-accent text-accent-foreground font-medium"
            )}
          >
            <span className="text-xs font-medium">{letter}</span>
            <span className="text-xs text-muted-foreground">
              {contacts.filter(c => c.name[0]?.toUpperCase() === letter).length}
            </span>
          </button>
        ))}

        <Separator className="my-2 mx-2" />

        {/* Tag groups */}
        {Object.entries(groups.tagGroups).map(([g, count]) => (
          <button
            key={g}
            onClick={() => setSelectedGroup(g)}
            className={cn(
              "px-3 py-1.5 rounded-lg mx-1 cursor-pointer text-sm flex items-center justify-between",
              selectedGroup === g && "bg-accent text-accent-foreground font-medium"
            )}
          >
            <span>{g}</span>
            <span className="text-xs text-muted-foreground">{count}</span>
          </button>
        ))}

        <Separator className="my-2 mx-2" />

        <div className="px-1 space-y-1 pb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".vcf,text/vcard"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = ""; // allow re-importing the same file
            }}
          />
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" disabled={importMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> {importMutation.isPending ? "Importing…" : "Import"}
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" disabled={contacts.length === 0} onClick={handleExport}>
            <Download size={14} /> Export
          </Button>
          <Button size="sm" className="w-full justify-start gap-2" onClick={openNewDialog}>
            <UserPlus size={14} /> New Contact
          </Button>
        </div>
      </div>

      {/* ─── Center Panel: Grid/List ─────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 bg-muted h-9"
              placeholder="Search contacts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                Sort <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("name-asc")}>Name A–Z</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("name-desc")}>Name Z–A</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("company")}>Company</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("recent")}>Recently added</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" className="h-9 w-9" aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}>
            <LayoutGrid size={16} />
          </Button>
          <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className="h-9 w-9" aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>
            <List size={16} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {contactsLoading ? (
            <div className="p-4">
              <LoadingList count={8} rowClassName="h-16 w-full" />
            </div>
          ) : contactsError ? (
            <ErrorState message={getQueryErrorMessage(contactsError) ?? "Unable to load contacts."} className="py-16" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={UserX}
              title={search || selectedGroup !== "all" ? "No contacts found" : "No contacts yet"}
              description={search || selectedGroup !== "all" ? undefined : "Add a contact to get started."}
              className="h-full"
            />
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
              {filtered.map(c => {
                const parsedTags: string[] = c.tags ? (() => { try { return JSON.parse(c.tags); } catch { return []; } })() : [];
                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveContact(c)}
                    className={cn(
                      "rounded-xl border bg-card p-4 flex flex-col items-center text-center cursor-pointer",
                      "hover:shadow-md hover:border-primary/30 hover:scale-[1.02] transition-all",
                      activeContact?.id === c.id && "border-primary shadow-md"
                    )}
                  >
                    <div className={cn("w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold", getAvatarColor(c.name))}>
                      {getInitials(c.name)}
                    </div>
                    <p className="text-sm font-semibold mt-3">{c.name}</p>
                    {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                    {c.email && <p className="text-xs text-muted-foreground truncate max-w-full">{c.email}</p>}
                    {parsedTags.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-2 justify-center">
                        {parsedTags.map((t: string) => (
                          <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              {filtered.map((c, i) => {
                const prevLetter = i > 0 ? filtered[i - 1].name[0]?.toUpperCase() : null;
                const curLetter = c.name[0]?.toUpperCase();
                const showSep = sortBy === "name-asc" && curLetter !== prevLetter;
                return (
                  <div key={c.id}>
                    {showSep && (
                      <div className="px-4 py-1 bg-muted/40 text-xs font-semibold text-muted-foreground sticky top-0">{curLetter}</div>
                    )}
                    <div
                      className={cn(
                        "flex items-center gap-4 px-4 py-2.5 hover:bg-muted/40 cursor-pointer",
                        activeContact?.id === c.id && "bg-accent"
                      )}
                      onClick={() => setActiveContact(c)}
                    >
                      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0", getAvatarColor(c.name))}>
                        {getInitials(c.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{c.name}</p>
                        {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                      </div>
                      <p className="text-xs text-muted-foreground hidden sm:block w-40 truncate">{c.email}</p>
                      <p className="text-xs text-muted-foreground hidden md:block w-32">{c.phone}</p>
                      <p className="text-xs text-muted-foreground hidden lg:block w-20">{c.group}</p>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            <MoreVertical size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); openEditDialog(c); }}>
                            <Pencil size={14} className="mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); setLocation("/talk"); }}>
                            <MessageSquare size={14} className="mr-2" /> Send message
                          </DropdownMenuItem>
                          {c.email && (
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); window.location.href = `mailto:${c.email}`; }}>
                              <Mail size={14} className="mr-2" /> Email
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); setConfirmDelete(c); }}>
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Panel: Detail ─────────────────── */}
      {activeContact && (
        <div className="w-[320px] flex-shrink-0 border-l flex flex-col overflow-y-auto">
          {/* Header */}
          <div className="p-6 border-b flex flex-col items-center text-center relative">
            <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-8 w-8" onClick={() => setActiveContact(null)}>
              <X size={16} />
            </Button>
            <div className={cn("w-20 h-20 rounded-full flex items-center justify-center text-2xl font-semibold", getAvatarColor(activeContact.name))}>
              {getInitials(activeContact.name)}
            </div>
            <p className="text-xl font-semibold mt-3">{activeContact.name}</p>
            {activeContact.company && <p className="text-sm text-muted-foreground">{activeContact.company}</p>}

            <div className="flex gap-6 mt-4">
              <button className="flex flex-col items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setLocation("/talk")}>
                <MessageSquare size={18} /> Message
              </button>
              <button className="flex flex-col items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setLocation("/talk")}>
                <Phone size={18} /> Call
              </button>
              <button
                className="flex flex-col items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={!activeContact.email}
                onClick={() => { if (activeContact.email) window.location.href = `mailto:${activeContact.email}`; }}
              >
                <Mail size={18} /> Email
              </button>
            </div>

            <Button variant="outline" size="sm" className="mt-3" onClick={() => openEditDialog(activeContact)}>
              <Pencil size={14} className="mr-1" /> Edit
            </Button>
          </div>

          {/* Fields */}
          <div className="px-6 py-4 space-y-4">
            {activeContact.email && (
              <div className="flex items-start gap-3">
                <Mail size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Email</p><p className="text-sm font-medium">{activeContact.email}</p></div>
              </div>
            )}
            {activeContact.phone && (
              <div className="flex items-start gap-3">
                <Phone size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Phone</p><p className="text-sm font-medium">{activeContact.phone}</p></div>
              </div>
            )}
            {activeContact.company && (
              <div className="flex items-start gap-3">
                <Building2 size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Company</p><p className="text-sm font-medium">{activeContact.company}</p></div>
              </div>
            )}
            {activeContact.group && (
              <div className="flex items-start gap-3">
                <Users size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div><p className="text-xs text-muted-foreground uppercase tracking-wide">Group</p><p className="text-sm font-medium">{activeContact.group}</p></div>
              </div>
            )}
            {activeContact.tags && (() => {
              try {
                const parsed = JSON.parse(activeContact.tags);
                if (parsed.length > 0) return (
                  <div className="flex items-start gap-3">
                    <Tag size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Tags</p>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {parsed.map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
                      </div>
                    </div>
                  </div>
                );
              } catch { /* ignore */ }
              return null;
            })()}
          </div>

        </div>
      )}

      {/* Dialog */}
      {dialogOpen && (
        <ContactDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          contact={editContact}
          onSaved={() => setEditContact(null)}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete contact?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            This permanently removes <span className="font-medium text-foreground">{confirmDelete?.name}</span> from your Nextcloud address book. This can't be undone.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (confirmDelete) deleteMutation.mutate(confirmDelete.id); }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
