import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek,
  endOfWeek, isSameDay, isSameMonth, isToday, addMonths, subMonths,
  parseISO, addDays, getHours, startOfDay, differenceInDays,
} from "date-fns";
import {
  ChevronLeft, ChevronRight, CalendarPlus, MapPin, Trash2, Clock, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, fetchJson } from "@/lib/api";
import { formatEventTime, formatEventDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Event } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────
type ViewMode = "month" | "week" | "day" | "agenda";

interface EventFormData {
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  calendar: string;
  color: string;
  location: string;
  description: string;
}

const CALENDAR_COLORS: Record<string, string> = {
  Personal: "#10B981",
  Work: "#4F46E5",
  Shared: "#F59E0B",
};

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function defaultFormData(date?: Date): EventFormData {
  const d = date || new Date();
  const dateStr = format(d, "yyyy-MM-dd");
  return {
    title: "",
    startDate: dateStr,
    startTime: "10:00",
    endDate: dateStr,
    endTime: "11:00",
    allDay: false,
    calendar: "Work",
    color: CALENDAR_COLORS.Work,
    location: "",
    description: "",
  };
}

// ─── Toast ──────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const show = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-fade-in bg-foreground text-background rounded-lg px-4 py-3 shadow-lg text-sm">
      {message}
    </div>
  );
}

