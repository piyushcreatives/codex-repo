import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isToday, isYesterday, differenceInDays } from "date-fns";
import {
  FileUp, Share2, MessageSquare, Settings, MessagesSquare,
  Activity as ActivityIcon, Eye, EyeOff, ExternalLink, CheckCheck,
  Search,
} from "lucide-react";
import { cn, getAvatarColor, getInitials } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingList } from "@/components/ui/loading-list";
import { ErrorState, getQueryErrorMessage } from "@/components/ui/query-state";
import type { Activity as ActivityType } from "@shared/schema";

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

// ─── Activity type config ──────────────────────────────────
const activityConfig: Record<string, { icon: typeof FileUp; bg: string; text: string; darkBg: string; darkText: string }> = {
  file:    { icon: FileUp,         bg: "bg-blue-100",   text: "text-blue-600",   darkBg: "dark:bg-blue-900/40",   darkText: "dark:text-blue-400" },
  share:   { icon: Share2,         bg: "bg-green-100",  text: "text-green-600",  darkBg: "dark:bg-green-900/40",  darkText: "dark:text-green-400" },
  comment: { icon: MessageSquare,  bg: "bg-purple-100", text: "text-purple-600", darkBg: "dark:bg-purple-900/40", darkText: "dark:text-purple-400" },
  system:  { icon: Settings,       bg: "bg-slate-100",  text: "text-slate-600",  darkBg: "dark:bg-slate-800",     darkText: "dark:text-slate-400" },
  talk:    { icon: MessagesSquare, bg: "bg-indigo-100", text: "text-indigo-600", darkBg: "dark:bg-indigo-900/40", darkText: "dark:text-indigo-400" },
};

const FILTER_TABS = [
  { value: "all", label: "All" },
  { value: "file", label: "Files" },
  { value: "share", label: "Sharing" },
  { value: "comment", label: "Comments" },
  { value: "system", label: "System" },
  { value: "talk", label: "Talk" },
];

// ─── Date grouping ─────────────────────────────────────────
function getDateGroup(dateStr: string): string {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (differenceInDays(new Date(), d) <= 7) return "This Week";
  return "Earlier";
}

