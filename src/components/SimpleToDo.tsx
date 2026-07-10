import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, Edit2, X, Save, Calendar as CalendarIcon, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";
import { notify } from "@/lib/notifications";
import { isNative, scheduleNativeAt, hashId } from "@/lib/native";
import { format, isSameDay, startOfDay } from "date-fns";
import { pl } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

type ToDoItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
};

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null; // ISO
  dueDate: string; // YYYY-MM-DD
  notified?: boolean;
  createdAt: number;
};

const sortItems = (list: ToDoItem[]) => {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
};

export function SimpleToDo() {
  const [items, setItems] = useState<ToDoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [schedTime, setSchedTime] = useState("");
  const [schedDate, setSchedDate] = useState<Date>(startOfDay(new Date()));

  const { t, language } = useTranslation();
  const { calendarSync } = useI18nStore();
  const dateLocale = language === 'pl' ? pl : undefined;
  const shortDateFormat = language === 'pl' ? 'd MMM' : 'MMM d';
  const { addEvent } = useHistoryStore();

  useEffect(() => {
    const data = loadJSON<ToDoItem[]>(STORAGE_KEYS.todo, []);
    setItems(sortItems(data));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      saveJSON(STORAGE_KEYS.todo, items);
    }
  }, [items, loaded]);

  const add = () => {
    if (!title.trim()) return;

    const newItem: ToDoItem = {
      id: generateId(),
      title: title.trim(),
      done: false,
      createdAt: Date.now()
    };

    setItems(prev => sortItems([newItem, ...prev]));
    setTitle("");
    addEvent('task_created', { title: newItem.title });
  };

  const startEdit = (item: ToDoItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
  };

  const saveEdit = () => {
    if (!editingId || !editTitle.trim()) return;

    setItems(prev => {
      const updated = prev.map(item => item.id === editingId ? {
        ...item,
        title: editTitle.trim()
      } : item);
      return sortItems(updated);
    });
    setEditingId(null);
    setEditTitle("");
  };

  const toggle = (id: string) => {
    setItems(prev => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, done: !item.done };
      });
      return sortItems(updated);
    });
  };

  const remove = (id: string) => {
    setItems(prev => prev.filter((item) => item.id !== id));
  };

  const startScheduling = (item: ToDoItem) => {
    setEditingId(null);
    setSchedulingId(item.id);
    setSchedTime("");
    setSchedDate(startOfDay(new Date()));
  };

  const moveToTasks = (item: ToDoItem) => {
    const dueDate = format(schedDate, 'yyyy-MM-dd');
    let remindAt: string | null = null;
    if (schedTime) {
      const [h, m] = schedTime.split(":").map(Number);
      const d = new Date(schedDate);
      d.setHours(h, m, 0, 0);
      remindAt = d.toISOString();
    }

    const id = generateId();
    const tasks = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
    tasks.unshift({ id, title: item.title, done: false, remindAt, dueDate, createdAt: Date.now() });
    saveJSON(STORAGE_KEYS.tasks, tasks);

    if (isNative() && remindAt) {
      scheduleNativeAt(hashId("task:" + id), item.title, t('reminder_title'), new Date(remindAt), calendarSync, id)
        .catch(e => console.error("Sync: schedule failed", e));
    }

    setItems(prev => prev.filter(x => x.id !== item.id));
    setSchedulingId(null);
    addEvent('task_created', { title: item.title, hasReminder: !!remindAt, date: dueDate, source: 'todo' });
    notify({ title: t('moved_to_tasks'), body: item.title, kind: "info" });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border bg-card/50 p-4 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('task_input_placeholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="flex-1 bg-transparent border-none text-base focus-visible:ring-0 px-0 h-auto"
          />
          <Button onClick={add} size="sm" aria-label={t('add_task')} className="size-8 rounded-full p-0 shadow-soft shrink-0">
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {items.length === 0 && (
            <motion.li
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground bg-card/10"
            >
              {t('tasks_empty')}
            </motion.li>
          )}
          {items.map((item) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-3 rounded-2xl border bg-card/40 border-border p-3 backdrop-blur"
            >
              {schedulingId === item.id ? (
                <div className="flex flex-col gap-3 w-full p-1">
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1.5 shrink-0">
                      <Input
                        type="time"
                        value={schedTime}
                        onChange={(e) => setSchedTime(e.target.value)}
                        className="w-[84px] font-mono h-7 text-[10px] rounded-full bg-secondary/50 border-none"
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="secondary" size="sm" className="h-7 rounded-full px-2 text-[9px] font-bold gap-1">
                            <CalendarIcon className="size-2.5" />
                            {isSameDay(schedDate, new Date()) ? t('today') : format(schedDate, shortDateFormat, { locale: dateLocale })}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-3xl" align="start" side="top" sideOffset={12} collisionPadding={16}>
                          <Calendar
                            mode="single"
                            selected={schedDate}
                            onSelect={(d) => d && setSchedDate(startOfDay(d))}
                            initialFocus
                            weekStartsOn={1}
                            locale={dateLocale}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex gap-1 ml-auto shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => setSchedulingId(null)} className="h-7 px-1.5 text-[10px]">
                        <X className="size-3 mr-1" /> {t('cancel')}
                      </Button>
                      <Button size="sm" onClick={() => moveToTasks(item)} className="h-7 px-2.5 text-[10px] shadow-sm">
                        <ListTodo className="size-3 mr-1" /> {t('move_to_tasks')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : editingId === item.id ? (
                <div className="flex items-center gap-2 w-full">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="flex-1 h-9 bg-transparent border-none px-0 text-sm focus-visible:ring-0"
                    autoFocus
                  />
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-8 w-8 p-0">
                      <X className="size-4" />
                    </Button>
                    <Button size="sm" onClick={saveEdit} className="h-8 w-8 p-0">
                      <Save className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => toggle(item.id)}
                    aria-label={item.title}
                    aria-pressed={item.done}
                    className={`grid size-6 shrink-0 place-items-center rounded-full border transition ${
                      item.done
                        ? "border-mint bg-mint text-mint-foreground"
                        : "border-border hover:border-primary"
                    }`}
                  >
                    {item.done && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${item.done ? "text-muted-foreground line-through" : ""}`}>
                      {item.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => startScheduling(item)}
                      aria-label={t('move_to_tasks')}
                      title={t('move_to_tasks')}
                      className="size-8 rounded-lg bg-violet-500/5 border-violet-500/10 text-violet-500 hover:bg-violet-500/10"
                    >
                      <ListTodo className="size-4" />
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
                </>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
