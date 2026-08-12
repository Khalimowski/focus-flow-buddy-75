import { useEffect, useState } from "react";
import { Clock, Minus, Moon, Plus, Sun, Sunrise, Sunset } from "lucide-react";
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

  // Every opening starts from whatever the field holds now (an empty field
  // opens on the next round five minutes), so a cancelled edit leaves nothing
  // behind.
  useEffect(() => {
    if (!open) return;
    setDraft(parseTime(value) ?? roundedNow());
    setUnit("hour");
  }, [open, value]);

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

          {/* Readout doubles as the hour/minute switch */}
          <div className="flex items-center justify-center gap-1 rounded-2xl bg-secondary/40 p-2">
            <UnitButton active={unit === "hour"} onClick={() => setUnit("hour")}>
              {pad(draft.h)}
            </UnitButton>
            <span className="font-mono text-3xl font-bold text-muted-foreground">:</span>
            <UnitButton active={unit === "minute"} onClick={() => setUnit("minute")}>
              {pad(draft.m)}
            </UnitButton>
          </div>

          <div className="flex flex-wrap justify-center gap-1.5">
            <QuickChip onClick={() => setDraft(roundedNow())}>{t("time_now")}</QuickChip>
            <QuickChip onClick={() => setDraft((d) => shift(d, 30))}>
              {t("time_plus_30m")}
            </QuickChip>
            <QuickChip onClick={() => setDraft((d) => shift(d, 60))}>{t("time_plus_1h")}</QuickChip>
          </div>

          {/* Fixed height so switching hour/minute doesn't resize the dialog
              under the finger that just tapped */}
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

          <div className="flex items-center gap-2 pt-1">
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
