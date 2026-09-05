import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cake,
  Calendar as CalendarIcon,
  CalendarSync,
  Check,
  Edit2,
  PawPrint,
  Plus,
  Stethoscope,
  Syringe,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { format, type Locale } from "date-fns";
import { pl } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { TimePicker } from "@/components/TimePicker";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";
import { cn, dateKey, generateId } from "@/lib/utils";
import { useTranslation, type Language } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";
import { cancelNative, hashId, isNative, scheduleNativeCycle } from "@/lib/native";
import {
  INTERVAL_UNITS,
  MAX_EVERY,
  completeEvent,
  cycleProgress,
  daysLeft,
  normalizeEvents,
  notifKey,
  occurrenceAt,
  occurrenceDay,
  parseDayKey,
  sanitizeEvery,
  sortEvents,
  type IntervalUnit,
  type RecurrenceMode,
  type RecurringEvent,
} from "@/lib/recurring";

/**
 * The Cycles tab: everything that comes round on its own interval rather than
 * inside a week — a flea-and-tick dose every five weeks, a rabies booster every
 * year, a birthday. Each row carries its next date and the days left until it.
 *
 * The date arithmetic and the two recurrence modes live in lib/recurring.ts;
 * this file is the screen.
 */

/** The translator, with its keys still typed against the `en` dictionary. */
type T = ReturnType<typeof useTranslation>["t"];
type TKey = Parameters<T>[0];

type Draft = {
  label: string;
  date: Date;
  /** Kept as text so the field can be emptied while it's being retyped. */
  every: string;
  unit: IntervalUnit;
  time: string;
  mode: RecurrenceMode;
  presetId?: string;
};

const DEFAULT_TIME = "09:00";

type Preset = {
  id: string;
  /** Language-independent, so a preset row keeps its icon after a switch. */
  tKey: TKey;
  icon: LucideIcon;
  every: number;
  unit: IntervalUnit;
  mode: RecurrenceMode;
};

/**
 * Quick-add presets. Unlike the habit presets these only *fill the form* —
 * a vaccination or a birthday needs a date and usually a name before it means
 * anything, so adding one blind would be a row nobody wants.
 */
const PRESETS: Preset[] = [
  {
    id: "pet_dose",
    tKey: "cycle_preset_pet_dose",
    icon: PawPrint,
    every: 5,
    unit: "week",
    mode: "completion",
  },
  {
    id: "vaccine",
    tKey: "cycle_preset_vaccine",
    icon: Syringe,
    every: 1,
    unit: "year",
    mode: "completion",
  },
  {
    id: "birthday",
    tKey: "cycle_preset_birthday",
    icon: Cake,
    every: 1,
    unit: "year",
    mode: "schedule",
  },
  {
    id: "dentist",
    tKey: "cycle_preset_dentist",
    icon: Stethoscope,
    every: 6,
    unit: "month",
    mode: "completion",
  },
];

const iconFor = (presetId?: string): LucideIcon =>
  PRESETS.find((p) => p.id === presetId)?.icon ?? CalendarSync;

const emptyDraft = (): Draft => ({
  label: "",
  date: new Date(),
  every: "1",
  unit: "month",
  time: DEFAULT_TIME,
  mode: "completion",
});

const draftOf = (ev: RecurringEvent): Draft => ({
  label: ev.label,
  date: parseDayKey(occurrenceDay(ev)),
  every: String(ev.every),
  unit: ev.unit,
  time: ev.time,
  mode: ev.mode,
  presetId: ev.presetId,
});

/** "Fri, 10 Oct" — with the year only when it isn't this one. */
function formatDay(day: string, locale?: Locale): string {
  const at = parseDayKey(day);
  const pattern = at.getFullYear() === new Date().getFullYear() ? "EEE, d MMM" : "d MMM yyyy";
  return format(at, pattern, { locale });
}

/**
 * The unit in the form the count needs. English splits at one; Polish also has
 * the paucal (2–4, but not 12–14) — "co 2 tygodnie" against "co 5 tygodni" —
 * so all three forms are in the dictionary and the count picks one.
 */
function unitName(t: T, language: Language, unit: IntervalUnit, count: number): string {
  let form: "one" | "few" | "many" = "many";
  if (count === 1) form = "one";
  else if (language !== "pl") form = "few";
  else if (count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)) {
    form = "few";
  }
  return t(`cycle_unit_${unit}_${form}` as TKey);
}

