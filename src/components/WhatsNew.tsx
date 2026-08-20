import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import { CHANGELOG, type ChangelogEntry, markChangelogSeen, unseenEntries } from "@/lib/changelog";

/** Settings asks for the notes again through this. */
export const WHATS_NEW_OPEN_EVENT = "ff.whats-new-open";

/**
 * The release notes, shown once per update: on the first launch of a build
 * newer than the one whose notes were last read here. Dismissing records the
 * current version, so it doesn't come back on the next refresh.
 *
 * Nothing is fetched — the notes ship in the bundle, which is what makes them
 * the notes for the build actually running, offline and on both targets.
 */
export function WhatsNew() {
  const { t } = useTranslation();
  const { language, tutorialCompleted } = useI18nStore();
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);

  useEffect(() => {
    // A first run has nothing to catch up on: everything in the list is simply
    // how the app has always worked as far as this user is concerned. Record
    // the version silently so the *next* update is the first they hear about.
    if (!tutorialCompleted) {
      markChangelogSeen();
      return;
    }
    const unseen = unseenEntries();
    if (unseen.length > 0) setEntries(unseen);
  }, [tutorialCompleted]);

  useEffect(() => {
    // Reopened from Settings: always the latest notes, seen or not.
    const onOpen = () => setEntries(CHANGELOG.slice(0, 1));
    window.addEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
  }, []);

  const close = () => {
    markChangelogSeen();
    setEntries(null);
  };

  if (!entries || entries.length === 0) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-3 overflow-hidden rounded-3xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" />
            {t("whats_new_title")}
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
              v{entries[0].version}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">{t("whats_new_desc")}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
          {entries.map((entry) => (
            <div key={entry.version} className="flex flex-col gap-2">
              {/* Only worth naming the version when they skipped a release and
                  are catching up on more than one. */}
              {entries.length > 1 && (
                <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("version")} {entry.version}
                </div>
              )}
              <ul className="flex flex-col gap-2">
                {entry.items[language].map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-2xl border border-border bg-card p-3"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Button onClick={close} className="h-9 shrink-0 rounded-full text-xs shadow-soft">
          {t("whats_new_got_it")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
