import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { CalendarDays, MessageSquare, Share2, Bell, Clock, ChevronRight, Sun } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingList } from "@/components/ui/loading-list";
import { fetchJson } from "@/lib/api";

type Ev = { id: number; title: string; startAt: string; endAt: string; allDay?: boolean; color?: string; location?: string | null };
type Conv = { id: number; name: string; unreadCount?: number; lastMessage?: string | null };
type Share = { id: string; name: string; ownerDisplayName: string };
type Notif = { id: number; app: string; subject: string; message: string; datetime: string };

const ROW = "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50";

export default function Today() {
  // NOTE: these query keys are shared with TopBar/Sidebar/App, which cache the full
  // `{ data: [...] }` response object. We must return the SAME shape here (not the
  // unwrapped array) or the last writer wins the shared cache and the shapes clash —
  // reading `.data` as an array then throws "filter is not a function" (blank screen).
  const events = useQuery({ queryKey: ["/api/events"], queryFn: () => fetchJson<{ data: Ev[] }>("/api/events") });
  const convos = useQuery({ queryKey: ["/api/conversations"], queryFn: () => fetchJson<{ data: Conv[] }>("/api/conversations") });
  const shares = useQuery({ queryKey: ["/api/shares/incoming"], queryFn: () => fetchJson<{ data: Share[] }>("/api/shares/incoming") });
  const notifs = useQuery({ queryKey: ["/api/notifications"], queryFn: () => fetchJson<{ data: Notif[] }>("/api/notifications") });

  // An event belongs to "today" if its time range overlaps today — this includes
  // multi-day events that started earlier and are still running.
  const dayStart = startOfDay(new Date());
  const dayEnd = endOfDay(new Date());
  const asArray = <T,>(r: { data?: T[] } | undefined): T[] => (Array.isArray(r?.data) ? r!.data : []);
  const todayEvents = asArray<Ev>(events.data)
    .filter((e) => {
      try {
        const start = parseISO(e.startAt);
        const end = parseISO(e.endAt || e.startAt);
        return start <= dayEnd && end >= dayStart;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const unread = asArray<Conv>(convos.data).filter((c) => (c.unreadCount || 0) > 0);
  const incoming = asArray<Share>(shares.data);
  const notifications = asArray<Notif>(notifs.data);
  const attentionCount = unread.length + incoming.length + notifications.length;
  const attentionLoading = convos.isLoading || shares.isLoading || notifs.isLoading;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sun className="h-6 w-6 text-amber-500" /> Today
        </h1>
        <p className="text-muted-foreground">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
      </div>

      {/* Schedule */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <h3 className="flex items-center gap-2 font-medium">
            <CalendarDays className="h-4 w-4 text-green-600" /> Today's schedule
          </h3>
          <Link to="/calendar" className="flex items-center gap-0.5 text-xs text-primary hover:underline">
            Open <ChevronRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {events.isLoading ? (
            <LoadingList count={3} rowClassName="h-12 w-full" />
          ) : todayEvents.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nothing scheduled today" description="Enjoy the clear day." />
          ) : (
            <div className="space-y-2">
              {todayEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2">
                  <div className="mt-1 w-1 self-stretch rounded-full" style={{ backgroundColor: e.color || "#4F46E5" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {e.allDay ? "All day" : `${format(parseISO(e.startAt), "HH:mm")} – ${format(parseISO(e.endAt), "HH:mm")}`}
                      {e.location ? ` · ${e.location}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Needs your attention */}
      <Card>
        <CardHeader className="pb-3">
          <h3 className="flex items-center gap-2 font-medium">
            <Bell className="h-4 w-4 text-indigo-600" /> Needs your attention
            {attentionCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{attentionCount}</span>
            )}
          </h3>
        </CardHeader>
        <CardContent className="pt-0">
          {attentionLoading ? (
            <LoadingList count={3} />
          ) : attentionCount === 0 ? (
            <EmptyState icon={Bell} title="You're all caught up" description="No unread messages, shares, or notifications." />
          ) : (
            <div className="space-y-1">
              {notifications.map((n) => (
                <Link key={`n${n.id}`} to="/activity" className={ROW}>
                  <Bell className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm">{n.message ? `${n.subject}: ${n.message}` : n.subject}</span>
                </Link>
              ))}
              {unread.map((c) => (
                <Link key={`c${c.id}`} to="/talk" className={ROW}>
                  <MessageSquare className="h-4 w-4 shrink-0 text-indigo-500" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{c.unreadCount}</span> unread in {c.name}
                    {c.lastMessage ? <span className="text-muted-foreground"> · {c.lastMessage}</span> : null}
                  </span>
                </Link>
              ))}
              {incoming.map((s) => (
                <Link key={`s${s.id}`} to="/files?view=shared" className={ROW}>
                  <Share2 className="h-4 w-4 shrink-0 text-purple-500" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {s.ownerDisplayName} shared <span className="font-medium">{s.name}</span> with you
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
