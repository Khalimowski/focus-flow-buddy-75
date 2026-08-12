import { forwardRef, useEffect, useRef, useState } from "react";
import { Clock, Keyboard, LayoutGrid, Minus, Moon, Plus, Sun, Sunrise, Sunset } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Time picker in FlowDay's own style.
 *
 * `<input type="time">` hands the phone's WebView its stock Material clock
 * dial — a grey analog face that ignores the app's theme and is fiddly to hit
 * on a small screen. This replaces it with a tap-only sheet: 24 hour chips
 * grouped by part of day, minutes in 5-minute steps with a ±1 fine adjust,
 * and shortcuts for the times people actually pick ("now", "+1 h").
 *
 * The keyboard button turns the readout into two number fields for anyone who
 * would rather just type it, same as the stock dialog's keyboard mode.
 *
 * Values are "HH:mm" strings, same as the inputs it replaces, and "" means
 * "no time set" wherever the caller allows it (`clearable`).
 */

const pad = (n: number) => String(n).padStart(2, "0");

const HOUR_ROWS = [
  { icon: Moon, hours: [0, 1, 2, 3, 4, 5] },
  { icon: Sunrise, hours: [6, 7, 8, 9, 10, 11] },
  { icon: Sun, hours: [12, 13, 14, 15, 16, 17] },
  { icon: Sunset, hours: [18, 19, 20, 21, 22, 23] },
];

const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5);

type Clock24 = { h: number; m: number };

function parseTime(value: string): Clock24 | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** Now, rounded up to the next 5 minutes — what an empty picker opens on. */
function roundedNow(): Clock24 {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return { h: d.getHours(), m: d.getMinutes() };
}

function shift({ h, m }: Clock24, minutes: number): Clock24 {
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return { h: Math.floor(total / 60), m: total % 60 };
}

type Props = {
  /** "HH:mm", or "" for no time. */
  value: string;
  onChange: (value: string) => void;
  /** Offer a "clear" button and allow committing an empty value. */
  clearable?: boolean;
  /** Trigger label while no time is set. Defaults to "Add time". */
  placeholder?: string;
  size?: "sm" | "md";
  /** Extra classes for the trigger button. */
  className?: string;
  id?: string;
  "aria-label"?: string;
};