// ─── Mini Month Navigator ───────────────────────────────────
function MiniCalendar({
  currentMonth,
  selectedDate,
  onSelectDate,
  eventDates,
}: {
  currentMonth: Date;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  eventDates: Set<string>;
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="p-3">
      <p className="text-sm font-semibold text-center mb-2">{format(currentMonth, "MMMM yyyy")}</p>
      <div className="grid grid-cols-7 gap-0">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-[11px] text-muted-foreground font-medium text-center py-1">{d}</div>
        ))}
        {days.map((day) => {
          const dayStr = format(day, "yyyy-MM-dd");
          const hasEvent = eventDates.has(dayStr);
          return (
            <button
              key={dayStr}
              onClick={() => onSelectDate(day)}
              className={cn(
                "relative w-7 h-7 flex items-center justify-center text-xs rounded-full cursor-pointer hover:bg-muted mx-auto",
                isToday(day) && "bg-primary text-primary-foreground font-semibold hover:bg-primary/90",
                isSameDay(day, selectedDate) && !isToday(day) && "bg-accent text-accent-foreground",
                !isSameMonth(day, currentMonth) && "text-muted-foreground/40"
              )}
            >
              {format(day, "d")}
              {hasEvent && !isToday(day) && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Event Detail Popover (as Dialog for simplicity) ────────
function EventDetailDialog({
  event,
  open,
  onClose,
  onEdit,
  onDelete,
}: {
  event: Event | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!event) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden">
        <div className="h-1" style={{ backgroundColor: event.color }} />
        <div className="p-4 space-y-3">
          <DialogHeader>
            <DialogTitle className="text-base">{event.title}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock size={14} />
            <span>{formatEventDate(event.startAt, !!event.allDay)}</span>
          </div>
          {!event.allDay && (
            <p className="text-sm text-muted-foreground ml-[22px]">
              {formatEventTime(event.startAt, event.endAt, !!event.allDay)}
            </p>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: event.color }} />
            <span>{event.calendar}</span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin size={14} />
              <span>{event.location}</span>
            </div>
          )}
          {event.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 size={14} className="mr-1" /> Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── New/Edit Event Dialog ──────────────────────────────────
function EventFormDialog({
  open,
  onClose,
  initialData,
  calendars,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialData: EventFormData;
  calendars: { name: string; color: string }[];
  onSave: (data: EventFormData) => void;
}) {
  const [form, setForm] = useState(initialData);
  useEffect(() => { setForm(initialData); }, [initialData]);

  // Default a new event to the first real calendar when its calendar isn't one that exists.
  useEffect(() => {
    if (calendars.length && !calendars.some((c) => c.name === form.calendar)) {
      setForm((prev) => ({ ...prev, calendar: calendars[0].name, color: calendars[0].color }));
    }
  }, [calendars, form.calendar]);

  const update = <K extends keyof EventFormData>(key: K, val: EventFormData[K]) =>
    setForm((prev) => ({
      ...prev,
      [key]: val,
      ...(key === "calendar"
        ? { color: calendars.find((c) => c.name === (val as string))?.color || prev.color || "#4F46E5" }
        : {}),
    }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{initialData.title ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            placeholder="Event title"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            className="text-base"
            autoFocus
          />
          <div className="flex items-center gap-3">
            <Label className="text-sm">All day</Label>
            <Switch checked={form.allDay} onCheckedChange={(v) => update("allDay", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Start date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} />
            </div>
            {!form.allDay && (
              <div>
                <Label className="text-xs text-muted-foreground">Start time</Label>
                <Select value={form.startTime} onValueChange={(v) => update("startTime", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">End date</Label>
              <Input type="date" value={form.endDate} onChange={(e) => update("endDate", e.target.value)} />
            </div>
            {!form.allDay && (
              <div>
                <Label className="text-xs text-muted-foreground">End time</Label>
                <Select value={form.endTime} onValueChange={(v) => update("endTime", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          {calendars.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Calendar</Label>
              <Select value={form.calendar} onValueChange={(v) => update("calendar", v)}>
                <SelectTrigger><SelectValue placeholder="Select a calendar" /></SelectTrigger>
                <SelectContent>
                  {calendars.map((cal) => (
                    <SelectItem key={cal.name} value={cal.name}>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cal.color }} />
                        {cal.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="relative">
            <MapPin size={14} className="absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Add location"
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              className="pl-8"
            />
          </div>
          <textarea
            placeholder="Add description"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave(form)} disabled={!form.title.trim()}>Save event</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Multi-day lane layout ──────────────────────────────────
// Splits each event into per-week segments and assigns non-overlapping lanes so multi-day
// events render as a continuous bar across the days they span.
type WeekSegment = {
  ev: Event;
  startCol: number; // 0-6 within the week
  endCol: number; // 0-6 within the week (inclusive)
  continuesLeft: boolean; // started before this week
  continuesRight: boolean; // ends after this week
  lane: number;
};

function layoutWeek(weekDays: Date[], events: Event[]): WeekSegment[] {
  const weekStart = startOfDay(weekDays[0]);
  const weekEnd = startOfDay(weekDays[6]);

  const segments: WeekSegment[] = [];
  for (const ev of events) {
    const start = startOfDay(parseISO(ev.startAt));
    let end = startOfDay(parseISO(ev.endAt));
    if (end < start) end = start;
    if (end < weekStart || start > weekEnd) continue;
    const segStart = start < weekStart ? weekStart : start;
    const segEnd = end > weekEnd ? weekEnd : end;
    segments.push({
      ev,
      startCol: differenceInDays(segStart, weekStart),
      endCol: differenceInDays(segEnd, weekStart),
      continuesLeft: start < weekStart,
      continuesRight: end > weekEnd,
      lane: 0,
    });
  }

  // Longer / earlier events first, then greedily pack into lanes.
  segments.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      (b.endCol - b.startCol) - (a.endCol - a.startCol) ||
      a.ev.startAt.localeCompare(b.ev.startAt),
  );
  const laneLastCol: number[] = [];
  for (const seg of segments) {
    let lane = 0;
    while (lane < laneLastCol.length && laneLastCol[lane] >= seg.startCol) lane++;
    laneLastCol[lane] = seg.endCol;
    seg.lane = lane;
  }
  return segments;
}

// ─── Month View ─────────────────────────────────────────────
function MonthView({
  currentMonth,
  events,
  onClickEvent,
  onClickDay,
}: {
  currentMonth: Date;
  events: Event[];
  onClickEvent: (e: Event, ev: React.MouseEvent) => void;
  onClickDay: (d: Date) => void;
}) {
  const MAX_LANES = 3;
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="grid grid-cols-7 border-b">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-xs font-medium text-muted-foreground text-center py-2">{d}</div>
        ))}
      </div>
      <div className="flex-1 flex flex-col">
        {weeks.map((weekDays, wi) => {
          const segments = layoutWeek(weekDays, events);
          const hiddenByDay = weekDays.map((_, col) =>
            segments.filter((s) => s.lane >= MAX_LANES && s.startCol <= col && s.endCol >= col).length,
          );

          return (
            <div key={wi} className="flex-1 min-h-0 border-b last:border-b-0 flex flex-col">
              {/* Day numbers */}
              <div className="grid grid-cols-7 flex-none">
                {weekDays.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={cn("px-1 pt-1 border-r last:border-r-0", !isSameMonth(day, currentMonth) && "bg-muted/10")}
                  >
                    {isToday(day) ? (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        {format(day, "d")}
                      </span>
                    ) : (
                      <span className={cn("flex h-6 w-6 items-center justify-center text-xs", !isSameMonth(day, currentMonth) && "text-muted-foreground/40")}>
                        {format(day, "d")}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Event lanes — multi-day events span columns via grid-column */}
              <div
                className="relative grid grid-cols-7 gap-y-0.5 px-0.5 pb-1 flex-1 min-h-0 overflow-hidden content-start"
                style={{ gridAutoRows: "18px" }}
              >
                {/* Per-day click targets (create) sit behind the bars */}
                {weekDays.map((day, col) => (
                  <button
                    key={`bg-${col}`}
                    onClick={() => onClickDay(day)}
                    aria-label={`Create event on ${format(day, "MMMM d")}`}
                    className="rounded-sm hover:bg-muted/30 transition-colors"
                    style={{ gridColumnStart: col + 1, gridColumnEnd: col + 2, gridRowStart: 1, gridRowEnd: MAX_LANES + 2 }}
                  />
                ))}

                {/* Event bars */}
                {segments
                  .filter((seg) => seg.lane < MAX_LANES)
                  .map((seg) => (
                    <button
                      key={`${seg.ev.id}-${wi}`}
                      onClick={(e) => { e.stopPropagation(); onClickEvent(seg.ev, e); }}
                      title={seg.ev.title}
                      className="relative z-10 h-[18px] truncate rounded px-1.5 text-left text-[11px] font-medium leading-[18px]"
                      style={{
                        gridColumnStart: seg.startCol + 1,
                        gridColumnEnd: seg.endCol + 2,
                        gridRowStart: seg.lane + 1,
                        backgroundColor: `${seg.ev.color}20`,
                        color: seg.ev.color,
                        ...(seg.continuesLeft ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 } : {}),
                        ...(seg.continuesRight ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}),
                      }}
                    >
                      {seg.continuesLeft ? "‹ " : ""}
                      {seg.ev.title}
                      {seg.continuesRight ? " ›" : ""}
                    </button>
                  ))}

                {/* Overflow indicator per day */}
                {hiddenByDay.map((count, col) =>
                  count > 0 ? (
                    <button
                      key={`more-${col}`}
                      onClick={() => onClickDay(weekDays[col])}
                      className="relative z-10 h-[18px] truncate px-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
                      style={{ gridColumnStart: col + 1, gridColumnEnd: col + 2, gridRowStart: MAX_LANES + 1 }}
                    >
                      +{count} more
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week View ──────────────────────────────────────────────
function WeekView({
  currentMonth,
  selectedDate,
  events,
  onClickEvent,
}: {
  currentMonth: Date;
  selectedDate: Date;
  events: Event[];
  onClickEvent: (e: Event, ev: React.MouseEvent) => void;
}) {
  const weekStart = startOfWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 24 }, (_, i) => i); // full day so no events are hidden

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b">
        <div />
        {weekDays.map((d) => (
          <div key={d.toISOString()} className="text-center py-2 border-l">
            <p className="text-xs text-muted-foreground">{format(d, "EEE")}</p>
            <p className={cn("text-sm font-medium", isToday(d) && "text-primary font-bold")}>{format(d, "d")}</p>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          {hours.map((hour) => (
            <div key={hour} className="contents">
              <div className="text-xs text-muted-foreground text-right pr-2 h-14 flex items-start justify-end pt-0.5">
                {format(new Date(2000, 0, 1, hour), "h a")}
              </div>
              {weekDays.map((d) => {
                const dayKey = format(d, "yyyy-MM-dd");
                const hourEvents = events.filter((ev) => {
                  const evDate = format(parseISO(ev.startAt), "yyyy-MM-dd");
                  const evHour = getHours(parseISO(ev.startAt));
                  return evDate === dayKey && evHour === hour;
                });
                return (
                  <div key={`${dayKey}-${hour}`} className="border-l border-b h-14 relative p-0.5">
                    {hourEvents.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => onClickEvent(ev, e)}
                        className="w-full rounded px-1.5 py-0.5 text-[11px] font-medium truncate cursor-pointer text-left border-l-2"
                        style={{
                          backgroundColor: `${ev.color}20`,
                          borderLeftColor: ev.color,
                          color: ev.color,
                        }}
                      >
                        {ev.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Day View ───────────────────────────────────────────────
function DayView({
  selectedDate,
  events,
  onClickEvent,
}: {
  selectedDate: Date;
  events: Event[];
  onClickEvent: (e: Event, ev: React.MouseEvent) => void;
}) {
  const dayKey = format(selectedDate, "yyyy-MM-dd");
  const dayEvents = events.filter((ev) => format(parseISO(ev.startAt), "yyyy-MM-dd") === dayKey);
  const hours = Array.from({ length: 24 }, (_, i) => i); // full day so no events are hidden

  if (dayEvents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">No events today</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2 border-b">
        <p className="text-sm font-semibold">{format(selectedDate, "EEEE, MMMM d, yyyy")}</p>
      </div>
      <div className="grid grid-cols-[56px_1fr]">
        {hours.map((hour) => {
          const hourEvents = dayEvents.filter((ev) => getHours(parseISO(ev.startAt)) === hour);
          return (
            <div key={hour} className="contents">
              <div className="text-xs text-muted-foreground text-right pr-2 h-14 flex items-start justify-end pt-0.5">
                {format(new Date(2000, 0, 1, hour), "h a")}
              </div>
              <div className="border-l border-b h-14 relative p-0.5">
                {hourEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={(e) => onClickEvent(ev, e)}
                    className="w-full rounded px-2 py-1 text-sm font-medium truncate cursor-pointer text-left border-l-2"
                    style={{
                      backgroundColor: `${ev.color}20`,
                      borderLeftColor: ev.color,
                      color: ev.color,
                    }}
                  >
                    {ev.title} · {formatEventTime(ev.startAt, ev.endAt, !!ev.allDay)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Agenda View ────────────────────────────────────────────
function AgendaView({
  events,
  onClickEvent,
}: {
  events: Event[];
  onClickEvent: (e: Event, ev: React.MouseEvent) => void;
}) {
  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const groups: { date: string; events: Event[] }[] = [];
  sorted.forEach((ev) => {
    const dateKey = format(parseISO(ev.startAt), "MMMM d, EEEE");
    const last = groups[groups.length - 1];
    if (last?.date === dateKey) {
      last.events.push(ev);
    } else {
      groups.push({ date: dateKey, events: [ev] });
    }
  });

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {groups.map((g) => (
        <div key={g.date}>
          <p className="text-sm font-semibold text-foreground py-2">{g.date}</p>
          <div className="space-y-1.5">
            {g.events.map((ev) => (
              <button
                key={ev.id}
                onClick={(e) => onClickEvent(ev, e)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left"
              >
                <div className="w-1 h-8 rounded-full" style={{ backgroundColor: ev.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatEventTime(ev.startAt, ev.endAt, !!ev.allDay)} · {ev.calendar}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground py-20">
          No upcoming events
        </div>
      )}
    </div>
  );
}

// ─── Main Calendar Page ─────────────────────────────────────
export default function Calendar() {
  const queryClient = useQueryClient();
  const { toast, show: showToast } = useToast();

  const [currentMonth, setCurrentMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set());
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventFormData, setEventFormData] = useState<EventFormData>(defaultFormData());
  const [editingEventId, setEditingEventId] = useState<number | null>(null);

  const { data: eventsData } = useQuery({
    queryKey: ["/api/events"],
    queryFn: () => fetchJson<{ data: Event[] }>("/api/events"),
  });

  const allEvents = eventsData?.data || [];
  const visibleEvents = allEvents.filter((e) => !hiddenCalendars.has(e.calendar));

  const eventDates = useMemo(() => {
    const set = new Set<string>();
    allEvents.forEach((e) => set.add(format(parseISO(e.startAt), "yyyy-MM-dd")));
    return set;
  }, [allEvents]);

  // Real calendars come from the events themselves (Nextcloud sets each event's calendar
  // name + color). This replaces the old hardcoded Personal/Work/Shared + fake Holidays list,
  // so the show/hide filters actually match the data.
  const calendars = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEvents) {
      if (e.calendar && !map.has(e.calendar)) map.set(e.calendar, e.color || "#4F46E5");
    }
    return Array.from(map, ([name, color]) => ({ name, color }));
  }, [allEvents]);

  // Keep every calendar surface in sync after a write: the Calendar list, the
  // Dashboard (upcoming events widget + mini calendar + count), and the TopBar bell.
  const syncCalendarViews = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };

  const buildEventBody = (data: EventFormData) => ({
    title: data.title,
    // Timed events: interpret the entered date+time as LOCAL wall-clock and convert to a
    // correct UTC instant, so it round-trips back to the same local time on display.
    startAt: data.allDay
      ? `${data.startDate}T00:00:00Z`
      : new Date(`${data.startDate}T${data.startTime}:00`).toISOString(),
    endAt: data.allDay
      ? `${data.endDate}T23:59:59Z`
      : new Date(`${data.endDate}T${data.endTime}:00`).toISOString(),
    allDay: data.allDay,
    calendar: data.calendar || undefined,
    color: data.color,
    location: data.location || undefined,
    description: data.description || undefined,
  });

  const createMutation = useMutation({
    mutationFn: async (data: EventFormData) => {
      await apiRequest("POST", "/api/events", buildEventBody(data));
    },
    onSuccess: () => {
      syncCalendarViews();
      showToast("Event created");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to create event."),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EventFormData }) => {
      await apiRequest("PATCH", `/api/events/${id}`, buildEventBody(data));
    },
    onSuccess: () => {
      syncCalendarViews();
      showToast("Event updated");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to update event."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/events/${id}`);
    },
    onSuccess: () => {
      syncCalendarViews();
      setEventDetailOpen(false);
      setSelectedEvent(null);
      showToast("Event deleted");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "Unable to delete event."),
  });

  const handleClickEvent = useCallback((ev: Event, _e: React.MouseEvent) => {
    setSelectedEvent(ev);
    setEventDetailOpen(true);
  }, []);

  const handleClickDay = useCallback((day: Date) => {
    setSelectedDate(day);
    setEventFormData(defaultFormData(day));
    setEditingEventId(null);
    setEventDialogOpen(true);
  }, []);

  const handleEditEvent = useCallback(() => {
    if (!selectedEvent) return;
    const start = parseISO(selectedEvent.startAt);
    const end = parseISO(selectedEvent.endAt);
    setEventFormData({
      title: selectedEvent.title,
      startDate: format(start, "yyyy-MM-dd"),
      startTime: format(start, "HH:mm"),
      endDate: format(end, "yyyy-MM-dd"),
      endTime: format(end, "HH:mm"),
      allDay: !!selectedEvent.allDay,
      calendar: selectedEvent.calendar,
      color: selectedEvent.color,
      location: selectedEvent.location || "",
      description: selectedEvent.description || "",
    });
    setEditingEventId(selectedEvent.id);
    setEventDetailOpen(false);
    setEventDialogOpen(true);
  }, [selectedEvent]);

  const handleSaveEvent = useCallback((data: EventFormData) => {
    if (editingEventId) {
      updateMutation.mutate({ id: editingEventId, data });
    } else {
      createMutation.mutate(data);
    }
    setEventDialogOpen(false);
    setEditingEventId(null);
  }, [editingEventId, createMutation, updateMutation]);

  const toggleCalendar = (name: string) => {
    setHiddenCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSelectDate = (d: Date) => {
    setSelectedDate(d);
    setCurrentMonth(startOfMonth(d));
  };

  return (
    <>
      <Toast message={toast} />

      <div className="flex h-[calc(100vh-var(--topbar-height,56px))] overflow-hidden">
        {/* ─── Left Panel ─── */}
        <div className="w-[220px] flex-shrink-0 border-r flex flex-col bg-background">
          <MiniCalendar
            currentMonth={currentMonth}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            eventDates={eventDates}
          />

          <Separator />

          <div className="flex-1 overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 py-2">My Calendars</p>
            {calendars.length === 0 ? (
              <p className="px-3 py-1.5 text-sm text-muted-foreground">No calendars yet</p>
            ) : (
              calendars.map((cal) => (
                <button
                  key={cal.name}
                  onClick={() => toggleCalendar(cal.name)}
                  className="flex items-center gap-2 px-3 py-1.5 w-full hover:bg-muted/60 transition-colors text-sm"
                >
                  <span
                    className="w-3 h-3 rounded-full border-2 shrink-0"
                    style={{
                      borderColor: cal.color,
                      backgroundColor: hiddenCalendars.has(cal.name) ? "transparent" : cal.color,
                    }}
                  />
                  <span className={hiddenCalendars.has(cal.name) ? "text-muted-foreground line-through" : ""}>{cal.name}</span>
                </button>
              ))
            )}
          </div>

          <div className="p-3 border-t">
            <Button
              className="w-full"
              onClick={() => {
                setEventFormData(defaultFormData(selectedDate));
                setEditingEventId(null);
                setEventDialogOpen(true);
              }}
            >
              <CalendarPlus size={16} className="mr-2" /> New Event
            </Button>
          </div>
        </div>

        {/* ─── Right Panel ─── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth((m) => subMonths(m, 1))}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth((m) => addMonths(m, 1))}>
              <ChevronRight size={16} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setCurrentMonth(startOfMonth(new Date())); setSelectedDate(new Date()); }}>
              Today
            </Button>
            <span className="text-base font-semibold">{format(currentMonth, "MMMM yyyy")}</span>
            <div className="flex-1" />
            <div className="flex border rounded-lg overflow-hidden">
              {(["month", "week", "day", "agenda"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "px-3 py-1.5 text-sm capitalize transition-colors",
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  )}
                >
                  {mode === "month" ? "Month" : mode === "week" ? "Week" : mode === "day" ? "Day" : "Agenda"}
                </button>
              ))}
            </div>
          </div>

          {/* View */}
          {viewMode === "month" && (
            <MonthView
              currentMonth={currentMonth}
              events={visibleEvents}
              onClickEvent={handleClickEvent}
              onClickDay={handleClickDay}
            />
          )}
          {viewMode === "week" && (
            <WeekView
              currentMonth={currentMonth}
              selectedDate={selectedDate}
              events={visibleEvents}
              onClickEvent={handleClickEvent}
            />
          )}
          {viewMode === "day" && (
            <DayView
              selectedDate={selectedDate}
              events={visibleEvents}
              onClickEvent={handleClickEvent}
            />
          )}
          {viewMode === "agenda" && (
            <AgendaView events={visibleEvents} onClickEvent={handleClickEvent} />
          )}
        </div>
      </div>

      {/* Dialogs */}
      <EventDetailDialog
        event={selectedEvent}
        open={eventDetailOpen}
        onClose={() => setEventDetailOpen(false)}
        onEdit={handleEditEvent}
        onDelete={() => selectedEvent && deleteMutation.mutate(selectedEvent.id)}
      />
      <EventFormDialog
        open={eventDialogOpen}
        onClose={() => setEventDialogOpen(false)}
        initialData={eventFormData}
        calendars={calendars}
        onSave={handleSaveEvent}
      />
    </>
  );
}
