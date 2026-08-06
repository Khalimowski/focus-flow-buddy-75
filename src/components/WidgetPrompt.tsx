import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, X } from "lucide-react";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import { getWidgetPinState, requestWidgetPin } from "@/lib/native";
import { STORAGE_KEYS, loadJSON, saveJSON } from "@/lib/storage";

type PromptState = { dismissed?: boolean };

function markAnswered() {
  saveJSON<PromptState>(STORAGE_KEYS.widgetPrompt, { dismissed: true });
}

/**
 * One-time offer to put the task widget on the home screen. Android only —
 * on web (and on launchers that refuse pin requests) getWidgetPinState reports
 * unsupported and nothing renders. Settings keeps a permanent entry for anyone
 * who dismisses this.
 */
export function WidgetPrompt() {
  const { t } = useTranslation();
  const { tutorialCompleted } = useI18nStore();
  const [show, setShow] = useState(false);
  // Launcher refused the dialog — fall back to telling the user how to do it.
  const [manualHint, setManualHint] = useState(false);

  useEffect(() => {
    // Don't stack on top of onboarding, don't re-ask once answered, and don't
    // pitch an empty widget before there's a task for it to show.
    if (!tutorialCompleted) return;
    if (loadJSON<PromptState>(STORAGE_KEYS.widgetPrompt, {}).dismissed) return;
    if (loadJSON<unknown[]>(STORAGE_KEYS.tasks, []).length === 0) return;

    let cancelled = false;
    const check = async () => {
      const { supported, added } = await getWidgetPinState();
      if (cancelled) return;
      if (added) {
        // Already on a home screen (maybe added by hand): stop asking here.
        markAnswered();
        setShow(false);
        return;
      }
      setShow(supported);
    };
    void check();

    // The launcher dialog takes the app to the background; re-check on the way
    // back so an accepted prompt disappears on its own.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tutorialCompleted]);

  const dismiss = useCallback(() => {
    markAnswered();
    setShow(false);
  }, []);

  const add = useCallback(async () => {
    const opened = await requestWidgetPin();
    // Nothing to do on success: the visibility re-check hides the card once the
    // widget lands, and leaves it up if the user backs out of the dialog.
    if (!opened) setManualHint(true);
  }, []);

  // Unmounted rather than animated out: an AnimatePresence exit leaves the
  // faded node in the DOM, keeping its buttons reachable by keyboard.
  if (!show) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      className="mb-4 overflow-hidden rounded-2xl border border-mint/30 bg-mint/10 p-3 backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mint/20 text-mint">
          <LayoutGrid className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t('widget_prompt_title')}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{t('widget_prompt_desc')}</div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={() => void add()}
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              {t('widget_add')}
            </button>
            <button
              onClick={dismiss}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-secondary"
            >
              {t('widget_not_now')}
            </button>
          </div>
          {manualHint && (
            <div className="mt-2 text-[11px] text-muted-foreground">{t('widget_manual_hint')}</div>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label={t('widget_not_now')}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-secondary"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
