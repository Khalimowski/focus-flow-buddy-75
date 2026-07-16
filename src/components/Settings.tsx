import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Moon, Sun, Calendar, Sparkles, GraduationCap, Vibrate } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18nStore, useTranslation, type VibrationType } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import { isNative, ensureCalendarPermission, updateStatusBar, syncAllToCalendar, applyVibrationSetting } from "@/lib/native";
import { loadJSON, STORAGE_KEYS } from "@/lib/storage";
import { AI_COACH_OPEN_EVENT } from "@/components/AICoach";
import { AccountSync } from "@/components/AccountSync";

export function Settings() {
  const [open, setOpen] = useState(false);
  const {
    theme, setTheme,
    calendarSync, setCalendarSync,
    nudgeCalendarSync, setNudgeCalendarSync,
    vibrationType, setVibrationType,
    setTutorialCompleted
  } = useI18nStore();
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

  const handleVibrationChange = (type: VibrationType) => {
    setVibrationType(type);
    // Move already-scheduled notifications onto the matching channel (no-op on web)
    void applyVibrationSetting();
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
              <Vibrate className="size-4" />
              <Label className="text-sm font-medium">
                {t('vibration')}
              </Label>
            </div>
            <Select
              value={vibrationType}
              onValueChange={(val) => handleVibrationChange(val as VibrationType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="long">{t('vibration_long')}</SelectItem>
                <SelectItem value="short">{t('vibration_short')}</SelectItem>
                <SelectItem value="double">{t('vibration_double')}</SelectItem>
                <SelectItem value="off">{t('vibration_off')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Language picker disabled for now (Polish paused) — restore this
              block, the Languages icon + Select imports, and the
              language/setLanguage store fields to re-enable. Also revert the
              pl->en migration in i18n.ts and resConfigs in
              android/app/build.gradle.
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
          */}

          <div className="pt-4 border-t">
            <AccountSync />
          </div>

          <div className="pt-4 border-t space-y-3">
            <Button
              className="w-full"
              onClick={() => {
                setOpen(false);
                // Let the sheet close animation finish before showing the coach
                setTimeout(() => window.dispatchEvent(new Event(AI_COACH_OPEN_EVENT)), 300);
              }}
            >
              <Sparkles className="mr-2 size-4" /> {t('settings_suggest_tasks')}
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