export function TimePicker({
  value,
  onChange,
  clearable = false,
  placeholder,
  size = "md",
  className,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Clock24>(() => parseTime(value) ?? roundedNow());
  const [unit, setUnit] = useState<"hour" | "minute">("hour");
  // Keyboard mode: the readout becomes two number fields. Their text is held
  // separately from `draft` so a half-typed or momentarily empty field doesn't
  // have to be a valid time.
  const [typing, setTyping] = useState(false);
  const [hourText, setHourText] = useState("");
  const [minuteText, setMinuteText] = useState("");
  const minuteRef = useRef<HTMLInputElement>(null);

  // Every opening starts from whatever the field holds now (an empty field
  // opens on the next round five minutes), so a cancelled edit leaves nothing
  // behind.
  useEffect(() => {
    if (!open) return;
    setDraft(parseTime(value) ?? roundedNow());
    setUnit("hour");
    setTyping(false);
  }, [open, value]);

  const startTyping = () => {
    setHourText(pad(draft.h));
    setMinuteText(pad(draft.m));
    setTyping(true);
  };

  const editHourText = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    if (!digits) {
      setHourText("");
      return;
    }
    const h = Math.min(23, Number(digits));
    // Show the clamp, so the field never disagrees with the time it sets
    setHourText(h === Number(digits) ? digits : pad(h));
    setDraft((d) => ({ ...d, h }));
    // Two digits, or a first digit no hour can start with, means the hour is
    // finished — move to the minutes like the phone's own picker does.
    if (digits.length === 2 || Number(digits) > 2) {
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  const editMinuteText = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    if (!digits) {
      setMinuteText("");
      return;
    }
    const m = Math.min(59, Number(digits));
    setMinuteText(m === Number(digits) ? digits : pad(m));
    setDraft((d) => ({ ...d, m }));
  };

  // Leaving a field zero-pads what's in it; a field left empty falls back to
  // the draft. Read `prev` rather than the draft, which the auto-advance blur
  // races: that blur fires in the same tick as the setDraft that caused it.
  const padHourText = () => setHourText((prev) => (prev ? pad(Number(prev)) : pad(draft.h)));
  const padMinuteText = () => setMinuteText((prev) => (prev ? pad(Number(prev)) : pad(draft.m)));

  const commit = (next: Clock24) => {
    onChange(`${pad(next.h)}:${pad(next.m)}`);
    setOpen(false);
  };

  const clear = () => {
    onChange("");
    setOpen(false);
  };

  const label = parseTime(value) ? value : (placeholder ?? t("add_time"));

  return (
    <>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel ?? t("time_picker_title")}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-secondary/50 font-mono font-medium cursor-pointer transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          size === "sm" ? "h-7 px-2.5 text-[10px]" : "h-8 px-3 text-xs",
          !parseTime(value) && "text-muted-foreground font-sans",
          className,
        )}
      >
        <Clock className={cn("shrink-0 text-primary", size === "sm" ? "size-2.5" : "size-3")} />
        {label}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm gap-3 rounded-3xl p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-primary" />
              {t("time_picker_title")}
            </DialogTitle>
          </DialogHeader>

          {/* Readout: the hour/minute switch, or the two fields to type into */}
          <div className="flex items-center justify-center gap-1 rounded-2xl bg-secondary/40 p-2">
            {typing ? (
              <>
                <TimeField
                  value={hourText}
                  onChange={editHourText}
                  onBlur={padHourText}
                  onEnter={() => commit(draft)}
                  label={t("time_hours")}
                  autoFocus
                />
                <span className="font-mono text-3xl font-bold text-muted-foreground">:</span>
                <TimeField
                  ref={minuteRef}
                  value={minuteText}
                  onChange={editMinuteText}
                  onBlur={padMinuteText}
                  onEnter={() => commit(draft)}
                  label={t("time_minutes")}
                />
              </>
            ) : (
              <>
                <UnitButton active={unit === "hour"} onClick={() => setUnit("hour")}>
                  {pad(draft.h)}
                </UnitButton>
                <span className="font-mono text-3xl font-bold text-muted-foreground">:</span>
                <UnitButton active={unit === "minute"} onClick={() => setUnit("minute")}>
                  {pad(draft.m)}
                </UnitButton>
              </>
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-1.5">
            <QuickChip onClick={() => setDraft(roundedNow())}>{t("time_now")}</QuickChip>
            <QuickChip onClick={() => setDraft((d) => shift(d, 30))}>
              {t("time_plus_30m")}
            </QuickChip>
            <QuickChip onClick={() => setDraft((d) => shift(d, 60))}>{t("time_plus_1h")}</QuickChip>
          </div>

          {/* The grid would sit under the soft keyboard anyway, so typing mode
              drops it and keeps the dialog short. Fixed height otherwise, so
              switching hour/minute doesn't resize it under the finger that
              just tapped. */}
          {typing ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              {t("time_type_hint")}
            </p>
          ) : (
            <div className="flex min-h-[11.5rem] items-center">
              {unit === "hour" ? (
                <div className="flex w-full flex-col gap-1.5">
                  {HOUR_ROWS.map(({ icon: Icon, hours }) => (
                    <div key={hours[0]} className="flex items-center gap-1.5">
                      <Icon className="size-3 shrink-0 text-muted-foreground" />
                      {hours.map((h) => (
                        <NumberChip
                          key={h}
                          selected={draft.h === h}
                          // Picking an hour moves straight on to minutes, so a
                          // full time is two taps.
                          onClick={() => {
                            setDraft((d) => ({ ...d, h }));
                            setUnit("minute");
                          }}
                        >
                          {pad(h)}
                        </NumberChip>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex w-full flex-col gap-1.5">
                  {[MINUTE_STEPS.slice(0, 6), MINUTE_STEPS.slice(6)].map((row) => (
                    <div key={row[0]} className="flex items-center gap-1.5">
                      {row.map((m) => (
                        <NumberChip
                          key={m}
                          selected={draft.m === m}
                          onClick={() => setDraft((d) => ({ ...d, m }))}
                        >
                          {pad(m)}
                        </NumberChip>
                      ))}
                    </div>
                  ))}
                  {/* Anything off the five-minute grid gets set here */}
                  <div className="mt-1 flex items-center justify-center gap-2 rounded-2xl bg-secondary/30 p-1.5">
                    <StepButton
                      label={t("time_minute_down")}
                      onClick={() => setDraft((d) => ({ ...d, m: (d.m + 59) % 60 }))}
                    >
                      <Minus className="size-3.5" />
                    </StepButton>
                    <span className="min-w-14 text-center font-mono text-sm font-bold">
                      {pad(draft.m)} {t("time_minutes_short")}
                    </span>
                    <StepButton
                      label={t("time_minute_up")}
                      onClick={() => setDraft((d) => ({ ...d, m: (d.m + 1) % 60 }))}
                    >
                      <Plus className="size-3.5" />
                    </StepButton>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              aria-label={typing ? t("time_grid_mode") : t("time_keyboard_mode")}
              onClick={() => (typing ? setTyping(false) : startTyping())}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer hover:bg-secondary/60 hover:text-foreground"
            >
              {typing ? <LayoutGrid className="size-4" /> : <Keyboard className="size-4" />}
            </button>
            {clearable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                className="h-9 rounded-full px-3 text-xs text-muted-foreground"
              >
                {t("time_clear")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="ml-auto h-9 rounded-full px-3 text-xs"
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => commit(draft)}
              className="h-9 rounded-full px-5 text-xs font-bold shadow-soft"
            >
              {t("time_set")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UnitButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl px-3 py-1 font-mono text-4xl font-bold leading-none transition-colors cursor-pointer",
        active
          ? "bg-primary/15 text-primary"
          : "text-foreground/60 hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** One half of the readout in keyboard mode, styled to match UnitButton. */
const TimeField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    onEnter: () => void;
    label: string;
    autoFocus?: boolean;
  }
>(({ value, onChange, onBlur, onEnter, label, autoFocus }, ref) => (
  <input
    ref={ref}
    type="text"
    // Numeric keypad without the spinner and validation baggage of type=number
    inputMode="numeric"
    pattern="[0-9]*"
    maxLength={2}
    aria-label={label}
    autoFocus={autoFocus}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onFocus={(e) => e.target.select()}
    onBlur={onBlur}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onEnter();
      }
    }}
    className="w-[2.1em] rounded-xl bg-primary/15 py-1 text-center font-mono text-4xl font-bold leading-none text-primary outline-none focus:ring-2 focus:ring-ring"
  />
));
TimeField.displayName = "TimeField";

function QuickChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-card/60 px-3 py-1 text-[10px] font-bold text-muted-foreground transition-colors cursor-pointer hover:bg-card hover:text-foreground"
    >
      {children}
    </button>
  );
}

function NumberChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "h-9 flex-1 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer",
        selected
          ? "bg-primary text-primary-foreground shadow-soft"
          : "bg-secondary/40 text-foreground/80 hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full bg-secondary/60 text-foreground transition-colors cursor-pointer hover:bg-secondary"
    >
      {children}
    </button>
  );
}
