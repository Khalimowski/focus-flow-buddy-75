import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isDictationAvailable,
  isModelCached,
  modelSizeMb,
  startDictation,
  type Dictation,
  type DictationErrorKind,
} from "@/lib/speech";
import { useTranslation } from "@/lib/i18n";

type Status = "idle" | "preparing" | "listening";

/** How long an error stays on screen before the button goes quiet again. */
const ERROR_MS = 4000;

const ERROR_KEYS: Record<
  DictationErrorKind,
  "voice_error_permission" | "voice_error_download" | "voice_error_engine"
> = {
  permission: "voice_error_permission",
  download: "voice_error_download",
  unsupported: "voice_error_engine",
  engine: "voice_error_engine",
};

/**
 * Push-to-dictate. Tapping starts offline recognition; it stops itself two
 * seconds after you stop talking, or on a second tap.
 *
 * `onTranscript` fires repeatedly with the running transcript while listening
 * (isFinal false) and once at the end (isFinal true), so the caller can show
 * words as they land. It never fires with an empty final.
 *
 * `onEmpty` fires instead when a session ends having produced no transcript at
 * all — nothing was said, the mic was refused, the model wouldn't download, or
 * it was cancelled before it started listening. Callers that clear the field on
 * `onStart` use it to put back what was there, so a failed dictation costs
 * nothing. Exactly one of the two runs per session.
 */
export function MicButton({
  onStart,
  onTranscript,
  onEmpty,
  disabled,
  className,
}: {
  onStart?: () => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onEmpty?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t, language } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [percent, setPercent] = useState(0);
  const [needsDownload, setNeedsDownload] = useState(false);
  const [error, setError] = useState<DictationErrorKind | null>(null);
  const session = useRef<Dictation | null>(null);
  /** Whether this session ever put words in the caller's hands. */
  const heardAnything = useRef(false);

  // Touches navigator/AudioContext, so it can't run during render.
  useEffect(() => setAvailable(isDictationAvailable(language)), [language]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  // Drop the mic if the tab unmounts mid-sentence.
  useEffect(() => () => session.current?.stop(), []);

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
    // Cancelling mid-download resolves through neither onFinal nor onError, so
    // the button has to let itself go — and since nothing was ever heard, this
    // is the only chance to say so. Stopping while listening still delivers its
    // transcript afterwards, so onFinal owns that ending instead.
    if (status === "preparing" && !heardAnything.current) onEmpty?.();
    setStatus("idle");
  }, [onEmpty, status]);

  const toggle = useCallback(async () => {
    if (status !== "idle") {
      stop();
      return;
    }

    setError(null);
    setPercent(0);
    setStatus("preparing");
    heardAnything.current = false;
    setNeedsDownload(!(await isModelCached(language)));
    onStart?.();

    session.current = startDictation(language, {
      onProgress: (fraction) => setPercent(Math.round(fraction * 100)),
      onListening: () => setStatus("listening"),
      onPartial: (text) => {
        heardAnything.current = true;
        onTranscript(text, false);
      },
      onFinal: (text) => {
        session.current = null;
        setStatus("idle");
        if (text) {
          heardAnything.current = true;
          onTranscript(text, true);
        } else if (!heardAnything.current) {
          onEmpty?.();
        }
      },
      onError: (err) => {
        session.current = null;
        setStatus("idle");
        setError(err.kind);
        if (!heardAnything.current) onEmpty?.();
      },
    });
  }, [language, onEmpty, onStart, onTranscript, status, stop]);

  if (!available) return null;

  const hint = error
    ? t(ERROR_KEYS[error])
    : status === "listening"
      ? t("voice_listening")
      : status === "preparing"
        ? needsDownload
          ? `${t("voice_downloading")} ${percent}% · ${modelSizeMb(language)} MB`
          : t("voice_starting")
        : null;

  return (
    <div className="relative shrink-0">
      {hint && (
        <div
          role="status"
          className={cn(
            "pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-full border px-3 py-1 text-[10px] font-bold shadow-soft",
            error ? "bg-destructive text-destructive-foreground border-destructive" : "bg-card",
          )}
        >
          {hint}
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant={status === "listening" ? "default" : "secondary"}
        onClick={toggle}
        disabled={disabled}
        aria-label={status === "listening" ? t("voice_stop") : t("voice_input")}
        aria-pressed={status === "listening"}
        className={cn(
          "size-8 rounded-full p-0 shadow-soft",
          status === "listening" &&
            "animate-pulse bg-destructive text-destructive-foreground hover:bg-destructive/90",
          className,
        )}
      >
        {status === "preparing" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Mic className="size-4" />
        )}
      </Button>
    </div>
  );
}