/** "Every 5 weeks", "Every year". */
function intervalText(t: T, language: Language, every: number, unit: IntervalUnit): string {
  return every === 1
    ? t("cycle_every_one").replace("{unit}", unitName(t, language, unit, 1))
    : t("cycle_every_n")
        .replace("{n}", String(every))
        .replace("{unit}", unitName(t, language, unit, every));
}

export function RecurringEvents() {
  const [items, setItems] = useState<RecurringEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // Bumped when a preset fills the form, so it remounts on the new values.
  const [draftKey, setDraftKey] = useState(0);
  // Re-read on every tick, so a countdown left open overnight rolls over.
  const [today, setToday] = useState(() => dateKey());

  const { t, language } = useTranslation();
  const dateLocale = language === "pl" ? pl : undefined;
  const { addEvent } = useHistoryStore();

  // Set when the next setItems comes from re-reading storage (see reload below)
  const skipNextSave = useRef(false);

  useEffect(() => {
    const load = () => setItems(normalizeEvents(loadJSON<unknown>(STORAGE_KEYS.recurring, [])));
    load();
    setLoaded(true);

    // A reload came from storage, not from the user, so don't push it straight
    // back out — see the same guard in TaskList.
    const reload = () => {
      skipNextSave.current = true;
      load();
    };
    window.addEventListener("ff.data_updated", reload);
    window.addEventListener("ff.remote-update", reload);
    return () => {
      window.removeEventListener("ff.data_updated", reload);
      window.removeEventListener("ff.remote-update", reload);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveJSON(STORAGE_KEYS.recurring, items);
  }, [items, loaded]);

  const ref = useRef(items);
  ref.current = items;
  // The tick loop is mounted once, so it would otherwise keep firing with
  // whatever language was active at mount.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const tick = () => {
      const day = dateKey();
      setToday((prev) => (prev === day ? prev : day));
      const now = Date.now();
      let changed = false;
      const next = ref.current.map((ev) => {
        if (!ev.enabled) return ev;
        const due = occurrenceDay(ev, day);
        // Only what's due *today*: an occurrence that came and went while the
        // app was closed has had its native notification already, and the row
        // reads "overdue" for as long as it stays untouched.
        if (due !== day || ev.notifiedFor === due) return ev;
        if (occurrenceAt(ev, day).getTime() > now) return ev;
        notify({
          title: ev.label,
          body: tRef.current("cycle_notification_body"),
          kind: "reminder",
        });
        changed = true;
        return { ...ev, notifiedFor: due };
      });
      if (changed) setItems(next);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // --- Native notifications -------------------------------------------------
  // One per event, at its next occurrence. The id is derived from that
  // occurrence (see notifKey), so an event that moves is disarmed with its old
  // values before the new ones are armed.

  const arm = (ev: RecurringEvent) => {
    if (!isNative() || !ev.enabled) return;
    const at = occurrenceAt(ev);
    if (at.getTime() <= Date.now()) return;
    void scheduleNativeCycle(
      hashId(notifKey(ev)),
      ev.label,
      t("cycle_notification_body"),
      at,
      ev.id,
    );
  };

  const disarm = (ev: RecurringEvent) => {
    if (!isNative()) return;
    void cancelNative([hashId(notifKey(ev))]);
  };

  const replace = (previous: RecurringEvent, next: RecurringEvent) => {
    // Scheduling an id again replaces what's pending under it, so the old
    // notification only needs cancelling when the new one lands under a
    // different id — cancelling and re-scheduling the same id would be a race
    // between two calls that could arrive in either order.
    if (!next.enabled || notifKey(next) !== notifKey(previous)) disarm(previous);
    arm(next);
    setItems((list) => list.map((ev) => (ev.id === next.id ? next : ev)));
  };

  // --- Mutations ------------------------------------------------------------

  const applyPreset = (preset: Preset) => {
    setEditingId(null);
    setDraft({
      label: t(preset.tKey),
      date: new Date(),
      every: String(preset.every),
      unit: preset.unit,
      time: DEFAULT_TIME,
      mode: preset.mode,
      presetId: preset.id,
    });
    setDraftKey((k) => k + 1);
  };

  const add = (form: Draft) => {
    const label = form.label.trim();
    if (!label) return;
    const ev: RecurringEvent = {
      id: generateId(),
      label,
      anchor: dateKey(form.date),
      every: sanitizeEvery(Number(form.every)),
      unit: form.unit,
      time: form.time || DEFAULT_TIME,
      mode: form.mode,
      enabled: true,
      createdAt: Date.now(),
      ...(form.presetId ? { presetId: form.presetId } : {}),
    };
    arm(ev);
    addEvent("cycle_created", {
      label,
      every: ev.every,
      unit: ev.unit,
      preset: ev.presetId ?? null,
    });
    setItems((list) => [...list, ev]);
    setDraft(emptyDraft());
    setDraftKey((k) => k + 1);
  };

  const saveEdit = (form: Draft) => {
    const previous = items.find((ev) => ev.id === editingId);
    if (!previous) return;
    const label = form.label.trim();
    if (!label) return;
    const { lastDone: _wasDone, notifiedFor: _wasNotified, ...kept } = previous;
    replace(previous, {
      ...kept,
      label,
      // The date was just set by hand, so nothing has been ticked off against
      // it and no reminder has gone out for it either.
      anchor: dateKey(form.date),
      every: sanitizeEvery(Number(form.every)),
      unit: form.unit,
      time: form.time || DEFAULT_TIME,
      mode: form.mode,
    });
    setEditingId(null);
  };

  const markDone = (ev: RecurringEvent) => {
    const next = completeEvent(ev, today);
    replace(ev, next);
    addEvent("cycle_completed", { label: ev.label });
    notify({
      title: ev.label,
      body: t("cycle_done_toast").replace(
        "{date}",
        formatDay(occurrenceDay(next, today), dateLocale),
      ),
      kind: "info",
    });
  };

  const toggle = (ev: RecurringEvent) => {
    const next = { ...ev, enabled: !ev.enabled };
    if (next.enabled) arm(next);
    else disarm(next);
    setItems((list) => list.map((item) => (item.id === ev.id ? next : item)));
  };

  const remove = (ev: RecurringEvent) => {
    disarm(ev);
    addEvent("cycle_deleted", { label: ev.label });
    if (editingId === ev.id) setEditingId(null);
    setItems((list) => list.filter((item) => item.id !== ev.id));
  };

  const sorted = useMemo(() => sortEvents(items, today), [items, today]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t("quick_add")}
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/30 hover:bg-secondary"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t(preset.tKey)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {intervalText(t, language, preset.every, preset.unit)}
                  </span>
                </span>
                <Plus className="size-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t("cycle_add_title")}
        </h3>
        <CycleForm
          key={`add-${draftKey}`}
          initial={draft}
          submitLabel={t("cycle_add")}
          onSubmit={add}
        />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t("cycles_title")}
          </h3>
          <span className="text-[11px] text-muted-foreground">{t("cycles_desc")}</span>
        </div>
        <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3 2xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {sorted.length === 0 && (
              <li className="flex items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground lg:col-span-2 2xl:col-span-3">
                <CalendarSync className="size-4 shrink-0" /> {t("cycles_empty")}
              </li>
            )}
            {sorted.map((ev) => {
              if (editingId === ev.id) {
                return (
                  <motion.li key={ev.id} layout className="lg:col-span-2 2xl:col-span-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {t("cycle_edit_title")}
                    </div>
                    <CycleForm
                      initial={draftOf(ev)}
                      submitLabel={t("save")}
                      onSubmit={saveEdit}
                      onCancel={() => setEditingId(null)}
                    />
                  </motion.li>
                );
              }

              const left = daysLeft(ev, today);
              const overdue = left < 0;
              const Icon = iconFor(ev.presetId);

              return (
                <motion.li
                  key={ev.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border bg-card p-3",
                    !ev.enabled && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm">{ev.label}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {intervalText(t, language, ev.every, ev.unit)}
                        {!ev.enabled && ` · ${t("cycle_paused")}`}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {t("cycle_next_label")}:{" "}
                        <span className="text-foreground">
                          {formatDay(occurrenceDay(ev, today), dateLocale)}
                        </span>{" "}
                        <span className="font-mono">{ev.time}</span>
                      </div>
                    </div>
                    <Countdown left={left} />
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        overdue ? "bg-destructive" : "bg-primary",
                      )}
                      style={{
                        width: `${Math.round((overdue ? 1 : cycleProgress(ev, today)) * 100)}%`,
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => markDone(ev)}
                      className="h-8 rounded-lg px-3 text-xs"
                    >
                      <Check className="mr-1 size-3.5" /> {t("cycle_mark_done")}
                    </Button>
                    <div className="ml-auto flex items-center gap-2">
                      <Switch
                        checked={ev.enabled}
                        onCheckedChange={() => toggle(ev)}
                        aria-label={ev.label}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => setEditingId(ev.id)}
                        aria-label={t("edit")}
                        className="size-8 rounded-lg border-border bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Edit2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => remove(ev)}
                        aria-label={t("delete")}
                        className="size-8 rounded-lg border-border bg-transparent text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </section>
    </div>
  );
}

/** The days-left badge: a number and what it counts, or "due today". */
function Countdown({ left }: { left: number }) {
  const { t } = useTranslation();
  const unitLabel =
    left >= 0
      ? left === 1
        ? t("cycle_days_left_one")
        : t("cycle_days_left_other")
      : left === -1
        ? t("cycle_days_over_one")
        : t("cycle_days_over_other");

  return (
    <div
      className={cn(
        "flex min-w-[74px] shrink-0 flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-center",
        left < 0
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : left === 0
            ? "border-mint/50 bg-mint/15 text-foreground"
            : "border-border bg-secondary/60",
      )}
    >
      {left === 0 ? (
        <span className="text-xs font-medium leading-tight">{t("cycle_due_today")}</span>
      ) : (
        <>
          <span className="font-mono text-lg font-semibold leading-none">{Math.abs(left)}</span>
          <span
            className={cn(
              "mt-0.5 text-[10px] leading-tight",
              left < 0 ? "opacity-80" : "text-muted-foreground",
            )}
          >
            {unitLabel}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Add and edit share one form. It keeps its own draft, so it is remounted (via
 * `key`) when a preset supplies new values — nothing else may reset it, or a
 * sync landing mid-sentence would wipe what's being typed.
 */
function CycleForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
}) {
  const { t, language } = useTranslation();
  const dateLocale = language === "pl" ? pl : undefined;
  const [form, setForm] = useState<Draft>(initial);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <Input
        name="cycle-label"
        autoComplete="off"
        placeholder={t("cycle_label_placeholder")}
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("cycle_next_date")}</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" className="h-9 gap-1.5 rounded-lg px-3 text-xs">
                <CalendarIcon className="size-3.5" />
                {format(form.date, "d MMM yyyy", { locale: dateLocale })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto rounded-3xl p-0" align="start" collisionPadding={16}>
              <Calendar
                mode="single"
                selected={form.date}
                onSelect={(picked) => picked && setForm({ ...form, date: picked })}
                initialFocus
                weekStartsOn={1}
                locale={dateLocale}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("cycle_remind_at")}</span>
          <TimePicker
            value={form.time}
            onChange={(next) => setForm({ ...form, time: next || DEFAULT_TIME })}
            className="h-9 w-24 justify-center text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("cycle_repeat_every")}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            name="cycle-every"
            type="number"
            min={1}
            max={MAX_EVERY}
            inputMode="numeric"
            value={form.every}
            onChange={(e) => setForm({ ...form, every: e.target.value })}
            onBlur={() => setForm((f) => ({ ...f, every: String(sanitizeEvery(Number(f.every))) }))}
            className="h-9 w-16 text-center"
          />
          {INTERVAL_UNITS.map((unit) => {
            const on = form.unit === unit;
            return (
              <button
                key={unit}
                type="button"
                aria-pressed={on}
                onClick={() => setForm({ ...form, unit })}
                className={cn(
                  "h-9 rounded-xl border px-3 text-xs transition",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-secondary",
                )}
              >
                {unitName(t, language, unit, 2)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("cycle_mode_title")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {(["completion", "schedule"] as const).map((mode) => {
            const on = form.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={on}
                onClick={() => setForm({ ...form, mode })}
                className={cn(
                  "h-9 rounded-xl border px-3 text-xs transition",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-secondary",
                )}
              >
                {mode === "completion" ? t("cycle_mode_completion") : t("cycle_mode_schedule")}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {form.mode === "completion"
            ? t("cycle_mode_completion_hint")
            : t("cycle_mode_schedule_hint")}
        </p>
      </div>

      <div className="flex items-center gap-2 self-end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="gap-1.5">
            <X className="size-4" /> {t("cancel")}
          </Button>
        )}
        <Button onClick={() => onSubmit(form)} disabled={!form.label.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
