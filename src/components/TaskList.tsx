import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { isNative, scheduleNativeAt, cancelNative, hashId } from "@/lib/native";

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null; // ISO
  notified?: boolean;
  createdAt: number;
};

export function TaskList({ onComplete }: { onComplete?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");

  useEffect(() => setTasks(loadJSON<Task[]>(STORAGE_KEYS.tasks, [])), []);
  useEffect(() => saveJSON(STORAGE_KEYS.tasks, tasks), [tasks]);

  // poll for due reminders
  const ref = useRef(tasks);
  ref.current = tasks;
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next = ref.current.map((t) => {
        if (!t.done && !t.notified && t.remindAt && new Date(t.remindAt).getTime() <= now) {
          notify({ title: "Reminder", body: t.title, kind: "task" });
          changed = true;
          return { ...t, notified: true };
        }
        return t;
      });
      if (changed) setTasks(next);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const add = () => {
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
    if (remindAt && isNative()) {
      void scheduleNativeAt(hashId("task:" + id), "Reminder", title.trim(), new Date(remindAt));
    }
    setTasks([{ id, title: title.trim(), done: false, remindAt, createdAt: Date.now() }, ...tasks]);
    setTitle("");
    setTime("");
  };

  const toggle = (id: string) => {
    setTasks(
      tasks.map((t) => {
        if (t.id !== id) return t;
        const becoming = !t.done;
        if (becoming) onComplete?.();
        return { ...t, done: becoming };
      }),
    );
  };

  const remove = (id: string) => {
    if (isNative()) void cancelNative([hashId("task:" + id)]);
    setTasks(tasks.filter((t) => t.id !== id));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border bg-card/50 p-4 backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="What's one small thing?"
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
            <Button onClick={add} className="shrink-0">
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        {time && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" /> You'll be nudged at {time}
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {tasks.length === 0 && (
            <motion.li
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground"
            >
              Quiet for now. Add one tiny task above.
            </motion.li>
          )}
          {tasks.map((t) => (
            <motion.li
              key={t.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="group flex items-center gap-3 rounded-2xl border bg-card/40 p-3 backdrop-blur"
            >
              <button
                onClick={() => toggle(t.id)}
                aria-label="toggle"
                className={`grid size-6 shrink-0 place-items-center rounded-full border transition ${
                  t.done
                    ? "border-mint bg-mint text-mint-foreground"
                    : "border-border hover:border-primary"
                }`}
              >
                {t.done && <Check className="size-3.5" strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-0">
                <div
                  className={`truncate text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}
                >
                  {t.title}
                </div>
                {t.remindAt && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                    <Clock className="size-3" />
                    {new Date(t.remindAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(t.id)}
                className="opacity-0 transition group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
