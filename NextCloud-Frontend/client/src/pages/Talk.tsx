import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import {
  MessageSquare, SquarePen, Phone, Video, MonitorUp,
  Search, PanelRight, Paperclip, Smile, SendHorizontal,
  Users, PhoneOff, X, FileText, Image, File,
  Bell, BellOff, Crown, Trash2, UserPlus, Mic, MicOff,
  Volume2, VolumeX, Grid3x3, MoreHorizontal, VideoOff,
  ChevronRight, ChevronUp, ChevronDown, Reply, Forward, Copy, Download, Trash,
  FilePlus, FileIcon, FileImage, FileVideo, FileAudio, FileArchive,
  FileSpreadsheet, FileType, ArrowDown, Pause, Play, Maximize, Minimize,
  UserRoundPlus, StopCircle, SignalHigh, Loader2,
} from "lucide-react";
import { cn, getAvatarColor, getInitials } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Conversation, Message } from "@shared/schema";

// â"€â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function formatMessageTime(dateStr: string) {
  return format(new Date(dateStr), "h:mm a");
}

function formatDateSeparator(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, d MMM");
}

function formatRelativeTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return format(d, "MMM d");
}

function formatCallDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function getMediaAccessErrorMessage(error: unknown, action: "call" | "screen-share" = "call") {
  const isSecureOrigin =
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  if (!isSecureOrigin) {
    return action === "screen-share"
      ? "Screen sharing requires HTTPS or localhost. Open this app over HTTPS to share your screen from another device."
      : "Camera and microphone access require HTTPS or localhost. This LAN HTTP URL can only run signaling-only mode.";
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return action === "screen-share"
        ? "Screen share permission was blocked by the browser."
        : "Camera or microphone permission was blocked by the browser.";
    }
    if (error.name === "NotFoundError") {
      return action === "screen-share"
        ? "No screen-sharing source is available on this device."
        : "No camera or microphone was found on this device.";
    }
    if (error.name === "NotReadableError") {
      return action === "screen-share"
        ? "Screen sharing is already being used by another application."
        : "The camera or microphone is already being used by another application.";
    }
  }

  return action === "screen-share"
    ? "Unable to start screen sharing on this device."
    : "Unable to access the camera or microphone on this device.";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMOJI_LIST = ["😀","😂","👍","❤️","🎉","🔥","👀","🙏","💯","✅","🚀","😎","🤔","💡","📌","✨","🎯","📊","🏆","👋"];
const ACTIVE_CONVERSATION_STORAGE_KEY = "cloudspace:talk:activeConversationId";

// ── Timing constants (ms) ──
/** How long to ring before auto-ending an unanswered call */
const CALL_RING_TIMEOUT_MS = 30_000;
/** How long the incoming-call banner stays before auto-dismissing */
const INCOMING_CALL_DISMISS_MS = 15_000;
/** Interval between ringtone tone bursts */
const RINGTONE_INTERVAL_MS = 2_200;
/** Grace period after ending a call — suppresses re-ring from stale signal */
const RECENTLY_ENDED_SUPPRESS_MS = 10_000;
/** Minimum call age before we auto-end when everyone else leaves */
const MIN_CALL_AGE_FOR_AUTO_END_MS = 2_000;
/** Minimum call age for group auto-end (stricter) */
const MIN_GROUP_CALL_AGE_FOR_AUTO_END_MS = 5_000;
/** Call duration counter tick */
const CALL_DURATION_TICK_MS = 1_000;

// ── Call overlay theme tokens ──
const CALL_BG = "bg-[#1a1a1a]";
const CALL_BG_HEX = "#1a1a1a";
const CALL_SURFACE = "bg-[#252525]";
const CALL_SURFACE_HEX = "#252525";
const CALL_ACCENT = "#5b5fc7";
const CALL_DANGER = "#d13438";
const CALL_DANGER_HOVER = "#bc2f32";
const CALL_SUCCESS = "#107c10";
const CALL_SUCCESS_HOVER = "#0e6b0e";

const QUICK_REACTIONS = ["👍","❤️","😂","🎉","👀","🔥"];

function parseAttachmentMessage(content: string): { name: string; path: string; shareLink?: string } | null {
  if (!content.startsWith("Shared file: ")) return null;
  const lines = content.split("\n");
  if (lines.length < 2) return null;
  const name = lines[0].replace("Shared file: ", "");
  const path = lines[1];
  // Line 3 might be a share link (starts with http)
  const shareLink = lines[2] && lines[2].startsWith("http") ? lines[2] : undefined;
  return { name, path, shareLink };
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return FileImage;
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return FileVideo;
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return FileAudio;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['pdf'].includes(ext)) return FileType;
  if (['doc', 'docx', 'txt', 'rtf', 'md'].includes(ext)) return FileText;
  return FileIcon;
}


type TalkDirectoryUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
};

type TalkParticipant = {
  attendeeId: number;
  actorId: string;
  actorType: string;
  displayName: string;
  email: string | null;
  isModerator: boolean;
  status: string | null;
  statusMessage: string | null;
  lastPing: number;
};

type SharedFile = {
  id: number;
  name: string;
  path?: string;
  size: number;
  mimeType: string | null;
  modifiedAt: string;
};

type UploadedTalkFile = {
  id: number;
  name: string;
  path: string;
  type: "file" | "folder";
  mimeType: string | null;
  size: number;
  modifiedAt: string;
  parentPath: string;
};

function getPreferredConversationId(conversations: Conversation[]) {
  const noteToSelf = conversations.find((conversation) => conversation.name === "Note to self");
  if (noteToSelf) return noteToSelf.id;

  const firstDirectMessage = conversations.find((conversation) => conversation.type === "dm");
  if (firstDirectMessage) return firstDirectMessage.id;

  const firstNonAnnouncement = conversations.find((conversation) => conversation.name !== "Talk updates ✅");
  if (firstNonAnnouncement) return firstNonAnnouncement.id;

  return conversations[0]?.id ?? null;
}

// â"€â"€â"€ Toast system â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function useToast() {
  const [toast, setToast] = useState<{ message: string; action?: React.ReactNode } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((message: string, action?: React.ReactNode) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, action });
    timerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);
  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);
  return { toast, show, dismiss };
}

function ToastOverlay({ toast, onDismiss }: { toast: { message: string; action?: React.ReactNode } | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
      <div className="bg-foreground text-background rounded-lg px-4 py-3 shadow-lg flex items-center gap-3 text-sm max-w-sm">
        <span className="flex-1">{toast.message}</span>
        {toast.action}
        <button onClick={onDismiss} className="hover:opacity-70"><X size={14} /></button>
      </div>
    </div>
  );
}

// â"€â"€â"€ Mock members data â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// â"€â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

type CallState = {
  active: boolean;
  type: "voice" | "video" | "screen";
  conversationId: number;
  conversationName: string;
  startedAt: Date;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeakerOn: boolean;
  isScreenSharing: boolean;
  participants: {
    id: number;
    username: string;
    name: string;
    status: "ringing" | "joined" | "declined" | "left";
    isSpeaking: boolean;
  }[];
  duration: number;
};

type ConversationCallParticipant = {
  username: string;
  displayName: string;
  status: "ringing" | "joined" | "declined" | "left";
  joinedAt: string | null;
};

type ConversationCallSignal = {
  conversationId: number;
  type: "voice" | "video" | "screen";
  initiatorName: string;
  initiatorUsername: string;
  active: boolean;
  isScreenSharing: boolean;
  startedAt: string;
  updatedAt: string;
  participants: ConversationCallParticipant[];
  signals: Array<{
    id: string;
    from: string;
    to: string;
    kind: "offer" | "answer" | "ice";
    createdAt: string;
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  }>;
  nativeSessionId?: string | null;
  nativeAvailable?: boolean;
  nativeSignalingMode?: string;
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
};

type RemoteCallMedia = {
  username: string;
  displayName: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  /** Secondary camera stream sent by the remote user while they screenshare */
  cameraStream?: MediaStream | null;
  hasCameraVideo?: boolean;
};

type IncomingCallState = {
  callerName: string;
  type: "voice" | "video" | "screen";
};

// â"€â"€â"€ Components â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function Avatar({ name, size = 38, isGroup = false }: { name: string; size?: number; isGroup?: boolean }) {
  const colorClass = getAvatarColor(name);
  return (
    <div
      className={cn("relative shrink-0 rounded-full flex items-center justify-center font-semibold", colorClass)}
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {isGroup ? <Users size={size * 0.45} /> : getInitials(name)}
    </div>
  );
}

function OnlineDot({ size = 8, className, isOnline = true }: { size?: number; className?: string; isOnline?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-full border-2 border-background",
        isOnline ? "bg-green-500" : "bg-gray-400",
        className
      )}
      style={{ width: size, height: size }}
    />
  );
}

function isRecentlyActive(dateStr: string | null | undefined, thresholdMinutes = 5): boolean {
  if (!dateStr) return false;
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff < thresholdMinutes * 60 * 1000;
}

