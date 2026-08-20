import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, CheckSquare, Clock, MoonStar, Sunrise } from "lucide-react";
import { addDays, format, parseISO, startOfDay } from "date-fns";
import { pl } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { dateKey, generateId, shiftDateKey } from "@/lib/utils";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import { unseenEntries } from "@/lib/changelog";
import { useHistoryStore } from "@/lib/history";
import { recordStat } from "@/lib/stats";
import { cancelNative, deleteFromCalendar, hashId, isNative, scheduleNativeAt } from "@/lib/native";
import { pushTaskToGoogleCalendar, removeTaskFromGoogleCalendar } from "@/lib/google";

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null;
  dueDate: string;
  notified?: boolean;
  createdAt: number;
};

type ToDoItem = { id: string; title: string; done: boolean; createdAt: number };

/** Device-local — see STORAGE_KEYS.endOfDay. */
type EodState = { lastReviewedDate?: string };

function readState(): EodState {
  return loadJSON<EodState>(STORAGE_KEYS.endOfDay, {});
}

/**
 * The day whose check-in is currently due. Before the cut-off that's still
 * yesterday's, which is what makes a missed 23:30 (phone face-down, app closed)
 * surface the next time the app is opened instead of being lost.
 */
function reviewDayFor(eodTime: string): string {
  const [h, m] = eodTime.split(":").map(Number);
  const cutoff = new Date();
  cutoff.setHours(h || 0, m || 0, 0, 0);
  return Date.now() >= cutoff.getTime() ? dateKey() : shiftDateKey(-1);
}

const byTime = (a: Task, b: Task) => {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.remindAt && b.remindAt) return a.remindAt < b.remindAt ? -1 : 1;
  if (a.remindAt) return -1;
  if (b.remindAt) return 1;
  return a.createdAt - b.createdAt;
};

/**
 * The end-of-day check-in: at the user's cut-off time (23:30 by default),
 * anything still open from today — and anything older that was never dealt
 * with — gets offered a new home: tomorrow, a day of their choosing, or the
 * To-Do list, which is where things without a date belong.
 *
 * Answering (or dismissing) records the day, so it asks once per day and not
 * again after a refresh. Tasks are read from and written straight to storage
 * rather than through TaskList; `ff.data_updated` makes the tab re-read.
 */
