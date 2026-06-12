import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bell, Search, FileUp, MessageSquare, CalendarDays, UserPlus,
  User, Palette, Keyboard, LogOut,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/api";
import { CommandPalette } from "./CommandPalette";

// ─── Toast ─────────────────────────────────────────────────
let toastTimeout: ReturnType<typeof setTimeout>;
function showToast(msg: string) {
  const existing = document.getElementById("cs-toast");
  if (existing) existing.remove();
  clearTimeout(toastTimeout);
  const el = document.createElement("div");
  el.id = "cs-toast";
  el.className =
    "fixed bottom-4 right-4 z-50 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm animate-fade-in";
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimeout = setTimeout(() => el.remove(), 2500);
}

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/files": "Files",
  "/talk": "Talk",
  "/calendar": "Calendar",
  "/notes": "Notes",
  "/contacts": "Contacts",
  "/deck": "Deck",
  "/mail": "Mail",
  "/activity": "Activity",
  "/media": "Media",
  "/settings": "Settings",
};

type ConversationNotification = {
  id: number;
  name: string;
  unreadCount?: number | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
};

type CalendarNotification = {
  id: number;
  title: string;
  startAt: string;
};

type FileNotification = {
  id: number;
  name: string;
  modifiedAt: string;
};

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Search / Command palette" },
  { keys: ["⌘", "/"], label: "Help" },
  { keys: ["⌘", "N"], label: "New note" },
  { keys: ["⌘", "⇧", "M"], label: "Compose email" },
  { keys: ["Esc"], label: "Close dialog" },
  { keys: ["↑", "↓"], label: "Navigate results" },
  { keys: ["Enter"], label: "Select result" },
  { keys: ["⌘", "D"], label: "Toggle dark mode" },
];

interface TopBarProps {
  sidebarCollapsed: boolean;
}

export function TopBar({ sidebarCollapsed }: TopBarProps) {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const title = pageTitles[location] || "CloudSpace";
  const [cmdOpen, setCmdOpen] = useState(false);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<number[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { data: userData } = useQuery({
    queryKey: ["/api/user"],
    queryFn: () => fetchJson<{ data: { name?: string; email?: string } }>("/api/user"),
  });
  const { data: conversationsData } = useQuery({
    queryKey: ["/api/conversations"],
    queryFn: () => fetchJson<{ data: ConversationNotification[] }>("/api/conversations"),
  });
  const { data: eventsData } = useQuery({
    queryKey: ["/api/events"],
    queryFn: () => fetchJson<{ data: CalendarNotification[] }>("/api/events"),
  });
  const { data: filesData } = useQuery({
    queryKey: ["/api/files", "/"],
    queryFn: () => fetchJson<{ data: FileNotification[] }>("/api/files?path=%2F"),
  });
  const userName = userData?.data?.name || "User";
  const userEmail = userData?.data?.email || "";

  const liveNotifications = useMemo(() => {
    const conversationNotifications = (conversationsData?.data || [])
      .filter((conversation) => (conversation.unreadCount || 0) > 0)
      .map((conversation) => ({
        id: conversation.id,
        icon: MessageSquare,
        color: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
        text: `${conversation.unreadCount} unread in ${conversation.name}${conversation.lastMessage ? `: ${conversation.lastMessage}` : ""}`,
        time: conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : "Just now",
        unread: true,
      }));

    const eventNotifications = (eventsData?.data || [])
      .slice()
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, 3)
      .map((event) => ({
        id: 100000 + event.id,
        icon: CalendarDays,
        color: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
        text: `Upcoming: ${event.title}`,
        time: new Date(event.startAt).toLocaleString(),
        unread: false,
      }));

    const fileNotifications = (filesData?.data || [])
      .filter((file) => file.modifiedAt)
      .slice()
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, 3)
      .map((file) => ({
        id: 200000 + file.id,
        icon: FileUp,
        color: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
        text: `Recently updated: ${file.name}`,
        time: new Date(file.modifiedAt).toLocaleString(),
        unread: false,
      }));

    return [...conversationNotifications, ...eventNotifications, ...fileNotifications]
      .filter((notification) => !dismissedNotificationIds.includes(notification.id))
      .slice(0, 8);
  }, [conversationsData?.data, dismissedNotificationIds, eventsData?.data, filesData?.data]);

  const badgeCount = liveNotifications.filter((notification) => notification.unread).length;

  const markAllRead = () => {
    setDismissedNotificationIds((current) => [
      ...new Set([...current, ...liveNotifications.map((notification) => notification.id)]),
    ]);
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    queryClient.setQueryData(["/api/auth/session"], null);
    navigate("/login");
    showToast("Signed out");
  };

  return (
    <header
      className={cn(
        "fixed top-0 z-20 flex h-14 items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all duration-200",
        sidebarCollapsed ? "left-[60px]" : "left-[240px]",
        "right-0"
      )}
    >
      {/* Left — page title */}
      <div className="flex items-center px-6">
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>

      {/* Center — search */}
      <div className="flex flex-1 justify-center px-4">
        <button
          onClick={() => setCmdOpen(true)}
          className="relative w-full max-w-md flex items-center"
        >
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <div className="h-9 w-full rounded-md border border-transparent bg-muted/50 pl-9 pr-16 flex items-center text-sm text-muted-foreground cursor-pointer hover:bg-muted/70 transition-colors">
              Search CloudSpace…
            </div>
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>K
            </kbd>
          </div>
        </button>
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-1 px-4">
        {/* Notification bell */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-9 w-9">
              <Bell className="h-4 w-4" />
              {badgeCount > 0 && (
                <Badge className="absolute -right-0.5 -top-0.5 h-4 w-4 items-center justify-center p-0 text-[10px]">
                  {badgeCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="font-semibold text-sm">Notifications</p>
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {liveNotifications.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No new notifications
                </div>
              ) : liveNotifications.map((n) => {
                const Icon = n.icon;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 px-4 py-3 border-b last:border-b-0",
                      n.unread && "bg-primary/[0.03]"
                    )}
                  >
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", n.color)}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{n.text}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t px-4 py-2">
              <button
                onClick={() => navigate("/activity")}
                className="text-xs text-primary hover:underline w-full text-center"
              >
                View all activity →
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground cursor-pointer hover:opacity-90 transition-opacity">
              {getInitials(userName)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="font-medium text-sm">{userName}</p>
              <p className="text-xs text-muted-foreground">{userEmail}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <User className="mr-2 h-4 w-4" /> Profile settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings?section=appearance")}>
              <Palette className="mr-2 h-4 w-4" /> Appearance
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
              <Keyboard className="mr-2 h-4 w-4" /> Keyboard shortcuts
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Command Palette */}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />

      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {SHORTCUTS.map((s) => (
              <div key={s.label} className="flex items-center justify-between py-1.5">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <div className="flex gap-1">
                  {s.keys.map((k) => (
                    <kbd key={k} className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs">
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
