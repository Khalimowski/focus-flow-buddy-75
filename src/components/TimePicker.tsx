import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Clock, Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Time picker in FlowDay's own style.
 *
 * `<input type="time">` hands the phone's WebView its stock Material clock
 * dial — a grey analog face that ignores the app's theme. This keeps the
 * interaction people already know (drag a hand around a 24-hour dial, or tap
 * the keyboard button and type) and dresses it in the app's own colours, plus
 * shortcuts for the times people actually pick ("now", "+1 h").
 *
 * Values are "HH:mm" strings, same as the inputs it replaces, and "" means
 * "no time set" wherever the caller allows it (`clearable`).
 */

const pad = (n: number) => String(n).padStart(2, "0");

// Dial geometry, in SVG units. The face fills the viewport, so DIAL/2 is both
// the centre and the outer edge; CSS scales the whole thing to fit the dialog.
const DIAL = 240;
const C = DIAL / 2;
const R_OUTER = 100;
const R_INNER = 66;
const KNOB = 19;

/** Both rings are indexed by angle / 30°, clockwise from the top. */
const OUTER_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const INNER_HOURS = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const MINUTE_MARKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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

function polar(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) };
}

/** Where an hour sits: 1–12 on the outer ring, 13–23 and 00 on the inner one. */
function hourAt(h: number) {
  const outer = OUTER_HOURS.indexOf(h);
  if (outer >= 0) return { deg: outer * 30, r: R_OUTER };
  return { deg: INNER_HOURS.indexOf(h) * 30, r: R_INNER };
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

          {/* The dial would sit under the soft keyboard anyway, so typing mode
              drops it and keeps the dialog short. */}
          {typing ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              {t("time_type_hint")}
            </p>
          ) : (
            <Dial
              unit={unit}
              value={draft}
              onChange={setDraft}
              // Picking an hour moves straight on to minutes, so a full time
              // is two taps.
              onPicked={() => unit === "hour" && setUnit("minute")}
              label={unit === "hour" ? t("time_hours") : t("time_minutes")}
            />
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              aria-label={typing ? t("time_clock_mode") : t("time_keyboard_mode")}
              onClick={() => (typing ? setTyping(false) : startTyping())}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer hover:bg-secondary/60 hover:text-foreground"
            >
              {typing ? <Clock className="size-4" /> : <Keyboard className="size-4" />}
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

/**
 * The 24-hour clock face: 1–12 on the outer ring, 13–23 and 00 on the inner
 * one, minutes at every 5 with any minute reachable by dragging between them.
 */
function Dial({
  unit,
  value,
  onChange,
  onPicked,
  label,
}: {
  unit: "hour" | "minute";
  value: Clock24;
  onChange: (next: Clock24) => void;
  onPicked: () => void;
  label: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  // Screen point -> the hour or minute it points at. The rect is read every
  // time rather than cached: the dialog animates in, so its size and position
  // are not stable until well after mount.
  const applyPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((clientX - rect.left) / rect.width) * DIAL - C;
      const dy = ((clientY - rect.top) / rect.height) * DIAL - C;
      const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      if (unit === "minute") {
        onChange({ ...value, m: Math.round(deg / 6) % 60 });
        return;
      }
      const idx = Math.round(deg / 30) % 12;
      // Which ring the finger is nearer decides morning or evening.
      const ring = Math.hypot(dx, dy) < (R_OUTER + R_INNER) / 2 ? INNER_HOURS : OUTER_HOURS;
      onChange({ ...value, h: ring[idx] });
    },
    [onChange, unit, value],
  );

  const nudge = (delta: number) => {
    if (unit === "hour") onChange({ ...value, h: (value.h + delta + 24) % 24 });
    else onChange({ ...value, m: (value.m + delta + 60) % 60 });
  };

  const selected = unit === "hour" ? hourAt(value.h) : { deg: value.m * 6, r: R_OUTER };
  const tip = polar(selected.deg, selected.r);

  return (
    <div className="flex justify-center py-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${DIAL} ${DIAL}`}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={unit === "hour" ? 23 : 59}
        aria-valuenow={unit === "hour" ? value.h : value.m}
        aria-valuetext={`${pad(value.h)}:${pad(value.m)}`}
        tabIndex={0}
        // touch-none keeps a drag across the face from scrolling the dialog
        className="size-[15rem] max-w-full cursor-pointer touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          applyPoint(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) applyPoint(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
          onPicked();
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") nudge(1);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") nudge(-1);
          else return;
          e.preventDefault();
        }}
      >
        <circle cx={C} cy={C} r={C} fill="currentColor" className="text-secondary/40" />

        <line
          x1={C}
          y1={C}
          x2={tip.x}
          y2={tip.y}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="text-primary"
        />
        <circle cx={C} cy={C} r={3.5} fill="currentColor" className="text-primary" />
        <circle cx={tip.x} cy={tip.y} r={KNOB} fill="currentColor" className="text-primary" />
        {/* A minute off the five-minute marks lands between two labels, so the
            knob gets a pip to show it is pointing at something exact. */}
        {unit === "minute" && value.m % 5 !== 0 && (
          <circle
            cx={tip.x}
            cy={tip.y}
            r={2.5}
            fill="currentColor"
            className="text-primary-foreground"
          />
        )}

        {unit === "hour"
          ? [
              { hours: OUTER_HOURS, r: R_OUTER, size: 15, muted: false },
              { hours: INNER_HOURS, r: R_INNER, size: 12, muted: true },
            ].map(({ hours, r, size, muted }) =>
              hours.map((h, i) => {
                const p = polar(i * 30, r);
                const on = value.h === h;
                return (
                  <text
                    key={`${r}-${h}`}
                    x={p.x}
                    y={p.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={size}
                    fill="currentColor"
                    className={cn(
                      "font-mono",
                      on
                        ? "font-bold text-primary-foreground"
                        : muted
                          ? "text-muted-foreground"
                          : "text-foreground",
                    )}
                  >
                    {r === R_OUTER ? h : pad(h)}
                  </text>
                );
              }),
            )
          : MINUTE_MARKS.map((m, i) => {
              const p = polar(i * 30, R_OUTER);
              const on = value.m === m;
              return (
                <text
                  key={m}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={15}
                  fill="currentColor"
                  className={cn(
                    "font-mono",
                    on ? "font-bold text-primary-foreground" : "text-foreground",
                  )}
                >
                  {pad(m)}
                </text>
              );
            })}
      </svg>
    </div>
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
