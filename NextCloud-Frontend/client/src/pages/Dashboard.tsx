import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  format,
  formatDistanceToNow,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
} from "date-fns";
import {
  FileText, Image, Table2, Archive, FileCode, File, Folder,
  CalendarDays, Upload, Share2, MessageCircle, Settings,
  MessageSquare, ChevronRight, Grid3X3, Calendar, StickyNote,
  Users, Clock, Activity, ChevronLeft, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingList } from "@/components/ui/loading-list";
import { getQueryErrorMessage } from "@/components/ui/query-state";
import { fetchJson } from "@/lib/api";
import { getInitials } from "@/lib/utils";

type DashboardEvent = {
  id: number | string;
  title: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  color?: string;
};

type DashboardData = {
  displayName?: string;
  storageUsed?: number;
  storageQuota?: number;
  recentFiles?: Array<{
    id: number | string;
    name: string;
    mimeType: string | null;
    type: string;
    size?: number;
    modifiedAt: string;
  }>;
  upcomingEvents?: DashboardEvent[];
  unreadMessages?: number;
  recentMessages?: Array<{
    conversation: {
      id: number | string;
      name: string;
      lastMessage?: string;
      lastMessageAt?: string;
      unreadCount?: number;
    };
  }>;
  recentActivity?: Array<{ id: number | string; type: string; description: string; timestamp: string }>;
  recentNotes?: Array<{ id: number | string; title?: string; modifiedAt?: string }>;
  contactsCount?: number;
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "\u{1F305} Good morning";
  if (h < 17) return "\u{2600}\u{FE0F} Good afternoon";
  return "\u{1F319} Good evening";
}

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}

function getFileIcon(mimeType: string | null, type: string) {
  if (type === "folder") return { icon: Folder, color: "text-indigo-400" };
  if (!mimeType) return { icon: File, color: "text-slate-400" };
  if (mimeType === "application/pdf") return { icon: FileText, color: "text-red-500" };
  if (mimeType.startsWith("image/")) return { icon: Image, color: "text-purple-500" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return { icon: Table2, color: "text-green-600" };
  if (mimeType.includes("wordprocessing") || mimeType.includes("document")) return { icon: FileText, color: "text-blue-500" };
  if (mimeType.includes("tar") || mimeType.includes("gzip") || mimeType.includes("zip")) return { icon: Archive, color: "text-orange-500" };
  if (mimeType.startsWith("text/")) return { icon: FileCode, color: "text-slate-500" };
  if (mimeType.includes("presentation")) return { icon: FileText, color: "text-orange-500" };
  return { icon: File, color: "text-slate-400" };
}

const activityIcons: Record<string, { icon: React.ElementType; bg: string; fg: string }> = {
  file: { icon: Upload, bg: "bg-blue-100 dark:bg-blue-900/30", fg: "text-blue-600 dark:text-blue-400" },
  share: { icon: Share2, bg: "bg-green-100 dark:bg-green-900/30", fg: "text-green-600 dark:text-green-400" },
  comment: { icon: MessageCircle, bg: "bg-purple-100 dark:bg-purple-900/30", fg: "text-purple-600 dark:text-purple-400" },
  system: { icon: Settings, bg: "bg-slate-100 dark:bg-slate-800", fg: "text-slate-600 dark:text-slate-400" },
  talk: { icon: MessageSquare, bg: "bg-indigo-100 dark:bg-indigo-900/30", fg: "text-indigo-600 dark:text-indigo-400" },
};

function StorageRing({ used, quota, size = 80 }: { used: number; quota: number; size?: number }) {
  const ratio = quota > 0 ? used / quota : 0;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - ratio);
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#4F46E5" strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
    </svg>
  );
}

