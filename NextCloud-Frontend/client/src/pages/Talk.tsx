import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import {
  MessageSquare, SquarePen, Phone, Video, MonitorUp,
  Search, PanelRight, Paperclip, Smile, SendHorizontal,
  Users, PhoneOff, X, FileText, Image, File,
  Bell, BellOff, Crown, Trash2, UserPlus, Mic, MicOff,
  Volume2, VolumeX, Grid3x3, MoreHorizontal, VideoOff,
  ChevronRight, Reply, Forward, Copy, Download, Trash,
  FilePlus, FileIcon, FileImage, FileVideo, FileAudio, FileArchive,
  FileSpreadsheet, FileType, ArrowDown, Pause, Play, Maximize, Minimize,
  UserRoundPlus, StopCircle, SignalHigh,
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

const EMOJI_LIST = ["😀","😂","👍","❤️","🎉","🔥","👀","🙏","💯","✅","🚀","😎","🤔","💡","📌","✨","🎯","📊","🏆","👋"];
const ACTIVE_CONVERSATION_STORAGE_KEY = "cloudspace:talk:activeConversationId";

const QUICK_REACTIONS = ["👍","❤️","😂","🎉","👀","🔥"];

function parseAttachmentMessage(content: string): { name: string; path: string } | null {
  if (!content.startsWith("Shared file: ")) return null;
  const lines = content.split("\n");
  if (lines.length < 2) return null;
  return { name: lines[0].replace("Shared file: ", ""), path: lines[1] };
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
  const show = useCallback((message: string, action?: React.ReactNode) => {
    setToast({ message, action });
    setTimeout(() => setToast(null), 4000);
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
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

function OnlineDot({ size = 8, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn("rounded-full bg-green-500 border-2 border-background", className)}
      style={{ width: size, height: size }}
    />
  );
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
        {c.type === "dm" && (
          <OnlineDot size={8} className="absolute bottom-0 right-0" />
        )}
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

function AttachmentBubble({ name, path, isSent }: { name: string; path: string; isSent: boolean }) {
  const Icon = getFileIcon(name);
  const ext = name.split(".").pop()?.toUpperCase() || "FILE";
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl p-3 min-w-[220px] max-w-[320px] border",
      isSent ? "bg-primary/10 border-primary/20" : "bg-muted/60 border-border"
    )}>
      <div className={cn(
        "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
        isSent ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
      )}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground">{ext} file</p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0">
            <Download size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>
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
      return <AttachmentBubble name={attachment.name} path={attachment.path} isSent={isSent} />;
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
        <button
          onClick={() => setShowReactions(true)}
          className="bg-muted/50 border border-dashed rounded-full px-1.5 py-0.5 text-xs cursor-pointer hover:bg-accent transition-colors text-muted-foreground"
        >
          +
        </button>
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

// â"€â"€â"€ Voice Call Overlay â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function VoiceCallOverlay({ callState, onUpdate, onEnd, onScreenShare, onAddParticipant, remoteMedia, currentUsername, availableUsers }: {
  callState: CallState;
  onUpdate: (partial: Partial<CallState>) => void;
  onEnd: () => void;
  onScreenShare: () => void;
  onAddParticipant: (username: string) => void;
  remoteMedia: RemoteCallMedia[];
  currentUsername: string;
  availableUsers: TalkDirectoryUser[];
}) {
  const [isOnHold, setIsOnHold] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState("");

  const joinedRemoteMedia = callState.participants
    .filter((participant) => participant.username !== currentUsername && participant.status === "joined")
    .map((participant) => {
      const media = remoteMedia.find((item) => item.username === participant.username);
      return media ? { participant, media } : null;
    })
    .filter((entry): entry is { participant: CallState["participants"][number]; media: RemoteCallMedia } => !!entry);

  const participantUsernames = new Set(callState.participants.map((p) => p.username));
  const addableUsers = availableUsers.filter(
    (u) => !participantUsernames.has(u.username) && u.username !== currentUsername
      && (addSearch ? u.displayName.toLowerCase().includes(addSearch.toLowerCase()) : true)
  );

  const handleHold = () => {
    const newHold = !isOnHold;
    setIsOnHold(newHold);
    // Mute mic and disable speaker when on hold
    onUpdate({ isMuted: newHold, isSpeakerOn: !newHold });
  };

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-gray-800 to-gray-900 flex flex-col items-center justify-center text-white">
      {joinedRemoteMedia.map(({ media }) => (
        <RemoteAudioRenderer
          key={media.username}
          stream={media.stream}
          muted={!callState.isSpeakerOn}
        />
      ))}

      {/* Hold overlay */}
      {isOnHold && (
        <div className="absolute inset-0 bg-black/50 z-10 flex items-center justify-center">
          <div className="text-center">
            <Pause size={56} className="text-yellow-400 mx-auto mb-3" />
            <p className="text-xl font-semibold text-yellow-400">Call on Hold</p>
            <button onClick={handleHold} className="mt-4 px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-medium rounded-full transition-colors">
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Participant count badge */}
      <div className="absolute top-4 right-4 bg-white/10 rounded-full px-3 py-1.5 flex items-center gap-2">
        <Users size={14} />
        <span className="text-sm">{callState.participants.filter((p) => p.status === "joined").length}</span>
      </div>

      {/* Duration */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur rounded-full px-4 py-1.5 text-sm font-mono">
        {formatCallDuration(callState.duration)}
      </div>

      {/* Main caller */}
      <div className="relative">
        {callState.participants.some((p) => p.isSpeaking && p.username !== currentUsername) && (
          <div className="absolute inset-0 -m-2 rounded-full ring-2 ring-green-400 animate-pulse" />
        )}
        <Avatar name={callState.conversationName} size={96} />
      </div>
      <p className="text-xl font-semibold mt-4">{callState.conversationName}</p>
      <p className="text-sm text-white/50 mt-1">
        {callState.participants.filter((p) => p.status === "joined").length > 1
          ? `${callState.participants.filter((p) => p.status === "joined").length} participants`
          : "Calling..."}
      </p>

      {/* Participants for group calls */}
      {callState.participants.length > 2 && (
        <div className="flex gap-4 mt-6 flex-wrap justify-center max-w-md">
          {callState.participants.map((p) => (
            <div key={p.id} className="flex flex-col items-center gap-1">
              <div className={cn("relative", p.isSpeaking && "ring-2 ring-green-400 rounded-full")}>
                <Avatar name={p.name} size={48} />
                {p.status === "ringing" && (
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center">
                    <Phone size={8} className="text-white" />
                  </div>
                )}
                {p.isSpeaking && (
                  <div className="absolute inset-0 rounded-full ring-2 ring-green-400 animate-ping opacity-40" />
                )}
              </div>
              <span className="text-xs text-white/70">{p.name.split(" ")[0]}</span>
              <span className="text-[10px] text-white/40">{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-gray-900/80 backdrop-blur rounded-2xl px-6 py-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onUpdate({ isMuted: !callState.isMuted })}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                callState.isMuted ? "bg-red-500/70 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              {callState.isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{callState.isMuted ? "Unmute" : "Mute"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onUpdate({ isSpeakerOn: !callState.isSpeakerOn })}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                !callState.isSpeakerOn ? "bg-white/30" : "bg-white/10 hover:bg-white/20"
              )}
            >
              {callState.isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{callState.isSpeakerOn ? "Speaker off" : "Speaker on"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHold}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                isOnHold ? "bg-yellow-500/70 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              {isOnHold ? <Play size={20} /> : <Pause size={20} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isOnHold ? "Resume" : "Hold"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onScreenShare}
              className="h-12 w-12 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <MonitorUp size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Share screen</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowAddPanel(!showAddPanel)}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                showAddPanel ? "bg-primary text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              <UserRoundPlus size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Add participant</TooltipContent>
        </Tooltip>

        <Popover>
          <PopoverTrigger asChild>
            <button className="h-12 w-12 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors">
              <Grid3x3 size={20} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-2">
            <div className="grid grid-cols-3 gap-1">
              {["1","2","3","4","5","6","7","8","9","*","0","#"].map((k) => (
                <button key={k} className="h-10 rounded-lg bg-muted hover:bg-accent text-sm font-medium">{k}</button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <button
          onClick={onEnd}
          className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors ml-2"
        >
          <PhoneOff size={20} />
        </button>
      </div>

      {/* Add Participant Panel */}
      {showAddPanel && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-80 bg-gray-900/95 backdrop-blur border border-white/10 rounded-2xl p-4 shadow-2xl">
          <p className="text-sm font-medium mb-2">Add participant</p>
          <Input
            placeholder="Search users..."
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            className="mb-2 bg-white/5 border-white/10 text-white placeholder:text-white/40"
          />
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {addableUsers.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-2">No users found</p>
            ) : addableUsers.slice(0, 8).map((u) => (
              <button
                key={u.username}
                onClick={() => { onAddParticipant(u.username); setShowAddPanel(false); setAddSearch(""); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <Avatar name={u.displayName} size={28} />
                <div className="min-w-0 text-left">
                  <span className="text-sm block truncate">{u.displayName}</span>
                  <span className="text-[10px] text-white/40 block">@{u.username}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// â"€â"€â"€ Video Call Overlay â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    if (stream) {
      void ref.current.play().catch(() => undefined);
    }
  }, [stream]);

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

function VideoCallOverlay({ callState, onUpdate, onEnd, currentUserName, currentUsername, onAddParticipant, localStream, localVideoEnabled, remoteMedia, availableUsers }: {
  callState: CallState;
  onUpdate: (partial: Partial<CallState>) => Promise<void> | void;
  onEnd: () => void;
  currentUserName: string;
  currentUsername: string;
  onAddParticipant: (username: string) => void;
  localStream: MediaStream | null;
  localVideoEnabled: boolean;
  remoteMedia: RemoteCallMedia[];
  availableUsers: TalkDirectoryUser[];
}) {
  const [isOnHold, setIsOnHold] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

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
  const isDm = joinedRemoteMedia.length <= 1;
  const featuredRemote = joinedRemoteMedia[0];
  const isSelfSharing = callState.isScreenSharing;

  const participantUsernames = new Set(callState.participants.map((p) => p.username));
  const addableUsers = availableUsers.filter(
    (u) => !participantUsernames.has(u.username) && u.username !== currentUsername
      && (addSearch ? u.displayName.toLowerCase().includes(addSearch.toLowerCase()) : true)
  );

  const handleHold = () => {
    const newHold = !isOnHold;
    setIsOnHold(newHold);
    onUpdate({ isMuted: newHold, isSpeakerOn: !newHold });
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => undefined);
      setIsFullscreen(false);
    }
  };

  const joinedCount = callState.participants.filter((p) => p.status === "joined").length;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {joinedRemoteMedia.map(({ media }) => (
        <RemoteAudioRenderer
          key={media.username}
          stream={media.stream}
          muted={!callState.isSpeakerOn}
        />
      ))}

      {/* Hold overlay */}
      {isOnHold && (
        <div className="absolute inset-0 bg-black/60 z-20 flex items-center justify-center">
          <div className="text-center">
            <Pause size={56} className="text-yellow-400 mx-auto mb-3" />
            <p className="text-xl font-semibold text-yellow-400">Call on Hold</p>
            <button onClick={handleHold} className="mt-4 px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-medium rounded-full transition-colors">
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-4 left-0 right-0 z-10 flex items-center justify-between px-4">
        {/* Duration */}
        <div className="bg-black/40 backdrop-blur rounded-full px-4 py-1.5 text-white text-sm font-mono flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {formatCallDuration(callState.duration)}
        </div>
        {/* Participant count + fullscreen */}
        <div className="flex items-center gap-2">
          <div className="bg-black/40 backdrop-blur rounded-full px-3 py-1.5 text-white text-sm flex items-center gap-1.5">
            <Users size={14} />
            <span>{joinedCount}</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={toggleFullscreen} className="bg-black/40 backdrop-blur rounded-full p-2 text-white hover:bg-black/60 transition-colors">
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Screen share toolbar for the user who is sharing */}
      {isSelfSharing && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-red-600/90 backdrop-blur rounded-xl px-5 py-2.5 flex items-center gap-4 shadow-lg">
          <MonitorUp size={18} className="text-white" />
          <span className="text-white text-sm font-medium">You are sharing your screen</span>
          <button
            onClick={() => onUpdate({ isScreenSharing: false })}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
          >
            <StopCircle size={14} />
            Stop sharing
          </button>
        </div>
      )}

      {/* Video tiles */}
      <div className="flex-1 p-4 relative">
        {callState.isScreenSharing ? (
          /* Screen share layout: shared screen + participant thumbnails + self PIP */
          <div className="h-full flex flex-col gap-3">
            <div className="flex-1 rounded-xl bg-gray-800 flex flex-col items-center justify-center relative overflow-hidden">
              {featuredRemote?.media.stream && featuredRemote.media.hasVideo ? (
                <StreamRenderer stream={featuredRemote.media.stream} className="h-full w-full rounded-xl object-contain" />
              ) : isSelfSharing && localStream ? (
                <StreamRenderer stream={localStream} muted className="h-full w-full rounded-xl object-contain" />
              ) : (
                <>
                  <MonitorUp size={64} className="text-white/30 mb-3" />
                  <p className="text-white font-medium">{isSelfSharing ? "You are" : (featuredRemote?.participant.name || "Participant") + " is"} sharing screen</p>
                </>
              )}
            </div>
            {/* Thumbnails strip */}
            <div className="flex gap-2 justify-center">
              {callState.participants.filter((p) => p.status === "joined").map((p) => {
                const isLocal = p.username === currentUsername;
                const pMedia = isLocal
                  ? { stream: isSelfSharing ? null : localStream, hasVideo: !isSelfSharing && localVideoEnabled && !callState.isVideoOff }
                  : joinedRemoteMedia.find((item) => item.participant.username === p.username)?.media;
                return (
                  <div
                    key={p.username}
                    className={cn(
                      "w-28 h-20 rounded-lg bg-gray-800 flex flex-col items-center justify-center relative overflow-hidden",
                      p.isSpeaking && "ring-2 ring-green-400"
                    )}
                  >
                    {pMedia?.stream && pMedia.hasVideo ? (
                      <StreamRenderer stream={pMedia.stream} muted={isLocal} className="h-full w-full object-cover" />
                    ) : (
                      <Avatar name={p.name} size={32} />
                    )}
                    <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/40 px-1 rounded">
                      {isLocal ? "You" : p.name.split(" ")[0]}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Self camera PIP when sharing screen */}
            {isSelfSharing && localVideoEnabled && !callState.isVideoOff && localStream && (
              <div className="absolute top-20 right-6 w-[200px] h-[150px] rounded-xl bg-gray-800 overflow-hidden border border-gray-600 shadow-xl z-10">
                <StreamRenderer stream={localStream} muted className="h-full w-full object-cover" />
                <span className="absolute bottom-2 left-2 text-[10px] text-white bg-black/40 px-1.5 py-0.5 rounded">Your camera</span>
              </div>
            )}
          </div>
        ) : isDm ? (
          /* DM video: main tile + self PIP */
          <div className="h-full relative">
            <div className={cn(
                "h-full rounded-xl bg-gray-800 flex items-center justify-center relative overflow-hidden",
                featuredRemote?.participant.isSpeaking && "ring-2 ring-green-400"
              )}>
                {featuredRemote?.media.stream && featuredRemote.media.hasVideo ? (
                  <StreamRenderer stream={featuredRemote.media.stream} muted className="h-full w-full object-cover" />
                ) : (
                  <>
                    {featuredRemote?.media.stream ? (
                      <StreamRenderer stream={featuredRemote.media.stream} muted className="hidden" />
                    ) : null}
                    <Avatar name={featuredRemote?.participant.name || callState.conversationName} size={64} />
                  </>
              )}
              <span className="absolute bottom-3 left-3 text-white text-xs font-medium bg-black/40 px-2 py-0.5 rounded">
                {featuredRemote?.participant.name || callState.conversationName}
              </span>
            </div>
            {/* Self PIP */}
            <div className="absolute bottom-4 right-4 w-[240px] h-[135px] rounded-xl bg-gray-800 flex items-center justify-center overflow-hidden border border-gray-700">
              {!callState.isVideoOff && localVideoEnabled && localStream ? (
                <StreamRenderer stream={localStream} muted className="h-full w-full object-cover" />
              ) : callState.isVideoOff ? (
                <div className="flex flex-col items-center gap-1">
                  <Avatar name={currentUserName} size={48} />
                  <span className="text-[10px] text-white/60">Camera off</span>
                </div>
              ) : (
                <Avatar name={currentUserName} size={48} />
              )}
              <span className="absolute bottom-2 left-2 text-[10px] text-white bg-black/40 px-1.5 py-0.5 rounded">You</span>
            </div>
          </div>
        ) : (
          /* Group video: grid */
          <div className="h-full grid grid-cols-2 gap-3">
            {callState.participants
              .filter((p) => p.status === "joined")
              .map((p) => {
                const media = p.username === currentUsername
                  ? { stream: localStream, hasVideo: localVideoEnabled && !callState.isVideoOff }
                  : joinedRemoteMedia.find((item) => item.participant.username === p.username)?.media;
                return (
              <div
                key={p.username}
                className={cn(
                  "rounded-xl bg-gray-800 flex items-center justify-center relative overflow-hidden",
                  p.isSpeaking && "ring-2 ring-green-400"
                )}
                >
                  {media?.stream && media.hasVideo ? (
                    <StreamRenderer stream={media.stream} muted={p.username === currentUsername} className="h-full w-full object-cover" />
                  ) : (
                    <>
                      {media?.stream ? (
                        <StreamRenderer stream={media.stream} muted className="hidden" />
                      ) : null}
                      <Avatar name={p.name} size={64} />
                    </>
                )}
                <span className="absolute bottom-2 left-2 text-white text-xs font-medium bg-black/40 px-2 py-0.5 rounded">
                  {p.name}{p.username === currentUsername ? " (You)" : ""}
                </span>
              </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Control bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-gray-900/80 backdrop-blur rounded-2xl px-6 py-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onUpdate({ isMuted: !callState.isMuted })}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                callState.isMuted ? "bg-red-500/70 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              {callState.isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{callState.isMuted ? "Unmute" : "Mute"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onUpdate({ isVideoOff: !callState.isVideoOff })}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                callState.isVideoOff ? "bg-red-500/70 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              {callState.isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{callState.isVideoOff ? "Camera on" : "Camera off"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onUpdate({ isScreenSharing: !callState.isScreenSharing })}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                callState.isScreenSharing ? "bg-green-600/80 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              <MonitorUp size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{callState.isScreenSharing ? "Stop sharing" : "Share screen"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHold}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                isOnHold ? "bg-yellow-500/70 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              {isOnHold ? <Play size={20} /> : <Pause size={20} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isOnHold ? "Resume" : "Hold"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowAddPanel(!showAddPanel)}
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                showAddPanel ? "bg-primary text-white" : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              <UserRoundPlus size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Add participant</TooltipContent>
        </Tooltip>

        <button
          onClick={onEnd}
          className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors ml-2"
        >
          <PhoneOff size={20} />
        </button>
      </div>

      {/* Add Participant Panel */}
      {showAddPanel && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-80 bg-gray-900/95 backdrop-blur border border-white/10 rounded-2xl p-4 shadow-2xl z-20">
          <p className="text-sm font-medium text-white mb-2">Add participant</p>
          <Input
            placeholder="Search users..."
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            className="mb-2 bg-white/5 border-white/10 text-white placeholder:text-white/40"
          />
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {addableUsers.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-2">No users found</p>
            ) : addableUsers.slice(0, 8).map((u) => (
              <button
                key={u.username}
                onClick={() => { onAddParticipant(u.username); setShowAddPanel(false); setAddSearch(""); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors text-white"
              >
                <Avatar name={u.displayName} size={28} />
                <div className="min-w-0 text-left">
                  <span className="text-sm block truncate">{u.displayName}</span>
                  <span className="text-[10px] text-white/40 block">@{u.username}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// â"€â"€â"€ Incoming Call Notification â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
    <div className="fixed inset-0 z-[60] bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 flex flex-col items-center justify-center text-white">
      {/* Animated pulse rings */}
      <div className="relative mb-6">
        <div className="absolute inset-0 -m-6 rounded-full bg-green-500/10 animate-ping" style={{ animationDuration: "2s" }} />
        <div className="absolute inset-0 -m-3 rounded-full bg-green-500/15 animate-pulse" style={{ animationDuration: "1.5s" }} />
        <Avatar name={callerName} size={120} />
        <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30">
          <CallIcon size={20} className="text-white" />
        </div>
      </div>

      {/* Caller info */}
      <p className="text-2xl font-bold mt-2">{callerName}</p>
      <p className="text-base text-white/60 mt-1">{callLabel}</p>

      {/* Ringing indicator */}
      <div className="flex items-center gap-2 mt-4">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-green-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <span className="text-sm text-white/50">Ringing...</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-12 mt-16">
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all hover:scale-105 shadow-lg shadow-red-500/30"
          >
            <PhoneOff size={28} />
          </button>
          <span className="text-xs text-white/60">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAccept}
            className="h-16 w-16 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center transition-all hover:scale-105 shadow-lg shadow-green-500/30 animate-pulse"
            style={{ animationDuration: "2s" }}
          >
            <CallIcon size={28} />
          </button>
          <span className="text-xs text-white/60">Accept</span>
        </div>
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
  }));
  const dmParticipant = members.find((member) => member.name !== currentUserName) || members[0] || null;
  const isAdmin = members.some((member) => member.id === currentUserId && member.isModerator);
  const sharedFiles = (sharedFilesData?.data || []).slice(0, 3);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
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
              <OnlineDot size={6} />
              <span className="text-xs text-green-500">Online</span>
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
                    <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(sharedFile.size / 1024))} KB</span>
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
              {members.map((member) => (
                <div key={member.name} className="flex items-center gap-2">
                  <div className="relative">
                    <Avatar name={member.name} size={36} />
                    <OnlineDot size={6} className="absolute bottom-0 right-0" />
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
                </div>
              ))}
            </div>

            {/* Admin actions */}
            {isAdmin && !isDm && (
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
              const memberId = Math.max(
                2,
                Array.from(m.name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
              );
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
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {availableUsers
              .filter((user) => !members.some((member) => member.username === user.username))
              .map((user) => (
              <button
                key={user.username}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                onClick={() => {
                  addMemberMutation.mutate(user.username, {
                    onSuccess: () => {
                      showToast(`Member added: ${user.displayName}`);
                      setAddMemberOpen(false);
                    },
                    onError: () => showToast(`Unable to add ${user.displayName}`),
                  });
                }}
              >
                <Avatar name={user.displayName} size={32} />
                <div className="min-w-0 text-left">
                  <span className="text-sm font-medium block truncate">{user.displayName}</span>
                  <span className="text-xs text-muted-foreground block truncate">@{user.username}</span>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// â"€â"€â"€ Main Talk Page â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export default function Talk() {
  const queryClient = useQueryClient();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();

  // State
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
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
  const [remoteMedia, setRemoteMedia] = useState<RemoteCallMedia[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const incomingCallTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const incomingCallAudioContextRef = useRef<AudioContext | null>(null);
  const incomingCallRingtoneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const previousLocalStreamRef = useRef<MediaStream | null>(null);
  const isMediaReadyRef = useRef(false);
  const sentOffersRef = useRef(new Set<string>());
  const sentAnswersRef = useRef(new Set<string>());
  const processedCandidateIdsRef = useRef<Set<string>>(new Set());
  const sawActiveSignalRef = useRef<Set<number>>(new Set());

  // Queries
  const { data: conversationsData } = useQuery({
    queryKey: ["/api/conversations"],
    queryFn: () => fetchJson<{ data: Conversation[] }>("/api/conversations"),
    refetchInterval: 10000,
  });

  const conversations = conversationsData?.data || [];
  const activeConversation = conversations.find((c) => c.id === activeConversationId);
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
    enabled: !!activeConversationId,
    refetchInterval: 3000,
  });

  const { data: messagesData } = messagesQuery;
  const messagesList = messagesData?.data || [];

  const { data: callSignalData } = useQuery({
    queryKey: ["/api/conversations/call", activeConversationId],
    queryFn: () => fetchJson<{ data: ConversationCallSignal | null }>(`/api/conversations/${activeConversationId}/call`),
    enabled: !!activeConversationId,
    refetchInterval: 1500,
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

  // Scroll to bottom on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesList]);

  // Call duration counter
  useEffect(() => {
    if (!callState?.active) return;
    const interval = setInterval(() => {
      setCallState((prev) => prev ? { ...prev, duration: prev.duration + 1 } : null);
    }, 1000);
    return () => clearInterval(interval);
  }, [callState?.active]);

  // Speaking simulation
  useEffect(() => {
    if (!callState?.active) return;
    const interval = setInterval(() => {
      setCallState((prev) => {
        if (!prev) return null;
        const speakingIdx = Math.floor(Math.random() * prev.participants.length);
        return {
          ...prev,
          participants: prev.participants.map((p, i) => ({ ...p, isSpeaking: i === speakingIdx })),
        };
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [callState?.active]);

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
    }, 2200);
  }

  // Incoming call auto-dismiss
  useEffect(() => {
    if (!incomingCall) {
      stopIncomingCallRingtone();
      return;
    }

    void startIncomingCallRingtone();
    incomingCallTimeoutRef.current = setTimeout(() => setIncomingCall(null), 15000);
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
    return Array.from(username).reduce((sum, char) => sum + char.charCodeAt(0), 0);
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
      next[existingIndex] = entry;
      return next;
    });
  }

  function removeRemoteMediaEntry(username: string) {
    setRemoteMedia((prev) => prev.filter((item) => item.username !== username));
  }

  function stopPeerConnection(username: string) {
    const existing = peerConnectionsRef.current.get(username);
    if (!existing) return;
    existing.onicecandidate = null;
    existing.ontrack = null;
    existing.close();
    peerConnectionsRef.current.delete(username);
    sentOffersRef.current.delete(username);
    sentAnswersRef.current.delete(username);
    removeRemoteMediaEntry(username);
  }

  function stopMediaAndPeer() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    previousLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
    previousLocalStreamRef.current = null;
    localStreamRef.current = null;
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
      iceServers:
        Array.isArray(callSignal?.iceServers) && callSignal.iceServers.length > 0
          ? callSignal.iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }],
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

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      setRemoteMediaEntry({
        username: remoteUsername,
        displayName: remoteDisplayName,
        stream,
        hasVideo: stream.getVideoTracks().length > 0,
      });
    };

    peerConnectionsRef.current.set(remoteUsername, connection);
    return connection;
  }

  async function replaceLocalStream(nextStream: MediaStream, conversationId: number, isScreenSharing: boolean) {
    const previous = localStreamRef.current;
    localStreamRef.current = nextStream;
    setLocalVideoEnabled(nextStream.getVideoTracks().length > 0);

    for (const connection of peerConnectionsRef.current.values()) {
      syncPeerConnectionTracks(connection, nextStream);
    }

    if (previous && previous !== previousLocalStreamRef.current) {
      previous.getTracks().forEach((track) => track.stop());
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
      offerToReceiveVideo: callType !== "voice",
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
          if (!connection.currentRemoteDescription) {
            await connection.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
          }
          if (!sentAnswersRef.current.has(signal.from)) {
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            await apiRequest("PATCH", `/api/conversations/${signalState.conversationId}/call`, {
              answer,
              answerTo: signal.from,
            }).catch(() => undefined);
            sentAnswersRef.current.add(signal.from);
          }
        }

        if (signal.kind === "answer") {
          if (!connection.currentRemoteDescription) {
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
      sawActiveSignalRef.current.add(activeConversationId);
      if (callState?.active && callState.conversationId === activeConversationId) {
        setCallState((prev) =>
          prev
            ? {
                ...prev,
                isScreenSharing: callSignal.isScreenSharing,
                participants: mapCallParticipants(callSignal.participants),
              }
            : prev,
        );
        void syncCallSignals(callSignal);
      } else {
        const currentParticipant = callSignal.participants.find((participant) => participant.username === currentUsername);
          if (callSignal.initiatorUsername !== currentUsername && currentParticipant?.status !== "declined") {
            setIncomingCall({
              callerName: callSignal.initiatorName,
              type: callSignal.type,
            });
          }
        }
        return;
    }

    const hasResolvedCallSignal = typeof callSignalData !== "undefined";
    if (
      hasResolvedCallSignal &&
      sawActiveSignalRef.current.has(activeConversationId) &&
      !callSignal?.active &&
      callState?.active &&
      callState.conversationId === activeConversationId
    ) {
      showToast("Call ended");
      stopMediaAndPeer();
      setCallState(null);
      setIncomingCall(null);
      sawActiveSignalRef.current.delete(activeConversationId);
    }
  }, [activeConversationId, callSignal, callSignalData, callState?.active, callState?.conversationId, currentUsername, showToast]);

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
    setIncomingCall(null);
  }

  async function endCall() {
    if (callState) {
      await apiRequest("POST", `/api/conversations/${callState.conversationId}/call/end`, {
        endedBy: currentUserName,
      }).catch(() => undefined);
      showToast(`Call ended · ${formatCallDuration(callState.duration)}`);
      sawActiveSignalRef.current.delete(callState.conversationId);
    }
    stopMediaAndPeer();
    setCallState(null);
  }

  async function toggleScreenShare(enabled: boolean, conversationId: number) {
    if (enabled) {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Screen share is unavailable in this browser.");
      }
      previousLocalStreamRef.current = localStreamRef.current;
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const [screenTrack] = screenStream.getVideoTracks();
      if (screenTrack) {
        screenTrack.onended = () => {
          void toggleScreenShare(false, conversationId).catch(() => undefined);
        };
      }
      await replaceLocalStream(screenStream, conversationId, true);
      return;
    }

    const fallbackStream = previousLocalStreamRef.current
      || await getLocalMedia(callState?.type === "voice" ? "voice" : "video");
    previousLocalStreamRef.current = fallbackStream;
    await replaceLocalStream(fallbackStream, conversationId, false);
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
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = !partial.isVideoOff;
      });
    }

    if (typeof partial.isScreenSharing === "boolean" && partial.isScreenSharing !== existing.isScreenSharing) {
      try {
        await toggleScreenShare(partial.isScreenSharing, existing.conversationId);
      } catch (error) {
        showToast(getMediaAccessErrorMessage(error, "screen-share"));
        return;
      }
    }

    setCallState((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  async function acceptIncomingCall() {
    if (!activeConversationId || !callSignal) return;
    try {
      const stream = await ensureMediaAndTracks(callSignal.type, activeConversationId);
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
      type: payload.data.type,
      conversationId: conversation.id,
      conversationName: conversation.name,
      startedAt: new Date(payload.data.startedAt),
      isMuted: false,
      isVideoOff: payload.data.type === "voice",
      isSpeakerOn: true,
      isScreenSharing: payload.data.isScreenSharing,
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
      const res = await apiRequest("POST", `/api/conversations/${activeConversationId}/messages`, { content });
      return res.json() as Promise<{ data: Message }>;
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

  const handleAttachmentUpload = useCallback(async (file: File | null) => {
    if (!file || !activeConversation) return;
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
      const fileBuffer = await file.arrayBuffer();
      const response = await fetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": file.name,
          "x-parent-path": uploadParentPath,
          "x-file-content-type": file.type || "application/octet-stream",
        },
        body: fileBuffer,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const payload = await response.json() as { data: UploadedTalkFile };
      const attachmentMessage = `Shared file: ${payload.data.name}\n${payload.data.path}`;
      await sendMutation.mutateAsync(attachmentMessage);
      showToast(`Shared ${payload.data.name}`);
    } catch {
      showToast("Unable to share file in this conversation.");
    } finally {
      setIsUploadingAttachment(false);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
    }
  }, [activeConversation, sendMutation, showToast]);

  // Mark as read mutation
  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/conversations/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

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
      const res = await apiRequest("POST", "/api/conversations", data);
      return res.json() as Promise<{ data: Conversation }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setActiveConversationId(result.data.id);
    },
  });

  const handleSelectConversation = useCallback((id: number) => {
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
    if (!content || !activeConversationId) return;

    const optimisticMsg: Message = {
      id: Date.now(),
      conversationId: activeConversationId,
      senderId: currentUserId,
      senderName: currentUserName,
      content,
      sentAt: new Date().toISOString(),
      reactions: null,
      replyToId: replyTo?.id ?? null,
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
  }, [composerContent, activeConversationId, currentUserId, currentUserName, sendMutation, queryClient, replyTo]);

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
  };

  const handleComposerFocus = () => {
    setIsTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const handleComposerBlur = () => {
    typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000);
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
    } catch {
      showToast("Failed to add participant");
    }
  }, [activeConversationId, showToast]);

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
    leaveGroupMutation.mutate(activeConversation.id);
    // Select next conversation
    const remaining = conversations.filter((c) => c.id !== activeConversation.id);
    setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
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

  const handleCreateGroup = () => {
    if (!newGroupName.trim() || newGroupMembers.length === 0) return;
    createConversationMutation.mutate({
      name: newGroupName,
      type: "group",
      memberUsernames: newGroupMembers,
    });
    setNewChatOpen(false);
    setNewGroupName("");
    setNewGroupMembers([]);
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

  // Filter conversations by search
  const query = searchQuery.toLowerCase().trim();
  const dmConversations = conversations.filter((c) => c.type === "dm");
  const groupConversations = conversations.filter((c) => c.type === "group");

  const filteredDm = query
    ? dmConversations.filter((c) => c.name.toLowerCase().includes(query) || (c.lastMessage || "").toLowerCase().includes(query))
    : dmConversations;
  const filteredGroups = query
    ? groupConversations.filter((c) => c.name.toLowerCase().includes(query) || (c.lastMessage || "").toLowerCase().includes(query))
    : groupConversations;

  // People search â€" contacts not already in conversations
  const peopleResults = query
    ? availableUsers.filter((user) => {
        if (!user.displayName.toLowerCase().includes(query) && !user.username.toLowerCase().includes(query)) return false;
        // Show if they don't match an existing visible conversation
        return !conversations.some((c) => c.type === "dm" && c.name === user.displayName);
      })
    : [];
  const activeConversationMemberCount = activeConversation?.members
    ? (() => {
        try {
          return (JSON.parse(activeConversation.members) as string[]).length;
        } catch {
          return 0;
        }
      })()
    : 0;

  const noResults = query && filteredDm.length === 0 && filteredGroups.length === 0 && peopleResults.length === 0;
  return (
    <>
      <ToastOverlay toast={toast} onDismiss={dismissToast} />

      {/* Call overlays */}
        {callState?.active && callState.type === "voice" && (
          <VoiceCallOverlay
            callState={callState}
            onUpdate={updateCall}
            onEnd={endCall}
            onScreenShare={handleVoiceScreenShare}
            onAddParticipant={handleAddCallParticipant}
            remoteMedia={remoteMedia}
            currentUsername={currentUsername}
            availableUsers={availableUsers}
          />
        )}
      {callState?.active && (callState.type === "video" || callState.type === "screen") && (
        <VideoCallOverlay
          callState={callState}
          onUpdate={updateCall}
          onEnd={endCall}
          currentUserName={currentUserName}
          currentUsername={currentUsername}
          onAddParticipant={handleAddCallParticipant}
          localStream={localStreamRef.current}
          localVideoEnabled={localVideoEnabled}
          remoteMedia={remoteMedia}
          availableUsers={availableUsers}
        />
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

          {/* Tabs */}
          <Tabs defaultValue="dm" className="flex-1 flex flex-col overflow-hidden px-2">
            <TabsList className="w-full">
              <TabsTrigger value="dm" className="flex-1">Direct Messages</TabsTrigger>
              <TabsTrigger value="groups" className="flex-1">Groups</TabsTrigger>
            </TabsList>

            <TabsContent value="dm" className="flex-1 overflow-y-auto mt-1">
              {noResults ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Search size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground text-center">No results for "{searchQuery}"</p>
                </div>
              ) : (
                <>
                  <div className="space-y-0.5">
                    {filteredDm.map((c) => (
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
            </TabsContent>

            <TabsContent value="groups" className="flex-1 overflow-y-auto mt-1">
              {query && filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Search size={32} className="text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground text-center">No results for "{searchQuery}"</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredGroups.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      isActive={c.id === activeConversationId}
                      onClick={() => handleSelectConversation(c.id)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
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
              if (file) void handleAttachmentUpload(file);
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
                    <OnlineDot size={8} className="absolute bottom-0 right-0" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm">{activeConversation.name}</p>
                  {activeConversation.type === "dm" ? (
                    <div className="flex items-center gap-1">
                      <OnlineDot size={6} />
                      <span className="text-xs text-green-500">Online</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {activeConversationMemberCount} members
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
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
                      onClick={() => callState?.active && callState.type === "video" ? endCall() : startCall("video")}
                      className={cn(
                        "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                        callState?.active && callState.type === "video"
                          ? "bg-red-100 text-red-600 dark:bg-red-900/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Video size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{callState?.active && callState.type === "video" ? "End call" : "Video call"}</TooltipContent>
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

                {/* Add participants / manage call */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Open participants"
                      onClick={() => setShowInfoPanel(true)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <UserPlus size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Add people</TooltipContent>
                </Tooltip>

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

                {/* Info panel */}
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
            {callState?.isScreenSharing && (
              <div className="bg-green-50 dark:bg-green-950/30 border-b border-green-200 dark:border-green-800 px-4 py-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <MonitorUp size={14} />
                {currentUserName} is sharing their screen
                <Button variant="ghost" size="sm" className="ml-auto text-green-700 dark:text-green-400">View</Button>
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
                    onChange={(event) => setChatSearchQuery(event.target.value)}
                  />
                  {hasChatSearch && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {visibleMessageCount} match{visibleMessageCount === 1 ? "" : "es"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {visibleGroupedMessages.length === 0 && hasChatSearch ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No messages match "{chatSearchQuery}".
                </div>
              ) : visibleGroupedMessages.map((group, gi) => (
                <div key={group.date}>
                  <DateSeparator date={group.messages[0].sentAt} />
                  {group.messages.map((msg, mi) => {
                    const isSent = currentUserId > 0
                      ? msg.senderId === currentUserId
                      : msg.senderName === currentUserName;
                    const prevMsg = mi > 0 ? group.messages[mi - 1] : gi > 0 ? visibleGroupedMessages[gi - 1].messages.at(-1) : undefined;
                    const isConsecutive = prevMsg
                      && prevMsg.senderId === msg.senderId
                      && (new Date(msg.sentAt).getTime() - new Date(prevMsg.sentAt).getTime()) < 120000;

                    return (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        isSent={isSent}
                        showAvatar={!isSent && !isConsecutive}
                        showSenderName={!isSent && !isConsecutive}
                        searchQuery={chatSearchQuery}
                        allMessages={messagesList}
                        onReply={handleReply}
                        onForward={handleForwardMessage}
                        onReact={handleReact}
                      />
                    );
                  })}
                </div>
              ))}

              {isTyping && activeConversation && (
                <TypingIndicator name={activeConversation.name} />
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply preview */}
            {replyTo && (
              <ReplyPreviewBar replyTo={replyTo} onCancel={() => setReplyTo(null)} />
            )}

            {/* Message Composer */}
            <div className="border-t bg-background px-3 py-3 flex-shrink-0">
              <div className="flex items-end gap-2">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    void handleAttachmentUpload(event.target.files?.[0] || null);
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
                    <button className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mb-0.5">
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
                  placeholder={`Message ${activeConversation.name}...`}
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px] max-h-[120px]"
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      className="h-9 w-9 rounded-lg shrink-0 mb-0.5"
                      disabled={!composerContent.trim()}
                      onClick={handleSend}
                    >
                      <SendHorizontal size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Send message</TooltipContent>
                </Tooltip>
              </div>
            </div>
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
            onLeaveGroup={handleLeaveGroup}
            onDeleteGroup={handleDeleteGroup}
            onTransferAdmin={handleTransferAdmin}
            showToast={showToast}
            currentUserName={currentUserName}
            currentUserId={currentUserId}
            availableUsers={availableUsers}
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



