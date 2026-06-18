import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Droplet, Pill, StretchHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { isNative, scheduleNativeDaily, cancelNative, hashId } from "@/lib/native";

type Reminder = {
  id: string;
  label: string;
  times: string[]; // "HH:mm"
  enabled: boolean;
  lastFired: Record<string, string>; // time -> YYYY-MM-DD
};

const PRESETS = [
  { label: "Drink water", icon: Droplet, times: ["09:00", "12:00", "15:00", "18:00"] },
  { label: "Take meds", icon: Pill, times: ["08:00"] },
  { label: "Stand & stretch", icon: StretchHorizontal, times: ["10:30", "14:30"] },
];

const today = () => new Date().toISOString().slice(0, 10);
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function Reminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("");

  useEffect(() => setItems(loadJSON<Reminder[]>(STORAGE_KEYS.reminders, [])), []);
  useEffect(() => saveJSON(STORAGE_KEYS.reminders, items), [items]);

  const ref = useRef(items);
  ref.current = items;
  useEffect(() => {
    const tick = () => {
      const hm = nowHM();
      const d = today();
      let changed = false;
      const next = ref.current.map((r) => {
        if (!r.enabled) return r;
        if (r.times.includes(hm) && r.lastFired[hm] !== d) {
          notify({ title: r.label, body: "Gentle nudge ✨", kind: "reminder" });
          changed = true;
          return { ...r, lastFired: { ...r.lastFired, [hm]: d } };
        }
        return r;
      });
      if (changed) setItems(next);
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, []);

  const scheduleAll = (r: Reminder) => {
    if (!isNative()) return;
    r.times.forEach((t, idx) => {
      const [h, m] = t.split(":").map(Number);
      void scheduleNativeDaily(hashId(`rem:${r.id}:${idx}`), r.label, "Gentle nudge ✨", h, m);
    });
  };
  const cancelAll = (r: Reminder) => {
    if (!isNative()) return;
    void cancelNative(r.times.map((_, idx) => hashId(`rem:${r.id}:${idx}`)));
  };

  const addPreset = (p: (typeof PRESETS)[number]) => {
    if (items.some((i) => i.label === p.label)) return;
    const r: Reminder = { id: crypto.randomUUID(), label: p.label, times: p.times, enabled: true, lastFired: {} };
    scheduleAll(r);
    setItems([...items, r]);
  };

  const addCustom = () => {
    if (!label.trim() || !time) return;
    const r: Reminder = { id: crypto.randomUUID(), label: label.trim(), times: [time], enabled: true, lastFired: {} };
    scheduleAll(r);
    setItems([...items, r]);
    setLabel("");
    setTime("");
  };

  const toggle = (id: string) =>
    setItems(
      items.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, enabled: !r.enabled };
        if (next.enabled) scheduleAll(next);
        else cancelAll(next);
        return next;
      }),
    );
  const remove = (id: string) => {
    const r = items.find((x) => x.id === id);
    if (r) cancelAll(r);
    setItems(items.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Quick add
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const Icon = p.icon;
            const added = items.some((i) => i.label === p.label);
            return (
              <button
                key={p.label}
                onClick={() => addPreset(p)}
                disabled={added}
                className="group flex items-center gap-3 rounded-2xl border bg-card/40 p-3 text-left transition hover:bg-card disabled:opacity-50"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="flex-1 text-sm">{p.label}</span>
                {!added && <Plus className="size-4 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Custom reminder
        </h3>
        <div className="flex flex-col gap-2 rounded-2xl border bg-card/50 p-4 sm:flex-row">
          <Input
            placeholder="What should I nudge you about?"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1"
          />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32 font-mono" />
          <Button onClick={addCustom}>
            <Plus className="size-4" />
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Your daily nudges
        </h3>
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {items.length === 0 && (
              <li className="flex items-center justify-center gap-2 rounded-2xl border border-dashed py-8 text-sm text-muted-foreground">
                <Sparkles className="size-4" /> Add a preset or your own.
              </li>
            )}
            {items.map((r) => (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-3 rounded-2xl border bg-card/40 p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{r.label}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1 font-mono text-[11px] text-muted-foreground">
                    {r.times.map((t) => (
                      <span key={t} className="rounded-md bg-secondary px-1.5 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <Switch checked={r.enabled} onCheckedChange={() => toggle(r.id)} />
                <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>
    </div>
  );
}
