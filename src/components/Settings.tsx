import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Moon, Sun, Languages, Bell, Calendar, Database, History, Sparkles, GraduationCap } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";
import { notify, ensurePermission } from "@/lib/notifications";
import { isNative, ensureCalendarPermission, updateStatusBar, syncAllToCalendar } from "@/lib/native";
import { loadJSON, STORAGE_KEYS } from "@/lib/storage";
import { AI_COACH_OPEN_EVENT } from "@/components/AICoach";

export function Settings() {
  const [open, setOpen] = useState(false);
  const {
    language, setLanguage,
    theme, setTheme,
    calendarSync, setCalendarSync,
    nudgeCalendarSync, setNudgeCalendarSync,
    setTutorialCompleted
  } = useI18nStore();
  const { events, getDaysSinceLaunch } = useHistoryStore();
  const { t } = useTranslation();

  useEffect(() => {
    // Sync with HTML class for tailwind dark mode
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.remove("light");
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }

    // Update native status bar icons
    void updateStatusBar(theme);
  }, [theme]);

  // Handle Android Back Button via History API (most reliable for Capacitor)
  useEffect(() => {
    if (!open) return;

    // Push a dummy state to history when settings open.
    // Keep TanStack Router's internal keys (__TSR_*) — replacing them with a
    // bare object leaves an entry the router can't resolve (white screen when
    // the WebView navigates onto it via back/forward swipe gestures).
    window.history.pushState({ ...window.history.state, settings: true }, "");

    const handlePopState = (e: PopStateEvent) => {
      // If we go back and the state is gone, close settings
      setOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // If menu is closed manually (not via back button), remove the dummy state
      if (window.history.state?.settings) {
        window.history.back();
      }
    };
  }, [open]);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleCalendarSyncChange = async (enabled: boolean) => {
    // Optimistically update so the toggle moves immediately
    setCalendarSync(enabled);

    if (!enabled) return;

    try {
      const granted = await ensureCalendarPermission();
      if (!granted) {
        setCalendarSync(false); // revert
        notify({
          title: t('permission_denied'),
          body: t('calendar_permission_tasks_body'),
          kind: "info"
        });
        return;
      }

      const tasks = loadJSON(STORAGE_KEYS.tasks, []);
      const reminders = loadJSON(STORAGE_KEYS.reminders, []);
      syncAllToCalendar(tasks, reminders).catch(e => console.error("[Settings] Sync failed", e));

      notify({
        title: t('calendar_sync_enabled'),
        body: t('calendar_sync_enabled_body'),
        kind: "info"
      });
    } catch (err) {
      console.error("[Settings] Sync enable failed", err);
      setCalendarSync(false); // revert
      notify({
        title: t('sync_error'),
        body: t('calendar_sync_error_body'),
        kind: "info"
      });
    }
  };

  const handleNudgeCalendarSyncChange = async (enabled: boolean) => {
    // Optimistically update so the toggle moves immediately
    setNudgeCalendarSync(enabled);

    if (!enabled) return;

    try {
      const granted = await ensureCalendarPermission();
      if (!granted) {
        setNudgeCalendarSync(false); // revert
        notify({
          title: t('permission_denied'),
          body: t('calendar_permission_nudges_body'),
          kind: "info"
        });
        return;
      }

      const tasks = loadJSON(STORAGE_KEYS.tasks, []);
      const reminders = loadJSON(STORAGE_KEYS.reminders, []);
      syncAllToCalendar(tasks, reminders).catch(e => console.error("[Settings] Nudge sync failed", e));

      notify({
        title: t('nudge_sync_enabled'),
        body: t('nudge_sync_enabled_body'),
        kind: "info"
      });
    } catch (err) {
      console.error("[Settings] Nudge sync enable failed", err);
      setNudgeCalendarSync(false); // revert
      notify({
        title: t('sync_error'),
        body: t('nudge_sync_error_body'),
        kind: "info"
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="rounded-full bg-background/80 backdrop-blur border-primary/20 shadow-lg">
          <SettingsIcon className="size-6 text-primary" />
          <span className="sr-only">{t('settings')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] sm:w-[400px] pt-safe-top">
        <SheetHeader>
          <SheetTitle>{t('settings')}</SheetTitle>
          <SheetDescription>
            {t('settings_desc')}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
              <Label htmlFor="dark-mode" className="text-sm font-medium">
                {theme === "dark" ? t('dark_mode') : t('light_mode')}
              </Label>
            </div>
            <Switch
              id="dark-mode"
              checked={theme === "dark"}
              onCheckedChange={toggleTheme}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="size-4" />
              <div className="flex flex-col">
                <Label htmlFor="calendar-sync" className="text-sm font-medium">
                  {t('sync_calendar')}
                </Label>
              </div>
            </div>
            <Switch
              id="calendar-sync"
              checked={calendarSync}
              onCheckedChange={handleCalendarSyncChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="size-4 opacity-70" />
              <div className="flex flex-col">
                <Label htmlFor="nudge-calendar-sync" className="text-sm font-medium">
                  {t('sync_nudges_calendar')}
                </Label>
              </div>
            </div>
            <Switch
              id="nudge-calendar-sync"
              checked={nudgeCalendarSync}
              onCheckedChange={handleNudgeCalendarSyncChange}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Languages className="size-4" />
              <Label className="text-sm font-medium">
                {t('language')}
              </Label>
            </div>
            <Select
              value={language}
              onValueChange={(val: "en" | "pl") => setLanguage(val)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('select_language')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="pl">Polski</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-6 border-t">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
              <Database className="size-3" /> {t('ai_insights')}
            </h4>

            <div className="rounded-2xl bg-secondary/30 p-4 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{t('collected_data')}</span>
                <span className="font-mono font-bold">{events.length} {t('data_points')}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{t('learning_progress')}</span>
                <span className="font-mono font-bold">{getDaysSinceLaunch()} / 3 {t('days')}</span>
              </div>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full mt-2 h-8 text-[10px] uppercase font-bold tracking-tight">
                    <History className="mr-1.5 size-3" /> {t('inspect_ai_memory')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[90vw] sm:max-w-[500px] h-[80vh] flex flex-col p-0 overflow-hidden rounded-3xl">
                  <DialogHeader className="p-6 pb-2">
                    <DialogTitle>{t('ai_activity_log')}</DialogTitle>
                    <DialogDescription>
                      {t('ai_activity_log_desc')}
                    </DialogDescription>
                  </DialogHeader>

                  <ScrollArea className="flex-1 p-6 pt-0">
                    <div className="space-y-3">
                      {events.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-10">{t('no_events_yet')}</p>
                      ) : (
                        [...events].reverse().map((ev) => (
                          <div key={ev.id} className="border-l-2 border-primary/30 pl-4 py-1">
                            <div className="flex justify-between items-baseline">
                              <span className="text-[10px] font-bold uppercase text-primary">
                                {ev.type.replace('_', ' ')}
                              </span>
                              <span className="text-[9px] font-mono text-muted-foreground">
                                {new Date(ev.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-xs text-foreground mt-0.5">
                              {ev.metadata?.title || ev.metadata?.label || t('user_action')}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              <Button
                size="sm"
                className="w-full mt-1 h-8 text-[10px] uppercase font-bold tracking-tight"
                onClick={() => {
                  setOpen(false);
                  // Let the sheet close animation finish before showing the coach
                  setTimeout(() => window.dispatchEvent(new Event(AI_COACH_OPEN_EVENT)), 300);
                }}
              >
                <Sparkles className="mr-1.5 size-3" /> {t('settings_suggest_tasks')}
              </Button>
            </div>
          </div>

          <div className="pt-4 border-t space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await ensurePermission();
                notify({
                  title: t('test_notification'),
                  body: t('test_notification_body'),
                  kind: "info"
                });
              }}
            >
              <Bell className="mr-2 size-4" />
              {t('test_notification')}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false);
                // Let the sheet close before the tour overlay appears
                setTimeout(() => setTutorialCompleted(false), 300);
              }}
            >
              <GraduationCap className="mr-2 size-4" />
              {t('replay_tutorial')}
            </Button>
          </div>
        </div>

        <div className="absolute bottom-8 left-6 right-6 text-center text-[10px] text-muted-foreground">
          {t('version')} 1.0.0
        </div>
      </SheetContent>
    </Sheet>
  );
}
