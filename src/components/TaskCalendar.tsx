import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Edit2, Trash2 } from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { pl } from "date-fns/locale";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export type CalendarTask = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null;
  dueDate: string; // YYYY-MM-DD
  createdAt: number;
  notified?: boolean;
};

type Scale = "day" | "week" | "month";

type Props = {
  tasks: CalendarTask[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (task: CalendarTask) => void;
  onDeleteTask: (id: string) => void;
};

const SCALE_KEY = "ff.calendar_scale";
const MAX_CHIPS = 3; // per month cell before the "+n more" line

const minutesOf = (task: CalendarTask) => {
  if (!task.remindAt) return 9999;
  const d = new Date(task.remindAt);
  return d.getHours() * 60 + d.getMinutes();
};

const byTime = (a: CalendarTask, b: CalendarTask) => {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const diff = minutesOf(a) - minutesOf(b);
  return diff !== 0 ? diff : a.createdAt - b.createdAt;
};

const timeLabel = (task: CalendarTask) =>
  task.remindAt
    ? new Date(task.remindAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

/** Day / week / month overview of every task, sharing the tab's selected date. */
export function TaskCalendar({
  tasks,
  selectedDate,
  onSelectDate,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: Props) {
  const { t, language } = useTranslation();
  const dateLocale = language === "pl" ? pl : undefined;

  const [scale, setScale] = useState<Scale>(() => {
    try {
      const saved = localStorage.getItem(SCALE_KEY);
      return saved === "day" || saved === "week" || saved === "month" ? saved : "month";
    } catch {
      return "month";
    }
  });
  const switchScale = (next: Scale) => {
    setScale(next);
    try {
      localStorage.setItem(SCALE_KEY, next);
    } catch {
      /* private mode */
    }
  };

  // Tasks bucketed by their due date, so each cell is a cheap lookup.
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks) {
      const list = map.get(task.dueDate);
      if (list) list.push(task);
      else map.set(task.dueDate, [task]);
    }
    for (const list of map.values()) list.sort(byTime);
    return map;
  }, [tasks]);

  const tasksOn = (date: Date) => byDate.get(format(date, "yyyy-MM-dd")) ?? [];

  const days = useMemo(() => {
    if (scale === "day") return [startOfDay(selectedDate)];
    if (scale === "week") {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
    }
    // Month grids start on Monday and run whole weeks so the columns line up.
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 }),
    });
  }, [scale, selectedDate]);

  const shift = (direction: 1 | -1) => {
    if (scale === "day") onSelectDate(startOfDay(addDays(selectedDate, direction)));
    else if (scale === "week") onSelectDate(startOfDay(addWeeks(selectedDate, direction)));
    else onSelectDate(startOfDay(addMonths(selectedDate, direction)));
  };

  const headerLabel = useMemo(() => {
    if (scale === "day") return format(selectedDate, "EEEE, d MMMM", { locale: dateLocale });
    if (scale === "week") {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      const end = addDays(start, 6);
      return `${format(start, "d MMM", { locale: dateLocale })} – ${format(end, "d MMM", { locale: dateLocale })}`;
    }
    return format(selectedDate, "LLLL yyyy", { locale: dateLocale });
  }, [scale, selectedDate, dateLocale]);

  const weekdayLabels = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) =>
      format(addDays(start, i), "EEEEE", { locale: dateLocale }),
    );
  }, [dateLocale]);

  const renderRow = (task: CalendarTask) => (
    <div key={task.id} className="flex items-center gap-2 rounded-xl border bg-card/40 px-2.5 py-2">
      <button
        onClick={() => onToggleTask(task.id)}
        aria-label={task.title}
        aria-pressed={task.done}
        className={`grid size-5 shrink-0 place-items-center rounded-full border transition ${
          task.done
            ? "border-mint bg-mint text-mint-foreground"
            : "border-border hover:border-primary"
        }`}
      >
        {task.done && <Check className="size-3" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-medium ${task.done ? "text-muted-foreground line-through" : ""}`}
        >
          {task.title}
        </div>
        {task.remindAt && (
          <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Clock className="size-2.5" />
            {timeLabel(task)}
          </div>
        )}
      </div>
      <button
        onClick={() => onEditTask(task)}
        aria-label={t("edit")}
        className="grid size-6 shrink-0 place-items-center rounded-md text-blue-500/80 hover:bg-blue-500/10"
      >
        <Edit2 className="size-3.5" />
      </button>
      <button
        onClick={() => onDeleteTask(task.id)}
        aria-label={t("delete")}
        className="grid size-6 shrink-0 place-items-center rounded-md text-red-500/80 hover:bg-red-500/10"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Scale switch + period navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center rounded-full bg-card/40 p-0.5">
          {(["day", "week", "month"] as const).map((option) => (
            <button
              key={option}
              onClick={() => switchScale(option)}
              aria-pressed={scale === option}
              className={`rounded-full px-3 py-1.5 text-[10px] font-bold transition-all ${
                scale === option
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`calendar_${option}` as "calendar_day")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("calendar_prev")}
            onClick={() => shift(-1)}
            className="size-8 rounded-full bg-card/40 hover:bg-card/60"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectDate(startOfDay(new Date()))}
            className="h-8 rounded-full bg-card/40 px-3 text-[10px] font-bold hover:bg-card/60"
          >
            {t("calendar_today")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("calendar_next")}
            onClick={() => shift(1)}
            className="size-8 rounded-full bg-card/40 hover:bg-card/60"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="text-center text-sm font-bold capitalize">{headerLabel}</div>

      {scale === "month" ? (
        <div className="rounded-2xl border bg-card/30 p-2">
          <div className="grid grid-cols-7 gap-1 pb-1">
            {weekdayLabels.map((label, i) => (
              <div
                key={i}
                className="text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((date) => {
              const dayTasks = tasksOn(date);
              const selected = isSameDay(date, selectedDate);
              const inMonth = isSameMonth(date, selectedDate);
              return (
                <button
                  key={date.toISOString()}
                  onClick={() => onSelectDate(startOfDay(date))}
                  className={`flex min-h-[52px] flex-col items-stretch gap-0.5 rounded-lg border p-1 text-left transition sm:min-h-[76px] ${
                    selected
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : "border-transparent bg-card/30 hover:bg-card/60"
                  } ${inMonth ? "" : "opacity-40"}`}
                >
                  <span
                    className={`text-[10px] font-bold ${
                      isSameDay(date, new Date()) ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {format(date, "d")}
                  </span>
                  {/* Titles need room, so phones get dots and a count instead. */}
                  {dayTasks.length > 0 && (
                    <>
                      <span className="flex flex-wrap gap-0.5 sm:hidden">
                        {dayTasks.slice(0, 4).map((task) => (
                          <span
                            key={task.id}
                            className={`size-1.5 rounded-full ${task.done ? "bg-mint/50" : "bg-primary"}`}
                          />
                        ))}
                      </span>
                      <span className="hidden flex-col gap-0.5 sm:flex">
                        {dayTasks.slice(0, MAX_CHIPS).map((task) => (
                          <span
                            key={task.id}
                            className={`truncate rounded px-1 text-[9px] leading-tight ${
                              task.done
                                ? "bg-mint/10 text-muted-foreground line-through"
                                : "bg-primary/15 text-foreground"
                            }`}
                          >
                            {task.title}
                          </span>
                        ))}
                        {dayTasks.length > MAX_CHIPS && (
                          <span className="px-1 text-[9px] text-muted-foreground">
                            {t("calendar_more").replace("{n}", String(dayTasks.length - MAX_CHIPS))}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {days.map((date) => {
            const dayTasks = tasksOn(date);
            const selected = isSameDay(date, selectedDate);
            return (
              <div
                key={date.toISOString()}
                className={`rounded-2xl border p-3 transition ${
                  selected && scale === "week"
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card/30"
                }`}
              >
                {/* In day scale the heading above already names the day. */}
                {scale === "week" && (
                  <button
                    onClick={() => onSelectDate(startOfDay(date))}
                    className="mb-2 flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span className="text-xs font-bold capitalize">
                      {format(date, "EEEE d MMM", { locale: dateLocale })}
                      {isSameDay(date, new Date()) && (
                        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                          {t("calendar_today")}
                        </span>
                      )}
                    </span>
                    {dayTasks.length > 0 && (
                      <span className="shrink-0 rounded-full bg-card/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {dayTasks.length}
                      </span>
                    )}
                  </button>
                )}
                {dayTasks.length === 0 ? (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">
                    {t("calendar_empty")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">{dayTasks.map(renderRow)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
