import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Droplet, Pill, StretchHorizontal, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { dateKey, generateId } from "@/lib/utils";
import { isNative, scheduleNativeDaily, cancelNative, hashId, deleteFromCalendar } from "@/lib/native";
import { pushNudgeToGoogleCalendar, removeNudgeFromGoogleCalendar } from "@/lib/google";
import { useTranslation, useI18nStore, translations } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";

type Reminder = {
  id: string;
  label: string;
  times: string[]; // "HH:mm"
  enabled: boolean;
  lastFired: Record<string, string>; // time -> YYYY-MM-DD (local day)
  // Which quick-add preset this came from, if any. Language-independent, so
  // switching to Polish can't make an already-added preset look unused.
  presetId?: string;
};

const today = () => dateKey();
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function Reminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [customTimes, setCustomTimes] = useState<string[]>([""]);
  const { t } = useTranslation();
  const { nudgeCalendarSync } = useI18nStore();
  const { addEvent } = useHistoryStore();

  const PRESETS = [
    { id: 'water', tKey: 'drink_water', label: t('drink_water'), icon: Droplet, times: ["09:00", "12:00", "15:00", "18:00"] },
    { id: 'meds', tKey: 'take_meds', label: t('take_meds'), icon: Pill, times: ["08:00"] },
    { id: 'stretch', tKey: 'stand_stretch', label: t('stand_stretch'), icon: StretchHorizontal, times: ["10:30", "14:30"] },
  ] as const;

  // A preset counts as added when its id matches, or — for nudges saved before
  // presetId existed — when the label matches its wording in ANY language.
  // Comparing against the current language only was the whole bug: after a
  // switch to Polish, "Drink water" stopped matching "Pij wodę" and the button
  // happily added a second copy firing at the same four times.
  const presetAdded = (p: (typeof PRESETS)[number]) =>
    items.some((i) => {
      if (i.presetId) return i.presetId === p.id;
      return Object.values(translations).some((dict) => dict[p.tKey] === i.label);
    });

  // Set when the next setItems comes from re-reading storage (see reload below)
  const skipNextSave = useRef(false);

  useEffect(() => {
    const load = () => setItems(loadJSON<Reminder[]>(STORAGE_KEYS.reminders, []));
    load();
    setLoaded(true);

    // A reload came from storage, not from the user, so don't push it straight
    // back out — see the same guard in TaskList.
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
    saveJSON(STORAGE_KEYS.reminders, items);
  }, [items, loaded]);

  const ref = useRef(items);
  ref.current = items;
  // The tick loop is mounted once, so it would otherwise keep firing nudges
  // with whatever language was active at mount.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const tick = () => {
      const hm = nowHM();
      const d = today();
      let changed = false;
      const next = ref.current.map((r) => {
        if (!r.enabled) return r;
        if (r.times.includes(hm) && r.lastFired[hm] !== d) {
          notify({ title: r.label, body: tRef.current('gentle_nudge_emoji'), kind: "reminder" });
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
    void pushNudgeToGoogleCalendar(r);
    if (!isNative()) return;
    r.times.forEach((t_val, idx) => {
      const [h, m] = t_val.split(":").map(Number);
      void scheduleNativeDaily(hashId(`rem:${r.id}:${idx}`), r.label, t('gentle_nudge_emoji'), h, m, nudgeCalendarSync, r.id);
    });
  };
  const cancelAll = (r: Reminder) => {
    void removeNudgeFromGoogleCalendar(r.id);
    if (!isNative()) return;
    void cancelNative(r.times.map((_, idx) => hashId(`rem:${r.id}:${idx}`)));
    void deleteFromCalendar(r.label);
  };

  const addPreset = (p: (typeof PRESETS)[number]) => {
    if (presetAdded(p)) return;
    const r: Reminder = {
      id: generateId(),
      label: p.label,
      times: [...p.times],
      enabled: true,
      lastFired: {},
      presetId: p.id,
    };
    scheduleAll(r);
    addEvent('nudge_created', { label: p.label, preset: true });
    setItems([...items, r]);
  };

  const addCustomTime = () => setCustomTimes([...customTimes, ""]);
  const removeCustomTime = (index: number) => {
    if (customTimes.length > 1) {
      setCustomTimes(customTimes.filter((_, i) => i !== index));
    }
  };
  const updateCustomTime = (index: number, value: string) => {
    const next = [...customTimes];
    next[index] = value;
    setCustomTimes(next);
  };

  const addCustom = () => {
    // De-duplicate: two identical times mean two notification ids on the same
    // minute (and two calendar events), with one lastFired slot between them.
    const validTimes = [...new Set(customTimes.filter(t => !!t))].sort();
    if (!label.trim() || validTimes.length === 0) return;
    const r: Reminder = {
      id: generateId(),
      label: label.trim(),
      times: validTimes,
      enabled: true,
      lastFired: {},
    };
    scheduleAll(r);
    addEvent('nudge_created', { label: label.trim(), preset: false });
    setItems([...items, r]);
    setLabel("");
    setCustomTimes([""]);
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
    if (r) {
      cancelAll(r);
      addEvent('nudge_deleted', { label: r.label });
    }
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
            const added = presetAdded(p);
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
            name="nudge-label"
            autoComplete="off"
            placeholder={t('nudge_placeholder')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1"
          />

          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {customTimes.map((time, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex gap-2 items-center"
                >
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => updateCustomTime(index, e.target.value)}
                    className="w-32 font-mono"
                  />
                  {customTimes.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeCustomTime(index)}
                      className="size-8"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                  {index === customTimes.length - 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addCustomTime}
                      className="h-9 px-3 rounded-md"
                    >
                      <Plus className="size-4 mr-1" /> {t('add_time')}
                    </Button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <Button onClick={addCustom} className="w-full sm:w-auto self-end">
            {t('add_nudge')}
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t('your_daily_nudges')}
        </h3>
        <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3 2xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {items.length === 0 && (
              <li className="flex items-center justify-center gap-2 rounded-2xl border border-dashed py-8 text-sm text-muted-foreground lg:col-span-2 2xl:col-span-3">
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
                    {r.times.map((t) => (
                      <span key={t} className="rounded-md bg-secondary px-1.5 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <Switch checked={r.enabled} onCheckedChange={() => toggle(r.id)} />
                <Button size="icon" variant="ghost" onClick={() => remove(r.id)} aria-label={t('delete')}>
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