function MiniCalendar({ events }: { events: DashboardEvent[] }) {
  const [viewMonth, setViewMonth] = useState(new Date());
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const eventDates = new Set(events.map((e) => format(new Date(e.startAt), "yyyy-MM-dd")));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          className="p-0.5 rounded hover:bg-muted/50 transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <span className="text-xs font-medium">{format(viewMonth, "MMMM yyyy")}</span>
        <button
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          className="p-0.5 rounded hover:bg-muted/50 transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="text-center text-[9px] text-muted-foreground font-medium py-0.5">{d}</div>
        ))}
        {days.map((day) => {
          const inMonth = isSameMonth(day, viewMonth);
          const today = isToday(day);
          const hasEvent = eventDates.has(format(day, "yyyy-MM-dd"));
          return (
            <div
              key={day.toISOString()}
              className={`relative flex flex-col items-center py-0.5 text-[10px] leading-tight ${
                !inMonth ? "text-muted-foreground/30" : today ? "font-bold text-indigo-600 dark:text-indigo-400" : "text-foreground"
              }`}
            >
              <span className={today ? "bg-indigo-600 text-white rounded-full w-4.5 h-4.5 flex items-center justify-center text-[10px]" : ""}>
                {format(day, "d")}
              </span>
              {hasEvent && inMonth && (
                <span className="absolute bottom-0 w-1 h-1 rounded-full bg-indigo-500" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [eventsView, setEventsView] = useState<"calendar" | "grid">("grid");

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/dashboard"],
    queryFn: () => fetchJson<{ data: DashboardData }>("/api/dashboard").then((r) => r.data),
  });

  const errorMessage = getQueryErrorMessage(error);

  const displayName = data?.displayName ? String(data.displayName).split(" ")[0] : "there";
  const storageUsed = data?.storageUsed ?? 0;
  const rawQuota = data?.storageQuota ?? 0;
  const isUnlimited = rawQuota < 0;
  const storageQuota = isUnlimited ? 0 : rawQuota;

  return (
    <div className="p-6 space-y-4">
      {/* Welcome Banner */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {getGreeting()}, {displayName} <span role="img" aria-label="wave">👋</span>
            </h1>
            <p className="mt-1 text-indigo-100 text-sm">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
          </div>
          {(storageUsed > 0 || storageQuota > 0) && (
            <div className="flex items-center gap-3">
              {storageQuota > 0 && <StorageRing used={storageUsed} quota={storageQuota} size={48} />}
              <div className="text-right text-sm">
                <p className="font-medium">{formatBytes(storageUsed)}</p>
                <p className="text-indigo-200 text-xs">
                  {isUnlimited ? "unlimited storage" : `of ${formatBytes(storageQuota)} used`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top-level error — a failed /api/dashboard should say so, not silently show empty widgets */}
      {errorMessage && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
          <span className="text-destructive">{errorMessage}</span>
        </div>
      )}

      {/* Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
        {/* Recent Files */}
        <Card className="md:col-span-4 flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <h3 className="font-medium">Recent Files</h3>
            <Link to="/files" className="text-xs text-primary hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            {isLoading ? (
              <LoadingList count={5} />
            ) : !data?.recentFiles?.length ? (
              <EmptyState icon={Folder} title="No recent files" />
            ) : (
              <div className="space-y-1">
                {data.recentFiles.map((f) => {
                  const { icon: Icon, color } = getFileIcon(f.mimeType, f.type);
                  return (
                    <div key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50 transition-colors">
                      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                      <span className="flex-1 truncate text-sm font-medium">{f.name}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatBytes(f.size || 0)}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(f.modifiedAt), { addSuffix: true })}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Events — calendar view / grid view toggle */}
        <Card className="md:col-span-3 flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <h3 className="font-medium">Upcoming Events</h3>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => setEventsView("grid")}
                  className={`p-1 transition-colors ${eventsView === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  aria-label="List view"
                  aria-pressed={eventsView === "grid"}
                >
                  <Grid3X3 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEventsView("calendar")}
                  className={`p-1 transition-colors ${eventsView === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  aria-label="Calendar view"
                  aria-pressed={eventsView === "calendar"}
                >
                  <Calendar className="h-3.5 w-3.5" />
                </button>
              </div>
              <Link to="/calendar" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Open <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            {isLoading ? (
              <LoadingList count={3} rowClassName="h-14 w-full" />
            ) : eventsView === "calendar" ? (
              <MiniCalendar events={data?.upcomingEvents || []} />
            ) : !data?.upcomingEvents?.length ? (
              <EmptyState icon={CalendarDays} title="No upcoming events" />
            ) : (
              <div className="space-y-2">
                {data.upcomingEvents.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2">
                    <div className="mt-1 w-1 self-stretch rounded-full" style={{ backgroundColor: e.color || "#4F46E5" }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.allDay
                          ? `${format(new Date(e.startAt), "EEE, d MMM")} · All day`
                          : `${format(new Date(e.startAt), "EEE, d MMM · HH:mm")} – ${format(new Date(e.endAt), "HH:mm")}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Messages */}
        <Card className="md:col-span-3 flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">Messages</h3>
              {(data?.unreadMessages ?? 0) > 0 && (
                <Badge className="h-5 px-1.5 text-[10px]">{data?.unreadMessages}</Badge>
              )}
            </div>
            <Link to="/talk" className="text-xs text-primary hover:underline flex items-center gap-0.5">
              Open Talk <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            {isLoading ? (
              <LoadingList count={3} rowClassName="h-14 w-full" />
            ) : !data?.recentMessages?.length ? (
              <EmptyState icon={MessageSquare} title="No recent messages" />
            ) : (
              <div className="space-y-1">
                {data.recentMessages.map((rm) => {
                  const c = rm.conversation;
                  return (
                    <div key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50 transition-colors">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {getInitials(c.name) || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.lastMessage || "No messages yet"}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          {c.lastMessageAt ? formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true }) : ""}
                        </span>
                        {(c.unreadCount || 0) > 0 && (
                          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <Link to="/talk" className="block text-center text-xs text-primary hover:underline pt-2">
                  Show more messages
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="md:col-span-2 flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <h3 className="font-medium">Recent Activity</h3>
            <Link to="/activity" className="text-xs text-primary hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            {isLoading ? (
              <LoadingList count={4} />
            ) : !data?.recentActivity?.length ? (
              <EmptyState icon={Activity} title="No recent activity" />
            ) : (
              <div className="space-y-1">
                {data.recentActivity.map((a) => {
                  const ai = activityIcons[a.type] || activityIcons.system;
                  const Icon = ai.icon;
                  return (
                    <div key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ai.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${ai.fg}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{a.description}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="md:col-span-2 flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <h3 className="font-medium">Notes</h3>
            <Link to="/notes" className="text-xs text-primary hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            {isLoading ? (
              <LoadingList count={3} />
            ) : !data?.recentNotes?.length ? (
              <EmptyState icon={StickyNote} title="No notes yet" />
            ) : (
              <div className="space-y-1">
                {data.recentNotes.map((n) => (
                  <div key={n.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50 transition-colors">
                    <StickyNote className="h-4 w-4 shrink-0 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{n.title || "Untitled"}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {n.modifiedAt ? formatDistanceToNow(new Date(n.modifiedAt), { addSuffix: true }) : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contacts & Quick Info */}
        <Card className="md:col-span-3 flex flex-col">
          <CardHeader className="pb-3">
            <h3 className="font-medium">Quick Info</h3>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            <div className="grid grid-cols-3 gap-3">
              <Link to="/contacts" className="block">
                <div className="flex flex-col items-center gap-1.5 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-lg font-semibold">{data?.contactsCount ?? 0}</span>
                  <span className="text-[10px] text-muted-foreground">Contacts</span>
                </div>
              </Link>
              <Link to="/talk" className="block">
                <div className="flex flex-col items-center gap-1.5 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
                    <MessageSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <span className="text-lg font-semibold">{data?.unreadMessages ?? 0}</span>
                  <span className="text-[10px] text-muted-foreground">Unread</span>
                </div>
              </Link>
              <Link to="/calendar" className="block">
                <div className="flex flex-col items-center gap-1.5 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <Clock className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-lg font-semibold">{data?.upcomingEvents?.length ?? 0}</span>
                  <span className="text-[10px] text-muted-foreground">Events</span>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Storage Overview */}
        <Card className="md:col-span-4 flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <h3 className="font-medium">Storage Overview</h3>
            <Link to="/files" className="text-xs text-primary hover:underline flex items-center gap-0.5">
              Manage <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex-1 pt-0">
            {storageUsed > 0 || storageQuota > 0 || isUnlimited ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  {storageQuota > 0 && <StorageRing used={storageUsed} quota={storageQuota} size={64} />}
                  <div>
                    <p className="text-sm font-medium">
                      {isUnlimited
                        ? `${formatBytes(storageUsed)} used`
                        : `${formatBytes(storageUsed)} of ${formatBytes(storageQuota)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isUnlimited ? "Unlimited storage plan" : `${formatBytes(storageQuota - storageUsed)} available`}
                    </p>
                  </div>
                </div>
                {storageQuota > 0 && (
                  <>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                        style={{ width: `${Math.min(100, (storageUsed / storageQuota) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((storageUsed / storageQuota) * 100).toFixed(1)}% used
                    </p>
                  </>
                )}
              </div>
            ) : (
              <EmptyState icon={Folder} title="Storage info unavailable" className="py-6" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