export function EndOfDayReview() {
  const { t, language } = useTranslation();
  const { eodReview, eodTime, calendarSync, tutorialCompleted } = useI18nStore();
  const { addEvent } = useHistoryStore();
  const dateLocale = language === "pl" ? pl : undefined;
  const longDateFormat = language === "pl" ? "d MMMM" : "MMMM d";

  const [reviewDay, setReviewDay] = useState<string | null>(null);
  const [items, setItems] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date>(() => addDays(startOfDay(new Date()), 1));
  // Something was moved but items remain — a quiet line beats a system
  // notification when the user is looking straight at the dialog.
  const [lastAction, setLastAction] = useState<string | null>(null);

  // The open check runs on a timer and on several events; it must never
  // re-derive the list while the user is working through it.
  const openRef = useRef(false);
  openRef.current = reviewDay !== null;

  const check = useCallback(() => {
    if (!eodReview || !tutorialCompleted || openRef.current) return;
    // Release notes get the screen first — two modals at half past eleven is
    // one too many. Dismissing them clears this, and the interval below brings
    // the check-in back within the minute.
    if (unseenEntries().length > 0) return;

    const day = reviewDayFor(eodTime);
    // A fresh install defaults to "yesterday already answered": no ambush on
    // first launch, but tonight's check-in still happens.
    const last = readState().lastReviewedDate ?? shiftDateKey(-1);
    if (last >= day) return;

    const leftovers = loadJSON<Task[]>(STORAGE_KEYS.tasks, [])
      .filter((task) => !task.done && (task.dueDate ?? day) <= day)
      .sort(byTime);
    if (leftovers.length === 0) return;

    setItems(leftovers);
    setSelected(new Set(leftovers.map((task) => task.id)));
    setPickedDate(addDays(startOfDay(new Date()), 1));
    setPicking(false);
    setLastAction(null);
    setReviewDay(day);
  }, [eodReview, eodTime, tutorialCompleted]);

  useEffect(() => {
    check();
    // A minute's granularity is plenty for a bedtime prompt, and polling the
    // clock survives the device sleeping through the cut-off (a setTimeout
    // armed hours earlier does not).
    const timer = window.setInterval(check, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("ff.data_updated", check);
    window.addEventListener("ff.remote-update", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("ff.data_updated", check);
      window.removeEventListener("ff.remote-update", check);
    };
  }, [check]);

  const finish = () => {
    if (reviewDay) saveJSON<EodState>(STORAGE_KEYS.endOfDay, { lastReviewedDate: reviewDay });
    setReviewDay(null);
    setItems([]);
    setSelected(new Set());
    setPicking(false);
    setLastAction(null);
  };

  // Drop what was just handled; close once the list is empty.
  const consume = (ids: Set<string>, message: string) => {
    const remaining = items.filter((task) => !ids.has(task.id));
    if (remaining.length === 0) {
      finish();
      return;
    }
    setItems(remaining);
    setSelected(new Set(remaining.map((task) => task.id)));
    setPicking(false);
    setLastAction(message);
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveSelected = (target: Date) => {
    const ids = new Set(selected);
    if (ids.size === 0) return;
    const targetKey = dateKey(target);

    const all = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
    const moved: Task[] = [];
    const updated = all.map((task) => {
      if (!ids.has(task.id)) return task;
      let remindAt = task.remindAt;
      if (remindAt) {
        // Keep the time of day, move the date under it.
        const old = new Date(remindAt);
        const next = startOfDay(target);
        next.setHours(old.getHours(), old.getMinutes(), 0, 0);
        remindAt = next.toISOString();
      }
      const next: Task = { ...task, dueDate: targetKey, remindAt, notified: false };
      moved.push(next);
      return next;
    });
    saveJSON(STORAGE_KEYS.tasks, updated);
    window.dispatchEvent(new CustomEvent("ff.data_updated"));

    for (const task of moved) {
      if (isNative()) {
        void (async () => {
          try {
            await cancelNative([hashId("task:" + task.id)]);
            await deleteFromCalendar(task.title);
            // A day picked in the past would otherwise fire the moment it's set.
            if (task.remindAt && new Date(task.remindAt).getTime() > Date.now()) {
              await scheduleNativeAt(
                hashId("task:" + task.id),
                task.title,
                t("reminder_title"),
                new Date(task.remindAt),
                calendarSync,
                task.id,
              );
            }
          } catch (e) {
            console.warn("[EOD] Native reschedule failed", e);
          }
        })();
      }
      if (task.remindAt) {
        void pushTaskToGoogleCalendar({ id: task.id, title: task.title, remindAt: task.remindAt });
      } else {
        void removeTaskFromGoogleCalendar(task.id);
      }
      addEvent("task_edited", { id: task.id, newTitle: task.title, movedTo: targetKey, source: "end_of_day" });
      // Distinct from a plain reschedule: this is the day running out, which is
      // the pattern the Insights screen is there to make visible.
      recordStat("taskPostponed");
    }

    consume(
      ids,
      t("eod_moved_to_day").replace("{date}", format(target, longDateFormat, { locale: dateLocale })),
    );
  };

  const moveSelectedToTodo = () => {
    const ids = new Set(selected);
    if (ids.size === 0) return;

    const all = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
    const moving = all.filter((task) => ids.has(task.id));

    const todos = loadJSON<ToDoItem[]>(STORAGE_KEYS.todo, []);
    for (const task of moving) {
      todos.unshift({ id: generateId(), title: task.title, done: false, createdAt: Date.now() });
    }
    saveJSON(STORAGE_KEYS.todo, todos);
    saveJSON(
      STORAGE_KEYS.tasks,
      all.filter((task) => !ids.has(task.id)),
    );
    window.dispatchEvent(new CustomEvent("ff.data_updated"));

    for (const task of moving) {
      if (isNative()) {
        void cancelNative([hashId("task:" + task.id)]);
        void deleteFromCalendar(task.title);
      }
      void removeTaskFromGoogleCalendar(task.id);
      addEvent("task_edited", { id: task.id, newTitle: task.title, source: "end_of_day", movedTo: "todo" });
      recordStat("taskToTodo");
      recordStat("todoCreated");
    }

    consume(ids, t("moved_to_todo"));
  };

  if (!reviewDay) return null;

  const allSelected = selected.size === items.length;

  return (
    <Dialog open onOpenChange={(next) => !next && finish()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-3 overflow-hidden rounded-3xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MoonStar className="size-4 text-primary" />
            {t("eod_title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("eod_desc").replace("{n}", String(items.length))}
          </DialogDescription>
        </DialogHeader>

        {lastAction && (
          <div className="rounded-2xl bg-mint/10 px-3 py-2 text-xs text-mint">{lastAction}</div>
        )}

        {/* One scroll region, so the buttons below stay reachable however long
            the list is. While the calendar is open the list stands down to a
            single line: on a phone the two together leave it about two rows of
            room, and squeezing both is worse than showing one at a time. */}
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1">
        {picking ? (
          <>
            <div className="rounded-2xl border border-border bg-card p-3">
              <div className="text-xs font-medium">
                {t("eod_moving").replace("{n}", String(selected.size))}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {items
                  .filter((task) => selected.has(task.id))
                  .map((task) => task.title)
                  .join(", ")}
              </div>
            </div>
            {/* Inline rather than a popover: nesting one inside the dialog puts
                a second layer between the user and a decision they're making at
                half past eleven. */}
            <div className="flex shrink-0 justify-center rounded-3xl border border-border bg-card p-2">
              <Calendar
                mode="single"
                selected={pickedDate}
                onSelect={(d) => d && setPickedDate(startOfDay(d))}
                weekStartsOn={1}
                locale={dateLocale}
                initialFocus
              />
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(items.map((task) => task.id)))
              }
              className="self-start rounded-full px-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              {allSelected ? t("eod_clear_selection") : t("eod_select_all")}
            </button>

            <ul className="flex flex-col gap-2">
              {items.map((task) => {
                const overdue = task.dueDate < reviewDay;
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    <Checkbox
                      id={`eod-${task.id}`}
                      checked={selected.has(task.id)}
                      onCheckedChange={() => toggleOne(task.id)}
                      className="size-5 shrink-0 rounded-full"
                    />
                    <label htmlFor={`eod-${task.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <div className="break-words text-sm font-medium">{task.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        {task.remindAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {new Date(task.remindAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        {overdue && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600">
                            {t("eod_overdue")} ·{" "}
                            {format(parseISO(task.dueDate), longDateFormat, { locale: dateLocale })}
                          </span>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        </div>

        {/* Pinned below the scroll region: whichever action the user is one tap
            away from must never be the thing that scrolled off. */}
        {picking ? (
          <div className="flex gap-2">
            <Button
              onClick={() => moveSelected(pickedDate)}
              className="h-9 flex-1 rounded-full text-xs shadow-soft"
            >
              {t("eod_move_to_day").replace(
                "{date}",
                format(pickedDate, longDateFormat, { locale: dateLocale }),
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPicking(false)}
              className="h-9 rounded-full px-4 text-xs"
            >
              {t("cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => moveSelected(addDays(startOfDay(new Date()), 1))}
                disabled={selected.size === 0}
                className="h-9 flex-1 gap-1.5 rounded-full text-xs shadow-soft"
              >
                <Sunrise className="size-3.5" /> {t("eod_tomorrow")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPicking(true)}
                disabled={selected.size === 0}
                className="h-9 flex-1 gap-1.5 rounded-full text-xs"
              >
                <CalendarDays className="size-3.5" /> {t("eod_pick_day")}
              </Button>
              <Button
                variant="secondary"
                onClick={moveSelectedToTodo}
                disabled={selected.size === 0}
                className="h-9 flex-1 gap-1.5 rounded-full text-xs"
              >
                <CheckSquare className="size-3.5" /> {t("eod_to_todo")}
              </Button>
            </div>

            <button
              onClick={finish}
              className="rounded-full py-2 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {t("eod_keep")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
