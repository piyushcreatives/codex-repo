import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Archive,
  Download,
  File,
  FileCode,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Image,
  Loader2,
  MoreVertical,
  RefreshCw,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { fetchJson, isFeatureUnavailableError, isUnauthorizedError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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

  const filesQuery = useQuery({
    queryKey: ["/api/files", currentPath],
    queryFn: () => fetchJson<{ data: CloudFile[] }>(`/api/files?path=${encodeURIComponent(currentPath)}`).then((payload) => payload.data),
  });

  const files = Array.isArray(filesQuery.data) ? filesQuery.data : [];
  const totalSize = useMemo(
    () => files.filter((file) => file.type === "file").reduce((sum, file) => sum + file.size, 0),
    [files],
  );

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/files", currentPath] });
      setNewFolderOpen(false);
      setNewFolderName("");
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
      await queryClient.invalidateQueries({ queryKey: ["/api/files", currentPath] });
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

    await queryClient.invalidateQueries({ queryKey: ["/api/files", currentPath] });
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

            <div className="ml-auto flex flex-wrap items-center gap-2">
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
          {filesQuery.isLoading ? (
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
                return (
                  <div
                    key={file.path}
                    className="grid grid-cols-[minmax(0,1fr)_120px_160px_48px] items-center border-b px-4 py-3 last:border-b-0 hover:bg-muted/20"
                  >
                    <button
                      onClick={() => {
                        if (file.type === "folder") {
                          setCurrentPath(file.path);
                        }
                      }}
                      className="flex min-w-0 items-center gap-3 text-left"
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

        {!filesQuery.isLoading && !errorMessage && (
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            {files.length} items · {formatBytes(totalSize)}
          </div>
        )}
      </div>

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
