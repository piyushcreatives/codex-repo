import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Sun,
  FolderOpen,
  MessageSquare,
  CalendarDays,
  StickyNote,
  Users,
  Kanban,
  Mail,
  Activity,
  Image,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { fetchJson } from "@/lib/api";
import { CloudSpaceLogo } from "./CloudSpaceLogo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Conversation, Activity as ActivityType } from "@shared/schema";
import type { AppCapabilities } from "@/lib/capabilities";

const navItems: Array<{
  label: string;
  icon: typeof LayoutDashboard;
  href: string;
  capability?: keyof Pick<AppCapabilities, "talk" | "calendar" | "notes" | "contacts" | "deck" | "mail" | "activity">;
}> = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Today", icon: Sun, href: "/today" },
  { label: "Files", icon: FolderOpen, href: "/files" },
  { label: "Talk", icon: MessageSquare, href: "/talk", capability: "talk" },
  { label: "Calendar", icon: CalendarDays, href: "/calendar", capability: "calendar" },
  { label: "Notes", icon: StickyNote, href: "/notes", capability: "notes" },
  { label: "Contacts", icon: Users, href: "/contacts", capability: "contacts" },
  { label: "Deck", icon: Kanban, href: "/deck", capability: "deck" },
  { label: "Mail", icon: Mail, href: "/mail", capability: "mail" },
  { label: "Activity", icon: Activity, href: "/activity", capability: "activity" },
  { label: "Media", icon: Image, href: "/media" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  capabilities: AppCapabilities;
}

export function Sidebar({ collapsed, onToggle, capabilities }: SidebarProps) {
  const [location] = useLocation();
  const { data: userData } = useQuery({
    queryKey: ["/api/user"],
    queryFn: () => fetchJson<{ data: { name?: string; email?: string } }>("/api/user"),
  });
  const userName = userData?.data?.name || "User";
  const userEmail = userData?.data?.email || "";

  const { data: convosData } = useQuery({
    queryKey: ["/api/conversations"],
    queryFn: () => fetchJson<{ data: Conversation[] }>("/api/conversations"),
    enabled: capabilities.talk,
  });
  const totalUnread = (convosData?.data || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const { data: emailCountsData } = useQuery({
    queryKey: ["/api/emails/counts"],
    queryFn: () => fetchJson<{ data: { inbox: number; drafts: number; spam: number } }>("/api/emails/counts"),
    staleTime: 30_000,
    enabled: capabilities.mail,
  });
  const mailUnread = emailCountsData?.data?.inbox ?? 0;

  const { data: activityData } = useQuery({
    queryKey: ["/api/activity", "all"],
    queryFn: () => fetchJson<{ data: ActivityType[] }>("/api/activity?limit=50&type=all"),
    staleTime: 30_000,
    enabled: capabilities.activity,
  });
  const activityUnread = (activityData?.data || []).filter((activity) => !activity.isRead).length;

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 flex h-screen flex-col border-r bg-sidebar transition-all duration-200",
        collapsed ? "w-[60px]" : "w-[240px]",
      )}
      style={{ borderColor: "hsl(var(--sidebar-border))" }}
    >
      <div className={cn("flex h-14 items-center gap-2 border-b px-4", collapsed && "justify-center px-0")}>
        <CloudSpaceLogo size={28} />
        {!collapsed && <span className="text-base font-semibold text-foreground">CloudSpace</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const isEnabled = item.capability ? capabilities[item.capability] : true;
            const Icon = item.icon;

            const badgeCount =
              item.label === "Talk" ? totalUnread :
              item.label === "Mail" ? mailUnread :
              item.label === "Activity" ? activityUnread : 0;
            const showBadge = isEnabled && badgeCount > 0;

            const linkContent = isEnabled ? (
              <Link
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {showBadge && (
                      <span className="bg-primary text-primary-foreground text-[10px] rounded-full px-1.5 min-w-[18px] text-center animate-badge-pulse">
                        {badgeCount}
                      </span>
                    )}
                  </>
                )}
                {collapsed && showBadge && (
                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-primary animate-badge-pulse" />
                )}
              </Link>
            ) : (
              <div
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium opacity-45",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </div>
            );

            const tooltipLabel = isEnabled ? item.label : `${item.label} unavailable`;

            if (collapsed) {
              return (
                <li key={item.href} className="relative">
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right">{tooltipLabel}</TooltipContent>
                  </Tooltip>
                </li>
              );
            }

            return <li key={item.href} className="relative">{linkContent}</li>;
          })}
        </ul>
      </nav>

      <button
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground",
          collapsed && "justify-center",
        )}
      >
        {collapsed ? <PanelLeftOpen size={16} /> : (
          <>
            <PanelLeftClose size={16} />
            <span>Collapse</span>
          </>
        )}
      </button>

      <div className={cn("border-t p-3", collapsed && "flex justify-center p-2")}>
        <div className={cn("flex items-center gap-3", collapsed && "gap-0")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {getInitials(userName)}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