// â"€â"€â"€ Conversation List Item â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function ConversationRow({
  conversation: c,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 cursor-pointer px-3 py-2.5 rounded-lg mx-1 text-left transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
      )}
    >
      <div className="relative">
        <Avatar name={c.name} size={38} isGroup={c.type === "group"} />
        {/* Online dot removed from sidebar — shown only in chat header where we have real participant data */}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">{c.name}</span>
            {c.isMuted && <BellOff size={12} className="text-muted-foreground/50 shrink-0" />}
          </div>
          {c.lastMessageAt && (
            <span className="text-xs text-muted-foreground shrink-0 ml-2">
              {formatRelativeTime(c.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground truncate">
            {c.lastMessage || "No messages yet"}
          </span>
          {(c.unreadCount || 0) > 0 && (
            <span className="bg-primary text-white text-[10px] rounded-full px-1.5 min-w-[18px] text-center shrink-0 ml-2">
              {c.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// â"€â"€â"€ Date Separator â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted-foreground px-2">{formatDateSeparator(date)}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// â"€â"€â"€ Message Bubble â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// --- Attachment Bubble ---

function AttachmentBubble({ name, path, isSent, shareLink }: { name: string; path: string; isSent: boolean; shareLink?: string }) {
  const Icon = getFileIcon(name);
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const extUpper = ext.toUpperCase() || "FILE";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext);
  const isPdf = ext === "pdf";
  // Primary: download via the owner's path (works for the file owner)
  const downloadUrl = `/api/files/download?path=${encodeURIComponent(path)}`;
  // Fallback: proxy download via the public share token (works for ANY logged-in user)
  const shareDownloadUrl = shareLink ? `/api/files/share-download?url=${encodeURIComponent(shareLink)}` : null;
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load image/PDF preview via fetch — try API first, fallback to share link
  useEffect(() => {
    if (!isImage) return;
    if (previewFailed) return;
    let cancelled = false;
    const tryFetch = async () => {
      // Try our API endpoint first (works for file owner)
      let res = await fetch(downloadUrl, { credentials: "include" }).catch(() => null);
      if (!res?.ok && shareDownloadUrl) {
        // Fallback: proxy via share token (works for any logged-in user)
        res = await fetch(shareDownloadUrl, { credentials: "include" }).catch(() => null);
      }
      if (res?.ok) {
        const blob = await res.blob();
        if (!cancelled) setPreviewSrc(URL.createObjectURL(blob));
      } else {
        if (!cancelled) setPreviewFailed(true);
      }
    };
    void tryFetch();
    return () => {
      cancelled = true;
      // Revoke the blob URL on cleanup to prevent memory leaks
      if (previewSrc) URL.revokeObjectURL(previewSrc);
    };
  }, [downloadUrl, shareDownloadUrl, isImage, previewFailed]);

  const handleDownload = async () => {
    try {
      // Try our API endpoint first (file owner path)
      let res = await fetch(downloadUrl, { credentials: "include" });
      if (!res.ok && shareDownloadUrl) {
        // Fallback: proxy via share token (works for any logged-in user)
        res = await fetch(shareDownloadUrl, { credentials: "include" });
      }
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Last resort: open share link directly (if available)
      if (shareLink) {
        window.open(shareLink, "_blank");
      }
    }
  };

  return (
    <div className={cn(
      "rounded-xl overflow-hidden border min-w-[220px] max-w-[320px]",
      isSent ? "bg-primary/10 border-primary/20" : "bg-muted/60 border-border"
    )}>
      {/* Image preview */}
      {isImage && previewSrc && (
        <div className="w-full max-h-[200px] overflow-hidden bg-black/5 cursor-pointer" onClick={() => setShowPreview(true)}>
          <img src={previewSrc} alt={name} className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      {/* PDF preview indicator */}
      {isPdf && (
        <div
          className="w-full h-[80px] bg-red-50 dark:bg-red-950/20 flex items-center justify-center cursor-pointer"
          onClick={() => setShowPreview(true)}
        >
          <div className="flex flex-col items-center gap-1">
            <FileType size={28} className="text-red-500" />
            <span className="text-[10px] text-red-500 font-medium">Click to view PDF</span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 p-3">
        <div className={cn(
          "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
          isSent ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        )}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-[11px] text-muted-foreground">{extUpper} file</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleDownload}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0"
            >
              <Download size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
      </div>
      {showPreview && (previewSrc || isPdf) && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setShowPreview(false)}
        >
          <button
            onClick={() => setShowPreview(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
          >
            <X size={28} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
            className="absolute top-4 right-16 text-white/70 hover:text-white z-10 flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm"
          >
            <Download size={16} />
            Download
          </button>
          <div className="max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {isImage && previewSrc ? (
              <img src={previewSrc} alt={name} className="max-w-full max-h-[90vh] object-contain rounded-lg" />
            ) : isPdf ? (
              <iframe
                src={downloadUrl}
                className="w-[80vw] h-[85vh] rounded-lg bg-white"
                title={name}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Unread Divider ---

function UnreadDivider() {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-destructive/40" />
      <span className="text-xs text-destructive font-medium px-2">New messages</span>
      <div className="flex-1 h-px bg-destructive/40" />
    </div>
  );
}

// --- Reply Preview (in composer) ---

function ReplyPreviewBar({ replyTo, onCancel }: { replyTo: Message; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
      <div className="w-0.5 h-8 bg-primary rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-primary">{replyTo.senderName}</p>
        <p className="text-xs text-muted-foreground truncate">{replyTo.content}</p>
      </div>
      <button onClick={onCancel} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted shrink-0">
        <X size={12} />
      </button>
    </div>
  );
}

function MessageBubble({
  message: m,
  isSent,
  showAvatar,
  showSenderName,
  searchQuery = "",
  allMessages = [],
  onReply,
  onForward,
  onReact,
}: {
  message: Message;
  isSent: boolean;
  showAvatar: boolean;
  showSenderName: boolean;
  searchQuery?: string;
  allMessages?: Message[];
  onReply?: (msg: Message) => void;
  onForward?: (msg: Message) => void;
  onReact?: (msgId: number, emoji: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const reactions = m.reactions ? JSON.parse(m.reactions) as Record<string, number> : null;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesSearch =
    normalizedSearch.length > 0 &&
    (m.content.toLowerCase().includes(normalizedSearch) || m.senderName.toLowerCase().includes(normalizedSearch));

  const attachment = parseAttachmentMessage(m.content);
  const replyToMsg = m.replyToId ? allMessages.find((msg) => msg.id === m.replyToId) : null;

  const bubbleClass = cn(
    "rounded-2xl px-3.5 py-2 text-sm",
    isSent ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm",
    matchesSearch && "ring-2 ring-amber-300/80 dark:ring-amber-500/60",
  );

  const renderContent = () => {
    if (attachment) {
      return <AttachmentBubble name={attachment.name} path={attachment.path} isSent={isSent} shareLink={attachment.shareLink} />;
    }
    return (
      <div className={bubbleClass}>
        {replyToMsg && (
          <div className={cn(
            "flex items-center gap-2 mb-1.5 pb-1.5 border-b",
            isSent ? "border-primary-foreground/20" : "border-border"
          )}>
            <div className={cn("w-0.5 h-6 rounded-full shrink-0", isSent ? "bg-primary-foreground/40" : "bg-primary")} />
            <div className="min-w-0">
              <p className={cn("text-[10px] font-medium", isSent ? "text-primary-foreground/70" : "text-primary")}>{replyToMsg.senderName}</p>
              <p className={cn("text-[11px] truncate", isSent ? "text-primary-foreground/60" : "text-muted-foreground")}>{replyToMsg.content}</p>
            </div>
          </div>
        )}
        {m.content}
      </div>
    );
  };

  const renderReactions = () => {
    if (!reactions) return null;
    return (
      <div className={cn("flex gap-1 mt-1 flex-wrap", isSent && "justify-end")}>
        {Object.entries(reactions).map(([emoji, count]) => (
          <button
            key={emoji}
            onClick={() => onReact?.(m.id, emoji)}
            className="bg-muted border rounded-full px-2 py-0.5 text-xs cursor-pointer hover:bg-accent transition-colors"
          >
            {emoji} {count}
          </button>
        ))}
      </div>
    );
  };

  const renderActions = () => {
    if (!showActions) return null;
    return (
      <div className={cn(
        "absolute top-0 flex items-center gap-0.5 bg-background border rounded-lg shadow-sm px-1 py-0.5 z-10",
        isSent ? "right-0 -translate-y-full mr-1" : "left-8 -translate-y-full ml-1"
      )}>
        {/* Quick reactions */}
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => { onReact?.(m.id, emoji); setShowActions(false); }}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-sm"
          >
            {emoji}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => { onReply?.(m); setShowActions(false); }} className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-muted-foreground">
              <Reply size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reply</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => { onForward?.(m); setShowActions(false); }} className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-muted-foreground">
              <Forward size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => { navigator.clipboard.writeText(m.content); setShowActions(false); }} className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-muted-foreground">
              <Copy size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>
      </div>
    );
  };

  if (isSent) {
    return (
      <div
        className={cn("flex items-end gap-2 max-w-[70%] ml-auto flex-row-reverse relative group", !showAvatar && "mt-0.5")}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {renderActions()}
        <div>
          {renderContent()}
          <span className="text-[11px] text-muted-foreground mt-1 mr-1 text-right block">
            {formatMessageTime(m.sentAt)}
          </span>
          {renderReactions()}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-end gap-2 max-w-[70%] relative group", !showAvatar && "mt-0.5 ml-[32px]")}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {showAvatar ? <Avatar name={m.senderName} size={24} /> : null}
      {renderActions()}
      <div>
        {showSenderName && (
          <span className="text-[11px] text-muted-foreground mb-1 ml-1 block">{m.senderName}</span>
        )}
        {renderContent()}
        <span className="text-[11px] text-muted-foreground mt-1 ml-1 block">
          {formatMessageTime(m.sentAt)}
        </span>
        {renderReactions()}
      </div>
    </div>
  );
}

// --- Forward Dialog ---

function ForwardDialog({
  open,
  onClose,
  message,
  conversations,
  onForward,
}: {
  open: boolean;
  onClose: () => void;
  message: Message | null;
  conversations: Conversation[];
  onForward: (conversationId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? conversations.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
        </DialogHeader>
        {message && (
          <div className="bg-muted/50 rounded-lg p-3 mb-3 text-sm">
            <p className="text-[11px] text-muted-foreground mb-1">{message.senderName}</p>
            <p className="truncate">{message.content}</p>
          </div>
        )}
        <Input placeholder="Search conversations..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
        <div className="space-y-1 max-h-[250px] overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => { onForward(c.id); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors"
            >
              <Avatar name={c.name} size={32} isGroup={c.type === "group"} />
              <span className="text-sm font-medium truncate">{c.name}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// â"€â"€â"€ Typing Indicator â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{name} is typing...</span>
    </div>
  );
}

// ——— Teams-Style Shared Call Toolbar ———————————————————————

function TeamsCallToolbar({
  isMuted,
  isVideoOff,
  isScreenSharing,
  showPeoplePanel,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onTogglePeople,
  onLeave,
  onMinimize,
  showVideoToggle = true,
}: {
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  showPeoplePanel: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onTogglePeople: () => void;
  onLeave: () => void;
  onMinimize?: () => void;
  showVideoToggle?: boolean;
}) {
  return (
    <div className={cn("absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-xl px-3 py-2 shadow-2xl", CALL_SURFACE)}>
      {/* Camera */}
      {showVideoToggle && (
        <button
          onClick={onToggleVideo}
          className={cn(
            "flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-[56px]",
            isVideoOff ? `bg-[${CALL_DANGER}] text-white` : "hover:bg-white/10 text-white"
          )}
          style={isVideoOff ? { backgroundColor: CALL_DANGER } : undefined}
        >
          {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
          <span className="text-[10px]">Camera</span>
        </button>
      )}

      {/* Mic */}
      <button
        onClick={onToggleMute}
        className={cn(
          "flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-[56px]",
          isMuted ? "text-white" : "hover:bg-white/10 text-white"
        )}
        style={isMuted ? { backgroundColor: CALL_DANGER } : undefined}
      >
        {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        <span className="text-[10px]">{isMuted ? "Unmute" : "Mute"}</span>
      </button>

      {/* Share */}
      <button
        onClick={onToggleScreenShare}
        className={cn(
          "flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-[56px]",
          isScreenSharing ? "text-white" : "hover:bg-white/10 text-white"
        )}
        style={isScreenSharing ? { backgroundColor: CALL_ACCENT } : undefined}
      >
        {isScreenSharing ? <StopCircle size={20} /> : <MonitorUp size={20} />}
        <span className="text-[10px]">{isScreenSharing ? "Stop" : "Share"}</span>
      </button>

      {/* People */}
      <button
        onClick={onTogglePeople}
        className={cn(
          "flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-[56px]",
          showPeoplePanel ? "bg-white/20 text-white" : "hover:bg-white/10 text-white"
        )}
      >
        <Users size={20} />
        <span className="text-[10px]">People</span>
      </button>

      {/* More */}
      <Popover>
        <PopoverTrigger asChild>
          <button className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg hover:bg-white/10 text-white transition-colors min-w-[56px]">
            <MoreHorizontal size={20} />
            <span className="text-[10px]">More</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className={cn("w-[220px] p-2 border-white/10 text-white", CALL_SURFACE)} side="top" align="center">
          <div className="space-y-1">
            <button
              onClick={() => {
                navigator.mediaDevices.enumerateDevices().then((devices) => {
                  const audioIn = devices.filter((d) => d.kind === "audioinput").map((d) => d.label || "Unknown mic").join("\n");
                  const videoIn = devices.filter((d) => d.kind === "videoinput").map((d) => d.label || "Unknown camera").join("\n");
                  const audioOut = devices.filter((d) => d.kind === "audiooutput").map((d) => d.label || "Unknown speaker").join("\n");
                  alert(`Microphones:\n${audioIn || "None"}\n\nCameras:\n${videoIn || "None"}\n\nSpeakers:\n${audioOut || "None"}`);
                }).catch(() => alert("Unable to list devices"));
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-sm transition-colors"
            >
              <Volume2 size={16} /> Device settings
            </button>
            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => undefined);
                } else {
                  document.exitFullscreen().catch(() => undefined);
                }
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-sm transition-colors"
            >
              <Maximize size={16} /> Full screen
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Minimize */}
      {onMinimize && (
        <button
          onClick={onMinimize}
          className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg hover:bg-white/10 text-white transition-colors min-w-[56px]"
        >
          <Minimize size={20} />
          <span className="text-[10px]">Minimize</span>
        </button>
      )}

      {/* Divider */}
      <div className="w-px h-8 bg-white/20 mx-1" />

      {/* Leave */}
      <button
        onClick={() => onLeave()}
        className="flex flex-col items-center gap-0.5 px-4 py-2 rounded-lg text-white transition-colors min-w-[56px]"
        style={{ backgroundColor: CALL_DANGER }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = CALL_DANGER_HOVER; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = CALL_DANGER; }}
      >
        <PhoneOff size={20} />
        <span className="text-[10px]">Leave</span>
      </button>
    </div>
  );
}

// ——— Teams People Side Panel ———————————————————————————

function TeamsPeoplePanel({
  participants,
  currentUsername,
  availableUsers,
  onAddParticipant,
  onClose,
}: {
  participants: CallState["participants"];
  currentUsername: string;
  availableUsers: TalkDirectoryUser[];
  onAddParticipant: (username: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const participantUsernames = new Set(participants.map((p) => p.username));
  const addableUsers = availableUsers.filter(
    (u) => !participantUsernames.has(u.username) && u.username !== currentUsername
      && (search ? u.displayName.toLowerCase().includes(search.toLowerCase()) : true)
  );

  return (
    <div className={cn("absolute top-0 right-0 bottom-0 w-80 border-l border-white/10 z-20 flex flex-col text-white", CALL_SURFACE)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="font-semibold text-sm">People</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors">
          <X size={16} />
        </button>
      </div>
      <div className="px-3 py-2">
        <Input
          placeholder="Invite someone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/5 border-white/10 text-white text-sm placeholder:text-white/40 h-8"
        />
      </div>
      {/* In this call */}
      <div className="px-3 py-1">
        <p className="text-[11px] text-white/50 font-medium uppercase tracking-wide mb-1">In this call ({participants.filter((p) => p.status === "joined").length})</p>
        <div className="space-y-0.5">
          {participants.filter((p) => p.status === "joined").map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5">
              <div className="relative">
                <Avatar name={p.name} size={28} />
                {p.isSpeaking && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border" style={{ backgroundColor: CALL_ACCENT, borderColor: CALL_SURFACE_HEX }} />
                )}
              </div>
              <span className="text-sm truncate flex-1">{p.username === currentUsername ? `${p.name} (You)` : p.name}</span>
              {/* Mute indicator — only shown for the local user since we can't detect remote mute state */}
            </div>
          ))}
        </div>
      </div>
      {/* Ringing */}
      {participants.some((p) => p.status === "ringing") && (
        <div className="px-3 py-1">
          <p className="text-[11px] text-white/50 font-medium uppercase tracking-wide mb-1">Ringing</p>
          <div className="space-y-0.5">
            {participants.filter((p) => p.status === "ringing").map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                <Avatar name={p.name} size={28} />
                <span className="text-sm truncate flex-1 text-white/60">{p.name}</span>
                <span className="text-[10px] text-yellow-400">Ringing...</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Invite */}
      {search && addableUsers.length > 0 && (
        <div className="px-3 py-1 border-t border-white/10 mt-1">
          <p className="text-[11px] text-white/50 font-medium uppercase tracking-wide mb-1">Invite</p>
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {addableUsers.slice(0, 8).map((u) => (
              <button
                key={u.username}
                onClick={() => onAddParticipant(u.username)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <Avatar name={u.displayName} size={28} />
                <div className="min-w-0 text-left flex-1">
                  <span className="text-sm block truncate">{u.displayName}</span>
                </div>
                <UserPlus size={14} className="text-white/40" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ——— Voice Call Overlay (Teams Style) ————————————————————

function VoiceCallOverlay({ callState, onUpdate, onEnd, onScreenShare, onAddParticipant, remoteMedia, currentUsername, availableUsers, conversationType = "dm", onMinimize }: {
  callState: CallState;
  onUpdate: (partial: Partial<CallState>) => Promise<void> | void;
  onEnd: (reason?: string) => void;
  onScreenShare: () => void;
  onAddParticipant: (username: string) => void;
  remoteMedia: RemoteCallMedia[];
  currentUsername: string;
  availableUsers: TalkDirectoryUser[];
  conversationType?: "dm" | "group";
  onMinimize?: () => void;
}) {
  const [showPeoplePanel, setShowPeoplePanel] = useState(false);

  const joinedRemoteMedia = callState.participants
    .filter((participant) => participant.username !== currentUsername && participant.status === "joined")
    .map((participant) => {
      const media = remoteMedia.find((item) => item.username === participant.username);
      return media ? { participant, media } : null;
    })
    .filter((entry): entry is { participant: CallState["participants"][number]; media: RemoteCallMedia } => !!entry);

  const joinedCount = callState.participants.filter((p) => p.status === "joined").length;
  const ringingParticipants = callState.participants.filter(
    (p) => p.username !== currentUsername && p.status === "ringing",
  );
  const isRinging = ringingParticipants.length > 0 && joinedRemoteMedia.length === 0;
  const hasRemoteJoined = joinedRemoteMedia.length > 0;
  const ringingName = ringingParticipants[0]?.name || callState.conversationName;

  // Stable ref so the timeout doesn't reset when onEnd's reference changes
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Auto-timeout: end call after 30 seconds if nobody answers
  useEffect(() => {
    if (!isRinging) return;
    if (conversationType !== "dm") return; // Group calls: don't auto-end
    const timer = setTimeout(() => {
      onEndRef.current(`${ringingName} is not available`);
    }, CALL_RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isRinging, ringingName, conversationType]);

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col text-white", CALL_BG)}>
      {/* Audio renderers */}
      {joinedRemoteMedia.map(({ media }) => (
        <RemoteAudioRenderer key={media.username} stream={media.stream} muted={!callState.isSpeakerOn} />
      ))}

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">{callState.conversationName}</span>
          {isRinging ? (
            <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
              <Phone size={14} className="animate-pulse" />
              <span>Calling...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-white/50 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {formatCallDuration(callState.duration)}
            </div>
          )}
        </div>
        <div className="text-white/40 text-xs">
          {isRinging
            ? `Ringing ${ringingParticipants.map((p) => p.name.split(" ")[0]).join(", ")}...`
            : hasRemoteJoined
              ? `Connected · ${joinedCount} in call`
              : "Connecting..."}
        </div>
      </div>

      {/* Center: Avatar grid */}
      <div className="flex-1 flex items-center justify-center">
        <div className={cn(
          "grid gap-6 p-8",
          callState.participants.length <= 2 ? "grid-cols-1" : callState.participants.length <= 4 ? "grid-cols-2" : "grid-cols-3"
        )}>
          {callState.participants.map((p) => (
            <div key={p.id} className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  "relative rounded-full p-1",
                  p.isSpeaking && "ring-2 ring-offset-2"
                )}
                style={p.isSpeaking ? { ringColor: CALL_ACCENT, ringOffsetColor: CALL_BG_HEX, ["--tw-ring-color" as string]: CALL_ACCENT, ["--tw-ring-offset-color" as string]: CALL_BG_HEX } : undefined}
              >
                <Avatar name={p.name} size={callState.participants.length <= 2 ? 96 : 72} />
                {p.status === "ringing" && (
                  <div className="absolute bottom-0 right-0 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center border-2" style={{ borderColor: CALL_BG_HEX }}>
                    <Phone size={10} className="text-white" />
                  </div>
                )}
                {p.username === currentUsername && callState.isMuted && p.status === "joined" && (
                  <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full flex items-center justify-center border-2" style={{ backgroundColor: CALL_DANGER, borderColor: CALL_BG_HEX }}>
                    <MicOff size={10} className="text-white" />
                  </div>
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{p.username === currentUsername ? `${p.name} (You)` : p.name}</p>
                {p.status === "ringing" && <p className="text-[11px] text-white/40">Ringing...</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Teams toolbar */}
      <TeamsCallToolbar
        isMuted={callState.isMuted}
        isVideoOff={true}
        isScreenSharing={false}
        showPeoplePanel={showPeoplePanel}
        onToggleMute={() => onUpdate({ isMuted: !callState.isMuted })}
        onToggleVideo={() => onUpdate({ isVideoOff: false })}
        onToggleScreenShare={onScreenShare}
        onTogglePeople={() => setShowPeoplePanel(!showPeoplePanel)}
        onLeave={onEnd}
        onMinimize={onMinimize}
        showVideoToggle={true}
      />

      {/* People panel */}
      {showPeoplePanel && (
        <TeamsPeoplePanel
          participants={callState.participants}
          currentUsername={currentUsername}
          availableUsers={availableUsers}
          onAddParticipant={onAddParticipant}
          onClose={() => setShowPeoplePanel(false)}
        />
      )}
    </div>
  );
}

// â"€â"€â"€ Video Call Overlay â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// ── Ringing center view with countdown ──

function RingingCenterView({ name }: { name: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Math.ceil(CALL_RING_TIMEOUT_MS / 1000) - elapsed);
  const showCountdown = remaining <= 15; // show countdown in the last 15 seconds

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {/* Outer pulse ring */}
        <div className="absolute inset-0 -m-6 rounded-full border-2 animate-ping" style={{ animationDuration: "2s", borderColor: `${CALL_ACCENT}66` }} />
        {/* Middle pulse ring */}
        <div className="absolute inset-0 -m-4 rounded-full border-2 animate-pulse" style={{ animationDuration: "1.5s", borderColor: `${CALL_ACCENT}99` }} />
        <Avatar name={name} size={96} />
      </div>
      <div className="flex flex-col items-center gap-2 mt-2">
        <p className="text-white text-lg font-semibold">{name}</p>
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Phone size={14} className="animate-pulse" />
          <span>Ringing</span>
          <span className="inline-flex">
            <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
          </span>
        </div>
        {showCountdown && (
          <p className="text-white/30 text-xs mt-1">
            Will end in {remaining}s if no answer
          </p>
        )}
      </div>
    </div>
  );
}

function StreamRenderer({
  stream,
  muted = false,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Track count to force re-attach when tracks are added/removed on the same stream
  const [, setTrackCount] = useState(0);

  useEffect(() => {
    if (!ref.current || !stream) {
      if (ref.current) ref.current.srcObject = null;
      return;
    }
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);

    // Listen for track changes on the stream
    const onTrackChange = () => {
      setTrackCount(stream.getTracks().length);
      if (ref.current) {
        ref.current.srcObject = stream;
        void ref.current.play().catch(() => undefined);
      }
    };
    stream.addEventListener("addtrack", onTrackChange);
    stream.addEventListener("removetrack", onTrackChange);

    // Safety: if the video gets paused (e.g., by browser optimisation during
    // DOM reconciliation when a sibling video element starts playing),
    // auto-resume it.
    const el = ref.current;
    const onPause = () => { void el.play().catch(() => undefined); };
    el.addEventListener("pause", onPause);

    return () => {
      stream.removeEventListener("addtrack", onTrackChange);
      stream.removeEventListener("removetrack", onTrackChange);
      el.removeEventListener("pause", onPause);
    };
  }, [stream]);

  // Re-validate srcObject on every render — React DOM reconciliation can
  // sometimes clear srcObject when sibling elements change (e.g. remote
  // video arriving causes the parent to re-render).
  useEffect(() => {
    if (ref.current && stream && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => undefined);
    }
  });

  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function RemoteAudioRenderer({
  stream,
  muted = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.srcObject = stream;
    element.muted = muted;

    const playAudio = () => {
      if (stream) {
        void element.play().catch(() => undefined);
      }
    };

    playAudio();

    if (!stream) return;

    const handleTrackAdded = () => {
      playAudio();
    };

    const handleTrackUnmuted = () => {
      playAudio();
    };

    stream.addEventListener("addtrack", handleTrackAdded);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("unmute", handleTrackUnmuted);
    }

    return () => {
      stream.removeEventListener("addtrack", handleTrackAdded);
      for (const track of stream.getAudioTracks()) {
        track.removeEventListener("unmute", handleTrackUnmuted);
      }
    };
  }, [stream, muted]);

  return <audio ref={ref} autoPlay playsInline hidden />;
}

function VideoCallOverlay({ callState, onUpdate, onEnd, currentUserName, currentUsername, onAddParticipant, localStream, localVideoEnabled, remoteMedia, availableUsers, isRemoteScreenSharing, previousCameraStream, conversationType = "dm", onMinimize }: {
  callState: CallState;
  onUpdate: (partial: Partial<CallState>) => Promise<void> | void;
  onEnd: (reason?: string) => void;
  currentUserName: string;
  currentUsername: string;
  onAddParticipant: (username: string) => void;
  localStream: MediaStream | null;
  localVideoEnabled: boolean;
  remoteMedia: RemoteCallMedia[];
  availableUsers: TalkDirectoryUser[];
  isRemoteScreenSharing?: boolean;
  previousCameraStream?: MediaStream | null;
  /** "dm" for 1:1 calls, "group" for group calls — determines layout */
  conversationType?: "dm" | "group";
  onMinimize?: () => void;
}) {
  const [showPeoplePanel, setShowPeoplePanel] = useState(false);
  // Pin a specific user's video to the main area — "screen" = screenshare, username = that user's camera, null = default
  const [pinnedView, setPinnedView] = useState<string | null>(null);
  const [callElapsed, setCallElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setCallElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const joinedRemoteMedia = callState.participants
    .filter((participant) => participant.username !== currentUsername && participant.status === "joined")
    .map((participant) => {
      const media = remoteMedia.find((item) => item.username === participant.username);
      return {
        participant,
        media: media || {
          username: participant.username,
          displayName: participant.name,
          stream: null,
          hasVideo: false,
        },
      };
    });
  const isDm = conversationType === "dm";
  const featuredRemote = joinedRemoteMedia[0];
  const isSelfSharing = callState.isScreenSharing;
  // Show screenshare layout if either WE are sharing or a REMOTE user is sharing
  const anyoneSharing = isSelfSharing || !!isRemoteScreenSharing;

  // Auto-pin screenshare when someone starts sharing
  useEffect(() => {
    if (anyoneSharing && pinnedView !== "screen") {
      setPinnedView("screen");
    } else if (!anyoneSharing && pinnedView === "screen") {
      setPinnedView(null);
    }
  }, [anyoneSharing]);

  // Use pinned layout (main + sidebar) when anything is pinned OR screenshare is active
  const usePinnedLayout = pinnedView !== null || anyoneSharing;

  // ── Ringing / calling state ──
  const ringingParticipants = callState.participants.filter(
    (p) => p.username !== currentUsername && p.status === "ringing",
  );
  const isRinging = ringingParticipants.length > 0 && joinedRemoteMedia.length === 0;
  const ringingName = ringingParticipants[0]?.name || callState.conversationName;

  // Stable ref so the timeout doesn't reset when onEnd's reference changes
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Auto-timeout: handle unanswered calls
  useEffect(() => {
    if (!isRinging) return;

    if (isDm) {
      // DM: end the entire call after 30s if nobody answers
      const timer = setTimeout(() => {
        onEndRef.current(`${ringingName} is not available`);
      }, CALL_RING_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
    // Group call: we don't auto-end, just let the UI show who hasn't joined
    return undefined;
  }, [isRinging, ringingName, isDm]);

  // Call status label for the top bar
  const callStatusLabel = isRinging
    ? "Calling..."
    : joinedRemoteMedia.length > 0
      ? `Connected · ${joinedRemoteMedia.length + 1} in call`
      : "Connecting...";

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col text-white", CALL_BG)}>
      {/* Audio renderers */}
      {joinedRemoteMedia.map(({ media }) => (
        <RemoteAudioRenderer key={media.username} stream={media.stream} muted={!callState.isSpeakerOn} />
      ))}

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 z-10">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">{callState.conversationName}</span>
          {isRinging ? (
            <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
              <Phone size={12} className="animate-pulse" />
              <span>{callStatusLabel}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-white/50 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span>{formatCallDuration(callState.duration)}</span>
              <span className="text-white/30 mx-1">·</span>
              <span>{callStatusLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* Screen share banner for the sharer */}
      {isSelfSharing && (
        <div className="mx-5 mb-2 rounded-lg px-4 py-2 flex items-center gap-3 z-10" style={{ backgroundColor: `${CALL_ACCENT}e6` }}>
          <MonitorUp size={16} className="text-white" />
          <span className="text-sm font-medium flex-1">You are sharing your screen</span>
          <button
            onClick={() => onUpdate({ isScreenSharing: false })}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white rounded-md px-3 py-1 text-sm font-medium transition-colors"
          >
            <StopCircle size={14} />
            Stop
          </button>
        </div>
      )}

      {/* Video area */}
      <div className={cn("flex-1 p-3 overflow-hidden", showPeoplePanel && "mr-80")}>
        {usePinnedLayout ? (
          /* ── Pinned layout: main content + participant sidebar ── */
          <div className="h-full flex gap-2">
            {/* Main pinned content */}
            <div className={cn("flex-1 rounded-lg flex items-center justify-center relative overflow-hidden", CALL_SURFACE)}>
              {/* Action buttons in main area */}
              <div className="absolute top-3 right-3 z-10 flex gap-2">
                {/* Pin Screen button — when screenshare active but a user camera is pinned */}
                {anyoneSharing && pinnedView !== "screen" && (
                  <button
                    onClick={() => setPinnedView("screen")}
                    className="bg-black/60 hover:bg-black/80 text-white rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <MonitorUp size={14} /> Pin Screen
                  </button>
                )}
                {/* Back to grid — when no screenshare and something is pinned */}
                {pinnedView && !anyoneSharing && (
                  <button
                    onClick={() => setPinnedView(null)}
                    className="bg-black/60 hover:bg-black/80 text-white rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Grid3x3 size={14} /> Back to grid
                  </button>
                )}
              </div>
              {(() => {
                // ── Pin = "screen" → show the screenshare in main area ──
                if (pinnedView === "screen") {
                  if (isSelfSharing && localStream) {
                    return <StreamRenderer stream={localStream} muted className="h-full w-full rounded-lg object-contain" />;
                  }
                  // Find whichever remote is screensharing — their main stream IS the screen
                  const sharingRemote = joinedRemoteMedia.find((r) => r.media.stream && r.media.hasVideo) || featuredRemote;
                  if (sharingRemote?.media.stream && sharingRemote.media.hasVideo) {
                    return <StreamRenderer stream={sharingRemote.media.stream} muted className="h-full w-full rounded-lg object-contain" />;
                  }
                  return (
                    <div className="flex flex-col items-center gap-3">
                      <MonitorUp size={48} className="text-white/20" />
                      <p className="text-white/50 text-sm">{isSelfSharing ? "You are" : (featuredRemote?.participant.name || "Participant") + " is"} sharing</p>
                    </div>
                  );
                }

                // ── Pin = username → show that user's camera/video in main area ──
                if (pinnedView) {
                  if (pinnedView === currentUsername) {
                    return localVideoEnabled && localStream
                      ? <StreamRenderer stream={localStream} muted className="h-full w-full rounded-lg object-cover" />
                      : <Avatar name={currentUserName} size={96} />;
                  }
                  const pinnedRemote = joinedRemoteMedia.find((r) => r.participant.username === pinnedView);
                  if (pinnedRemote?.media.stream) {
                    const hasVid = pinnedRemote.media.stream.getVideoTracks().some((t) => t.readyState === "live");
                    if (hasVid || pinnedRemote.media.hasVideo) {
                      return <StreamRenderer stream={pinnedRemote.media.stream} muted className="h-full w-full rounded-lg object-cover" />;
                    }
                  }
                  return <Avatar name={pinnedRemote?.participant.name || pinnedView} size={96} />;
                }

                // Fallback
                return (
                  <div className="flex flex-col items-center gap-3">
                    <MonitorUp size={48} className="text-white/20" />
                    <p className="text-white/50 text-sm">No content pinned</p>
                  </div>
                );
              })()}
            </div>
            {/* Participant sidebar — shows everyone in the call with camera/avatar */}
            <div className="w-[200px] flex flex-col gap-2 overflow-y-auto shrink-0">
              {/* Self view — always first — click to pin */}
              <div
                className={cn("w-full aspect-[4/3] rounded-lg flex items-center justify-center relative overflow-hidden border shrink-0 cursor-pointer group/tile", CALL_SURFACE, pinnedView === currentUsername && "ring-2")}
                style={{ borderColor: pinnedView === currentUsername ? CALL_ACCENT : `${CALL_ACCENT}80`, ...(pinnedView === currentUsername ? { ["--tw-ring-color" as string]: CALL_ACCENT } : {}) }}
                onClick={() => setPinnedView(pinnedView === currentUsername ? (anyoneSharing ? "screen" : null) : currentUsername)}
              >
                {isSelfSharing ? (
                  // During screenshare: show the saved camera stream, NOT localStream (which is the screen)
                  previousCameraStream && previousCameraStream.getVideoTracks().some((t) => t.readyState === "live") ? (
                    <StreamRenderer stream={previousCameraStream} muted className="h-full w-full object-cover" />
                  ) : (
                    <Avatar name={currentUserName} size={36} />
                  )
                ) : localVideoEnabled && localStream ? (
                  <StreamRenderer stream={localStream} muted className="h-full w-full object-cover" />
                ) : (
                  <Avatar name={currentUserName} size={36} />
                )}
                <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">You</span>
              </div>
              {/* Remote participants */}
              {joinedRemoteMedia.map(({ participant, media }) => {
                // During screenshare the remote may send a secondary cameraStream
                const hasCam = media.cameraStream && media.hasCameraVideo;
                // Check for live video tracks
                const hasLiveVideo = media.stream
                  ? media.stream.getVideoTracks().some((t) => t.readyState === "live")
                  : false;
                // Detect if THIS participant is the one screensharing — their main
                // stream carries the screen, so we must NOT show it in the sidebar.
                // Only show their secondary camera stream (hasCam) or avatar.
                const isThisUserTheScreenSharer = isRemoteScreenSharing && hasLiveVideo
                  && joinedRemoteMedia.filter((r) => r.media.stream && r.media.hasVideo).length > 0
                  && joinedRemoteMedia.find((r) => r.media.stream && r.media.hasVideo)?.participant.username === participant.username;
                const showRegularCamera = !isThisUserTheScreenSharer && media.stream && (media.hasVideo || hasLiveVideo);
                const isPinned = pinnedView === participant.username;
                return (
                  <div
                    key={participant.username}
                    className={cn(
                      "w-full aspect-[4/3] rounded-lg flex items-center justify-center relative overflow-hidden shrink-0 cursor-pointer group/tile",
                      CALL_SURFACE,
                      (participant.isSpeaking || isPinned) && "ring-2"
                    )}
                    style={(participant.isSpeaking || isPinned) ? { ["--tw-ring-color" as string]: CALL_ACCENT } : undefined}
                    onClick={() => setPinnedView(isPinned ? (anyoneSharing ? "screen" : null) : participant.username)}
                  >
                    {/* Pin indicator */}
                    <div className={cn("absolute top-1 right-1 z-10 bg-black/60 rounded px-1.5 py-0.5 text-[10px] text-white transition-opacity", isPinned ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100")}>
                      {isPinned ? "Pinned" : "Pin"}
                    </div>
                    {hasCam ? (
                      <StreamRenderer stream={media.cameraStream!} muted className="h-full w-full object-cover" />
                    ) : showRegularCamera ? (
                      <StreamRenderer stream={media.stream} muted className="h-full w-full object-cover" />
                    ) : (
                      <Avatar name={participant.name} size={36} />
                    )}
                    <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">
                      {participant.name.split(" ")[0]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : isDm ? (
          /* ── DM video: remote fills area, self PIP rendered separately below ── */
          <div className={cn("h-full rounded-lg flex items-center justify-center relative overflow-hidden", CALL_SURFACE)} style={{ isolation: "isolate" }}>
            {featuredRemote?.media.stream && featuredRemote.media.hasVideo ? (
              <StreamRenderer stream={featuredRemote.media.stream} muted className="h-full w-full object-cover" />
            ) : isRinging ? (
              /* ── Ringing / Calling animation ── */
              <RingingCenterView name={ringingName} />

            ) : (
              <>
                {featuredRemote?.media.stream ? (
                  <StreamRenderer stream={featuredRemote.media.stream} muted className="hidden" />
                ) : null}
                <div className="flex flex-col items-center gap-3">
                  <Avatar name={featuredRemote?.participant.name || callState.conversationName} size={80} />
                  <p className="text-white/60 text-sm">{featuredRemote?.participant.name || callState.conversationName}</p>
                </div>
              </>
            )}
            {!isRinging && (
              <span className="absolute bottom-3 left-3 text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded" style={{ zIndex: 2 }}>
                {featuredRemote?.participant.name || callState.conversationName}
              </span>
            )}
          </div>
        ) : (
          /* ── Group video: dynamic grid ── */
          (() => {
            // Show joined + ringing participants (not declined/left)
            // Show the current user + anyone the server reports as "joined"
            const visibleParticipants = callState.participants.filter(
              (p) => p.status === "joined" || p.username === currentUsername
            );
            const count = visibleParticipants.length;
            // Dynamic grid: 1→1col, 2→2col, 3-4→2col, 5-6→3col, 7-9→3col, 10+→4col
            const gridCols =
              count <= 1 ? "grid-cols-1" :
              count === 2 ? "grid-cols-2" :
              count === 3 ? "grid-cols-3" :
              count <= 4 ? "grid-cols-2" :
              count <= 6 ? "grid-cols-3" :
              count <= 9 ? "grid-cols-3" :
              "grid-cols-4";
            // Adapt avatar size based on grid density
            const avatarSize = count <= 2 ? 80 : count <= 4 ? 64 : count <= 9 ? 48 : 40;
            return (
              <div className={cn("h-full grid gap-2", gridCols)}>
                {visibleParticipants.map((p) => {
                  const isMe = p.username === currentUsername;
                  const remoteEntry = joinedRemoteMedia.find((item) => item.participant.username === p.username)?.media;
                  const media = isMe
                    ? { stream: localStream, hasVideo: localVideoEnabled }
                    : remoteEntry;
                  // Check live video tracks directly — more reliable than cached hasVideo flag
                  // which can go stale after renegotiation or when camera is toggled mid-call
                  const hasLiveVideo = media?.stream
                    ? media.stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled)
                    : false;
                  const showVideo = isMe ? localVideoEnabled : (media?.hasVideo || hasLiveVideo);
                  const isRingingParticipant = p.status === "ringing";
                  return (
                    <div
                      key={p.username}
                      className={cn(
                        "rounded-lg flex items-center justify-center relative overflow-hidden aspect-video cursor-pointer group/tile",
                        CALL_SURFACE,
                        p.isSpeaking && "ring-2"
                      )}
                      style={p.isSpeaking ? { ["--tw-ring-color" as string]: CALL_ACCENT } : undefined}
                      onClick={() => !isMe && setPinnedView(p.username)}
                    >
                      {/* Pin on hover */}
                      {!isMe && (
                        <div className="absolute top-2 right-2 z-10 bg-black/60 rounded px-2 py-1 text-[10px] text-white opacity-0 group-hover/tile:opacity-100 transition-opacity">
                          Pin
                        </div>
                      )}
                      {isRingingParticipant ? (
                        /* Ringing participant in group grid */
                        <div className="flex flex-col items-center gap-2">
                          <div className="relative">
                            <div className="absolute inset-0 -m-3 rounded-full border-2 animate-pulse" style={{ borderColor: `${CALL_ACCENT}66`, animationDuration: "1.5s" }} />
                            <Avatar name={p.name} size={avatarSize} />
                          </div>
                          <span className="text-[11px] text-white/40">Ringing...</span>
                        </div>
                      ) : media?.stream && showVideo ? (
                        <StreamRenderer stream={media.stream} muted={isMe} className="h-full w-full object-cover" />
                      ) : (
                        <>
                          {media?.stream ? <StreamRenderer stream={media.stream} muted className="hidden" /> : null}
                          <div className="flex flex-col items-center gap-2">
                            <Avatar name={p.name} size={avatarSize} />
                          </div>
                        </>
                      )}
                      <div className="absolute bottom-2 left-2 flex flex-col gap-0.5">
                        <span className="text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded">
                          {p.name}{isMe ? " (You)" : ""}
                        </span>
                        {!isMe && (
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded w-fit",
                            p.status === "joined" ? "bg-green-500/80 text-white" :
                            p.status === "ringing" ? (callElapsed > 30 ? "bg-red-500/80 text-white" : "bg-yellow-500/80 text-white") :
                            "bg-white/20 text-white/60"
                          )}>
                            {p.status === "joined" ? "Connected" : p.status === "ringing" ? (callElapsed > 30 ? "No answer" : "Ringing...") : p.status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>

      {/* ── Self PIP — rendered OUTSIDE the video area DOM tree so remote video
           DOM changes never cause React reconciliation to touch this element.
           Uses fixed positioning relative to the overlay container. ── */}
      {!anyoneSharing && isDm && (
        <div
          className={cn("absolute bottom-28 right-7 w-[200px] h-[150px] rounded-lg flex items-center justify-center overflow-hidden border-2 border-white/20 shadow-2xl", CALL_SURFACE)}
          style={{ zIndex: 60, willChange: "transform", transform: "translateZ(0)" }}
        >
          {localVideoEnabled && localStream ? (
            <StreamRenderer stream={localStream} muted className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Avatar name={currentUserName} size={44} />
              {!localVideoEnabled && <span className="text-[10px] text-white/40">Camera off</span>}
            </div>
          )}
          <span className="absolute bottom-1.5 left-1.5 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">You</span>
        </div>
      )}

      {/* Teams toolbar */}
      <TeamsCallToolbar
        isMuted={callState.isMuted}
        isVideoOff={callState.isVideoOff}
        isScreenSharing={callState.isScreenSharing}
        showPeoplePanel={showPeoplePanel}
        onToggleMute={() => onUpdate({ isMuted: !callState.isMuted })}
        onToggleVideo={() => onUpdate({ isVideoOff: !callState.isVideoOff })}
        onToggleScreenShare={() => onUpdate({ isScreenSharing: !callState.isScreenSharing })}
        onTogglePeople={() => setShowPeoplePanel(!showPeoplePanel)}
        onLeave={onEnd}
        onMinimize={onMinimize}
      />

      {/* People panel */}
      {showPeoplePanel && (
        <TeamsPeoplePanel
          participants={callState.participants}
          currentUsername={currentUsername}
          availableUsers={availableUsers}
          onAddParticipant={onAddParticipant}
          onClose={() => setShowPeoplePanel(false)}
        />
      )}
    </div>
  );
}

// ——— Incoming Call Notification (Teams Style) ————————————

function IncomingCallBanner({ callerName, type, onAccept, onDecline }: {
  callerName: string;
  type: "voice" | "video" | "screen";
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isVoiceCall = type === "voice";
  const isScreenShare = type === "screen";
  const CallIcon = isVoiceCall ? Phone : isScreenShare ? MonitorUp : Video;
  const callLabel = isVoiceCall ? "Voice call" : isScreenShare ? "Screen share" : "Video call";

  return (
    <div className={cn("fixed inset-0 z-[60] flex flex-col items-center justify-center text-white", CALL_BG)}>
      {/* Avatar with speaking ring */}
      <div className="relative mb-6">
        <div className="absolute inset-0 -m-4 rounded-full border-2 animate-pulse" style={{ animationDuration: "2s", borderColor: CALL_ACCENT }} />
        <div className="absolute inset-0 -m-8 rounded-full border animate-ping" style={{ animationDuration: "3s", borderColor: `${CALL_ACCENT}4d` }} />
        <Avatar name={callerName} size={100} />
      </div>

      {/* Caller info */}
      <p className="text-xl font-semibold mt-2">{callerName}</p>
      <p className="text-sm text-white/50 mt-1">{callLabel} - incoming</p>

      {/* Action buttons - Teams style */}
      <div className="flex items-center gap-4 mt-12">
        {/* Accept with video (for video calls) */}
        {type === "video" && (
          <button
            onClick={onAccept}
            className="flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl text-white transition-colors"
            style={{ backgroundColor: CALL_ACCENT }}
          >
            <Video size={24} />
            <span className="text-xs font-medium">Accept</span>
          </button>
        )}

        {/* Accept with audio */}
        <button
          onClick={onAccept}
          className="flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl text-white transition-colors"
          style={{ backgroundColor: CALL_SUCCESS }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = CALL_SUCCESS_HOVER; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = CALL_SUCCESS; }}
        >
          <CallIcon size={24} />
          <span className="text-xs font-medium">{type === "video" ? "Audio" : "Accept"}</span>
        </button>

        {/* Decline */}
        <button
          onClick={onDecline}
          className="flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl text-white transition-colors"
          style={{ backgroundColor: CALL_DANGER }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = CALL_DANGER_HOVER; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = CALL_DANGER; }}
        >
          <PhoneOff size={24} />
          <span className="text-xs font-medium">Decline</span>
        </button>
      </div>
    </div>
  );
}

// â"€â"€â"€ Info Panel â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function InfoPanel({
  conversation,
  onMuteToggle,
  onLeaveGroup,
  onDeleteGroup,
  onTransferAdmin,
  showToast,
  currentUserName,
  currentUserId,
  availableUsers,
  isRemovedFromChat,
}: {
  conversation: Conversation;
  onMuteToggle: () => void;
  onLeaveGroup: () => void;
  onDeleteGroup: () => void;
  onTransferAdmin: (memberId: number, memberName: string) => void;
  showToast: (msg: string) => void;
  currentUserName: string;
  currentUserId: number;
  availableUsers: TalkDirectoryUser[];
  isRemovedFromChat?: boolean;
}) {
  const isDm = conversation.type === "dm";
  const { data: participantsData } = useQuery({
    queryKey: ["/api/conversations/participants", conversation.id],
    queryFn: () => fetchJson<{ data: TalkParticipant[] }>(`/api/conversations/${conversation.id}/participants`),
  });
  const { data: sharedFilesData } = useQuery({
    queryKey: ["/api/files", "/"],
    queryFn: () => fetchJson<{ data: SharedFile[] }>("/api/files?path=%2F"),
  });
  const members = (participantsData?.data || []).map((participant) => ({
    id: participant.attendeeId || Math.max(2, Array.from(participant.actorId).reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    name: participant.displayName,
    email: participant.email,
    isModerator: participant.isModerator,
    username: participant.actorId,
    status: participant.status,
    lastPing: participant.lastPing,
  }));
  const dmParticipant = members.find((member) => member.name !== currentUserName) || members[0] || null;
  const infoPanelDmOnline = dmParticipant
    ? (dmParticipant.status === "online" || dmParticipant.status === "away" || dmParticipant.status === "dnd" || (dmParticipant.lastPing > 0 && (Date.now() / 1000 - dmParticipant.lastPing) < 300))
    : false;
  // Check admin status by display name, username, or ID (covers all possible matching)
  const isAdmin = members.some((m) =>
    (m.name === currentUserName || m.id === currentUserId) && m.isModerator
  );
  const sharedFiles = (sharedFilesData?.data || []).slice(0, 3);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [addMemberSelected, setAddMemberSelected] = useState<string[]>([]);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<{ id: number; name: string } | null>(null);
  const [selectedTransferMember, setSelectedTransferMember] = useState<{ id: number; name: string } | null>(null);
  const addMemberMutation = useMutation({
    mutationFn: async (username: string) => {
      return fetchJson<{ data: TalkParticipant[] }>(`/api/conversations/${conversation.id}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
    },
  });

  const queryClient = useQueryClient();
  const otherMembers = members.filter((m) => m.name !== currentUserName);

  return (
    <div className="w-[260px] flex-shrink-0 border-l flex flex-col overflow-hidden bg-background">
      <div className="p-4 flex flex-col items-center text-center">
        <Avatar name={conversation.name} size={64} isGroup={!isDm} />
        <p className="font-semibold mt-3">{conversation.name}</p>
        {isDm ? (
          <>
            <p className="text-sm text-muted-foreground">
              {dmParticipant?.email || dmParticipant?.username || conversation.name}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <OnlineDot size={6} isOnline={infoPanelDmOnline} />
              <span className={cn("text-xs", infoPanelDmOnline ? "text-green-500" : "text-muted-foreground")}>
                {infoPanelDmOnline
                  ? (dmParticipant?.status === "away" ? "Away" : dmParticipant?.status === "dnd" ? "Do not disturb" : "Active now")
                  : conversation.lastMessageAt ? `Last seen ${formatRelativeTime(conversation.lastMessageAt)}` : "Offline"}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{members.length} members</p>
        )}
      </div>

      <Separator />

      {isDm ? (
        <>
          <div className="p-3 space-y-1">
            <Button variant="ghost" className="w-full justify-start text-sm h-9" onClick={() => showToast("Profile view is not connected yet for Talk contacts.")}>View profile</Button>
            <Button variant="ghost" className="w-full justify-start text-sm h-9" onClick={onMuteToggle}>
              {conversation.isMuted ? <><BellOff size={16} className="mr-2" /> Unmute notifications</> : <><Bell size={16} className="mr-2" /> Mute notifications</>}
            </Button>
            <Button variant="ghost" className="w-full justify-start text-sm h-9" onClick={() => showToast("Blocking users is not supported by this Talk integration yet.")}>Block user</Button>
          </div>
          <Separator />
          <div className="p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">SHARED FILES</p>
            <div className="space-y-2">
              {sharedFiles.length === 0 ? (
                <p className="text-xs text-muted-foreground">No recent files available</p>
              ) : sharedFiles.map((sharedFile) => {
                const SharedIcon = sharedFile.mimeType?.startsWith("image/") ? Image : sharedFile.mimeType?.includes("pdf") ? FileText : File;
                return (
                  <div key={sharedFile.id} className="flex items-center gap-2 text-sm">
                    <SharedIcon size={16} className="text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{sharedFile.name}</span>
                    <span className="text-xs text-muted-foreground">{formatFileSize(sharedFile.size)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="p-3 flex-1 overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground mb-2">MEMBERS</p>
            <div className="space-y-2">
              {members.map((member) => {
                const memberOnline = member.status === "online" || member.status === "away" || member.status === "dnd"
                  || (member.lastPing > 0 && (Date.now() / 1000 - member.lastPing) < 300);
                return (
                <div key={member.name} className="group flex items-center gap-2">
                  <div className="relative">
                    <Avatar name={member.name} size={36} />
                    <OnlineDot size={6} className="absolute bottom-0 right-0" isOnline={memberOnline} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{member.name}</p>
                      {member.name === currentUserName && (
                        <span className="text-[11px] text-muted-foreground">(you)</span>
                      )}
                      {/* Admin badge */}
                      {(() => {
                        if (member.isModerator) {
                          return <Badge variant="secondary" className="text-[10px] px-1.5">Admin</Badge>;
                        }
                        return null;
                      })()}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                  {isAdmin && member.name !== currentUserName && member.id !== currentUserId && !isRemovedFromChat && (
                    <button
                      onClick={() => setRemoveMemberTarget({ id: member.id, name: member.name || member.username })}
                      className="ml-auto text-red-500 hover:text-red-400 text-xs shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
                );
              })}
            </div>

            {/* Admin actions */}
            {isAdmin && !isDm && !isRemovedFromChat && (
              <>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pt-3 pb-1">Admin</p>
                <div className="space-y-1">
                  <Button variant="ghost" className="w-full justify-start text-sm h-9" onClick={() => setAddMemberOpen(true)}>
                    <UserPlus size={16} className="mr-2" /> Add member
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-sm h-9" onClick={() => setTransferOpen(true)}>
                    <Crown size={16} className="mr-2" /> Transfer admin
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-sm h-9 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 size={16} className="mr-2" /> Delete group
                  </Button>
                </div>
              </>
            )}
          </div>
          <Separator />
          <div className="p-3 space-y-1">
            {isRemovedFromChat ? (
              <Button
                variant="ghost"
                className="w-full justify-start text-sm h-9 text-destructive hover:text-destructive"
                onClick={() => {
                  // Clear the cached removed conversation to remove from sidebar
                  onLeaveGroup();
                }}
              >
                <Trash2 size={16} className="mr-2" /> Delete chat
              </Button>
            ) : (
              <>
                <Button variant="ghost" className="w-full justify-start text-sm h-9" onClick={onMuteToggle}>
                  {conversation.isMuted ? <><BellOff size={16} className="mr-2" /> Unmute notifications</> : <><Bell size={16} className="mr-2" /> Mute notifications</>}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sm h-9 text-destructive hover:text-destructive"
                  onClick={() => setLeaveOpen(true)}
                >
                  Leave group
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {/* Leave group confirm */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave group?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You'll no longer receive messages from {conversation.name}. You can rejoin if someone adds you back.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setLeaveOpen(false); onLeaveGroup(); }}>Leave group</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete group confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete group?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete {conversation.name} and all its messages for all members.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setDeleteOpen(false); onDeleteGroup(); }}>Delete group</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer admin */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer admin role</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            Choose a new admin for {conversation.name}. You'll become a regular member.
          </p>
          <div className="space-y-1">
            {otherMembers.map((m) => {
              const memberId = m.id;
              const isSelected = selectedTransferMember?.name === m.name;
              return (
                <button
                  key={m.name}
                  onClick={() => setSelectedTransferMember({ id: memberId, name: m.name })}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    isSelected ? "bg-accent" : "hover:bg-muted"
                  )}
                >
                  <div className={cn("h-4 w-4 rounded-full border-2", isSelected ? "border-primary bg-primary" : "border-muted-foreground")} />
                  <Avatar name={m.name} size={32} />
                  <span className="text-sm font-medium">{m.name}</span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedTransferMember}
              onClick={() => {
                if (selectedTransferMember) {
                  onTransferAdmin(selectedTransferMember.id, selectedTransferMember.name);
                  setTransferOpen(false);
                  setSelectedTransferMember(null);
                }
              }}
            >
              Transfer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add member */}
      <Dialog open={addMemberOpen} onOpenChange={(open) => {
        setAddMemberOpen(open);
        if (!open) { setAddMemberSearch(""); setAddMemberSelected([]); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add members</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search people..."
            value={addMemberSearch}
            onChange={(e) => setAddMemberSearch(e.target.value)}
            className="mb-3"
          />
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
            {availableUsers
              .filter((user) => !members.some((m) => m.username === user.username))
              .filter((user) => {
                if (!addMemberSearch.trim()) return true;
                const q = addMemberSearch.toLowerCase();
                return user.displayName.toLowerCase().includes(q) || user.username.toLowerCase().includes(q);
              })
              .map((user) => {
                const isSelected = addMemberSelected.includes(user.username);
                return (
                  <button
                    key={user.username}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                      isSelected ? "bg-accent" : "hover:bg-muted"
                    )}
                    onClick={() => {
                      setAddMemberSelected((prev) =>
                        isSelected ? prev.filter((u) => u !== user.username) : [...prev, user.username]
                      );
                    }}
                  >
                    <div className={cn(
                      "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground"
                    )}>
                      {isSelected && <span className="text-white text-[10px]">✔</span>}
                    </div>
                    <Avatar name={user.displayName} size={32} />
                    <div className="min-w-0 text-left">
                      <span className="text-sm font-medium block truncate">{user.displayName}</span>
                      <span className="text-xs text-muted-foreground block truncate">@{user.username}</span>
                    </div>
                  </button>
                );
              })}
          </div>
          {addMemberSelected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {addMemberSelected.map((username) => {
                const user = availableUsers.find((u) => u.username === username);
                return (
                  <span key={username} className="inline-flex items-center gap-1 bg-muted rounded-full px-2.5 py-1 text-xs font-medium">
                    {user?.displayName || username}
                    <button onClick={() => setAddMemberSelected((prev) => prev.filter((u) => u !== username))} className="hover:opacity-70">
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => { setAddMemberOpen(false); setAddMemberSearch(""); setAddMemberSelected([]); }}>
              Cancel
            </Button>
            <Button
              disabled={addMemberSelected.length === 0 || addMemberMutation.isPending}
              onClick={async () => {
                for (const username of addMemberSelected) {
                  await addMemberMutation.mutateAsync(username).catch(() => undefined);
                }
                showToast(`Added ${addMemberSelected.length} member${addMemberSelected.length > 1 ? "s" : ""}`);
                setAddMemberOpen(false);
                setAddMemberSearch("");
                setAddMemberSelected([]);
              }}
            >
              {addMemberMutation.isPending ? "Adding..." : `Add ${addMemberSelected.length || ""} member${addMemberSelected.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove member confirmation */}
      <Dialog open={!!removeMemberTarget} onOpenChange={(open) => { if (!open) setRemoveMemberTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to remove <span className="font-semibold text-foreground">{removeMemberTarget?.name}</span> from this group? They will no longer be able to send messages, but can still see previous chat history.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setRemoveMemberTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!removeMemberTarget) return;
                try {
                  // Remove the member
                  await fetch(`/api/conversations/${conversation.id}/members/${removeMemberTarget.id}`, {
                    method: "DELETE",
                    credentials: "include",
                  });
                  showToast(`Removed ${removeMemberTarget.name}`);
                  queryClient.invalidateQueries({ queryKey: ["/api/conversations/participants", conversation.id] });
                  queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
                } catch {
                  showToast("Failed to remove member");
                }
                setRemoveMemberTarget(null);
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// â"€â"€â"€ Main Talk Page â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function TalkInner() {
  const queryClient = useQueryClient();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();

  // State
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // Remote typing is now polled from the server — no local typing state needed
  const [composerContent, setComposerContent] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [callState, setCallState] = useState<CallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [newGroupTab, setNewGroupTab] = useState<"dm" | "group">("dm");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [newDmSearch, setNewDmSearch] = useState("");
  const [localVideoEnabled, setLocalVideoEnabled] = useState(false);
  const [localStreamState, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<RemoteCallMedia[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; previewUrl: string | null } | null>(null);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [callMinimized, setCallMinimized] = useState(false);
  const [callEndedInfo, setCallEndedInfo] = useState<{ duration: string; reason: string } | null>(null);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const incomingCallTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const incomingCallAudioContextRef = useRef<AudioContext | null>(null);
  const incomingCallRingtoneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  /** Extra RTCRtpSender for camera track added during screenshare (per peer) */
  const cameraSendersRef = useRef(new Map<string, RTCRtpSender>());
  /** The live camera stream kept active during screenshare (so remote can see our camera) */
  const liveCameraStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const previousLocalStreamRef = useRef<MediaStream | null>(null);
  const isMediaReadyRef = useRef(false);
  const sentOffersRef = useRef(new Set<string>());
  const sentAnswersRef = useRef(new Set<string>());
  const processedCandidateIdsRef = useRef<Set<string>>(new Set());
  const sawActiveSignalRef = useRef<Set<number>>(new Set());
  const recentlyEndedCallRef = useRef<Map<number, number>>(new Map()); // conversationId → timestamp when we ended
  const latestIceServersRef = useRef<Array<{ urls: string | string[]; username?: string; credential?: string }>>([{ urls: "stun:stun.l.google.com:19302" }]);
  const ringingExpiredUsernamesRef = useRef<Set<string>>(new Set()); // usernames whose ringing timed out — prevents server poll from bringing them back

  // Queries
  const { data: conversationsData } = useQuery({
    queryKey: ["/api/conversations"],
    queryFn: () => fetchJson<{ data: Conversation[] }>("/api/conversations"),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const conversations = conversationsData?.data || [];
  const liveActiveConversation = conversations.find((c) => c.id === activeConversationId);

  // ── Kicked / removed user support ──
  // When a user is kicked, Nextcloud removes the conversation from the API.
  // We cache the last-known conversation + messages so the kicked user can
  // still see their chat history in read-only mode with a "kicked" banner.
  const [removedConversationCache, setRemovedConversationCache] = useState<{
    conversation: Conversation;
    messages: Message[];
  } | null>(null);

  const prevConversationIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const currentIds = new Set(conversations.map((c) => c.id));
    if (prevConversationIdsRef.current.size > 0 && activeConversationId) {
      if (prevConversationIdsRef.current.has(activeConversationId) && !currentIds.has(activeConversationId)) {
        // Conversation just disappeared — cache it for read-only display
        const cachedConvo = prevConversationsRef.current?.find((c) => c.id === activeConversationId);
        const cachedMsgs = queryClient.getQueryData<{ data: Message[] }>(
          ["/api/conversations/messages", activeConversationId],
        )?.data || [];
        if (cachedConvo) {
          setRemovedConversationCache({ conversation: cachedConvo, messages: cachedMsgs });
        }
      }
    }
    prevConversationIdsRef.current = currentIds;
  }, [conversations, activeConversationId, queryClient]);

  // Keep a ref of previous conversations for caching on removal
  const prevConversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    if (conversations.length > 0) {
      prevConversationsRef.current = conversations;
    }
  }, [conversations]);

  // The active conversation: use live data, or fall back to the cached kicked version
  const isRemovedFromChat = !liveActiveConversation && !!removedConversationCache && removedConversationCache.conversation.id === activeConversationId;
  const activeConversation = liveActiveConversation || (isRemovedFromChat ? removedConversationCache?.conversation : undefined);

  const { data: currentUserData } = useQuery({
    queryKey: ["/api/user"],
    queryFn: () => fetchJson<{ data: { id?: number; name?: string; username?: string } }>("/api/user"),
  });
  const currentUserId = currentUserData?.data?.id || 0;
  const currentUserName = currentUserData?.data?.name || "You";
  const currentUsername = currentUserData?.data?.username || currentUserName;
  const { data: usersData } = useQuery({
    queryKey: ["/api/users/search"],
    queryFn: () => fetchJson<{ data: TalkDirectoryUser[] }>("/api/users/search"),
  });
  const availableUsers = usersData?.data || [];

  const messagesQuery = useQuery({
    queryKey: ["/api/conversations/messages", activeConversationId],
    queryFn: () => fetchJson<{ data: Message[] }>(`/api/conversations/${activeConversationId}/messages`),
    // Don't fetch or refetch if the user was removed — use cached data instead
    enabled: !!activeConversationId && !isRemovedFromChat,
    refetchInterval: isRemovedFromChat ? false : 2000,
    refetchIntervalInBackground: !isRemovedFromChat,
  });

  const { data: messagesData, isLoading: isLoadingMessages } = messagesQuery;
  // Use cached messages if removed, otherwise live data
  const messagesList = isRemovedFromChat
    ? removedConversationCache?.messages || []
    : messagesData?.data || [];

  // Remote typing indicators (disabled for removed conversations)
  const { data: typingData } = useQuery({
    queryKey: ["/api/conversations/typing", activeConversationId],
    queryFn: () => fetchJson<{ data: Array<{ username: string; displayName: string }> }>(`/api/conversations/${activeConversationId}/typing`),
    enabled: !!activeConversationId && !isRemovedFromChat,
    refetchInterval: isRemovedFromChat ? false : 2000,
    refetchIntervalInBackground: !isRemovedFromChat,
  });
  const remoteTypingUsers = typingData?.data || [];

  // Participants for the active conversation (for online status)
  const { data: activeParticipantsData } = useQuery({
    queryKey: ["/api/conversations/participants", activeConversationId],
    queryFn: () => fetchJson<{ data: TalkParticipant[] }>(`/api/conversations/${activeConversationId}/participants`),
    enabled: !!activeConversationId && !isRemovedFromChat,
    refetchInterval: isRemovedFromChat ? false : 10000,
    refetchIntervalInBackground: true,
  });
  const activeParticipants = activeParticipantsData?.data || [];

  // Compute DM partner online status from participant data
  const dmPartner = activeConversation?.type === "dm"
    ? activeParticipants.find((p) => p.actorId !== currentUsername)
    : null;
  // Determine partner presence: use lastPing as primary signal (active session within 5 min),
  // status field as secondary. Nextcloud status is often null unless explicitly set by user.
  const isDmPartnerOnline = dmPartner
    ? (
        (dmPartner.lastPing > 0 && (Date.now() / 1000 - dmPartner.lastPing) < 300) ||
        dmPartner.status === "online" ||
        dmPartner.status === "away" ||
        dmPartner.status === "dnd"
      )
    : false;
  const isDmPartnerAway = dmPartner
    ? (dmPartner.status === "away" || (isDmPartnerOnline && dmPartner.lastPing > 0 && (Date.now() / 1000 - dmPartner.lastPing) > 120))
    : false;

  const { data: callSignalData } = useQuery({
    queryKey: ["/api/conversations/call", activeConversationId],
    queryFn: () => fetchJson<{ data: ConversationCallSignal | null }>(`/api/conversations/${activeConversationId}/call`),
    enabled: !!activeConversationId && !isRemovedFromChat,
    refetchInterval: isRemovedFromChat ? false : 1500,
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 1000,
  });
  const callSignal = callSignalData?.data;

  useEffect(() => {
    if (!activeConversationId) return;
    window.sessionStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, String(activeConversationId));
  }, [activeConversationId]);

  // Restore last open conversation, fall back to preferred thread.
  useEffect(() => {
    if (conversations.length && !activeConversationId) {
      const storedConversationId = window.sessionStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      const parsedStoredId = storedConversationId ? Number(storedConversationId) : NaN;
      const hasStoredConversation = Number.isFinite(parsedStoredId) && conversations.some((conversation) => conversation.id === parsedStoredId);
      setActiveConversationId(hasStoredConversation ? parsedStoredId : getPreferredConversationId(conversations));
    }
  }, [conversations, activeConversationId]);

  // Scroll to bottom on messages change (only if user hasn't scrolled up)
  useEffect(() => {
    if (!showScrollToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messagesList]);

  // Detect scroll position to show/hide scroll-to-bottom button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 150);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeConversationId]);

  // Call duration counter — only ticks once at least one remote participant has joined
  const hasAnyRemoteJoined = callState?.active
    ? callState.participants.some(
        (p) => p.username !== currentUsername && p.status === "joined",
      )
    : false;

  useEffect(() => {
    if (!callState?.active || !hasAnyRemoteJoined) return;
    const interval = setInterval(() => {
      setCallState((prev) => prev ? { ...prev, duration: prev.duration + 1 } : null);
    }, CALL_DURATION_TICK_MS);
    return () => clearInterval(interval);
  }, [callState?.active, hasAnyRemoteJoined]);

  // Speaking detection via audio analysis — checks which remote streams have active audio
  useEffect(() => {
    if (!callState?.active) return;
    const audioContextRef: { current: AudioContext | null } = { current: null };
    const analysers = new Map<string, { analyser: AnalyserNode; source: MediaElementAudioSourceNode | MediaStreamAudioSourceNode }>();

    const SPEAKING_THRESHOLD = 15; // RMS threshold for "speaking" (0-255 range)

    const tick = setInterval(() => {
      if (!audioContextRef.current) {
        try {
          audioContextRef.current = new AudioContext();
        } catch { return; }
      }
      const ctx = audioContextRef.current;

      // Build analysers for any new remote streams
      for (const rm of remoteMedia) {
        if (!rm.stream || analysers.has(rm.username)) continue;
        try {
          const source = ctx.createMediaStreamSource(rm.stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analysers.set(rm.username, { analyser, source });
        } catch { /* stream might not be ready */ }
      }

      // Sample each analyser
      const speakingSet = new Set<string>();
      for (const [username, { analyser }] of analysers) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
        if (rms > SPEAKING_THRESHOLD) speakingSet.add(username);
      }

      setCallState((prev) => {
        if (!prev) return null;
        let changed = false;
        const nextParticipants = prev.participants.map((p) => {
          const nowSpeaking = speakingSet.has(p.username);
          if (p.isSpeaking !== nowSpeaking) changed = true;
          return { ...p, isSpeaking: nowSpeaking };
        });
        return changed ? { ...prev, participants: nextParticipants } : prev;
      });
    }, 300);

    return () => {
      clearInterval(tick);
      for (const { source } of analysers.values()) {
        try { source.disconnect(); } catch { /* ok */ }
      }
      analysers.clear();
      if (audioContextRef.current?.state !== "closed") {
        void audioContextRef.current?.close().catch(() => undefined);
      }
    };
  }, [callState?.active, remoteMedia]);

  function stopIncomingCallRingtone() {
    if (incomingCallRingtoneIntervalRef.current) {
      clearInterval(incomingCallRingtoneIntervalRef.current);
      incomingCallRingtoneIntervalRef.current = null;
    }

    const audioContext = incomingCallAudioContextRef.current;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.suspend().catch(() => undefined);
    }
  }

  function playIncomingCallTone(audioContext: AudioContext) {
    const startAt = audioContext.currentTime;
    const bursts = [0, 0.38];

    for (const offset of bursts) {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, startAt + offset);
      oscillator.frequency.exponentialRampToValueAtTime(660, startAt + offset + 0.22);

      gainNode.gain.setValueAtTime(0.0001, startAt + offset);
      gainNode.gain.exponentialRampToValueAtTime(0.08, startAt + offset + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.28);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start(startAt + offset);
      oscillator.stop(startAt + offset + 0.3);
    }
  }

  async function startIncomingCallRingtone() {
    if (incomingCallRingtoneIntervalRef.current) return;

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) return;

    if (!incomingCallAudioContextRef.current || incomingCallAudioContextRef.current.state === "closed") {
      incomingCallAudioContextRef.current = new AudioContextCtor();
    }

    const audioContext = incomingCallAudioContextRef.current;
    if (!audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }

    if (audioContext.state !== "running") return;

    playIncomingCallTone(audioContext);
    incomingCallRingtoneIntervalRef.current = setInterval(() => {
      if (audioContext.state === "running") {
        playIncomingCallTone(audioContext);
      }
    }, RINGTONE_INTERVAL_MS);
  }

  // Incoming call auto-dismiss
  useEffect(() => {
    if (!incomingCall) {
      stopIncomingCallRingtone();
      return;
    }

    void startIncomingCallRingtone();
    incomingCallTimeoutRef.current = setTimeout(() => setIncomingCall(null), INCOMING_CALL_DISMISS_MS);
    return () => {
      if (incomingCallTimeoutRef.current) clearTimeout(incomingCallTimeoutRef.current);
      stopIncomingCallRingtone();
    };
  }, [incomingCall]);

  useEffect(() => {
    return () => {
      stopIncomingCallRingtone();
      const audioContext = incomingCallAudioContextRef.current;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, []);

  function getParticipantStableId(username: string) {
    // DJB2 hash — collision-resistant unlike a simple charCode sum
    let hash = 5381;
    for (let i = 0; i < username.length; i++) {
      hash = ((hash << 5) + hash + username.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function mapCallParticipants(participants: ConversationCallParticipant[]) {
    return participants.map((participant) => ({
      id: getParticipantStableId(participant.username),
      username: participant.username,
      name: participant.displayName,
      status: participant.status,
      isSpeaking: false,
    }));
  }

  function shouldCreateOfferForPeer(localUsername: string, remoteUsername: string, initiatorUsername: string) {
    if (localUsername === initiatorUsername) return true;
    if (remoteUsername === initiatorUsername) return false;
    return localUsername.localeCompare(remoteUsername) < 0;
  }

  function setRemoteMediaEntry(entry: RemoteCallMedia) {
    setRemoteMedia((prev) => {
      const existingIndex = prev.findIndex((item) => item.username === entry.username);
      if (existingIndex === -1) return [...prev, entry];
      const next = prev.slice();
      // Preserve cameraStream/hasCameraVideo when updating the primary stream
      next[existingIndex] = {
        ...next[existingIndex],
        ...entry,
        cameraStream: entry.cameraStream ?? next[existingIndex].cameraStream,
        hasCameraVideo: entry.hasCameraVideo ?? next[existingIndex].hasCameraVideo,
      };
      return next;
    });
  }

  function removeRemoteMediaEntry(username: string) {
    setRemoteMedia((prev) => prev.filter((item) => item.username !== username));
  }

  /** Update (or set) a secondary camera stream for a remote user (used during screenshare) */
  function setRemoteCameraStream(username: string, cameraStream: MediaStream | null) {
    setRemoteMedia((prev) => {
      const idx = prev.findIndex((item) => item.username === username);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = {
        ...next[idx],
        cameraStream,
        hasCameraVideo: cameraStream ? cameraStream.getVideoTracks().some((t) => t.readyState === "live") : false,
      };
      return next;
    });
  }

  function stopPeerConnection(username: string) {
    const existing = peerConnectionsRef.current.get(username);
    if (!existing) return;
    // Clear ALL handlers before closing to prevent cascading events
    existing.onicecandidate = null;
    existing.ontrack = null;
    existing.onnegotiationneeded = null;
    existing.oniceconnectionstatechange = null;
    existing.close();
    peerConnectionsRef.current.delete(username);
    cameraSendersRef.current.delete(username);
    sentOffersRef.current.delete(username);
    sentAnswersRef.current.delete(username);
    removeRemoteMediaEntry(username);
  }

  function stopMediaAndPeer() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    previousLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveCameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    previousLocalStreamRef.current = null;
    liveCameraStreamRef.current = null;
    localStreamRef.current = null; setLocalStreamState(null);
    cameraSendersRef.current.clear();
    for (const username of Array.from(peerConnectionsRef.current.keys())) {
      stopPeerConnection(username);
    }
    setRemoteMedia([]);
    setLocalVideoEnabled(false);
    isMediaReadyRef.current = false;
    processedCandidateIdsRef.current.clear();
  }

  useEffect(() => {
    return () => {
      stopMediaAndPeer();
    };
  }, []);

  async function getLocalMedia(type: "voice" | "video" | "screen") {
    if (!(navigator?.mediaDevices?.getUserMedia)) {
      throw new Error("Media devices are unavailable in this browser.");
    }
    if (type === "screen") {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Screen share is unavailable in this browser.");
      }
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    }
    if (type === "video") {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    }
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  function syncPeerConnectionTracks(connection: RTCPeerConnection, stream: MediaStream) {
    const senders = connection.getSenders();
    const videoTrack = stream.getVideoTracks()[0] || null;
    const audioTrack = stream.getAudioTracks()[0] || null;

    const videoSender = senders.find((sender) => sender.track?.kind === "video");
    const audioSender = senders.find((sender) => sender.track?.kind === "audio");

    if (videoSender) {
      void videoSender.replaceTrack(videoTrack);
    } else if (videoTrack) {
      connection.addTrack(videoTrack, stream);
    }

    if (audioSender) {
      void audioSender.replaceTrack(audioTrack);
    } else if (audioTrack) {
      connection.addTrack(audioTrack, stream);
    }
  }

  function ensurePeerConnection(
    conversationId: number,
    remoteUsername: string,
    remoteDisplayName: string,
  ) {
    const existing = peerConnectionsRef.current.get(remoteUsername);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: latestIceServersRef.current,
      iceTransportPolicy: "all",
    });

    if (localStreamRef.current) {
      syncPeerConnectionTracks(connection, localStreamRef.current);
    }

    connection.onicecandidate = async (event) => {
      if (!event.candidate) return;
      await apiRequest("PATCH", `/api/conversations/${conversationId}/call`, {
        iceCandidate: event.candidate.toJSON(),
        iceTo: remoteUsername,
      }).catch(() => undefined);
    };

    // Allow renegotiation: when remote sends a new offer, we need to accept it
    connection.onnegotiationneeded = async () => {
      // Only create offer if we are the offerer for this peer
      if (callSignal?.initiatorUsername && currentUsername) {
        if (shouldCreateOfferForPeer(currentUsername, remoteUsername, callSignal.initiatorUsername)) {
          try {
            const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await connection.setLocalDescription(offer);
            await apiRequest("PATCH", `/api/conversations/${conversationId}/call`, {
              offer,
              offerTo: remoteUsername,
            }).catch(() => undefined);
          } catch (_e) { /* best effort */ }
        }
      }
    };

    /**
     * Track known stream IDs so we can distinguish the primary video/screen
     * stream from a secondary camera stream sent during screenshare.
     *
     * We count how many DISTINCT video-bearing streams we've seen.  The first
     * one is always treated as the primary (it may carry screen or regular
     * camera video).  Only when a SECOND distinct video stream arrives AND the
     * primary already has a live video track do we treat the newcomer as the
     * secondary camera stream.
     */
    let primaryVideoStreamId: string | null = null;

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      // ontrack received

      // Is this a secondary camera stream?  Only when:
      //  • the track is video
      //  • we already have a primary video stream (with a live video track)
      //  • this stream is a DIFFERENT object from that primary
      const isVideoTrack = event.track.kind === "video";
      const isNewStream = primaryVideoStreamId != null && stream.id !== primaryVideoStreamId;
      const primaryHasVideo = primaryVideoStreamId != null; // we set this only after receiving a video track

      if (isVideoTrack && isNewStream && primaryHasVideo) {
        // This is the remote user's camera while they screenshare
        const updateCamera = () => {
          setRemoteCameraStream(remoteUsername, stream);
        };
        updateCamera();
        stream.onaddtrack = updateCamera;
        stream.onremovetrack = updateCamera;
        event.track.onunmute = updateCamera;
        event.track.onmute = updateCamera;
        event.track.onended = () => setRemoteCameraStream(remoteUsername, null);
        return;
      }

      // Track which stream carries the primary video
      if (isVideoTrack && !primaryVideoStreamId) {
        primaryVideoStreamId = stream.id;
      }

      // Primary stream — always update the main entry (handles audio too)
      const updateEntry = () => {
        const videoTracks = stream.getVideoTracks();
        const hasVid = videoTracks.some((t) => t.readyState === "live");
        setRemoteMediaEntry({
          username: remoteUsername,
          displayName: remoteDisplayName,
          stream,
          hasVideo: hasVid,
        });
      };
      updateEntry();
      stream.onaddtrack = updateEntry;
      stream.onremovetrack = updateEntry;
      event.track.onunmute = updateEntry;
      event.track.onmute = updateEntry;
    };

    // Detect peer disconnect via ICE state — crucial for DM auto-end
    connection.oniceconnectionstatechange = () => {
      const state = connection.iceConnectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        // Mark this remote media as disconnected
        removeRemoteMediaEntry(remoteUsername);

        // For DM calls: if the only peer disconnected, end the call immediately.
        // We read callState via the setter to get the LATEST value and avoid
        // racing with endCall which may have already cleared it.
        setCallState((prev) => {
          if (!prev?.active) return prev; // Already ended — nothing to do
          const otherJoined = prev.participants.filter(
            (p) => p.username !== currentUsername && p.status === "joined"
          );
          const isDmConversation = activeConversation?.type === "dm";
          if (isDmConversation && otherJoined.length <= 1 && otherJoined.some((p) => p.username === remoteUsername)) {
            // Schedule the auto-end (can't call stopMediaAndPeer inside setState).
            // Use the ref check to skip if endCall already ran.
            setTimeout(() => {
              // Guard: if media was already cleaned up (endCall ran first), skip
              if (!localStreamRef.current && peerConnectionsRef.current.size === 0) return;
              const cid = prev.conversationId;
              recentlyEndedCallRef.current.set(cid, Date.now());
              setTimeout(() => recentlyEndedCallRef.current.delete(cid), RECENTLY_ENDED_SUPPRESS_MS);
              setCallEndedInfo({ duration: formatCallDuration(prev.duration), reason: "Other participant disconnected" });
              try { stopMediaAndPeer(); } catch { /* already cleaned up */ }
              setCallMinimized(false);
              setCallState(null);
              setIncomingCall(null);
              setIsRemoteScreenSharing(false);
              if (cid) sawActiveSignalRef.current.delete(cid);
              apiRequest("POST", `/api/conversations/${cid}/call/end`, {
                endedBy: currentUsername,
              }).catch(() => undefined);
            }, 0);
          } else if (!isDmConversation) {
            // Group call: just mark the disconnected user as "left" — don't end the call
            return {
              ...prev,
              participants: prev.participants.map((p) =>
                p.username === remoteUsername ? { ...p, status: "left" as const } : p
              ),
            };
          }
          return prev;
        });
      }
    };

    peerConnectionsRef.current.set(remoteUsername, connection);
    return connection;
  }

  async function replaceLocalStream(nextStream: MediaStream, conversationId: number, isScreenSharing: boolean) {
    const previous = localStreamRef.current;
    localStreamRef.current = nextStream;
    setLocalStreamState(nextStream);
    setLocalVideoEnabled(nextStream.getVideoTracks().length > 0);

    for (const [peerUsername, connection] of peerConnectionsRef.current.entries()) {
      syncPeerConnectionTracks(connection, nextStream);
      // Renegotiate so remote peer picks up the new tracks
      try {
        const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await connection.setLocalDescription(offer);
        await apiRequest("PATCH", `/api/conversations/${conversationId}/call`, {
          offer,
          offerTo: peerUsername,
        }).catch(() => undefined);
        // Clear sent answers so we can accept a new answer from this peer
        sentAnswersRef.current.delete(peerUsername);
      } catch (_e) { /* renegotiation best-effort */ }
    }

    if (previous && previous !== previousLocalStreamRef.current) {
      // Only stop tracks that are NOT re-used in the new stream or the saved
      // camera stream (mic track can be shared between both).
      const keepTrackIds = new Set<string>();
      nextStream.getTracks().forEach((t) => keepTrackIds.add(t.id));
      previousLocalStreamRef.current?.getTracks().forEach((t) => keepTrackIds.add(t.id));
      liveCameraStreamRef.current?.getTracks().forEach((t) => keepTrackIds.add(t.id));
      previous.getTracks().forEach((track) => {
        if (!keepTrackIds.has(track.id)) track.stop();
      });
    }
    isMediaReadyRef.current = true;
    await apiRequest("PATCH", `/api/conversations/${conversationId}/call`, {
      isScreenSharing,
    }).catch(() => undefined);
  }

  async function ensureMediaAndTracks(type: "voice" | "video" | "screen", conversationId: number) {
    if (isMediaReadyRef.current && localStreamRef.current) {
      return localStreamRef.current;
    }

    const stream = await getLocalMedia(type);
    localStreamRef.current = stream;
    setLocalStreamState(stream);
    previousLocalStreamRef.current = type === "screen" ? null : stream;
    setLocalVideoEnabled(stream.getVideoTracks().length > 0);
    for (const connection of peerConnectionsRef.current.values()) {
      syncPeerConnectionTracks(connection, stream);
    }
    isMediaReadyRef.current = true;
    return stream;
  }

  async function maybeCreateOfferForPeer(
    conversationId: number,
    remoteUsername: string,
    remoteDisplayName: string,
    callType: "voice" | "video" | "screen",
    initiatorUsername: string,
  ) {
    if (!currentUsername || !localStreamRef.current) return;
    if (!shouldCreateOfferForPeer(currentUsername, remoteUsername, initiatorUsername)) return;
    if (sentOffersRef.current.has(remoteUsername)) return;

    const connection = ensurePeerConnection(conversationId, remoteUsername, remoteDisplayName);
    const offer = await connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await connection.setLocalDescription(offer);
    await apiRequest("PATCH", `/api/conversations/${conversationId}/call`, {
      offer,
      offerTo: remoteUsername,
    }).catch(() => undefined);
    sentOffersRef.current.add(remoteUsername);
  }

  async function syncCallSignals(signalState: ConversationCallSignal) {
    if (!currentUsername || !callState?.active) return;
    const joinedParticipants = signalState.participants.filter((participant) => participant.status === "joined");

    for (const participant of joinedParticipants) {
      if (participant.username === currentUsername) continue;
      await maybeCreateOfferForPeer(
        signalState.conversationId,
        participant.username,
        participant.displayName,
        signalState.type,
        signalState.initiatorUsername,
      );
    }

    for (const participant of signalState.participants) {
      if (participant.username === currentUsername) continue;
      if (participant.status === "declined" || participant.status === "left") {
        stopPeerConnection(participant.username);
      }
    }

    for (const signal of signalState.signals) {
      if (signal.to !== currentUsername) continue;
      if (processedCandidateIdsRef.current.has(signal.id)) continue;

      const remoteParticipant = signalState.participants.find((participant) => participant.username === signal.from);
      const connection = ensurePeerConnection(
        signalState.conversationId,
        signal.from,
        remoteParticipant?.displayName || signal.from,
      );

      try {
        if (signal.kind === "offer") {
          // Always accept new offers (supports renegotiation for camera/screenshare toggle)
          await connection.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          await apiRequest("PATCH", `/api/conversations/${signalState.conversationId}/call`, {
            answer,
            answerTo: signal.from,
          }).catch(() => undefined);
          sentAnswersRef.current.add(signal.from);
        }

        if (signal.kind === "answer") {
          // Accept answer — for renegotiation, signalingState may be "have-local-offer"
          if (connection.signalingState === "have-local-offer" || !connection.currentRemoteDescription) {
            await connection.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
          }
        }

        if (signal.kind === "ice") {
          await connection.addIceCandidate(new RTCIceCandidate(signal.payload as RTCIceCandidateInit));
        }

        processedCandidateIdsRef.current.add(signal.id);
      } catch (_error) {
        // Retry on next poll if the connection is not ready yet.
      }
    }
  }

  useEffect(() => {
    if (!activeConversationId) return;

    if (callSignal?.active) {
      // Keep ICE servers ref up-to-date so new peer connections always get the latest TURN credentials
      if (Array.isArray(callSignal.iceServers) && callSignal.iceServers.length > 0) {
        latestIceServersRef.current = callSignal.iceServers;
      }

      if (callState?.active && callState.conversationId === activeConversationId) {
        // Track whether a REMOTE user is sharing their screen
        const remoteIsSharing = callSignal.isScreenSharing && !callState.isScreenSharing;
        setIsRemoteScreenSharing(remoteIsSharing);
        setCallState((prev) => {
          if (!prev) return prev;
          const serverParticipants = mapCallParticipants(callSignal.participants);
          const prevByUsername = new Map(prev.participants.map((p) => [p.username, p]));

          // Merge server participants with sticky "joined" — once joined, don't downgrade
          // unless the server explicitly says "left" or "declined"
          const mergedParticipants = serverParticipants.map((p) => {
            const prevState = prevByUsername.get(p.username);

            // Ringing-expired: override ringing to left
            if (p.status === "ringing" && ringingExpiredUsernamesRef.current.has(p.username)) {
              return { ...p, status: "left" as const };
            }
            // If server says they joined, clear from expired set (they answered late)
            if (p.status === "joined" && ringingExpiredUsernamesRef.current.has(p.username)) {
              ringingExpiredUsernamesRef.current.delete(p.username);
            }
            // Sticky joined: if previously joined but server now says "ringing" or empty,
            // keep them as "joined" — prevents flicker from temporary server state changes
            if (prevState?.status === "joined" && p.status === "ringing") {
              return { ...p, status: "joined" as const, isSpeaking: prevState.isSpeaking };
            }
            return p;
          });

          const updated: CallState = {
            ...prev,
            participants: mergedParticipants,
          };
          // Auto-upgrade call type when remote shares screen or sends video
          // so VideoCallOverlay's internal layout renders correctly
          if (remoteIsSharing && updated.type === "voice") {
            updated.type = "screen";
          } else if (remoteMedia.some((m) => m.hasVideo) && updated.type === "voice") {
            updated.type = "video";
          }
          return updated;
        });
        void syncCallSignals(callSignal);

        // Auto-end call when other participants leave
        const callAge = callState.startedAt ? Date.now() - new Date(callState.startedAt).getTime() : 0;
        const joinedCount = callSignal.participants.filter((p) => p.status === "joined").length;
        const isDmCall = activeConversation?.type === "dm";
        const otherLeft = callSignal.participants.some(
          (p) => p.username !== currentUsername && (p.status === "left" || p.status === "declined")
        );

        // DM calls: end immediately when other participant leaves (lower threshold)
        if (isDmCall && joinedCount <= 1 && otherLeft && callAge > MIN_CALL_AGE_FOR_AUTO_END_MS) {
          recentlyEndedCallRef.current.set(activeConversationId, Date.now());
          setTimeout(() => recentlyEndedCallRef.current.delete(activeConversationId), RECENTLY_ENDED_SUPPRESS_MS);
          sawActiveSignalRef.current.delete(activeConversationId);
          setCallEndedInfo({ duration: formatCallDuration(callState.duration), reason: "Other participant left the call" });
          try { stopMediaAndPeer(); } catch { /* already cleaned up */ }
          setCallMinimized(false);
          setCallState(null);
          setIncomingCall(null);
          setIsRemoteScreenSharing(false);
          apiRequest("POST", `/api/conversations/${activeConversationId}/call/end`, { endedBy: currentUsername }).catch(() => undefined);
          return;
        }
        // Group calls: if only you remain
        if (!isDmCall && callAge > MIN_GROUP_CALL_AGE_FOR_AUTO_END_MS && joinedCount <= 1 && callSignal.participants.filter((p) => p.status === "joined" || p.status === "ringing").length <= 1) {
          recentlyEndedCallRef.current.set(activeConversationId, Date.now());
          setTimeout(() => recentlyEndedCallRef.current.delete(activeConversationId), RECENTLY_ENDED_SUPPRESS_MS);
          sawActiveSignalRef.current.delete(activeConversationId);
          setCallEndedInfo({ duration: formatCallDuration(callState.duration), reason: "All participants left the call" });
          try { stopMediaAndPeer(); } catch { /* already cleaned up */ }
          setCallMinimized(false);
          setCallState(null);
          setIncomingCall(null);
          setIsRemoteScreenSharing(false);
          apiRequest("POST", `/api/conversations/${activeConversationId}/call/end`, { endedBy: currentUsername }).catch(() => undefined);
          return;
        }
      } else {
        const currentParticipant = callSignal.participants.find((participant) => participant.username === currentUsername);
        // Suppress incoming call if we just ended a call on this conversation (prevents re-ring)
        const recentlyEnded = recentlyEndedCallRef.current.has(activeConversationId);
          if (
            !recentlyEnded &&
            callSignal.initiatorUsername !== currentUsername &&
            currentParticipant?.status !== "declined" &&
            currentParticipant?.status !== "left"
          ) {
            setIncomingCall({
              callerName: callSignal.initiatorName,
              type: callSignal.type,
            });
          }
        }
        return;
    }

    const hasResolvedCallSignal = typeof callSignalData !== "undefined";
    const callAge2 = callState?.startedAt ? Date.now() - new Date(callState.startedAt).getTime() : 0;
    if (
      hasResolvedCallSignal &&
      sawActiveSignalRef.current.has(activeConversationId) &&
      !callSignal?.active &&
      callState?.active &&
      callState.conversationId === activeConversationId &&
      callAge2 > MIN_CALL_AGE_FOR_AUTO_END_MS
    ) {
      recentlyEndedCallRef.current.set(activeConversationId, Date.now());
      setTimeout(() => recentlyEndedCallRef.current.delete(activeConversationId), RECENTLY_ENDED_SUPPRESS_MS);
      sawActiveSignalRef.current.delete(activeConversationId);
      const dur = callState?.duration ? formatCallDuration(callState.duration) : "0:00";
      setCallEndedInfo({ duration: dur, reason: "Call has been ended" });
      try { stopMediaAndPeer(); } catch { /* already cleaned up */ }
      setCallMinimized(false);
      setCallState(null);
      setIncomingCall(null);
      setIsRemoteScreenSharing(false);
    }
  }, [activeConversationId, callSignal, callSignalData, callState?.active, callState?.conversationId, currentUsername, showToast]);

  // Group call ringing timeout: after 40s, stop showing ringing participants
  useEffect(() => {
    if (!callState?.active) return;
    if (activeConversation?.type !== "group") return;

    const timer = setTimeout(() => {
      setCallState((prev) => {
        if (!prev) return prev;
        const hasRinging = prev.participants.some((p) => p.status === "ringing");
        if (!hasRinging) return prev;
        // Track expired usernames so server poll doesn't bring them back as "ringing"
        prev.participants.forEach((p) => {
          if (p.status === "ringing") ringingExpiredUsernamesRef.current.add(p.username);
        });
        return {
          ...prev,
          participants: prev.participants.map((p) =>
            p.status === "ringing" ? { ...p, status: "left" as const } : p
          ),
        };
      });
    }, 40_000);
    return () => clearTimeout(timer);
  }, [callState?.active, activeConversation?.type]);

  async function startCall(type: "voice" | "video" | "screen") {
    if (!activeConversation) return;
    stopMediaAndPeer();
    try {
      const stream = await ensureMediaAndTracks(type, activeConversation.id);
      previousLocalStreamRef.current = stream;
    } catch (error) {
      showToast(getMediaAccessErrorMessage(error, "call"));
      return;
    }

    const payload = await fetchJson<{ data: ConversationCallSignal }>(
      `/api/conversations/${activeConversation.id}/call/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          initiatorName: currentUserName,
        }),
      },
    ).catch(() => null);
    if (!payload?.data?.nativeAvailable) {
      stopMediaAndPeer();
      showToast("Unable to start the native Nextcloud Talk call for this conversation.");
      return;
    }
    const participants = payload?.data?.participants || [];

    setCallState({
      active: true,
      type,
      conversationId: activeConversation.id,
      conversationName: activeConversation.name,
      startedAt: new Date(),
      isMuted: false,
      isVideoOff: type === "voice",
      isSpeakerOn: true,
      isScreenSharing: type === "screen",
      participants: mapCallParticipants(participants),
      duration: 0,
    });
    sawActiveSignalRef.current.add(activeConversation.id);
    setIncomingCall(null);
  }

  function endCall(reason?: string | unknown) {
    // Guard: onClick handlers may pass a SyntheticEvent as the first arg
    const safeReason = typeof reason === "string" ? reason : undefined;
    // Capture values BEFORE any state changes
    const dur = callState ? formatCallDuration(callState.duration) : "0:00";
    const convId = callState?.conversationId;

    // 1. Suppress re-ring FIRST (synchronous ref writes are safe)
    if (convId) {
      recentlyEndedCallRef.current.set(convId, Date.now());
      setTimeout(() => recentlyEndedCallRef.current.delete(convId), RECENTLY_ENDED_SUPPRESS_MS);
      sawActiveSignalRef.current.delete(convId);
    }

    // 2. Clear ringing-expired tracking for next call
    ringingExpiredUsernamesRef.current.clear();

    // 3. Defer ALL state changes + media cleanup to the next microtask.
    //    This prevents intermediate renders where callState is truthy
    //    but media refs have been cleared (which crashes the overlay).
    setTimeout(() => {
      try { stopMediaAndPeer(); } catch (e) { console.error("[endCall] stopMediaAndPeer error:", e); }
      // Reset minimized state BEFORE clearing callState to prevent the PiP bar
      // from reading null callState properties during the transition render.
      setCallMinimized(false);
      setCallState(null);
      setIncomingCall(null);
      setIsRemoteScreenSharing(false);

      if (convId) {
        setCallEndedInfo({ duration: dur, reason: safeReason || "You ended the call" });
        apiRequest("POST", `/api/conversations/${convId}/call/end`, {
          endedBy: currentUserName,
        }).catch(() => undefined);
      }
    }, 0);
  }

  async function toggleScreenShare(enabled: boolean, conversationId: number) {
    if (enabled) {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Screen share is unavailable in this browser.");
      }

      // ── Save current stream so the local self-view can show camera preview ──
      previousLocalStreamRef.current = localStreamRef.current;

      // ── Capture screen (video only — we keep our own mic separately) ──
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      if (screenVideoTrack) {
        screenVideoTrack.onended = () => {
          void toggleScreenShare(false, conversationId).catch(() => undefined);
          setCallState((prev) => prev ? { ...prev, isScreenSharing: false } : prev);
        };
      }

      // ── Get a FRESH mic stream (don't share the track with the camera stream) ──
      // This avoids the bug where stopping/cleaning up one stream kills the
      // shared mic track in the other.
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const freshMicTrack = micStream.getAudioTracks()[0];

      // ── Build combined stream: fresh mic + screen video ──
      const combinedTracks: MediaStreamTrack[] = [];
      if (freshMicTrack) combinedTracks.push(freshMicTrack);
      if (screenVideoTrack) combinedTracks.push(screenVideoTrack);
      const combinedStream = new MediaStream(combinedTracks);

      // ── Apply mute state to the fresh mic if the call is muted ──
      if (callState?.isMuted && freshMicTrack) {
        freshMicTrack.enabled = false;
      }

      await replaceLocalStream(combinedStream, conversationId, true);
      return;
    }

    // ── Stopping screenshare ────────────────────────────────────────
    // Clean up any secondary camera senders first
    for (const [peerUsername, sender] of cameraSendersRef.current.entries()) {
      const connection = peerConnectionsRef.current.get(peerUsername);
      if (connection) {
        try { connection.removeTrack(sender); } catch { /* ok */ }
      }
    }
    cameraSendersRef.current.clear();
    liveCameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    liveCameraStreamRef.current = null;

    // Stop ALL tracks on the current stream (screen video + screenshare mic)
    localStreamRef.current?.getTracks().forEach((t) => t.stop());

    // Get a completely FRESH camera+audio stream — never reuse old tracks
    const mediaType = callState?.type === "voice" ? "voice" : "video";
    const freshStream = await getLocalMedia(mediaType);

    // Apply mute state to the fresh stream
    if (callState?.isMuted) {
      freshStream.getAudioTracks().forEach((t) => { t.enabled = false; });
    }

    // Stop the old saved camera stream (its tracks are separate, safe to stop)
    previousLocalStreamRef.current?.getTracks().forEach((t) => t.stop());
    previousLocalStreamRef.current = freshStream;

    await replaceLocalStream(freshStream, conversationId, false);
  }

  async function updateCall(partial: Partial<CallState>) {
    const existing = callState;
    if (!existing) return;

    if (typeof partial.isMuted === "boolean") {
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !partial.isMuted;
      });
    }

    if (typeof partial.isVideoOff === "boolean") {
      const wantsVideoOn = !partial.isVideoOff;
      const isCurrentlyScreenSharing = existing.isScreenSharing;

      if (isCurrentlyScreenSharing) {
        // ── Camera toggle DURING screenshare ──
        // The main localStream carries the SCREEN video — never touch it.
        // Instead, add/remove a separate camera stream sent as a secondary
        // video track on each peer connection.
        if (wantsVideoOn) {
          try {
            const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const camTrack = camStream.getVideoTracks()[0];
            if (camTrack) {
              liveCameraStreamRef.current = camStream;
              // Save for self-view in the sidebar tile
              previousLocalStreamRef.current = camStream;
              // Add camera track to every peer connection as a second video track
              for (const [peerUsername, connection] of peerConnectionsRef.current.entries()) {
                const sender = connection.addTrack(camTrack, camStream);
                cameraSendersRef.current.set(peerUsername, sender);
                try {
                  const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
                  await connection.setLocalDescription(offer);
                  await apiRequest("PATCH", `/api/conversations/${existing.conversationId}/call`, {
                    offer,
                    offerTo: peerUsername,
                  }).catch(() => undefined);
                  sentAnswersRef.current.delete(peerUsername);
                } catch (_e) { /* renegotiation best-effort */ }
              }
              setLocalVideoEnabled(true);
            }
          } catch (error) {
            showToast(getMediaAccessErrorMessage(error, "call"));
            return;
          }
        } else {
          // Turn camera OFF while screensharing — remove the secondary camera track
          for (const [peerUsername, sender] of cameraSendersRef.current.entries()) {
            const connection = peerConnectionsRef.current.get(peerUsername);
            if (connection) {
              try { connection.removeTrack(sender); } catch { /* ok */ }
            }
          }
          cameraSendersRef.current.clear();
          liveCameraStreamRef.current?.getTracks().forEach((t) => t.stop());
          liveCameraStreamRef.current = null;
          previousLocalStreamRef.current = null;
          setLocalVideoEnabled(false);
          // Renegotiate so remote drops the camera stream
          for (const [peerUsername, connection] of peerConnectionsRef.current.entries()) {
            try {
              const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
              await connection.setLocalDescription(offer);
              await apiRequest("PATCH", `/api/conversations/${existing.conversationId}/call`, {
                offer,
                offerTo: peerUsername,
              }).catch(() => undefined);
              sentAnswersRef.current.delete(peerUsername);
            } catch (_e) { /* renegotiation best-effort */ }
          }
        }
      } else {
        // ── Camera toggle when NOT screensharing ──
        const hasVideoTrack = (localStreamRef.current?.getVideoTracks().length ?? 0) > 0;

        if (wantsVideoOn && !hasVideoTrack) {
          // Voice call → need to acquire camera and add video track
          try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = videoStream.getVideoTracks()[0];
            if (videoTrack && localStreamRef.current) {
              const combinedStream = new MediaStream([
                ...localStreamRef.current.getAudioTracks(),
                videoTrack,
              ]);
              localStreamRef.current = combinedStream;
              setLocalStreamState(combinedStream);
              previousLocalStreamRef.current = combinedStream;
              for (const [peerUsername, connection] of peerConnectionsRef.current.entries()) {
                syncPeerConnectionTracks(connection, combinedStream);
                try {
                  const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
                  await connection.setLocalDescription(offer);
                  await apiRequest("PATCH", `/api/conversations/${existing.conversationId}/call`, {
                    offer,
                    offerTo: peerUsername,
                  }).catch(() => undefined);
                  sentAnswersRef.current.delete(peerUsername);
                } catch (_e) { /* renegotiation best-effort */ }
              }
              setLocalVideoEnabled(true);
            }
          } catch (error) {
            showToast(getMediaAccessErrorMessage(error, "call"));
            return;
          }
          // Switch overlay from voice to video
          partial = { ...partial, type: "video" };
        } else {
          // Toggle existing video tracks on/off
          localStreamRef.current?.getVideoTracks().forEach((track) => {
            track.enabled = wantsVideoOn;
          });
          setLocalVideoEnabled(wantsVideoOn);
        }
      }
    }

    if (typeof partial.isScreenSharing === "boolean" && partial.isScreenSharing !== existing.isScreenSharing) {
      // Set isScreenSharing state BEFORE toggling so the UI immediately switches
      // to screenshare layout (sidebar with participant tiles) on the same render
      // that receives the new localStream.  Without this, there is a flash where
      // isSelfSharing is still false and the sidebar shows localStream (screen)
      // instead of previousCameraStream (camera).
      setCallState((prev) => (prev ? { ...prev, isScreenSharing: partial.isScreenSharing } : prev));
      try {
        await toggleScreenShare(partial.isScreenSharing!, existing.conversationId);
      } catch (error) {
        // Revert on failure
        setCallState((prev) => (prev ? { ...prev, isScreenSharing: existing.isScreenSharing } : prev));
        showToast(getMediaAccessErrorMessage(error, "screen-share"));
        return;
      }
    }

    setCallState((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  async function acceptIncomingCall() {
    if (!activeConversationId || !callSignal) return;
    // Receiver always joins with voice (audio only) — never prompt for screenshare.
    // If the caller is sharing their screen, the receiver just views it.
    const receiverMediaType = callSignal.type === "screen" ? "voice" : callSignal.type;
    try {
      const stream = await ensureMediaAndTracks(receiverMediaType, activeConversationId);
      previousLocalStreamRef.current = stream;
    } catch (error) {
      showToast(getMediaAccessErrorMessage(error, "call"));
      return;
    }

    const payload = await fetchJson<{ data: ConversationCallSignal }>(
      `/api/conversations/${activeConversationId}/call/accept`,
      {
        method: "POST",
      },
    ).catch(() => null);
    if (!payload?.data?.nativeAvailable) {
      stopMediaAndPeer();
      showToast("Unable to join the native Nextcloud Talk call.");
      return;
    }

    const conversation = activeConversation || conversations.find((item) => item.id === activeConversationId);
    if (!conversation) return;

    setCallState({
      active: true,
      type: payload.data.type === "screen" ? "video" : payload.data.type,
      conversationId: conversation.id,
      conversationName: conversation.name,
      startedAt: new Date(payload.data.startedAt),
      isMuted: false,
      isVideoOff: receiverMediaType === "voice",
      isSpeakerOn: true,
      isScreenSharing: false, // Receiver is NOT sharing; they just view the caller's share
      participants: mapCallParticipants(payload.data.participants),
      duration: 0,
    });
    setIncomingCall(null);
  }

  async function declineIncomingCall() {
    if (activeConversationId) {
      await apiRequest("POST", `/api/conversations/${activeConversationId}/call/decline`).catch(() => undefined);
    }
    stopMediaAndPeer();
    setIncomingCall(null);
  }

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      return fetchJson<{ data: Message }>(`/api/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    },
    onSuccess: async (result, content) => {
      queryClient.setQueryData(
        ["/api/conversations/messages", activeConversationId],
        (old: { data: Message[] } | undefined) => {
          const existing = old?.data || [];
          const withoutOptimistic = existing.filter(
            (message) =>
              !(
                message.id >= 1_000_000_000_000 &&
                message.senderId === currentUserId &&
                message.content === content
              ),
          );

          if (withoutOptimistic.some((message) => message.id === result.data.id)) {
            return { data: withoutOptimistic };
          }

          return { data: [...withoutOptimistic, result.data] };
        },
      );
      await messagesQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (_, content) => {
      queryClient.setQueryData(
        ["/api/conversations/messages", activeConversationId],
        (old: { data: Message[] } | undefined) => ({
          data: (old?.data || []).filter(
            (message) =>
              !(
                message.id >= 1_000_000_000_000 &&
                message.senderId === currentUserId &&
                message.content === content
              ),
          ),
        }),
      );
      showToast("Unable to send message");
    },
  });

  const handleAttachmentSelect = useCallback((file: File | null) => {
    if (!file) return;
    // Stage the file — don't auto-upload or auto-send
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    setPendingAttachment({ file, previewUrl });
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }, []);

  const cancelPendingAttachment = useCallback(() => {
    if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
    setPendingAttachment(null);
  }, [pendingAttachment]);

  const sendWithAttachment = useCallback(async (messageText: string) => {
    if (!pendingAttachment || !activeConversation) return;
    setIsUploadingAttachment(true);

    try {
      const folderName = activeConversation.type === "group"
        ? activeConversation.name.replace(/[<>:"/\\|?*]+/g, "-").trim() || "Group"
        : "Direct Messages";
      await apiRequest("POST", "/api/files", {
        name: "Talk Uploads",
        type: "folder",
        parentPath: "/",
      }).catch(() => undefined);
      await apiRequest("POST", "/api/files", {
        name: folderName,
        type: "folder",
        parentPath: "/Talk Uploads",
      }).catch(() => undefined);
      const uploadParentPath = `/Talk Uploads/${folderName}`;
      const fileBuffer = await pendingAttachment.file.arrayBuffer();
      const response = await fetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": pendingAttachment.file.name,
          "x-parent-path": uploadParentPath,
          "x-file-content-type": pendingAttachment.file.type || "application/octet-stream",
        },
        body: fileBuffer,
      });

      if (!response.ok) throw new Error("Upload failed");

      const payload = await response.json() as { data: UploadedTalkFile & { shareLink?: string | null } };
      // Build message: "Shared file: name\npath\nshareLink" optionally followed by user's message
      const shareLinkPart = payload.data.shareLink ? `\n${payload.data.shareLink}` : "";
      let attachmentMessage = `Shared file: ${payload.data.name}\n${payload.data.path}${shareLinkPart}`;
      if (messageText.trim()) {
        attachmentMessage += `\n${messageText.trim()}`;
      }
      await sendMutation.mutateAsync(attachmentMessage);
      showToast(`Shared ${payload.data.name}`);
    } catch {
      showToast("Unable to share file in this conversation.");
    } finally {
      setIsUploadingAttachment(false);
      if (pendingAttachment.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
      setPendingAttachment(null);
    }
  }, [pendingAttachment, activeConversation, sendMutation, showToast]);

  // Mark as read mutation
  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/conversations/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: () => {
      // Revert the optimistic unreadCount update by re-fetching
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // Auto mark-as-read when viewing a conversation and new messages arrive
  useEffect(() => {
    if (!activeConversationId) return;
    const currentCount = messagesList.length;
    if (currentCount > prevMessageCountRef.current && prevMessageCountRef.current > 0) {
      // New messages arrived while viewing — mark as read
      markReadMutation.mutate(activeConversationId);
    }
    prevMessageCountRef.current = currentCount;
  }, [activeConversationId, messagesList.length]);

  // Mute mutation
  const muteMutation = useMutation({
    mutationFn: async ({ id, muted }: { id: number; muted: boolean }) => {
      await apiRequest("PATCH", `/api/conversations/${id}/mute`, { muted });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // Leave group mutation
  const leaveGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/conversations/${id}/members/me`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // Transfer admin mutation
  const transferAdminMutation = useMutation({
    mutationFn: async ({ id, adminId }: { id: number; adminId: number }) => {
      await apiRequest("PATCH", `/api/conversations/${id}/admin`, { adminId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // Create conversation mutation
  const createConversationMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      type: string;
      inviteUsername?: string;
      memberUsernames?: string[];
    }) => {
      return fetchJson<{ data: Conversation }>("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setActiveConversationId(result.data.id);
      setNewChatOpen(false);
      setNewGroupTab("dm");
      setNewGroupName("");
      setNewGroupMembers([]);
      setNewDmSearch("");
    },
  });

  const handleSelectConversation = useCallback((id: number) => {
    setRemovedConversationCache(null);
    setActiveConversationId(id);
    setReplyTo(null);
    setForwardMessage(null);
    queryClient.setQueryData(["/api/conversations"], (old: { data: Conversation[] } | undefined) => {
      if (!old) return old;
      return { data: old.data.map((c) => c.id === id ? { ...c, unreadCount: 0 } : c) };
    });
    markReadMutation.mutate(id);
  }, [markReadMutation, queryClient]);

  const handleSend = useCallback(() => {
    const content = composerContent.trim();
    if (!activeConversationId) return;

    // If there's a pending attachment, upload it with the message text
    if (pendingAttachment) {
      void sendWithAttachment(content);
      setComposerContent("");
      setReplyTo(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    if (!content) return;

    const optimisticMsg: Message = {
      id: Date.now(),
      conversationId: activeConversationId,
      senderId: currentUserId,
      senderName: currentUserName,
      content,
      sentAt: new Date().toISOString(),
      reactions: null,
      replyToId: replyTo?.id ?? null,
      systemMessage: null,
    };
    queryClient.setQueryData(
      ["/api/conversations/messages", activeConversationId],
      (old: { data: Message[] } | undefined) => ({
        data: [...(old?.data || []), optimisticMsg],
      })
    );

    setComposerContent("");
    setReplyTo(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMutation.mutate(content);
  }, [composerContent, activeConversationId, currentUserId, currentUserName, sendMutation, queryClient, replyTo, pendingAttachment, sendWithAttachment]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    // Send typing signal (debounced by 2s via timeout)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTypingSignal();
    typingTimeoutRef.current = setTimeout(() => {/* typing expires on server */}, 3000);
  };

  const sendTypingSignal = useCallback(() => {
    if (!activeConversationId) return;
    fetch(`/api/conversations/${activeConversationId}/typing`, { method: "POST" }).catch(() => undefined);
  }, [activeConversationId]);

  const handleComposerFocus = () => {
    sendTypingSignal();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const handleComposerBlur = () => {
    // no-op: typing signal expires on server after 5s
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const handleReply = useCallback((msg: Message) => {
    setReplyTo(msg);
    textareaRef.current?.focus();
  }, []);

  const handleForwardMessage = useCallback((msg: Message) => {
    setForwardMessage(msg);
  }, []);

  const handleForwardToConversation = useCallback(async (targetConversationId: number) => {
    if (!forwardMessage) return;
    try {
      await apiRequest("POST", `/api/conversations/${targetConversationId}/messages`, {
        content: forwardMessage.content,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      showToast("Message forwarded");
    } catch {
      showToast("Failed to forward message");
    }
    setForwardMessage(null);
  }, [forwardMessage, queryClient, showToast]);

  const handleReact = useCallback((msgId: number, emoji: string) => {
    // Optimistic reaction update
    queryClient.setQueryData(
      ["/api/conversations/messages", activeConversationId],
      (old: { data: Message[] } | undefined) => {
        if (!old) return old;
        return {
          data: old.data.map((msg) => {
            if (msg.id !== msgId) return msg;
            const reactions = msg.reactions ? JSON.parse(msg.reactions) as Record<string, number> : {};
            reactions[emoji] = (reactions[emoji] || 0) + 1;
            return { ...msg, reactions: JSON.stringify(reactions) };
          }),
        };
      }
    );
  }, [activeConversationId, queryClient]);

  const handleAddCallParticipant = useCallback(async (username: string) => {
    if (!activeConversationId) return;
    try {
      await fetchJson(`/api/conversations/${activeConversationId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      showToast(`Invited ${username} to the call`);
      // Also add them to the current call's participant list as "ringing"
      if (callState?.active) {
        setCallState((prev) => {
          if (!prev) return prev;
          const alreadyInCall = prev.participants.some((p) => p.username === username);
          if (alreadyInCall) return prev;
          const user = availableUsers.find((u) => u.username === username);
          return {
            ...prev,
            participants: [
              ...prev.participants,
              {
                id: getParticipantStableId(username),
                username,
                name: user?.displayName || username,
                status: "ringing" as const,
                isSpeaking: false,
              },
            ],
          };
        });
      }
    } catch {
      showToast("Failed to add participant");
    }
  }, [activeConversationId, showToast, callState, availableUsers]);

  const handleVoiceScreenShare = useCallback(async () => {
    if (!callState) return;
    try {
      await updateCall({ isScreenSharing: true });
      // Switch to video/screen overlay
      setCallState((prev) => prev ? { ...prev, type: "screen" } : prev);
    } catch {
      showToast("Unable to start screen sharing");
    }
  }, [callState, showToast]);

  const handleMuteToggle = () => {
    if (!activeConversation) return;
    const newMuted = !activeConversation.isMuted;
    muteMutation.mutate({ id: activeConversation.id, muted: newMuted });
    showToast(newMuted ? "Notifications muted" : "Notifications unmuted");
  };

  const handleLeaveGroup = () => {
    if (!activeConversation) return;
    const name = activeConversation.name;
    const convId = activeConversation.id;
    // Cache current messages so the chat stays visible in read-only mode
    const cachedMsgs = queryClient.getQueryData<{ data: Message[] }>(
      ["/api/conversations/messages", convId],
    )?.data || [];
    setRemovedConversationCache({ conversation: activeConversation, messages: cachedMsgs });
    leaveGroupMutation.mutate(convId);
    showToast(`You left ${name}`);
  };

  const handleDeleteGroup = () => {
    if (!activeConversation) return;
    const name = activeConversation.name;
    deleteGroupMutation.mutate(activeConversation.id);
    const remaining = conversations.filter((c) => c.id !== activeConversation.id);
    setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
    showToast(`Group deleted: ${name}`);
  };

  const handleTransferAdmin = (memberId: number, memberName: string) => {
    if (!activeConversation) return;
    transferAdminMutation.mutate({ id: activeConversation.id, adminId: memberId });
    showToast(`Admin role transferred to ${memberName}`);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || newGroupMembers.length === 0) return;
    const groupName = newGroupName.trim();
    createConversationMutation.mutate({
      name: newGroupName,
      type: "group",
      memberUsernames: newGroupMembers,
    });
    showToast("Group created");
  };

  const handleStartDm = (contact: TalkDirectoryUser) => {
    // Check if DM already exists
    const existing = conversations.find((c) => {
      if (c.type !== "dm") return false;
      // Match by name or by member username
      if (c.name === contact.displayName || c.name === contact.username) return true;
      try {
        const members = c.members ? JSON.parse(c.members) as string[] : [];
        return members.includes(contact.username);
      } catch { return false; }
    });
    if (existing) {
      handleSelectConversation(existing.id);
    } else {
      createConversationMutation.mutate({
        name: contact.displayName,
        type: "dm",
        inviteUsername: contact.username,
      });
    }
    setSearchQuery("");
    setNewChatOpen(false);
    setNewDmSearch("");
    textareaRef.current?.focus();
  };


  // Group messages by date for rendering
  const groupedMessages = messagesList.reduce<{ date: string; messages: Message[] }[]>((groups, msg) => {
    const dateKey = new Date(msg.sentAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.date === dateKey) {
      last.messages.push(msg);
    } else {
      groups.push({ date: dateKey, messages: [msg] });
    }
    return groups;
  }, []);
  const normalizedChatSearch = chatSearchQuery.trim().toLowerCase();
  const hasChatSearch = normalizedChatSearch.length > 0;
  const visibleGroupedMessages = groupedMessages
    .map((group) => ({
      ...group,
      messages: hasChatSearch
        ? group.messages.filter((message) =>
            message.content.toLowerCase().includes(normalizedChatSearch) ||
            message.senderName.toLowerCase().includes(normalizedChatSearch),
          )
        : group.messages,
    }))
    .filter((group) => group.messages.length > 0);
  const visibleMessageCount = visibleGroupedMessages.reduce((count, group) => count + group.messages.length, 0);

  // Collect matching message IDs for search navigation
  const searchMatchIds = hasChatSearch
    ? visibleGroupedMessages.flatMap((group) =>
        group.messages
          .filter((m) =>
            m.content.toLowerCase().includes(normalizedChatSearch) ||
            m.senderName.toLowerCase().includes(normalizedChatSearch)
          )
          .map((m) => m.id)
      )
    : [];

  const scrollToSearchMatch = useCallback((index: number) => {
    if (index < 0 || index >= searchMatchIds.length) return;
    setSearchMatchIndex(index);
    const el = document.getElementById(`msg-${searchMatchIds[index]}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchMatchIds]);

  // ── Unified conversation list: unread first, then by most recent activity ──
  const query = searchQuery.toLowerCase().trim();

  // Include the cached removed conversation so kicked users still see it in the sidebar
  const allConversations = removedConversationCache
    && !conversations.some((c) => c.id === removedConversationCache.conversation.id)
    ? [...conversations, { ...removedConversationCache.conversation, lastMessage: "You were removed from this group" }]
    : conversations;

  const filteredConversations = query
    ? allConversations.filter((c) => c.name.toLowerCase().includes(query) || (c.lastMessage || "").toLowerCase().includes(query))
    : allConversations;

  // Sort: unread on top (sorted by recency), then read (sorted by recency)
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    const aUnread = (a.unreadCount || 0) > 0 ? 1 : 0;
    const bUnread = (b.unreadCount || 0) > 0 ? 1 : 0;
    // Unread conversations float to the top
    if (aUnread !== bUnread) return bUnread - aUnread;
    // Within same group, sort by most recent message (newest first)
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  // People search — contacts not already in conversations
  const peopleResults = query
    ? availableUsers.filter((user) => {
        if (!user.displayName.toLowerCase().includes(query) && !user.username.toLowerCase().includes(query)) return false;
        return !conversations.some((c) => c.type === "dm" && c.name === user.displayName);
      })
    : [];
  // Use the live participant list for member count (much more reliable than
  // the static members JSON which is often empty from Nextcloud's room list).
  const activeConversationMemberCount = activeParticipants.length > 0
    ? activeParticipants.filter((p) => p.actorType === "users").length
    : activeConversation?.members
      ? (() => { try { return (JSON.parse(activeConversation.members) as string[]).length; } catch { return 0; } })()
      : 0;

  const noResults = query && sortedConversations.length === 0 && peopleResults.length === 0;
  return (
    <>
      <ToastOverlay toast={toast} onDismiss={dismissToast} />

      {/* Minimized call PiP bar */}
      {callState?.active && callMinimized && (
        <div className="fixed bottom-20 right-4 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 cursor-pointer" onClick={() => setCallMinimized(false)}>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-medium">{callState.conversationName}</span>
          <span className="text-xs text-white/50">{formatCallDuration(callState.duration)}</span>
          <button onClick={(e) => { e.stopPropagation(); endCall(); }} className="ml-2 p-1 rounded hover:bg-white/10">
            <PhoneOff size={14} className="text-red-400" />
          </button>
        </div>
      )}

      {/* Call overlays — use VideoCallOverlay when ANY video/screen is active (local or remote) */}
        {callState?.active && !callMinimized && callState.type === "voice"
          && !localVideoEnabled
          && !callState.isScreenSharing
          && !isRemoteScreenSharing
          && !remoteMedia.some((m) => m.hasVideo)
          && (
          <VoiceCallOverlay
            callState={callState}
            onUpdate={updateCall}
            onEnd={endCall}
            onScreenShare={handleVoiceScreenShare}
            onAddParticipant={handleAddCallParticipant}
            remoteMedia={remoteMedia}
            currentUsername={currentUsername}
            availableUsers={availableUsers}
            conversationType={activeConversation?.type === "group" ? "group" : "dm"}
            onMinimize={() => setCallMinimized(true)}
          />
        )}
      {callState?.active && !callMinimized && (
          callState.type === "video"
          || callState.type === "screen"
          || localVideoEnabled
          || callState.isScreenSharing
          || isRemoteScreenSharing
          || remoteMedia.some((m) => m.hasVideo)
        ) && (
        <VideoCallOverlay
          callState={callState}
          onUpdate={updateCall}
          onEnd={endCall}
          currentUserName={currentUserName}
          currentUsername={currentUsername}
          onAddParticipant={handleAddCallParticipant}
          localStream={localStreamState}
          localVideoEnabled={localVideoEnabled}
          remoteMedia={remoteMedia}
          availableUsers={availableUsers}
          isRemoteScreenSharing={isRemoteScreenSharing}
          previousCameraStream={previousLocalStreamRef.current}
          conversationType={activeConversation?.type === "group" ? "group" : "dm"}
          onMinimize={() => setCallMinimized(true)}
        />
      )}

      {/* Call ended popup */}
      {callEndedInfo && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-background rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <PhoneOff size={24} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold">Call Ended</h3>
            <p className="text-sm text-muted-foreground">{callEndedInfo.reason}</p>
            <p className="text-sm font-medium">Duration: {callEndedInfo.duration}</p>
            <Button
              onClick={() => setCallEndedInfo(null)}
              className="w-full"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Incoming call notification */}
        {incomingCall && (
          <IncomingCallBanner
            callerName={incomingCall.callerName}
            type={incomingCall.type}
            onAccept={acceptIncomingCall}
            onDecline={declineIncomingCall}
          />
        )}
      <div className="flex h-[calc(100vh-var(--topbar-height,56px))] overflow-hidden">
        {/* â"€â"€â"€ Panel 1: Conversation List â"€â"€â"€ */}
        <div className="w-[280px] flex-shrink-0 border-r flex flex-col bg-background">
          {/* Header */}
          <div className="p-3 flex items-center gap-2">
            <Input
              placeholder="Search conversations..."
              className="flex-1 h-9 rounded-lg bg-muted border-0"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setNewChatOpen(true)}>
                  <SquarePen size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New chat</TooltipContent>
            </Tooltip>
          </div>

          {/* Unified conversation list — unread & recent on top */}
          <div className="flex-1 flex flex-col overflow-hidden px-2">
            <div className="flex-1 overflow-y-auto mt-1">
              {noResults ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Search size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground text-center">No results for "{searchQuery}"</p>
                </div>
              ) : (
                <>
                  <div className="space-y-0.5">
                    {sortedConversations.map((c) => (
                      <ConversationRow
                        key={c.id}
                        conversation={c}
                        isActive={c.id === activeConversationId}
                        onClick={() => handleSelectConversation(c.id)}
                      />
                    ))}
                  </div>
                  {peopleResults.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">People</span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                      <div className="space-y-0.5">
                        {peopleResults.map((user) => (
                          <button
                            key={user.username}
                            onClick={() => handleStartDm(user)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mx-1 text-left hover:bg-muted/60 transition-colors"
                          >
                            <Avatar name={user.displayName} size={38} />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium block truncate">{user.displayName}</span>
                              <span className="text-xs text-muted-foreground block truncate">@{user.username}</span>
                            </div>
                            <ChevronRight size={14} className="text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* â"€â"€â"€ Panel 2: Chat Area â"€â"€â"€ */}
        {activeConversation ? (
          <div
            className="flex-1 flex flex-col min-w-0 relative"
            onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingFile(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleAttachmentSelect(file);
            }}
          >
            {/* Drag overlay */}
            {isDraggingFile && (
              <div className="absolute inset-0 z-30 bg-primary/5 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <FilePlus size={40} className="mx-auto text-primary mb-2" />
                  <p className="text-sm font-medium text-primary">Drop file to upload</p>
                </div>
              </div>
            )}
            {/* Chat TopBar */}
            <div className="border-b px-4 h-14 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar name={activeConversation.name} size={36} isGroup={activeConversation.type === "group"} />
                  {activeConversation.type === "dm" && (
                    <OnlineDot size={8} className="absolute bottom-0 right-0" isOnline={isDmPartnerOnline} />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm">{activeConversation.name}</p>
                  {activeConversation.type === "dm" ? (
                    <div className="flex items-center gap-1">
                      <OnlineDot size={6} isOnline={isDmPartnerOnline} />
                      <span className={cn("text-xs", isDmPartnerOnline ? (isDmPartnerAway ? "text-yellow-500" : "text-green-500") : "text-muted-foreground")}>
                        {isDmPartnerOnline
                          ? (isDmPartnerAway ? "Away" : dmPartner?.status === "dnd" ? "Do not disturb" : "Active now")
                          : "Offline"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {activeConversationMemberCount} members
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isRemovedFromChat ? (
                  <span className="text-xs text-red-500/80 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded font-medium">Read only</span>
                ) : (
                <>
                {callSignal?.active && !callState?.active && callSignal.participants?.some((p) => p.status === "joined") ? (
                  /* Active group call with participants — show Join button */
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label="Join call"
                        onClick={acceptIncomingCall}
                        className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-sm font-medium text-white transition-colors"
                        style={{ backgroundColor: CALL_SUCCESS }}
                      >
                        <Phone size={16} />
                        Join
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Join ongoing call</TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                {/* Voice call */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={callState?.active ? "End voice call" : "Start voice call"}
                      onClick={() => callState?.active ? endCall() : startCall("voice")}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                        callState?.active && callState.type === "voice"
                          ? "bg-red-100 text-red-600 dark:bg-red-900/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Phone size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{callState?.active ? "End call" : "Voice call"}</TooltipContent>
                </Tooltip>

                {/* Video call */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={callState?.active && callState.type === "video" ? "End video call" : "Start video call"}
                      onClick={() => callState?.active ? endCall() : startCall("video")}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                        callState?.active && (callState.type === "video" || callState.type === "screen")
                          ? "bg-red-100 text-red-600 dark:bg-red-900/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Video size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{callState?.active ? "End call" : "Video call"}</TooltipContent>
                </Tooltip>

                {/* Screen share */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={callState?.isScreenSharing ? "Stop screen sharing" : "Start screen sharing"}
                      onClick={() => callState?.active ? updateCall({ isScreenSharing: !callState.isScreenSharing }) : startCall("screen")}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                        callState?.isScreenSharing
                          ? "bg-green-100 text-green-600 dark:bg-green-900/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <MonitorUp size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Screen share</TooltipContent>
                </Tooltip>
                  </>
                )}

                {/* Members — only for group chats */}
                {activeConversation.type === "group" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label="View members"
                        onClick={() => setShowInfoPanel(true)}
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Users size={18} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Members</TooltipContent>
                  </Tooltip>
                )}

                {/* Search */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Search messages"
                      onClick={() => setShowSearch((s) => !s)}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                        showSearch ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Search size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Search in chat</TooltipContent>
                </Tooltip>

                </>
                )}
                {/* Info panel — always visible, even for removed chats */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowInfoPanel((s) => !s)}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                        showInfoPanel ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <PanelRight size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Info</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Screen share banner */}
            {(callState?.isScreenSharing || isRemoteScreenSharing) && (
              <div className="bg-green-50 dark:bg-green-950/30 border-b border-green-200 dark:border-green-800 px-4 py-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <MonitorUp size={14} />
                {callState?.isScreenSharing ? "You are" : "Someone is"} sharing their screen
              </div>
            )}

            {/* Search Bar (collapsible) */}
            <div className={cn("overflow-hidden transition-all duration-200", showSearch ? "max-h-14" : "max-h-0")}>
              <div className="px-4 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search in conversation..."
                    className="h-8 text-sm"
                    value={chatSearchQuery}
                    onChange={(event) => { setChatSearchQuery(event.target.value); setSearchMatchIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setChatSearchQuery("");
                        setShowSearch(false);
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        if (e.shiftKey) {
                          scrollToSearchMatch(searchMatchIndex - 1);
                        } else {
                          scrollToSearchMatch(searchMatchIndex + 1);
                        }
                      }
                    }}
                  />
                  {hasChatSearch && searchMatchIds.length > 0 && (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {searchMatchIndex + 1}/{searchMatchIds.length}
                      </span>
                      <button
                        onClick={() => scrollToSearchMatch(searchMatchIndex - 1)}
                        disabled={searchMatchIndex <= 0}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Previous match"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => scrollToSearchMatch(searchMatchIndex + 1)}
                        disabled={searchMatchIndex >= searchMatchIds.length - 1}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Next match"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  )}
                  {hasChatSearch && searchMatchIds.length === 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">No matches</span>
                  )}
                </div>
              </div>
            </div>

            {/* Message Area */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative">
              {isLoadingMessages && messagesList.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-muted-foreground" />
                </div>
              ) : visibleGroupedMessages.length === 0 && hasChatSearch ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No messages match "{chatSearchQuery}".
                </div>
              ) : visibleGroupedMessages.length === 0 && !hasChatSearch ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageSquare size={36} className="text-muted-foreground/20 mb-2" />
                  <p className="text-sm text-muted-foreground">No messages yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Send a message to start the conversation</p>
                </div>
              ) : visibleGroupedMessages.map((group, gi) => (
                <div key={group.date}>
                  <DateSeparator date={group.messages[0].sentAt} />
                  {group.messages.map((msg, mi) => {
                    // System messages: render as centered WhatsApp-style notifications
                    if (msg.systemMessage) {
                      const isCallRelated = msg.systemMessage.includes("call");
                      const isMissedCall = msg.content.toLowerCase().includes("missed");

                      // Build display text with proper actor/user resolution
                      const isSentByMe = msg.senderName === currentUserName || msg.senderName === currentUsername;
                      let displayText = msg.content;

                      // Replace {actor} with the sender's name or "You"
                      displayText = displayText.replace(/\{actor\}/g, isSentByMe ? "You" : msg.senderName);
                      // Replace {user} with the other person's name — never "you" if it's already the actor
                      displayText = displayText.replace(/\{user\}/g, isSentByMe ? (activeConversation?.name || "the other user") : "you");

                      // Fix "You missed a call from You" → "You missed a call from <other person>"
                      if (isMissedCall && isSentByMe) {
                        displayText = displayText.replace(/from You/gi, `from ${activeConversation?.name || "the other user"}`);
                      }
                      // Fix "You missed a call from you" for the receiver
                      if (isMissedCall && !isSentByMe) {
                        displayText = displayText.replace(/from you/gi, `from ${msg.senderName}`);
                      }

                      // Format call duration messages: "Call with X and Y (Duration 0:47)"
                      const durationMatch = displayText.match(/\(Duration[:\s]+(\d+:\d+)\)/i);
                      if (durationMatch) {
                        // Keep duration format clean
                        displayText = displayText.replace(/\(Duration[:\s]+(\d+:\d+)\)/i, `(${durationMatch[1]})`);
                      }

                      return (
                        <div key={msg.id} className="flex justify-center my-2">
                          <div className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs max-w-[85%]",
                            isMissedCall
                              ? "bg-red-50 text-red-500 dark:bg-red-950/30 dark:text-red-400"
                              : isCallRelated
                                ? "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"
                                : "bg-muted/60 text-muted-foreground"
                          )}>
                            {isCallRelated && <Phone size={12} />}
                            <span>{displayText}</span>
                            <span className="text-[10px] opacity-60 ml-1">{formatMessageTime(msg.sentAt)}</span>
                          </div>
                        </div>
                      );
                    }

                    const isSent = currentUserId > 0
                      ? msg.senderId === currentUserId
                      : (msg.senderName === currentUserName || msg.senderName === currentUsername);
                    const prevMsg = mi > 0 ? group.messages[mi - 1] : gi > 0 ? visibleGroupedMessages[gi - 1].messages.at(-1) : undefined;
                    const isConsecutive = prevMsg
                      && prevMsg.senderId === msg.senderId
                      && !prevMsg.systemMessage
                      && (new Date(msg.sentAt).getTime() - new Date(prevMsg.sentAt).getTime()) < 120000;

                    return (
                      <div key={msg.id} id={`msg-${msg.id}`}>
                      <MessageBubble
                        message={msg}
                        isSent={isSent}
                        showAvatar={!isSent && (activeConversation?.type === "group" || !isConsecutive)}
                        showSenderName={!isSent && (activeConversation?.type === "group" || !isConsecutive)}
                        searchQuery={chatSearchQuery}
                        allMessages={messagesList}
                        onReply={handleReply}
                        onForward={handleForwardMessage}
                        onReact={handleReact}
                      />
                      </div>
                    );
                  })}
                </div>
              ))}

              {remoteTypingUsers.length > 0 && (
                <TypingIndicator name={remoteTypingUsers.map((u) => u.displayName).join(", ")} />
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Scroll to bottom button */}
            {showScrollToBottom && (
              <button
                onClick={() => {
                  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                  setShowScrollToBottom(false);
                }}
                className="absolute bottom-[calc(theme(spacing.3)+60px)] right-6 z-20 h-9 w-9 rounded-full bg-background border shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                aria-label="Scroll to bottom"
              >
                <ArrowDown size={16} />
              </button>
            )}

            {/* Reply preview */}
            {replyTo && (
              <ReplyPreviewBar replyTo={replyTo} onCancel={() => setReplyTo(null)} />
            )}

            {/* Pending attachment preview */}
            {pendingAttachment && (
              <div className="border-t bg-muted/30 px-3 py-2 flex items-center gap-3">
                {pendingAttachment.previewUrl ? (
                  <img src={pendingAttachment.previewUrl} alt={pendingAttachment.file.name} className="h-12 w-12 rounded-lg object-cover border" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                    {(() => { const FIcon = getFileIcon(pendingAttachment.file.name); return <FIcon size={20} className="text-muted-foreground" />; })()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pendingAttachment.file.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatFileSize(pendingAttachment.file.size)} — {isUploadingAttachment ? "Uploading..." : "Ready to send"}
                  </p>
                </div>
                <button
                  onClick={cancelPendingAttachment}
                  className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Message Composer — hidden if removed/kicked from group */}
            {isRemovedFromChat ? (
              <div className="border-t bg-muted/50 px-4 py-4 flex-shrink-0">
                <div className="flex items-center gap-3 justify-center text-muted-foreground">
                  <div className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <X size={16} className="text-red-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">You were removed from this group</p>
                    <p className="text-xs text-muted-foreground mt-0.5">You can view previous messages but can no longer send new ones</p>
                  </div>
                </div>
              </div>
            ) : (
            <div className="border-t bg-background px-3 py-3 flex-shrink-0">
              <div className="flex items-end gap-2">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    handleAttachmentSelect(event.target.files?.[0] || null);
                  }}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Attach file"
                      onClick={() => attachmentInputRef.current?.click()}
                      className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mb-0.5"
                      disabled={isUploadingAttachment}
                    >
                      <Paperclip size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{isUploadingAttachment ? "Uploading..." : "Attach file"}</TooltipContent>
                </Tooltip>

                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <button aria-label="Insert emoji" className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mb-0.5">
                      <Smile size={18} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-3" align="start">
                    <div className="grid grid-cols-5 gap-2">
                      {EMOJI_LIST.map((emoji) => (
                        <button
                          key={emoji}
                          className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-lg"
                          onClick={() => {
                            setComposerContent((prev) => prev + emoji);
                            setEmojiOpen(false);
                            textareaRef.current?.focus();
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <textarea
                  ref={textareaRef}
                  value={composerContent}
                  onChange={(e) => setComposerContent(e.target.value)}
                  onInput={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  onFocus={handleComposerFocus}
                  onBlur={handleComposerBlur}
                  placeholder={pendingAttachment ? "Add a message (optional)..." : `Message ${activeConversation.name}...`}
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px] max-h-[120px]"
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      className="h-9 w-9 rounded-lg shrink-0 mb-0.5"
                      disabled={!composerContent.trim() && !pendingAttachment}
                      onClick={handleSend}
                    >
                      <SendHorizontal size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Send message</TooltipContent>
                </Tooltip>
              </div>
            </div>
            )}
          </div>
        ) : (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center bg-muted/20">
            <div className="text-center space-y-3">
              <MessageSquare size={48} className="text-muted-foreground/30 mx-auto" />
              <p className="font-medium text-muted-foreground">Select a conversation</p>
              <p className="text-sm text-muted-foreground/70">Choose from your direct messages or groups</p>
            </div>
          </div>
        )}

        {/* â"€â"€â"€ Panel 3: Info Panel â"€â"€â"€ */}
        {showInfoPanel && activeConversation && (
          <InfoPanel
            conversation={activeConversation}
            onMuteToggle={handleMuteToggle}
            onLeaveGroup={isRemovedFromChat ? () => {
              setRemovedConversationCache(null);
              const remaining = conversations.filter((c) => c.id !== activeConversationId);
              setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
            } : handleLeaveGroup}
            onDeleteGroup={handleDeleteGroup}
            onTransferAdmin={handleTransferAdmin}
            showToast={showToast}
            currentUserName={currentUserName}
            currentUserId={currentUserId}
            availableUsers={availableUsers}
            isRemovedFromChat={isRemovedFromChat}
          />
        )}
      </div>

      {/* New Conversation Dialog */}
      <Dialog open={newChatOpen} onOpenChange={(open) => {
        setNewChatOpen(open);
        if (!open) { setNewGroupTab("dm"); setNewGroupName(""); setNewGroupMembers([]); setNewDmSearch(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
          </DialogHeader>
          <Tabs value={newGroupTab} onValueChange={(v) => setNewGroupTab(v as "dm" | "group")}>
            <TabsList className="w-full mb-3">
              <TabsTrigger value="dm" className="flex-1">Direct message</TabsTrigger>
              <TabsTrigger value="group" className="flex-1">New group</TabsTrigger>
            </TabsList>

            <TabsContent value="dm">
              <Input
                placeholder="Search people..."
                className="mb-3"
                value={newDmSearch}
                onChange={(e) => setNewDmSearch(e.target.value)}
              />
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {availableUsers
                  .filter((user) =>
                    !newDmSearch ||
                    user.displayName.toLowerCase().includes(newDmSearch.toLowerCase()) ||
                    user.username.toLowerCase().includes(newDmSearch.toLowerCase()),
                  )
                  .map((user) => (
                    <button
                      key={user.username}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors"
                      onClick={() => handleStartDm(user)}
                    >
                      <Avatar name={user.displayName} size={36} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium block truncate">{user.displayName}</span>
                        <span className="text-xs text-muted-foreground block truncate">@{user.username}</span>
                      </div>
                    </button>
                  ))}
              </div>
            </TabsContent>

            <TabsContent value="group">
              <Input
                placeholder="Group name"
                className="mb-3"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mb-2">Add members (at least 1)</p>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {availableUsers.map((user) => {
                  const isSelected = newGroupMembers.includes(user.username);
                  return (
                    <button
                      key={user.username}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                        isSelected ? "bg-accent" : "hover:bg-muted"
                      )}
                      onClick={() => {
                        setNewGroupMembers((prev) =>
                          isSelected ? prev.filter((username) => username !== user.username) : [...prev, user.username]
                        );
                      }}
                    >
                      <div className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center",
                        isSelected ? "bg-primary border-primary" : "border-muted-foreground"
                      )}>
                        {isSelected && <span className="text-white text-[10px]">✔</span>}
                      </div>
                      <Avatar name={user.displayName} size={32} />
                      <div className="min-w-0 text-left">
                        <span className="text-sm font-medium block truncate">{user.displayName}</span>
                        <span className="text-xs text-muted-foreground block truncate">@{user.username}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {newGroupMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {newGroupMembers.map((username) => {
                    const user = availableUsers.find((entry) => entry.username === username);
                    const label = user?.displayName || username;
                    return (
                      <span key={username} className="inline-flex items-center gap-1 bg-muted rounded-full px-2.5 py-1 text-xs font-medium">
                        <Avatar name={label} size={16} />
                        {label.split(" ")[0]}
                        <button onClick={() => setNewGroupMembers((prev) => prev.filter((value) => value !== username))} className="hover:opacity-70">
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <Button
                className="w-full mt-3"
                disabled={!newGroupName.trim() || newGroupMembers.length === 0}
                onClick={handleCreateGroup}
              >
                Create group
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Forward Dialog */}
      <ForwardDialog
        open={!!forwardMessage}
        onClose={() => setForwardMessage(null)}
        message={forwardMessage}
        conversations={conversations}
        onForward={handleForwardToConversation}
      />
    </>
  );
}

// ── Error Boundary — prevents a render error from white-screening the app ──
// On recovery it forces a full page reload to guarantee a clean state, since
// stale call signals, polling effects, and WebRTC refs cannot be safely
// re-initialised by simply re-mounting TalkInner.

class TalkErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[Talk] Render error caught by ErrorBoundary:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm mx-auto p-8">
            <p className="text-lg font-semibold">Something went wrong</p>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred in Talk. Click below to reload.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Talk() {
  return (
    <TalkErrorBoundary>
      <TalkInner />
    </TalkErrorBoundary>
  );
}
