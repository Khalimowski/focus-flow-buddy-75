import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Droplet, Pill, StretchHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { isNative, scheduleNativeDaily, cancelNative, hashId } from "@/lib/native";
import { useTranslation } from "@/lib/i18n";

type Reminder = {
  id: string;
  label: string;
  times: string[]; // "HH:mm"
  enabled: boolean;
  lastFired: Record<string, string>; // time -> YYYY-MM-DD
};

export function Reminders() {
  const { t } = useTranslation();

  const nowHM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const today = () => new Date().toISOString().split("T")[0];

  const PRESETS = [
    { label: t('drink_water'), icon: Droplet, times: ["09:00", "12:00", "15:00", "18:00"] },
    { label: t('take_meds'), icon: Pill, times: ["08:00"] },
    { label: t('stand_stretch'), icon: StretchHorizontal, times: ["10:30", "14:30"] },
  ];

  const [items, setItems] = useState<Reminder[]>([]);
  const [label, setLabel] = useState("");
  const [times, setTimes] = useState<string[]>([""]);

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
          notify({ title: r.label, body: t('gentle_nudge_emoji'), kind: "reminder" });
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
  }, [t]);

  const scheduleAll = (r: Reminder) => {
    if (!isNative()) return;
    r.times.forEach((t_str, idx) => {
      if (!t_str) return;
      const [h, m] = t_str.split(":").map(Number);
      void scheduleNativeDaily(hashId(`rem:${r.id}:${idx}`), r.label, t('gentle_nudge_emoji'), h, m);
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
    const validTimes = times.filter(Boolean);
    if (!label.trim() || validTimes.length === 0) return;
    const r: Reminder = { id: crypto.randomUUID(), label: label.trim(), times: validTimes, enabled: true, lastFired: {} };
    scheduleAll(r);
    setItems([...items, r]);
    setLabel("");
    setTimes([""]);
  };

  const updateTime = (idx: number, val: string) => {
    const next = [...times];
    next[idx] = val;
    setTimes(next);
  };

  const addTimeSlot = () => setTimes([...times, ""]);
  const removeTimeSlot = (idx: number) => {
    if (times.length === 1) return;
    setTimes(times.filter((_, i) => i !== idx));
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
          {t('quick_add')}
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
          {t('custom_reminder')}
        </h3>
        <div className="flex flex-col gap-3 rounded-2xl border bg-card/50 p-4">
          <Input
            placeholder={t('nudge_placeholder')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1"
          />
          <div className="flex flex-wrap gap-2">
            {times.map((t_val, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <Input
                  type="time"
                  value={t_val}
                  onChange={(e) => updateTime(idx, e.target.value)}
                  className="w-32 font-mono"
                />
                {times.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeTimeSlot(idx)}
                    className="size-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              size="outline"
              variant="secondary"
              onClick={addTimeSlot}
              className="h-10 px-3 border-dashed"
            >
              <Plus className="size-4 mr-1" />
              <span className="text-xs">{t('add_time')}</span>
            </Button>
          </div>
          <Button onClick={addCustom} className="w-full sm:w-auto self-end">
            <Plus className="size-4 mr-2" />
            {t('add_nudge')}
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t('your_daily_nudges')}
        </h3>
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {items.length === 0 && (
              <li className="flex items-center justify-center gap-2 rounded-2xl border border-dashed py-8 text-sm text-muted-foreground">
                <Sparkles className="size-4" /> {t('add_preset_or_own')}
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
                    {r.times.map((t_str) => (
                      <span key={t_str} className="rounded-md bg-secondary px-1.5 py-0.5">
                        {t_str}
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
