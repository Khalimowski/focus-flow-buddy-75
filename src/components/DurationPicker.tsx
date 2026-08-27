import { Hourglass } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Duration in minutes, chosen from a short list of presets. Paired with
 * TimePicker: a task's duration only means anything alongside a time, so
 * callers render the chip only once a time is set. Opening the dialog is
 * always the user's move — it never pops up on its own.
 */

const PRESETS = [15, 30, 45, 60, 90, 120];

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

type Props = {
  /** Minutes, or null for no duration set. */
  value: number | null;
  onChange: (value: number | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "md";
  className?: string;
  id?: string;
  "aria-label"?: string;
};

export function DurationPicker({
  value,
  onChange,
  open,
  onOpenChange,
  size = "md",
  className,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const { t } = useTranslation();
  const label = value ? formatDuration(value) : t("add_duration");

  const pick = (min: number) => {
    onChange(min);
    onOpenChange(false);
  };

  const clear = () => {
    onChange(null);
    onOpenChange(false);
  };

  return (
    <>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel ?? t("duration_picker_title")}
        onClick={() => onOpenChange(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-secondary/50 font-mono font-medium cursor-pointer transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          size === "sm" ? "h-7 px-2.5 text-[10px]" : "h-8 px-3 text-xs",
          value === null && "text-muted-foreground font-sans",
          className,
        )}
      >
        <Hourglass className={cn("shrink-0 text-primary", size === "sm" ? "size-2.5" : "size-3")} />
        {label}
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm gap-3 rounded-3xl p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Hourglass className="size-4 text-primary" />
              {t("duration_picker_title")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => pick(min)}
                aria-pressed={value === min}
                className={cn(
                  "rounded-2xl border py-3 text-center font-mono text-sm font-bold transition-colors cursor-pointer",
                  value === min
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {formatDuration(min)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              className="h-9 rounded-full px-3 text-xs text-muted-foreground"
            >
              {t("duration_clear")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="ml-auto h-9 rounded-full px-3 text-xs"
            >
              {t("cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
