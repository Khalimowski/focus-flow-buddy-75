import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, Clock, Edit2, X, Save, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles, CheckSquare, List, CalendarClock, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { generateId } from "@/lib/utils";
import { isNative, scheduleNativeAt, cancelNative, hashId, deleteFromCalendar } from "@/lib/native";
import { isGoogleConfigured, getGoogleConnection, pushTaskToGoogleCalendar, removeTaskFromGoogleCalendar } from "@/lib/google";
import { GmailImport } from "@/components/GmailImport";
import { TaskTimeline, type TimelineTask } from "@/components/TaskTimeline";
import { TaskCalendarDialog } from "@/components/TaskCalendarDialog";
import { TimePicker } from "@/components/TimePicker";
import { MicButton } from "@/components/MicButton";
import { extractSchedule } from "@/lib/voice-time";
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

type ViewMode = 'list' | 'timeline';

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
  // Set when the next setTasks comes from re-reading storage (see reload below)
  const skipNextSave = useRef(false);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [newTaskDate, setNewTaskDate] = useState<Date>(startOfDay(new Date()));

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem("ff.tasks_view") === "timeline" ? "timeline" : "list";
    } catch {
      return "list";
    }
  });
  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem("ff.tasks_view", mode); } catch { /* private mode */ }
  };
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editDate, setEditDate] = useState<Date>(new Date());

  const { t, language } = useTranslation();
  const dateLocale = language === 'pl' ? pl : undefined;
  const shortDateFormat = language === 'pl' ? 'd MMM' : 'MMM d';
  const { calendarSync, googleGmail } = useI18nStore();
  const { addEvent } = useHistoryStore();
  // Gmail button visibility tracks the connection state set in Settings
  const [googleConnected, setGoogleConnected] = useState(false);
  useEffect(() => {
    const update = () => setGoogleConnected(!!getGoogleConnection());
    update();
    window.addEventListener("ff.google-changed", update);
    return () => window.removeEventListener("ff.google-changed", update);
  }, []);

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

    // A reload came from storage, not from the user, so don't push it straight
    // back out: two devices left open would otherwise echo each other's pulls
    // forever (each pull bumps updated_at, which the other sees as a change).
    const reload = () => {
      skipNextSave.current = true;
      load();
    };
    window.addEventListener('ff.data_updated', reload);
    window.addEventListener('ff.remote-update', reload);
    return () => {
      window.removeEventListener('ff.data_updated', reload);
      window.removeEventListener('ff.remote-update', reload);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveJSON(STORAGE_KEYS.tasks, tasks);
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

      const getMinutes = (item: (typeof filteredTasks)[number] | (typeof nudgeItems)[number]) => {
        if (item.kind === 'task') {
          if (!item.remindAt) return 9999;
          const d = new Date(item.remindAt);
          return d.getHours() * 60 + d.getMinutes();
        }
        const [h, m] = item.time.split(':').map(Number);
        return h * 60 + m;
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

  // Shared by the inline composer and the calendar popup: everything a new task
  // needs is passed in, so no caller depends on the composer's own state.
  const addTask = (rawTitle: string, time: string, date: Date) => {
    const cleanTitle = rawTitle.trim();
    if (!cleanTitle) return;

    try {
      let remindAt: string | null = null;
      const dueDate = format(date, 'yyyy-MM-dd');

      if (time) {
        const [h, m] = time.split(":").map(Number);
        const d = new Date(date);
        d.setHours(h, m, 0, 0);
        remindAt = d.toISOString();
      }

      const id = generateId();
      const newTask: Task = {
        id,
        title: cleanTitle,
        done: false,
        remindAt,
        dueDate,
        createdAt: Date.now()
      };

      // 1. Immediate UI update
      setTasks(prev => sortTasks([newTask, ...prev]));

      // 2. Background native sync
      if (isNative() && remindAt) {
        deleteFromCalendar(cleanTitle).catch(e => console.error("Sync: delete failed", e));
        scheduleNativeAt(hashId("task:" + id), cleanTitle, t('reminder_title'), new Date(remindAt), calendarSync, id)
          .catch(e => console.error("Sync: schedule failed", e));
      }
      void pushTaskToGoogleCalendar(newTask);

      addEvent('task_created', { title: cleanTitle, hasReminder: !!remindAt, date: dueDate });
    } catch (e) {
      console.error("Task add failed", e);
    }
  };

  const add = () => {
    if (!title.trim()) return;
    addTask(title, time, newTaskDate);
    setTitle("");
    setTime("");
    setNewTaskDate(selectedDate);
  };

  // Each dictation starts from an empty field: tapping the mic wipes whatever
  // was there, so a second take replaces the first rather than piling onto it.
  // The old text is held on to until the session produces something, because a
  // dictation that hears nothing — mic refused, model missing, or just silence
  // — must not cost the user what they had already typed.
  const dictationUndo = useRef("");
  const startDictation = () => {
    dictationUndo.current = title;
    setTitle("");
  };
  const restoreDictation = useCallback(() => {
    setTitle(dictationUndo.current);
  }, []);
  const applyDictation = useCallback((text: string, isFinal: boolean) => {
    // Vosk returns lowercase and unpunctuated; a leading capital is all a task
    // title needs to stop looking like a transcript.
    const capitalize = (body: string) => body.charAt(0).toUpperCase() + body.slice(1);

    // Only the settled sentence gets searched: an interim result rewrites its
    // own tail every word or two, so "at four" would set 16:00 a moment before
    // "at four thirty" arrives.
    const spoken = isFinal ? extractSchedule(text, language) : null;
    if (!spoken) {
      setTitle(capitalize(text));
      return;
    }

    // What was spoken wins over what's already in the pickers — it's the more
    // recent thing the user asked for. Saying only a date leaves the time
    // alone, and vice versa.
    if (spoken.time) setTime(spoken.time);
    if (spoken.date) setNewTaskDate(spoken.date);
    // "tomorrow at half past four" is all schedule and no title, which leaves
    // the field empty for the user to fill in.
    setTitle(capitalize(spoken.title));
  }, [language]);

  // Gmail import: subject becomes the task title on the selected day (no time)
  const importFromEmail = (subject: string) => {
    const newTask: Task = {
      id: generateId(),
      title: subject.trim() || "(no subject)",
      done: false,
      remindAt: null,
      dueDate: format(selectedDate, 'yyyy-MM-dd'),
      createdAt: Date.now()
    };
    setTasks(prev => sortTasks([newTask, ...prev]));
    addEvent('task_created', { title: newTask.title, hasReminder: false, date: newTask.dueDate });
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
      if (remindAt) {
        void pushTaskToGoogleCalendar({ id: idToSync, title: titleToSync, remindAt });
      } else {
        void removeTaskFromGoogleCalendar(idToSync);
      }
    } catch (e) {
      console.error("Save edit failed", e);
      notify({ title: t('save_error'), body: t('save_error_body'), kind: "info" });
    }
  };

  // Timeline drag-drop: move a task to a new time of day (minutes from midnight), or clear its time
  const setTaskTime = (id: string, minutes: number | null) => {
    const task = tasks.find(item => item.id === id);
    if (!task) return;

    let remindAt: string | null = null;
    if (minutes !== null) {
      const d = parseISO(task.dueDate);
      d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      remindAt = d.toISOString();
    }
    if (remindAt === task.remindAt) return;

    setTasks(prev => sortTasks(prev.map(item =>
      item.id === id ? { ...item, remindAt, notified: false } : item
    )));

    if (isNative()) {
      const runNativeSync = async () => {
        try {
          await cancelNative([hashId("task:" + id)]);
          await deleteFromCalendar(task.title);
          if (remindAt) {
            await scheduleNativeAt(hashId("task:" + id), task.title, t('reminder_title'), new Date(remindAt), calendarSync, id);
          }
        } catch (nativeErr) {
          console.warn("[Native] Task sync failed during timeline move:", nativeErr);
        }
      };
      void runNativeSync();
    }
    if (remindAt) {
      void pushTaskToGoogleCalendar({ id, title: task.title, remindAt });
    } else {
      void removeTaskFromGoogleCalendar(id);
    }

    addEvent('task_edited', { id, newTitle: task.title });
  };

  const toggle = (id: string) => {
    // Side effects stay OUT of the setTasks updater: React runs updaters during
    // render, so notifying the streak/history stores from in there was a
    // "setState while rendering another component" error, and an updater React
    // chooses to re-run would fire the cancel/calendar calls twice.
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const becoming = !task.done;

    setTasks(prev =>
      sortTasks(prev.map((item) => (item.id === id ? { ...item, done: becoming } : item))),
    );

    if (!becoming) return;
    onComplete?.();
    addEvent('task_completed', { title: task.title });

    // Remove from native notifications and calendar when done
    if (isNative()) {
      void cancelNative([hashId("task:" + id)]);
      void deleteFromCalendar(task.title);
    }
    void removeTaskFromGoogleCalendar(id);
  };

  const moveToTodo = (id: string) => {
    const task = tasks.find(item => item.id === id);
    if (!task) return;

    // Convert to a To-Do item
    const todos = loadJSON<{ id: string; title: string; done: boolean; createdAt: number }[]>(STORAGE_KEYS.todo, []);
    todos.unshift({ id: generateId(), title: task.title, done: task.done, createdAt: Date.now() });
    saveJSON(STORAGE_KEYS.todo, todos);

    // Remove from tasks, including any scheduled notification/calendar entry
    setTasks(prev => prev.filter(item => item.id !== id));
    if (isNative()) {
      cancelNative([hashId("task:" + id)]).catch(e => console.error("Sync: cancel failed", e));
      deleteFromCalendar(task.title).catch(e => console.error("Sync: delete failed", e));
    }
    void removeTaskFromGoogleCalendar(id);

    notify({ title: t('moved_to_todo'), body: task.title, kind: "info" });
  };

  const toggleNudge = (reminderId: string, time: string) => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const updated = reminders.map(r => {
      if (r.id !== reminderId) return r;
      const lastFired = { ...r.lastFired };
      if (lastFired[time] === dateStr) {
        delete lastFired[time];
      } else {
        lastFired[time] = dateStr;
      }
      return { ...r, lastFired };
    });
    setReminders(updated);
    saveJSON(STORAGE_KEYS.reminders, updated);
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
      void removeTaskFromGoogleCalendar(id);

      addEvent('task_deleted', { title: taskToDelete.title });
    } catch (e) {
      console.error("Task remove failed", e);
      setTasks(prev => prev.filter((item) => item.id !== id));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Daily Strip */}
      {/* Sizes shrink below sm so the whole week AND the date picker fit a
          375px phone — the strip scrolls horizontally with no visible
          scrollbar, so anything past the edge was effectively undiscoverable. */}
      <div className="flex items-center justify-between gap-1 overflow-x-auto py-3 px-1 scrollbar-hide sm:gap-2" data-tour="days">
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
              className={`flex min-w-[38px] flex-1 flex-col items-center rounded-2xl py-3.5 transition-all sm:min-w-[50px] ${
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
            <Button variant="ghost" size="icon" className="rounded-2xl bg-card/40 size-[38px] shrink-0 hover:bg-card/60 sm:size-[50px]">
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

      <div className="rounded-2xl border bg-card/50 p-4 backdrop-blur shadow-sm" data-tour="add-task">
        <div className="flex flex-col gap-3">
          {/* The label reclaims the card's top padding as part of the tap
              target. This card is ~120px tall but the input was only 32px of
              it, so a thumb aimed at "the field" mostly landed on padding — or
              on the time/date row below, which opens a picker instead of the
              keyboard, leaving the field looking like it refused the tap. The
              To-Do composer never showed this because its card is half the
              height, so the same aim hits.

              h-11 (not flex-1/h-auto): in this *column* flex container flex-1
              resolves to flex-basis:0% on the HEIGHT, and only the automatic
              minimum size kept the field from collapsing to nothing. */}
          <label className="-mx-4 -mt-4 block cursor-text px-4 pt-4">
            <Input
              name="task-title"
              autoComplete="off"
              placeholder={t('task_input_placeholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              className="w-full bg-transparent border-none text-base focus-visible:ring-0 px-0 h-11"
            />
          </label>
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div className="flex gap-2">
              <TimePicker
                value={time}
                onChange={setTime}
                clearable
                className="w-28 justify-center"
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
              {isGoogleConfigured() && googleGmail && googleConnected && (
                <GmailImport onImport={importFromEmail} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <MicButton
                onStart={startDictation}
                onTranscript={applyDictation}
                onEmpty={restoreDictation}
              />
              <Button onClick={add} size="sm" aria-label={t('add_task')} className="size-8 rounded-full p-0 shadow-soft">
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1">
        <div className="flex items-center rounded-full bg-card/40 p-0.5" data-tour="view-toggle">
          <button
            onClick={() => switchView('list')}
            aria-label={t('view_list')}
            aria-pressed={viewMode === 'list'}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold transition-all ${
              viewMode === 'list' ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="size-3" /> {t('view_list')}
          </button>
          <button
            onClick={() => switchView('timeline')}
            aria-label={t('view_timeline')}
            aria-pressed={viewMode === 'timeline'}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold transition-all ${
              viewMode === 'timeline' ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarClock className="size-3" /> {t('view_timeline')}
          </button>
        </div>
        {/* The calendar is a popup rather than a third view: it spans months, so
            it wants the whole screen rather than the tab's column. */}
        <button
          onClick={() => setCalendarOpen(true)}
          aria-label={t('view_calendar')}
          className="flex items-center gap-1.5 rounded-full bg-card/40 px-3 py-1.5 text-[10px] font-bold text-muted-foreground transition-all hover:bg-card/60 hover:text-foreground"
        >
          <CalendarDays className="size-3" /> {t('view_calendar')}
        </button>
      </div>

      <TaskCalendarDialog
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        tasks={tasks}
        selectedDate={selectedDate}
        onSelectDate={(d) => {
          setSelectedDate(d);
          setNewTaskDate(d);
        }}
        onAddTask={addTask}
        onToggleTask={toggle}
        onEditTask={(task) => {
          setCalendarOpen(false);
          switchView('list');
          setSelectedDate(startOfDay(parseISO(task.dueDate)));
          startEdit(task);
        }}
        onDeleteTask={remove}
      />

      {viewMode === 'timeline' ? (
        displayItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground bg-card/10">
            {t('tasks_empty')}
          </div>
        ) : (
          <TaskTimeline
            items={displayItems}
            isToday={isSameDay(selectedDate, new Date())}
            onToggleTask={toggle}
            onToggleNudge={toggleNudge}
            onSetTaskTime={setTaskTime}
            onEditTask={(task: TimelineTask) => {
              switchView('list');
              startEdit(task);
            }}
            onDeleteTask={remove}
          />
        )
      ) : (
      <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3 2xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {displayItems.length === 0 && (
            <motion.li
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground bg-card/10 lg:col-span-2 2xl:col-span-3"
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
                    name="task-edit-title"
                    autoComplete="off"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="flex-1 h-9 bg-transparent border-none px-0 text-sm focus-visible:ring-0"
                    autoFocus
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1.5 shrink-0">
                      <TimePicker
                        value={editTime}
                        onChange={setEditTime}
                        clearable
                        size="sm"
                        className="w-[84px] justify-center"
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
                    onClick={() => item.kind === 'task' ? toggle(item.id) : toggleNudge(item.originalId, item.time)}
                    aria-label={item.title}
                    aria-pressed={item.done}
                    className={`grid size-6 shrink-0 place-items-center rounded-full border transition ${
                      item.done
                        ? item.kind === 'nudge' ? "border-amber-500 bg-amber-500 text-white" : "border-mint bg-mint text-mint-foreground"
                        : item.kind === 'nudge' ? "border-border hover:border-amber-500" : "border-border hover:border-primary"
                    }`}
                  >
                    {item.done && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className={`text-sm font-medium break-words min-w-0 ${item.done ? "text-muted-foreground line-through" : ""}`}
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
                        onClick={() => moveToTodo(item.id)}
                        aria-label={t('move_to_todo')}
                        title={t('move_to_todo')}
                        className="size-8 rounded-lg bg-violet-500/5 border-violet-500/10 text-violet-500 hover:bg-violet-500/10"
                      >
                        <CheckSquare className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => startEdit(item)}
                        aria-label={t('edit')}
                        className="size-8 rounded-lg bg-blue-500/5 border-blue-500/10 text-blue-500 hover:bg-blue-500/10"
                      >
                        <Edit2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => remove(item.id)}
                        aria-label={t('delete')}
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
      )}
    </div>
  );
}