// ─── Main Activity Page ────────────────────────────────────
export default function Activity() {
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: activityData, isLoading, error } = useQuery<{ data: ActivityType[] }>({
    queryKey: ["/api/activity", activeFilter],
    queryFn: () => fetchJson<{ data: ActivityType[] }>(`/api/activity?limit=50&type=${activeFilter}`),
  });
  const activities = activityData?.data ?? [];

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/activity/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/activity"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: (_opts?: { silent?: boolean }) => apiRequest("POST", "/api/activity/read-all"),
    onSuccess: (_data, opts) => {
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      if (!opts?.silent) showToast("All marked as read");
    },
  });

  // Compute stats from full (unfiltered) data
  const { data: allData } = useQuery<{ data: ActivityType[] }>({
    queryKey: ["/api/activity", "all"],
    queryFn: () => fetchJson<{ data: ActivityType[] }>("/api/activity?limit=50&type=all"),
  });
  const allActivities = allData?.data ?? [];

  // Clear the unread badge when you open the Activity feed — viewing the page
  // counts as seeing it. Without this the sidebar badge sticks forever, since
  // nothing else marks these read on visit (only the manual button / per-row toggle).
  // A short delay lets the unread highlights show briefly before they settle.
  const autoReadDoneRef = useRef(false);
  useEffect(() => {
    if (autoReadDoneRef.current) return;
    if (!allActivities.some((a) => !a.isRead)) return;
    autoReadDoneRef.current = true;
    const t = setTimeout(() => markAllReadMutation.mutate({ silent: true }), 1200);
    return () => clearTimeout(t);
  }, [allActivities]);

  const stats = useMemo(() => {
    const todayItems = allActivities.filter(a => isToday(parseISO(a.timestamp)));
    return {
      todayCount: todayItems.length,
      filesChanged: allActivities.filter(a => a.type === "file").length,
      shares: allActivities.filter(a => a.type === "share").length,
      unread: allActivities.filter(a => !a.isRead).length,
    };
  }, [allActivities]);

  // Type counts for badges
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const a of allActivities) {
      if (!a.isRead) {
        counts[a.type] = (counts[a.type] || 0) + 1;
        counts.all++;
      }
    }
    return counts;
  }, [allActivities]);

  // Filtered + searched
  const filtered = useMemo(() => {
    if (!search) return activities;
    const q = search.toLowerCase();
    return activities.filter(a =>
      a.description.toLowerCase().includes(q) ||
      a.actor.toLowerCase().includes(q) ||
      a.subject?.toLowerCase().includes(q)
    );
  }, [activities, search]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { label: string; items: ActivityType[] }[] = [];
    const map = new Map<string, ActivityType[]>();
    const order = ["Today", "Yesterday", "This Week", "Earlier"];
    for (const a of filtered) {
      const group = getDateGroup(a.timestamp);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(a);
    }
    for (const label of order) {
      const items = map.get(label);
      if (items && items.length > 0) groups.push({ label, items });
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height))]">
      {/* Stats bar */}
      <div className="px-6 py-4 border-b grid grid-cols-2 sm:grid-cols-4 gap-4 flex-shrink-0">
        {[
          { value: stats.todayCount, label: "events today" },
          { value: stats.filesChanged, label: "files changed" },
          { value: stats.shares, label: "new shares" },
          { value: stats.unread, label: "unread" },
        ].map(s => (
          <div key={s.label} className="bg-muted/40 rounded-lg px-4 py-3">
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b flex items-center justify-between flex-shrink-0">
        <Tabs value={activeFilter} onValueChange={setActiveFilter}>
          <TabsList className="bg-transparent h-auto p-0 gap-0">
            {FILTER_TABS.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  "rounded-none border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none",
                  "text-muted-foreground hover:text-foreground bg-transparent"
                )}
              >
                {tab.label}
                {(typeCounts[tab.value] || 0) > 0 && (
                  <span className="ml-1.5 bg-primary/10 text-primary text-[10px] rounded-full px-1.5 min-w-[16px] text-center">
                    {typeCounts[tab.value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Input
            className="w-48 h-8 text-sm"
            placeholder="Search activity…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Button variant="outline" size="sm" className="gap-1" onClick={() => markAllReadMutation.mutate()}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        </div>
      </div>

      {/* Activity feed */}
      <div className="flex-1 overflow-y-auto px-6">
        {isLoading ? (
          <div className="py-4">
            <LoadingList count={6} rowClassName="h-14 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={getQueryErrorMessage(error) ?? "Unable to load activity."} className="py-16" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title={search || activeFilter !== "all" ? "No activity matches this filter" : "No recent activity"}
            className="py-16"
            action={
              (search || activeFilter !== "all") ? (
                <Button variant="ghost" size="sm" onClick={() => { setActiveFilter("all"); setSearch(""); }}>
                  Clear filter
                </Button>
              ) : undefined
            }
          />
        ) : (
          grouped.map(group => (
            <div key={group.label}>
              <div className="sticky top-0 bg-background/80 backdrop-blur-sm z-10 py-2 mb-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</p>
              </div>
              {group.items.map(item => {
                const config = activityConfig[item.type] ?? activityConfig.system;
                const Icon = config.icon;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-4 py-3 border-b border-border/50 group",
                      !item.isRead && "bg-primary/[0.02]"
                    )}
                  >
                    {/* Unread dot */}
                    <div className="flex-shrink-0 mt-2.5 w-2">
                      {!item.isRead ? (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      ) : (
                        <div className="w-2 h-2" />
                      )}
                    </div>

                    {/* Icon */}
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", config.bg, config.text, config.darkBg, config.darkText)}>
                      <Icon size={16} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0", getAvatarColor(item.actor))}>
                          {getInitials(item.actor)}
                        </div>
                        <span className="text-sm font-medium">{item.actor}</span>
                        <span className={cn("text-sm", !item.isRead ? "text-foreground" : "text-muted-foreground")}>{item.description}</span>
                      </div>
                      {item.subject && (
                        <p className="text-primary text-sm font-medium mt-0.5 ml-8">{item.subject}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5 ml-8">
                        {format(parseISO(item.timestamp), "h:mm a")}
                      </p>
                    </div>

                    {/* Hover actions */}
                    <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={item.isRead ? "Mark as unread" : "Mark as read"}
                        onClick={() => markReadMutation.mutate(item.id)}
                      >
                        {item.isRead ? <EyeOff size={14} /> : <Eye size={14} />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Open ${item.type}`}
                        onClick={() => showToast(`Opening ${item.type}…`)}
                      >
                        <ExternalLink size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
