import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, Clock, Edit2, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { isNative, scheduleNativeAt, cancelNative, hashId, deleteFromCalendar } from "@/lib/native";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null; // ISO
  notified?: boolean;
  createdAt: number;
};

const sortTasks = (list: Task[]) => {
  return [...list].sort((a, b) => {
    // 1. Uncompleted before completed
    if (a.done !== b.done) return a.done ? 1 : -1;

    // 2. Both have reminders -> sort by "Time of Day" (HH:mm)
    if (a.remindAt && b.remindAt) {
      const getHM = (iso: string) => {
        const d = new Date(iso);
        return d.getHours() * 60 + d.getMinutes();
      };
      const hmA = getHM(a.remindAt);
      const hmB = getHM(b.remindAt);

      if (hmA !== hmB) return hmA - hmB;
      // Identical times -> secondary sort by creation
      return a.createdAt - b.createdAt;
    }

    // 3. One has reminder -> reminder first
    if (a.remindAt) return -1;
    if (b.remindAt) return 1;

    // 4. Neither has reminder -> oldest first (grows downwards)
    return a.createdAt - b.createdAt;
  });
};

export function TaskList({ onComplete }: { onComplete?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const { t } = useTranslation();
  const { calendarSync } = useI18nStore();
  const { addEvent } = useHistoryStore();

  useEffect(() => {
    const data = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
    setTasks(sortTasks(data));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      saveJSON(STORAGE_KEYS.tasks, tasks);
    }
  }, [tasks, loaded]);

  // poll for due reminders
  const ref = useRef(tasks);
  ref.current = tasks;
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next = ref.current.map((task_item) => {
        if (!task_item.done && !task_item.notified && task_item.remindAt && new Date(task_item.remindAt).getTime() <= now) {
          notify({ title: t('reminder_title'), body: task_item.title, kind: "task" });
          changed = true;
          return { ...task_item, notified: true };
        }
        return task_item;
      });
      if (changed) setTasks(next);
    }, 15000);
    return () => clearInterval(id);
  }, [t]);

  const add = async () => {
    if (!title.trim()) return;
    let remindAt: string | null = null;
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      remindAt = d.toISOString();
    }
    const id = crypto.randomUUID();

    if (isNative() && remindAt) {
      // Sync cleanup
      await deleteFromCalendar(title.trim());
      void scheduleNativeAt(hashId("task:" + id), title.trim(), t('reminder_title'), new Date(remindAt), calendarSync);
    }

    addEvent('task_created', { title: title.trim(), hasReminder: !!remindAt });
    setTasks(prev => sortTasks([{ id, title: title.trim(), done: false, remindAt, createdAt: Date.now() }, ...prev]));
    setTitle("");
    setTime("");
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
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
    if (!editingId || !editTitle.trim()) return;

    let remindAt: string | null = null;
    if (editTime) {
      const [h, m] = editTime.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      remindAt = d.toISOString();
    }

    if (isNative()) {
      void cancelNative([hashId("task:" + editingId)]);

      const oldTask = tasks.find(item => item.id === editingId);
      if (oldTask) {
        await deleteFromCalendar(oldTask.title);
      }

      if (remindAt) {
        void scheduleNativeAt(hashId("task:" + editingId), editTitle.trim(), t('reminder_title'), new Date(remindAt), calendarSync);
      }
    }

    setTasks(prev => {
      const updated = prev.map(item => item.id === editingId ? { ...item, title: editTitle.trim(), remindAt, notified: false } : item);
      addEvent('task_edited', { id: editingId, newTitle: editTitle.trim() });
      return sortTasks(updated);
    });
    cancelEdit();
  };

  const toggle = (id: string) => {
    setTasks(prev => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item;
        const becoming = !item.done;
        if (becoming) {
          onComplete?.();
          addEvent('task_completed', { title: item.title });
        }
        return { ...item, done: becoming };
      });
      return sortTasks(updated);
    });
  };

  const remove = async (id: string) => {
    if (isNative()) {
      void cancelNative([hashId("task:" + id)]);
      const task = tasks.find(item => item.id === id);
      if (task) {
        await deleteFromCalendar(task.title);
        addEvent('task_deleted', { title: task.title });
      }
    }
    setTasks(prev => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border bg-card/50 p-4 backdrop-blur shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder={t('task_input_placeholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-32 font-mono"
            />
            <Button onClick={add} className="shrink-0 bg-primary hover:bg-primary/90">
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {tasks.length === 0 && (
            <motion.li
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground"
            >
              {t('tasks_empty')}
            </motion.li>
          )}
          {tasks.map((task) => (
            <motion.li
              key={task.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-3 rounded-2xl border bg-card/40 p-3 backdrop-blur"
            >
              {editingId === task.id ? (
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex gap-2">
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 h-9"
                      autoFocus
                    />
                    <Input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-24 font-mono h-9"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8">
                      <X className="size-3.5 mr-1" /> {t('cancel')}
                    </Button>
                    <Button size="sm" onClick={saveEdit} className="h-8">
                      <Save className="size-3.5 mr-1" /> {t('save')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => toggle(task.id)}
                    aria-label="toggle"
                    className={`grid size-6 shrink-0 place-items-center rounded-full border transition ${
                      task.done
                        ? "border-mint bg-mint text-mint-foreground"
                        : "border-border hover:border-primary"
                    }`}
                  >
                    {task.done && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-medium ${task.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {task.title}
                    </div>
                    {task.remindAt && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                        <Clock className="size-3" />
                        {new Date(task.remindAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => startEdit(task)}
                      className="size-8 rounded-lg bg-blue-500/5 border-blue-500/10 text-blue-500 hover:bg-blue-500/10"
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => remove(task.id)}
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
