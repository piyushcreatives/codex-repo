import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Archive,
  Check,
  Copy,
  Download,
  Eye,
  File,
  FileCode,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Image,
  Link2,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  Share2,
  Table2,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { fetchJson, isFeatureUnavailableError, isUnauthorizedError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { getAvatarColor, getInitials } from "@/lib/utils";

type CloudFile = {
  id: number;
  name: string;
  path: string;
  type: "file" | "folder";
  mimeType: string | null;
  size: number;
  modifiedAt: string;
  parentPath: string;
};

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getFileIcon(mimeType: string | null, type: string) {
  if (type === "folder") return { icon: Folder, color: "text-indigo-500" };
  if (!mimeType) return { icon: File, color: "text-slate-500" };
  if (mimeType === "application/pdf") return { icon: FileText, color: "text-red-500" };
  if (mimeType.startsWith("image/")) return { icon: Image, color: "text-purple-500" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return { icon: Table2, color: "text-green-600" };
  if (mimeType.includes("document") || mimeType.includes("wordprocessing")) return { icon: FileText, color: "text-blue-500" };
  if (mimeType.includes("zip") || mimeType.includes("gzip") || mimeType.includes("tar")) return { icon: Archive, color: "text-orange-500" };
  if (mimeType.startsWith("text/")) return { icon: FileCode, color: "text-slate-500" };
  return { icon: File, color: "text-slate-500" };
}

function isPreviewable(mimeType: string | null) {
  if (!mimeType) return false;
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    /(json|xml|javascript|typescript|csv|markdown|x-sh)/.test(mimeType)
  );
}

function FilePreview({
  file,
  onClose,
  onDownload,
}: {
  file: CloudFile | null;
  onClose: () => void;
  onDownload: (file: CloudFile) => void;
}) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const mime = file?.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  const isText = !isImage && !isPdf && (mime.startsWith("text/") || /(json|xml|javascript|typescript|csv|markdown|x-sh)/.test(mime));
  // The download route serves inline with the correct Content-Type — ideal for preview.
  const src = file ? `/api/files/download?path=${encodeURIComponent(file.path)}` : "";

  useEffect(() => {
    if (!file || !isText) {
      setTextContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(src, { credentials: "include" })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("load failed"))))
      .then((text) => {
        if (!cancelled) setTextContent(text.slice(0, 100_000));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, isText, src]);

  if (!file) return null;
  const { icon: Icon, color } = getFileIcon(file.mimeType, file.type);

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl w-[92vw] p-0 gap-0 overflow-hidden">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-3 space-y-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className={`h-5 w-5 shrink-0 ${color}`} />
            <div className="min-w-0 text-left">
              <DialogTitle className="truncate text-sm">{file.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {formatBytes(file.size)} · {format(new Date(file.modifiedAt), "MMM d, yyyy HH:mm")}
              </DialogDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="mr-8 shrink-0" onClick={() => onDownload(file)}>
            <Download className="mr-1 h-4 w-4" /> Download
          </Button>
        </DialogHeader>

        <div className="flex max-h-[75vh] min-h-[300px] items-center justify-center overflow-auto bg-muted/30">
          {isImage ? (
            <img src={src} alt={file.name} className="max-h-[75vh] w-auto object-contain" />
          ) : isPdf ? (
            <iframe src={src} title={file.name} className="h-[75vh] w-full bg-white" />
          ) : isText ? (
            loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : failed ? (
              <EmptyState icon={X} title="Couldn’t load preview" description="Try downloading the file instead." />
            ) : (
              <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-relaxed text-foreground">
                {textContent}
              </pre>
            )
          ) : (
            <EmptyState
              icon={Icon}
              title="No preview available"
              description="This file type can’t be previewed in the browser."
              action={
                <Button size="sm" onClick={() => onDownload(file)}>
                  <Download className="mr-1 h-4 w-4" /> Download
                </Button>
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ShareRecord = {
  id: string;
  shareType: number; // 0 = registered user, 3 = public link
  shareWith: string | null;
  shareWithDisplayName: string | null;
  permissions: number;
  url: string | null;
  token: string | null;
  path: string;
};

type DirectoryUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
};

type IncomingShare = {
  id: string;
  path: string;
  name: string;
  itemType: "file" | "folder";
  ownerId: string;
  ownerDisplayName: string;
  permissions: number;
  sharedAt: string;
};

type OutgoingShare = {
  id: string;
  path: string;
  name: string;
  itemType: "file" | "folder";
  shareType: number; // 0 = registered user, 3 = public link
  shareWith: string | null;
  shareWithDisplayName: string | null;
  permissions: number;
  url: string | null;
  sharedAt: string;
};

// Nextcloud permission bitmask: read=1, update=2, create=4, delete=8, share=16.
function editPermissions(isFolder: boolean) {
  return isFolder ? 31 : 3; // folder: full; file: read + update
}

function ShareDialog({ file, onClose }: { file: CloudFile | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [userQuery, setUserQuery] = useState("");
  const [allowEditing, setAllowEditing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isFolder = file?.type === "folder";

  const sharesQuery = useQuery({
    queryKey: ["/api/shares", file?.path],
    queryFn: () => fetchJson<{ data: ShareRecord[] }>(`/api/shares?path=${encodeURIComponent(file!.path)}`).then((p) => p.data),
    enabled: !!file,
  });
  const shares = Array.isArray(sharesQuery.data) ? sharesQuery.data : [];
  const userShares = shares.filter((s) => s.shareType === 0);
  const linkShares = shares.filter((s) => s.shareType === 3);
  const alreadySharedWith = new Set(userShares.map((s) => s.shareWith));

  const usersQuery = useQuery({
    queryKey: ["/api/users/search", userQuery],
    queryFn: () => fetchJson<{ data: DirectoryUser[] }>(`/api/users/search?query=${encodeURIComponent(userQuery)}`).then((p) => p.data),
    enabled: !!file && userQuery.trim().length >= 2,
  });
  const userResults = (Array.isArray(usersQuery.data) ? usersQuery.data : []).filter(
    (u) => !alreadySharedWith.has(u.username),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/shares", file?.path] });
    void queryClient.invalidateQueries({ queryKey: ["/api/shares/outgoing"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/shares/incoming"] });
  };

  const shareWithUser = useMutation({
    mutationFn: (user: DirectoryUser) =>
      fetchJson("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file!.path,
          shareType: 0,
          shareWith: user.username,
          permissions: allowEditing ? editPermissions(isFolder) : 1,
        }),
      }),
    onSuccess: (_data, user) => {
      void invalidate();
      setUserQuery("");
      showToast(`Shared with ${user.displayName}`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to share."),
  });

  // Org-internal link: points at OUR frontend's "Shared with me" view, NOT Nextcloud's
  // public page. Only signed-in members of the organization can open it.
  const internalLink = `${window.location.origin}/#/files?view=shared`;
  const [linkCopied, setLinkCopied] = useState(false);
  const copyInternalLink = () => {
    void navigator.clipboard?.writeText(internalLink).catch(() => undefined);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1500);
    showToast("Internal link copied");
  };

  const removeShare = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void invalidate();
      showToast("Share removed");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to remove share."),
  });

  const copyLink = (share: ShareRecord) => {
    if (!share.url) return;
    void navigator.clipboard?.writeText(share.url).catch(() => undefined);
    setCopiedId(share.id);
    window.setTimeout(() => setCopiedId((current) => (current === share.id ? null : current)), 1500);
    showToast("Link copied");
  };

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" /> Share “{file?.name}”
          </DialogTitle>
          <DialogDescription>
            Share this {isFolder ? "folder" : "file"} with a registered user, or create a public link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Share with a registered user */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add people</Label>
            <div className="relative">
              <UserPlus className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder="Search users by name…"
                className="pl-8"
              />
              {(usersQuery.isFetching || userResults.length > 0) && userQuery.trim().length >= 2 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-md">
                  {usersQuery.isFetching && userResults.length === 0 ? (
                    <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                    </div>
                  ) : userResults.length === 0 ? (
                    <div className="px-2 py-2 text-sm text-muted-foreground">No users found</div>
                  ) : (
                    userResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => shareWithUser.mutate(user)}
                        disabled={shareWithUser.isPending}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarColor(user.displayName)}`}>
                          {getInitials(user.displayName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{user.displayName}</span>
                          {user.email && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={allowEditing}
                onChange={(event) => setAllowEditing(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Allow editing
            </label>
          </div>

          {/* Existing access */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">People with access</Label>
            {sharesQuery.isLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : userShares.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">Not shared with anyone yet.</p>
            ) : (
              userShares.map((share) => (
                <div key={share.id} className="flex items-center gap-2">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarColor(share.shareWithDisplayName || "?")}`}>
                    {getInitials(share.shareWithDisplayName || "?")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{share.shareWithDisplayName}</span>
                    <span className="block text-xs text-muted-foreground">{share.permissions > 1 ? "Can edit" : "Can view"}</span>
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove access"
                    onClick={() => removeShare.mutate(share.id)} disabled={removeShare.isPending}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Internal link — org members only */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Internal link</Label>
            <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{internalLink}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Copy internal link" onClick={copyInternalLink}>
                {linkCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only signed-in members of your organization can open this — share it with the people you added above.
            </p>
          </div>

          {/* Legacy public links — revocable so out-of-org access can be cleaned up */}
          {linkShares.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-amber-600">Public links (anyone with the URL)</Label>
              {linkShares.map((share) => (
                <div key={share.id} className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50/50 px-2 py-1.5 dark:bg-amber-950/10">
                  <Link2 className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{share.url}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Copy link" onClick={() => copyLink(share)}>
                    {copiedId === share.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Revoke public link"
                    onClick={() => removeShare.mutate(share.id)} disabled={removeShare.isPending}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <p className="text-xs text-amber-600">These are accessible to anyone outside your organization. Revoke if not intended.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function showToast(message: string) {
  const existing = document.getElementById("cs-toast");
  if (existing) existing.remove();
  const element = document.createElement("div");
  element.id = "cs-toast";
  element.className =
    "fixed bottom-4 right-4 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg animate-fade-in";
  element.textContent = message;
  document.body.appendChild(element);
  window.setTimeout(() => element.remove(), 3000);
}

async function uploadViaAdapter(file: File, parentPath: string, onProgress: (value: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/files");
    request.responseType = "json";
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("x-file-name", file.name);
    request.setRequestHeader("x-parent-path", parentPath);
    request.setRequestHeader("x-file-content-type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      const message =
        typeof request.response === "object" &&
        request.response &&
        "error" in request.response &&
        typeof request.response.error === "string"
          ? request.response.error
          : `Upload failed with status ${request.status}`;
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("Upload failed."));
    request.send(file);
  });
}

export default function Files() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [shareFile, setShareFile] = useState<CloudFile | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  // Deep-link support: an internal share link (#/files?view=shared) opens the "Shared with me" tab.
  const [filesView, setFilesView] = useState<"mine" | "shared" | "sharedByMe">(() => {
    try {
      return new URLSearchParams(window.location.hash.split("?")[1] || "").get("view") === "shared" ? "shared" : "mine";
    } catch {
      return "mine";
    }
  });

  // Handle the deep link arriving while Files is already mounted (e.g. clicking the
  // share notification from the Files page) — the component won't remount, so watch the hash.
  useEffect(() => {
    const onHashChange = () => {
      try {
        const view = new URLSearchParams(window.location.hash.split("?")[1] || "").get("view");
        if (view === "shared") setFilesView("shared");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const incomingQuery = useQuery({
    queryKey: ["/api/shares/incoming"],
    queryFn: () => fetchJson<{ data: IncomingShare[] }>("/api/shares/incoming").then((p) => p.data),
    enabled: filesView === "shared",
  });
  const incomingShares = Array.isArray(incomingQuery.data) ? incomingQuery.data : [];

  const outgoingQuery = useQuery({
    queryKey: ["/api/shares/outgoing"],
    queryFn: () => fetchJson<{ data: OutgoingShare[] }>("/api/shares/outgoing").then((p) => p.data),
    enabled: filesView === "sharedByMe",
  });
  const outgoingShares = Array.isArray(outgoingQuery.data) ? outgoingQuery.data : [];

  const revokeOutgoing = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/shares/outgoing"] });
      showToast("Share revoked");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to revoke share."),
  });

  const manageItem = (share: OutgoingShare) => {
    setShareFile({
      id: Number(share.id) || 0,
      name: share.name,
      path: share.path,
      type: share.itemType,
      mimeType: null,
      size: 0,
      modifiedAt: share.sharedAt,
      parentPath: share.path.split("/").slice(0, -1).join("/") || "/",
    });
  };

  const copyShareUrl = (url: string) => {
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    showToast("Link copied");
  };

  const openSharedItem = (item: IncomingShare) => {
    const parent = item.path.split("/").slice(0, -1).join("/") || "/";
    setCurrentPath(item.itemType === "folder" ? item.path : parent);
    setHighlightedPath(item.itemType === "file" ? item.path : null);
    setFilesView("mine");
  };

  // NOTE: distinct query key ("files-browser") so this full directory listing never
  // collides with the root-summary queries in TopBar/CommandPalette/Talk, which share
  // ["/api/files", "/"] but cache the raw { data: [...] } wrapper. Sharing that key made
  // the browser read a non-array and render "empty" until a mutation forced a refetch.
  const filesQuery = useQuery({
    queryKey: ["files-browser", currentPath],
    queryFn: () => fetchJson<{ data: CloudFile[] }>(`/api/files?path=${encodeURIComponent(currentPath)}`).then((payload) => payload.data),
  });

  const rawFiles = filesQuery.data as CloudFile[] | { data?: CloudFile[] } | undefined;
  const allFiles = Array.isArray(rawFiles)
    ? rawFiles
    : Array.isArray(rawFiles?.data)
      ? rawFiles.data
      : [];
  const files = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter((file) => file.name.toLowerCase().includes(q));
  }, [allFiles, search]);
  const totalSize = useMemo(
    () => files.filter((file) => file.type === "file").reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  // Reset the quick-filter when navigating into a different folder.
  useEffect(() => {
    setSearch("");
  }, [currentPath]);

  // Scroll a freshly-created/highlighted folder into view, then fade the highlight.
  useEffect(() => {
    if (!highlightedPath) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightedPath(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightedPath]);

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          type: "folder",
          parentPath: currentPath,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to create folder.");
      }
      return response.json() as Promise<{ data: CloudFile }>;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["files-browser", currentPath] });
      setNewFolderOpen(false);
      setNewFolderName("");
      setSearch("");
      // Highlight (and scroll to) the newly created folder for clear feedback.
      if (result?.data?.path) setHighlightedPath(result.data.path);
      showToast("Folder created");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "Unable to create folder.");
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (file: CloudFile) => {
      const response = await fetch(`/api/files/${file.id}?path=${encodeURIComponent(file.path)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to delete file.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files-browser", currentPath] });
      showToast("Deleted successfully");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "Unable to delete file.");
    },
  });

  const breadcrumbs = currentPath === "/"
    ? [{ label: "Home", path: "/" }]
    : [
        { label: "Home", path: "/" },
        ...currentPath.split("/").filter(Boolean).map((segment, index, segments) => ({
          label: segment,
          path: `/${segments.slice(0, index + 1).join("/")}`,
        })),
      ];

  const refreshFiles = async () => {
    setIsRefreshing(true);
    await filesQuery.refetch();
    setIsRefreshing(false);
  };

  const handleDownload = async (file: CloudFile) => {
    try {
      const response = await fetch(`/api/files/${file.id}?path=${encodeURIComponent(file.path)}&download=1`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to download file.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      window.URL.revokeObjectURL(url);
      showToast("Download started");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to download file.");
    }
  };

  const handleUploadSelection = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    for (const file of Array.from(selectedFiles)) {
      setUploadProgress((current) => ({ ...current, [file.name]: 0 }));
      try {
        await uploadViaAdapter(file, currentPath, (value) => {
          setUploadProgress((current) => ({ ...current, [file.name]: value }));
        });
        showToast(`${file.name} uploaded`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : `Unable to upload ${file.name}`);
      } finally {
        setUploadProgress((current) => {
          const next = { ...current };
          delete next[file.name];
          return next;
        });
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await queryClient.invalidateQueries({ queryKey: ["files-browser", currentPath] });
  };

  const openPicker = () => fileInputRef.current?.click();

  const errorMessage = useMemo(() => {
    if (!filesQuery.error) return null;
    if (isUnauthorizedError(filesQuery.error)) return "Your session expired. Please sign in again.";
    if (isFeatureUnavailableError(filesQuery.error)) return "Files are unavailable for this Nextcloud connection.";
    return filesQuery.error instanceof Error ? filesQuery.error.message : "Unable to load files.";
  }, [filesQuery.error]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => void handleUploadSelection(event.target.files)}
      />

      <div className="flex h-full flex-col">
        <div className="border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border text-sm">
              <button
                onClick={() => setFilesView("mine")}
                className={`px-3 py-1.5 transition-colors ${filesView === "mine" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                My files
              </button>
              <button
                onClick={() => setFilesView("shared")}
                className={`px-3 py-1.5 transition-colors ${filesView === "shared" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                Shared with me
              </button>
              <button
                onClick={() => setFilesView("sharedByMe")}
                className={`border-l px-3 py-1.5 transition-colors ${filesView === "sharedByMe" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                Shared by me
              </button>
            </div>

            {filesView === "mine" && (
              <nav className="flex items-center gap-1 text-sm text-muted-foreground">
                {breadcrumbs.map((crumb, index) => (
                  <span key={crumb.path} className="flex items-center gap-1">
                    {index > 0 && <span>/</span>}
                    <button
                      onClick={() => setCurrentPath(crumb.path)}
                      className="rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {crumb.label === "Home" ? <Home className="h-4 w-4" /> : crumb.label}
                    </button>
                  </span>
                ))}
              </nav>
            )}

            {filesView === "mine" && (
              <>
                <div className="relative ml-auto w-full max-w-xs sm:ml-4">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search this folder…"
                    aria-label="Search files and folders"
                    className="h-9 pl-8 pr-8"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
                    <FolderPlus className="mr-1 h-4 w-4" /> New Folder
                  </Button>
                  <Button size="sm" onClick={openPicker}>
                    <Upload className="mr-1 h-4 w-4" /> Upload
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => void refreshFiles()}>
                    {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {Object.keys(uploadProgress).length > 0 && (
          <div className="border-b bg-muted/30 px-4 py-3">
            <div className="space-y-2">
              {Object.entries(uploadProgress).map(([name, progress]) => (
                <div key={name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="truncate font-medium">{name}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {filesView === "shared" ? (
            incomingQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : incomingQuery.error ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
                  <p className="text-sm text-muted-foreground">Unable to load items shared with you.</p>
                </div>
              </div>
            ) : incomingShares.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Share2 className="mb-3 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm font-medium">Nothing shared with you yet</p>
                <p className="mt-1 text-sm text-muted-foreground">When someone shares a file or folder, it appears here.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[minmax(0,1fr)_200px_140px] border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Name</span>
                  <span>Shared by</span>
                  <span className="text-right">When</span>
                </div>
                {incomingShares.map((item) => {
                  const { icon: Icon, color } = getFileIcon(null, item.itemType);
                  return (
                    <button
                      key={item.id}
                      onClick={() => openSharedItem(item)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_200px_140px] items-center border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/20"
                      title="Open"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                        <span className="truncate text-sm font-medium">{item.name}</span>
                      </span>
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${getAvatarColor(item.ownerDisplayName)}`}>
                          {getInitials(item.ownerDisplayName)}
                        </span>
                        <span className="truncate">{item.ownerDisplayName}</span>
                      </span>
                      <span className="text-right text-sm text-muted-foreground">
                        {format(new Date(item.sharedAt), "MMM d, yyyy")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : filesView === "sharedByMe" ? (
            outgoingQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : outgoingQuery.error ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
                  <p className="text-sm text-muted-foreground">Unable to load the items you’ve shared.</p>
                </div>
              </div>
            ) : outgoingShares.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Share2 className="mb-3 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm font-medium">You haven’t shared anything yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Use the ⋯ menu on a file or folder to share it.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_96px] border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Name</span>
                  <span>Shared with</span>
                  <span className="text-right">When</span>
                  <span />
                </div>
                {outgoingShares.map((share) => {
                  const { icon: Icon, color } = getFileIcon(null, share.itemType);
                  const isLink = share.shareType === 3;
                  return (
                    <div
                      key={share.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_96px] items-center border-b px-4 py-3 last:border-b-0 hover:bg-muted/20"
                    >
                      <button onClick={() => manageItem(share)} className="flex min-w-0 items-center gap-3 text-left" title="Manage sharing">
                        <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                        <span className="truncate text-sm font-medium">{share.name}</span>
                      </button>
                      {isLink ? (
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          <Link2 className="h-4 w-4 shrink-0 text-amber-600" />
                          <span className="truncate text-amber-600">Public link</span>
                        </span>
                      ) : (
                        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${getAvatarColor(share.shareWithDisplayName || "?")}`}>
                            {getInitials(share.shareWithDisplayName || "?")}
                          </span>
                          <span className="truncate">{share.shareWithDisplayName}</span>
                          <span className="shrink-0 text-xs">{share.permissions > 1 ? "· edit" : "· view"}</span>
                        </span>
                      )}
                      <span className="text-right text-sm text-muted-foreground">
                        {format(new Date(share.sharedAt), "MMM d, yyyy")}
                      </span>
                      <span className="flex items-center justify-end gap-1">
                        {isLink && share.url && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Copy link" onClick={() => copyShareUrl(share.url!)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Revoke share"
                          onClick={() => revokeOutgoing.mutate(share.id)} disabled={revokeOutgoing.isPending}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          ) : filesQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : errorMessage ? (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            </div>
          ) : files.length === 0 && search ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Search className="mb-3 h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm font-medium">No files match “{search}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different search in this folder.</p>
              <Button variant="ghost" className="mt-4" onClick={() => setSearch("")}>
                Clear search
              </Button>
            </div>
          ) : files.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Folder className="mb-3 h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm font-medium">This folder is empty</p>
              <p className="mt-1 text-sm text-muted-foreground">Upload files or create a folder to get started.</p>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" onClick={() => setNewFolderOpen(true)}>
                  <FolderPlus className="mr-1 h-4 w-4" /> New Folder
                </Button>
                <Button onClick={openPicker}>
                  <Upload className="mr-1 h-4 w-4" /> Upload
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div className="grid grid-cols-[minmax(0,1fr)_120px_160px_48px] border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Name</span>
                <span className="text-right">Size</span>
                <span className="text-right">Modified</span>
                <span />
              </div>

              {files.map((file) => {
                const { icon: Icon, color } = getFileIcon(file.mimeType, file.type);
                const isHighlighted = file.path === highlightedPath;
                const canPreview = file.type === "file" && isPreviewable(file.mimeType);
                return (
                  <div
                    key={file.path}
                    ref={isHighlighted ? highlightRef : undefined}
                    className={`grid grid-cols-[minmax(0,1fr)_120px_160px_48px] items-center border-b px-4 py-3 last:border-b-0 transition-colors ${
                      isHighlighted ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "hover:bg-muted/20"
                    }`}
                  >
                    <button
                      onClick={() => {
                        if (file.type === "folder") {
                          setCurrentPath(file.path);
                        } else {
                          setPreviewFile(file);
                        }
                      }}
                      className="flex min-w-0 items-center gap-3 text-left"
                      title={file.type === "folder" ? "Open folder" : "Preview file"}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{file.path}</p>
                      </div>
                    </button>

                    <span className="text-right text-sm text-muted-foreground">
                      {file.type === "file" ? formatBytes(file.size) : "—"}
                    </span>
                    <span className="text-right text-sm text-muted-foreground">
                      {format(new Date(file.modifiedAt), "MMM d, yyyy HH:mm")}
                    </span>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canPreview && (
                          <DropdownMenuItem onClick={() => setPreviewFile(file)}>
                            <Eye className="mr-2 h-4 w-4" /> Preview
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setShareFile(file)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share
                        </DropdownMenuItem>
                        {file.type === "file" && (
                          <DropdownMenuItem onClick={() => void handleDownload(file)}>
                            <Download className="mr-2 h-4 w-4" /> Download
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => deleteFileMutation.mutate(file)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {filesView === "shared" ? (
          !incomingQuery.isLoading && !incomingQuery.error && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {incomingShares.length} item{incomingShares.length === 1 ? "" : "s"} shared with you
            </div>
          )
        ) : filesView === "sharedByMe" ? (
          !outgoingQuery.isLoading && !outgoingQuery.error && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {outgoingShares.length} active share{outgoingShares.length === 1 ? "" : "s"}
            </div>
          )
        ) : (
          !filesQuery.isLoading && !errorMessage && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {search
                ? `${files.length} of ${allFiles.length} items match · ${formatBytes(totalSize)}`
                : `${files.length} items · ${formatBytes(totalSize)}`}
            </div>
          )
        )}
      </div>

      <FilePreview
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={(file) => void handleDownload(file)}
      />

      <ShareDialog file={shareFile} onClose={() => setShareFile(null)} />

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newFolderName.trim()) {
                  createFolderMutation.mutate(newFolderName.trim());
                }
              }}
              placeholder="Project Files"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createFolderMutation.mutate(newFolderName.trim())}
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
            >
              {createFolderMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
