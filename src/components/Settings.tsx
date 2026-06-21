import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Moon, Sun, Languages, Bell, Calendar } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18nStore, useTranslation } from "@/lib/i18n";
import { notify, ensurePermission } from "@/lib/notifications";
import { ensureCalendarPermission } from "@/lib/native";

export function Settings() {
  const { language, setLanguage, theme, setTheme, calendarSync, setCalendarSync } = useI18nStore();
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
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const handleCalendarSyncChange = async (enabled: boolean) => {
    if (enabled) {
      const granted = await ensureCalendarPermission();
      if (!granted) {
        setCalendarSync(false);
        return;
      }
    }
    setCalendarSync(enabled);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="rounded-full bg-background/80 backdrop-blur border-primary/20 shadow-lg">
          <SettingsIcon className="size-6 text-primary" />
          <span className="sr-only">{t('settings')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] sm:w-[400px]">
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

          <div className="pt-4 border-t">
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
          </div>
        </div>

        <div className="absolute bottom-8 left-6 right-6 text-center text-[10px] text-muted-foreground">
          {t('version')} 1.0.0
        </div>
      </SheetContent>
    </Sheet>
  );
}
