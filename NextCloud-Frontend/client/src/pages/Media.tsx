import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { fetchJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type MediaItem = {
  id: number;
  name: string;
  path: string;
  parentPath: string;
  mimeType: string | null;
  size: number;
  modifiedAt: string;
  mediaKind: "image" | "video";
};

type ViewMode = "large" | "small" | "list";
type SortMode = "newest" | "oldest" | "name" | "size";

function showToast(message: string) {
  const existing = document.getElementById("cs-toast");
  if (existing) existing.remove();
  const element = document.createElement("div");
  element.id = "cs-toast";
  element.className =
    "fixed bottom-4 right-4 z-[60] rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg animate-fade-in";
  element.textContent = message;
  document.body.appendChild(element);
  window.setTimeout(() => element.remove(), 2500);
}

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function mediaUrl(item: MediaItem) {
  return `/api/files/${item.id}?path=${encodeURIComponent(item.path)}&download=1`;
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

export default function Media() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedAlbum, setSelectedAlbum] = useState("All Media");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("large");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [favourites, setFavourites] = useState<Set<number>>(new Set());

  const mediaQuery = useQuery({
    queryKey: ["/api/media"],
    queryFn: () => fetchJson<{ data: MediaItem[] }>("/api/media"),
  });

  const mediaFiles = mediaQuery.data?.data || [];
  const albumOptions = useMemo(() => {
    const parents = new Set(
      mediaFiles.map((item) => (item.parentPath === "/" ? "Root" : item.parentPath.split("/").filter(Boolean).at(-1) || "Root")),
    );
    return ["All Media", ...Array.from(parents).sort()];
  }, [mediaFiles]);

  const filteredMedia = useMemo(() => {
    let next = [...mediaFiles];
    if (selectedAlbum !== "All Media") {
      next = next.filter((item) => {
        const albumName = item.parentPath === "/" ? "Root" : item.parentPath.split("/").filter(Boolean).at(-1) || "Root";
        return albumName === selectedAlbum;
      });
    }

    if (activeFilter === "Favourites") {
      next = next.filter((item) => favourites.has(item.id));
    } else if (activeFilter === "Videos") {
      next = next.filter((item) => item.mediaKind === "video");
    } else if (activeFilter === "Images") {
      next = next.filter((item) => item.mediaKind === "image");
    } else if (activeFilter === "Recently added") {
      next = next.slice().sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 12);
    }

    switch (sortMode) {
      case "oldest":
        next.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
        break;
      case "name":
        next.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "size":
        next.sort((a, b) => b.size - a.size);
        break;
      default:
        next.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
        break;
    }

    return next;
  }, [activeFilter, favourites, mediaFiles, selectedAlbum, sortMode]);

  const grouped = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    for (const item of filteredMedia) {
      const key = format(new Date(item.modifiedAt), "MMMM yyyy");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filteredMedia]);

  const deleteMutation = useMutation({
    mutationFn: async (item: MediaItem) => {
      const response = await fetch(`/api/files/${item.id}?path=${encodeURIComponent(item.path)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to delete media.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      showToast("Deleted successfully");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to delete media."),
  });

  const toggleFavourite = (id: number) => {
    setFavourites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownload = async (item: MediaItem) => {
    try {
      const response = await fetch(mediaUrl(item));
      if (!response.ok) throw new Error("Unable to download media.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.URL.revokeObjectURL(url);
      showToast("Download started");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to download media.");
    }
  };

  const handleUploadSelection = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;
    for (const file of Array.from(selectedFiles)) {
      setUploadProgress((current) => ({ ...current, [file.name]: 0 }));
      try {
        await uploadViaAdapter(file, "/", (value) => {
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
    await queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    setUploadOpen(false);
  };

  const activeMedia = lightboxIndex !== null ? filteredMedia[lightboxIndex] : null;
  const gridCols =
    viewMode === "large"
      ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5"
      : "grid-cols-5 sm:grid-cols-6 lg:grid-cols-8";

  return (
    <div className="flex h-[calc(100vh-var(--topbar-height))]">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,video/*"
        multiple
        onChange={(event) => void handleUploadSelection(event.target.files)}
      />

      <div className="w-[220px] border-r flex-shrink-0 flex flex-col overflow-y-auto">
        <p className="text-sm font-semibold px-3 pt-4 pb-2">Media</p>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1">Albums</p>
        {albumOptions.map((album) => (
          <button
            key={album}
            onClick={() => { setSelectedAlbum(album); setActiveFilter(null); }}
            className={cn(
              "px-3 py-1.5 rounded-lg mx-1 cursor-pointer flex items-center justify-between text-left w-[calc(100%-8px)]",
              selectedAlbum === album && !activeFilter ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted/60",
            )}
          >
            <span className="flex items-center gap-2">
              <Folder size={14} className="text-muted-foreground" />
              <span className="text-sm">{album}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {album === "All Media"
                ? mediaFiles.length
                : mediaFiles.filter((item) => (item.parentPath === "/" ? "Root" : item.parentPath.split("/").filter(Boolean).at(-1) || "Root") === album).length}
            </span>
          </button>
        ))}

        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">Filter</p>
        {["Images", "Videos", "Favourites", "Recently added"].map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(activeFilter === filter ? null : filter)}
            className={cn(
              "px-3 py-1.5 rounded-lg mx-1 cursor-pointer flex items-center gap-2 text-left w-[calc(100%-8px)]",
              activeFilter === filter ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted/60",
            )}
          >
            {filter === "Videos" ? <Video size={14} className="text-muted-foreground" /> : <ImageIcon size={14} className="text-muted-foreground" />}
            <span className="text-sm">{filter}</span>
          </button>
        ))}

        <div className="mt-auto p-3">
          <Button className="w-full gap-2" onClick={() => setUploadOpen(true)}>
            <Upload size={16} /> Upload media
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b flex items-center gap-3 flex-shrink-0">
          <span className="text-sm font-semibold flex-1">{activeFilter || selectedAlbum}</span>
          <span className="text-xs text-muted-foreground">{filteredMedia.length} items</span>

          <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
              <SelectItem value="size">Size</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex border rounded-md">
            <Button variant={viewMode === "large" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-r-none" onClick={() => setViewMode("large")}>
              <LayoutGrid size={14} />
            </Button>
            <Button variant={viewMode === "small" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-none border-x" onClick={() => setViewMode("small")}>
              <Grid3X3 size={14} />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-l-none" onClick={() => setViewMode("list")}>
              <List size={14} />
            </Button>
          </div>

          <Button
            variant={selectMode ? "secondary" : "outline"}
            size="sm"
            className="gap-1"
            onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
          >
            <CheckSquare size={14} /> Select
          </Button>
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

        {selectMode && (
          <div className="px-4 py-2 bg-primary/5 border-b flex items-center gap-3 animate-fade-in flex-shrink-0">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(filteredMedia.map((item) => item.id)))}>
              Select all
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => selected.forEach((id) => toggleFavourite(id))}>
              <Heart size={14} /> Favourite
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-destructive"
              onClick={() => {
                filteredMedia.filter((item) => selected.has(item.id)).forEach((item) => deleteMutation.mutate(item));
                setSelected(new Set());
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {mediaQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading media...
            </div>
          ) : filteredMedia.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <ImageIcon size={40} className="text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No media files found</p>
            </div>
          ) : viewMode === "list" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground text-xs">
                  <th className="pb-2 w-16" />
                  <th className="pb-2">Filename</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Size</th>
                  <th className="pb-2">Updated</th>
                  <th className="pb-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {filteredMedia.map((item, index) => (
                  <tr key={item.id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => !selectMode && setLightboxIndex(index)}>
                    <td className="py-2">
                      {item.mediaKind === "image" ? (
                        <img src={mediaUrl(item)} alt={item.name} className="w-12 h-12 object-cover rounded" loading="lazy" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center"><Video size={18} /></div>
                      )}
                    </td>
                    <td className="py-2 font-medium">{item.name}</td>
                    <td className="py-2 text-muted-foreground">{item.mediaKind}</td>
                    <td className="py-2 text-muted-foreground">{formatBytes(item.size)}</td>
                    <td className="py-2 text-muted-foreground">{format(new Date(item.modifiedAt), "MMM d, yyyy")}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(event) => { event.stopPropagation(); void handleDownload(item); }}>
                          <Download size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(event) => { event.stopPropagation(); toggleFavourite(item.id); }}>
                          <Heart size={14} className={favourites.has(item.id) ? "fill-current text-rose-500" : ""} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(event) => { event.stopPropagation(); deleteMutation.mutate(item); }}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            grouped.map(([month, items]) => (
              <div key={month}>
                <div className="mb-3 mt-4 first:mt-0">
                  <h3 className="text-sm font-semibold text-foreground">{month}</h3>
                  <p className="text-xs text-muted-foreground">{items.length} items</p>
                </div>
                <div className={cn("grid gap-2", gridCols)}>
                  {items.map((item) => {
                    const itemIndex = filteredMedia.indexOf(item);
                    const isSelected = selected.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={cn("relative group cursor-pointer overflow-hidden rounded-lg bg-muted aspect-square", isSelected && "ring-2 ring-primary")}
                        onClick={() => selectMode ? setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        }) : setLightboxIndex(itemIndex)}
                      >
                        {item.mediaKind === "image" ? (
                          <img src={mediaUrl(item)} alt={item.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-900 text-white">
                            <Video size={32} />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                          <p className="text-white text-xs truncate">{item.name}</p>
                        </div>
                        {favourites.has(item.id) && <Heart size={14} className="absolute top-2 right-2 fill-white text-white drop-shadow" />}
                        {selectMode && (
                          <div className={cn("absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center", isSelected ? "bg-primary border-primary" : "border-white bg-black/20")}>
                            {isSelected && <Check size={12} className="text-white" />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {activeMedia && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
            <div>
              <p className="text-white text-sm font-medium">{activeMedia.name}</p>
              <p className="text-white/50 text-xs">
                {formatBytes(activeMedia.size)} · {format(new Date(activeMedia.modifiedAt), "MMM d, yyyy")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="text-white/70 hover:text-white p-2" onClick={() => toggleFavourite(activeMedia.id)}>
                <Heart size={18} className={favourites.has(activeMedia.id) ? "fill-white" : ""} />
              </button>
              <button className="text-white/70 hover:text-white p-2" onClick={() => void handleDownload(activeMedia)}>
                <Download size={18} />
              </button>
              <button className="text-white/70 hover:text-white p-2" onClick={() => setLightboxIndex(null)}>
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center relative px-16 min-h-0">
            {lightboxIndex !== null && lightboxIndex > 0 && (
              <button
                onClick={() => setLightboxIndex(lightboxIndex - 1)}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {activeMedia.mediaKind === "image" ? (
              <img src={mediaUrl(activeMedia)} alt={activeMedia.name} className="max-h-full max-w-full object-contain rounded" />
            ) : (
              <video src={mediaUrl(activeMedia)} controls className="max-h-full max-w-full rounded" />
            )}
            {lightboxIndex !== null && lightboxIndex < filteredMedia.length - 1 && (
              <button
                onClick={() => setLightboxIndex(lightboxIndex + 1)}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>
        </div>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Media</DialogTitle>
          </DialogHeader>
          <div className="border-2 border-dashed border-primary/40 rounded-xl p-12 text-center">
            <Upload size={48} className="mx-auto text-indigo-400/40 mb-4" />
            <p className="font-semibold mb-1">Choose image or video files</p>
            <p className="text-sm text-muted-foreground mb-4">They will be uploaded to your Nextcloud root folder.</p>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Browse files
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
