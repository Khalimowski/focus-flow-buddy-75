import { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, Clock, Edit2, X, Save, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { generateId } from "@/lib/utils";
import { isNative, scheduleNativeAt, cancelNative, hashId, deleteFromCalendar } from "@/lib/native";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";
import { format, addDays, isSameDay, startOfDay, parseISO, startOfWeek } from "date-fns";
import { pl } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null; // ISO
  dueDate: string; // ISO date string (YYYY-MM-DD)
  notified?: boolean;
  createdAt: number;
};

type Reminder = {
  id: string;
  label: string;
  times: string[]; // "HH:mm"
  enabled: boolean;
  lastFired: Record<string, string>; // time -> YYYY-MM-DD
};

const sortTasks = (list: Task[]) => {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.remindAt && b.remindAt) {
      const getHM = (iso: string) => {
        const d = new Date(iso);
        return d.getHours() * 60 + d.getMinutes();
      };
      const hmA = getHM(a.remindAt);
      const hmB = getHM(b.remindAt);
      if (hmA !== hmB) return hmA - hmB;
      return a.createdAt - b.createdAt;
    }
    if (a.remindAt) return -1;
    if (b.remindAt) return 1;
    return a.createdAt - b.createdAt;
  });
};

export function TaskList({ onComplete }: { onComplete?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [newTaskDate, setNewTaskDate] = useState<Date>(startOfDay(new Date()));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editDate, setEditDate] = useState<Date>(new Date());

  const { t, language } = useTranslation();
  const dateLocale = language === 'pl' ? pl : undefined;
  const shortDateFormat = language === 'pl' ? 'd MMM' : 'MMM d';
  const { calendarSync } = useI18nStore();
  const { addEvent } = useHistoryStore();

  useEffect(() => {
    const load = () => {
      const data = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
      const reminderData = loadJSON<Reminder[]>(STORAGE_KEYS.reminders, []);
      setReminders(reminderData);

      // Migration: ensure all tasks have a dueDate and handle missing createdAt
      const migrated = data.map(task => ({
        ...task,
        createdAt: task.createdAt || Date.now(),
        dueDate: task.dueDate || (task.remindAt ? format(parseISO(task.remindAt), 'yyyy-MM-dd') : format(new Date(task.createdAt || Date.now()), 'yyyy-MM-dd'))
      }));
      setTasks(sortTasks(migrated));
    };

    load();
    setLoaded(true);

    window.addEventListener('ff.data_updated', load);
    return () => window.removeEventListener('ff.data_updated', load);
  }, []);

  useEffect(() => {
    if (loaded) {
      saveJSON(STORAGE_KEYS.tasks, tasks);
    }
  }, [tasks, loaded]);

  const displayItems = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const filteredTasks = tasks.filter(t => t.dueDate === dateStr).map(t => ({ ...t, kind: 'task' as const }));

    const nudgeItems = reminders
      .filter(r => r.enabled)
      .flatMap(r => r.times.map(time => ({
        id: `${r.id}-${time}`,
        title: r.label,
        done: r.lastFired[time] === dateStr,
        remindAt: time,
        kind: 'nudge' as const,
        originalId: r.id,
        time: time
      })));

    return [...filteredTasks, ...nudgeItems].sort((a, b) => {
      // Sort logic: Done items at bottom
      if (a.done !== b.done) return a.done ? 1 : -1;

      const getMinutes = (item: any) => {
        if (item.kind === 'task') {
          if (!item.remindAt) return 9999;
          const d = new Date(item.remindAt);
          return d.getHours() * 60 + d.getMinutes();
        } else {
          const [h, m] = item.time.split(':').map(Number);
          return h * 60 + m;
        }
      };

      const minA = getMinutes(a);
      const minB = getMinutes(b);

      if (minA !== minB) return minA - minB;
      return 0;
    });
  }, [tasks, reminders, selectedDate]);

  // Daily Strip dates (Monday to Sunday of current week)
  const dayStrip = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, []);

  const add = async () => {
    if (!title.trim()) return;

    try {
      let remindAt: string | null = null;
      const dueDate = format(newTaskDate, 'yyyy-MM-dd');

      if (time) {
        const [h, m] = time.split(":").map(Number);
        const d = new Date(newTaskDate);
        d.setHours(h, m, 0, 0);
        remindAt = d.toISOString();
      }

      const id = generateId();
      const newTask: Task = {
        id,
        title: title.trim(),
        done: false,
        remindAt,
        dueDate,
        createdAt: Date.now()
      };

      // 1. Immediate UI update
      setTasks(prev => sortTasks([newTask, ...prev]));
      setTitle("");
      setTime("");
      setNewTaskDate(selectedDate);

      // 2. Background native sync
      if (isNative() && remindAt) {
        deleteFromCalendar(title.trim()).catch(e => console.error("Sync: delete failed", e));
        scheduleNativeAt(hashId("task:" + id), title.trim(), t('reminder_title'), new Date(remindAt), calendarSync, id)
          .catch(e => console.error("Sync: schedule failed", e));
      }

      addEvent('task_created', { title: title.trim(), hasReminder: !!remindAt, date: dueDate });
    } catch (e) {
      console.error("Task add failed", e);
    }
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDate(parseISO(task.dueDate));
    if (task.remindAt) {
      const d = new Date(task.remindAt);
      setEditTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    } else {
      setEditTime("");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditTime("");
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) {
      console.warn("[Save] Missing ID or title", { editingId, editTitle });
      return;
    }

    try {
      console.log(`[Save] Attempting to save task: ${editingId}`);
      let remindAt: string | null = null;

      // Ensure date is valid before formatting
      let validDate = editDate;
      if (!validDate || isNaN(validDate.getTime())) {
        console.warn("[Save] Invalid editDate, defaulting to today");
        validDate = new Date();
      }
      const dueDate = format(validDate, 'yyyy-MM-dd');

      if (editTime) {
        const [h, m] = editTime.split(":").map(Number);
        const d = new Date(validDate);
        d.setHours(h, m, 0, 0);
        remindAt = d.toISOString();
      }

      // 1. Capture current values for background sync before clearing state
      const idToSync = editingId;
      const titleToSync = editTitle.trim();
      const oldTask = tasks.find(item => item.id === idToSync);
      const oldTitle = oldTask?.title;

      // 2. Immediate UI update
      setTasks(prev => {
        const updated = prev.map(item => item.id === idToSync ? {
          ...item,
          title: titleToSync,
          remindAt,
          dueDate,
          notified: false
        } : item);
        return sortTasks(updated);
      });

      addEvent('task_edited', { id: idToSync, newTitle: titleToSync });
      cancelEdit();

      // 3. Background native sync (don't block the UI)
      if (isNative()) {
        const runNativeSync = async () => {
          try {
            await cancelNative([hashId("task:" + idToSync)]);
            if (oldTitle) {
              await deleteFromCalendar(oldTitle);
            }
            if (remindAt) {
              await scheduleNativeAt(hashId("task:" + idToSync), titleToSync, t('reminder_title'), new Date(remindAt), calendarSync, idToSync);
            }
          } catch (nativeErr) {
            console.warn("[Native] Task sync failed during edit:", nativeErr);
          }
        };
        void runNativeSync();
      }
    } catch (e) {
      console.error("Save edit failed", e);
      notify({ title: t('save_error'), body: t('save_error_body'), kind: "info" });
    }
  };

  const toggle = (id: string) => {
    setTasks(prev => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item;
        const becoming = !item.done;
        if (becoming) {
          onComplete?.();
          addEvent('task_completed', { title: item.title });

          // Remove from native notifications and calendar when done
          if (isNative()) {
            void cancelNative([hashId("task:" + id)]);
            void deleteFromCalendar(item.title);
          }
        }
        return { ...item, done: becoming };
      });
      return sortTasks(updated);
    });
  };

  const remove = async (id: string) => {
    try {
      const taskToDelete = tasks.find(item => item.id === id);
      if (!taskToDelete) return;

      // 1. Immediate UI update
      setTasks(prev => prev.filter((item) => item.id !== id));

      // 2. Background native cleanup
      if (isNative()) {
        cancelNative([hashId("task:" + id)]).catch(e => console.error("Sync: cancel failed", e));
        deleteFromCalendar(taskToDelete.title).catch(e => console.error("Sync: delete failed", e));
      }

      addEvent('task_deleted', { title: taskToDelete.title });
    } catch (e) {
      console.error("Task remove failed", e);
      setTasks(prev => prev.filter((item) => item.id !== id));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Daily Strip */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto py-3 px-1 scrollbar-hide">
        {dayStrip.map((date, i) => {
          const active = isSameDay(date, selectedDate);
          const isToday = isSameDay(date, new Date());
          return (
            <button
              key={i}
              onClick={() => {
                setSelectedDate(startOfDay(date));
                setNewTaskDate(startOfDay(date));
              }}
              className={`flex min-w-[50px] flex-col items-center rounded-2xl py-3.5 transition-all ${
                active
                  ? "bg-primary text-primary-foreground shadow-glow scale-102 ring-1 ring-primary/20"
                  : "bg-card/40 text-muted-foreground hover:bg-card/60"
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-tighter opacity-70">
                {format(date, 'EEE', { locale: dateLocale })}
              </span>
              <span className="text-sm font-bold leading-none mt-1">{format(date, 'd')}</span>
              {isToday && !active && <div className="mt-1 size-1 rounded-full bg-primary animate-pulse" />}
            </button>
          );
        })}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-2xl bg-card/40 size-[50px] shrink-0 hover:bg-card/60">
              <CalendarIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 rounded-3xl" align="end" sideOffset={12} collisionPadding={16}>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedDate(startOfDay(d))}
              initialFocus
              weekStartsOn={1}
              locale={dateLocale}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="rounded-2xl border bg-card/50 p-4 backdrop-blur shadow-sm">
        <div className="flex flex-col gap-3">
          <Input
            placeholder={t('task_input_placeholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="flex-1 bg-transparent border-none text-base focus-visible:ring-0 px-0 h-auto"
          />
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div className="flex gap-2">
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-28 font-mono h-8 text-xs rounded-full bg-secondary/50 border-none"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="sm" className="h-8 rounded-full px-3 text-[10px] font-bold gap-1.5">
                    <CalendarIcon className="size-3" />
                    {isSameDay(newTaskDate, new Date()) ? t('today') : format(newTaskDate, shortDateFormat, { locale: dateLocale })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-3xl" align="start" side="top" sideOffset={12} collisionPadding={16}>
                  <Calendar
                    mode="single"
                    selected={newTaskDate}
                    onSelect={(d) => d && setNewTaskDate(startOfDay(d))}
                    initialFocus
                    weekStartsOn={1}
                    locale={dateLocale}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button onClick={add} size="sm" className="size-8 rounded-full p-0 shadow-soft">
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {displayItems.length === 0 && (
            <motion.li
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground bg-card/10"
            >
              {t('tasks_empty')}
            </motion.li>
          )}
          {displayItems.map((item) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={`flex items-center gap-3 rounded-2xl border p-3 backdrop-blur ${
                item.kind === 'nudge'
                  ? "bg-amber-500/5 border-amber-500/10 shadow-sm"
                  : "bg-card/40 border-border"
              }`}
            >
              {item.kind === 'task' && editingId === item.id ? (
                <div className="flex flex-col gap-3 w-full p-1">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="flex-1 h-9 bg-transparent border-none px-0 text-sm focus-visible:ring-0"
                    autoFocus
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1.5 shrink-0">
                      <Input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="w-[84px] font-mono h-7 text-[10px] rounded-full bg-secondary/50 border-none"
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="secondary" size="sm" className="h-7 rounded-full px-2 text-[9px] font-bold gap-1">
                            <CalendarIcon className="size-2.5" />
                            {format(editDate, shortDateFormat, { locale: dateLocale })}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-3xl" align="start" side="top" sideOffset={12} collisionPadding={16}>
                          <Calendar
                            mode="single"
                            selected={editDate}
                            onSelect={(d) => d && setEditDate(startOfDay(d))}
                            initialFocus
                            weekStartsOn={1}
                            locale={dateLocale}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex gap-1 ml-auto shrink-0">
                      <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 px-1.5 text-[10px]">
                        <X className="size-3 mr-1" /> {t('cancel')}
                      </Button>
                      <Button size="sm" onClick={saveEdit} className="h-7 px-2.5 text-[10px] shadow-sm">
                        <Save className="size-3 mr-1" /> {t('save')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => item.kind === 'task' ? toggle(item.id) : null}
                    aria-label="toggle"
                    className={`grid size-6 shrink-0 place-items-center rounded-full border transition ${
                      item.done
                        ? item.kind === 'nudge' ? "border-amber-500 bg-amber-500 text-white" : "border-mint bg-mint text-mint-foreground"
                        : "border-border hover:border-primary"
                    } ${item.kind === 'nudge' ? 'cursor-default' : ''}`}
                  >
                    {item.done && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className={`text-sm font-medium ${item.done ? "text-muted-foreground line-through" : ""}`}
                      >
                        {item.title}
                      </div>
                      {item.kind === 'nudge' && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600">
                          {t('nudges')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                      <Clock className="size-3" />
                      {item.kind === 'task' && item.remindAt ? (
                        new Date(item.remindAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      ) : (
                        item.kind === 'nudge' ? item.time : ""
                      )}
                    </div>
                  </div>
                  {item.kind === 'task' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => startEdit(item)}
                        className="size-8 rounded-lg bg-blue-500/5 border-blue-500/10 text-blue-500 hover:bg-blue-500/10"
                      >
                        <Edit2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => remove(item.id)}
                        className="size-8 rounded-lg bg-red-500/5 border-red-500/10 text-red-500 hover:bg-red-500/10"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                  {item.kind === 'nudge' && (
                    <div className="flex items-center justify-center size-8 text-amber-500/40">
                      <Sparkles className="size-4" />
                    </div>
                  )}
                </>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
