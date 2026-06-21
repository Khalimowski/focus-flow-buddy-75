import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'pl';
export type Theme = 'light' | 'dark';

interface I18nState {
  language: Language;
  theme: Theme;
  calendarSync: boolean;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setCalendarSync: (enabled: boolean) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: 'en',
      theme: 'dark',
      calendarSync: false,
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setCalendarSync: (calendarSync) => set({ calendarSync }),
    }),
    {
      name: 'focus-flow-settings',
    }
  )
);

export const translations = {
  en: {
    app_name: "Focus Flow",
    tagline: "Time-sensitive clarity for ADHD brains and beyond.",
    tasks: "Tasks",
    nudges: "Nudges",
    enable_nudges: "Enable nudges",
    blocked: "Blocked",
    enable: "Enable",
    streak_current: "CURRENT STREAK",
    streak_best: "Best",
    streak_desc: "Complete one task to keep the chain alive.",
    days: "days",
    settings: "Settings",
    settings_desc: "Customize your Focus Flow experience.",
    dark_mode: "Dark Mode",
    light_mode: "Bright Mode",
    language: "Language",
    version: "Version",
    sync_calendar: "Sync to Calendar",
    sync_calendar_desc: "Automatically add reminders to your phone calendar.",
    tasks_placeholder: "Add a tiny task...",
    reminders_title: "Gentle Nudges",
    reminders_desc: "Daily reminders to keep you on track.",
    boink_channel_name: "Nudge Notifications",
    quick_add: "Quick Add",
    custom_reminder: "Custom Nudge",
    your_daily_nudges: "Your Daily Nudges",
    add_preset_or_own: "Add a preset or your own.",
    nudge_placeholder: "What should I nudge you about?",
    gentle_nudge_emoji: "Gentle nudge ✨",
    drink_water: "Drink water",
    take_meds: "Take meds",
    stand_stretch: "Stand & stretch",
    task_input_placeholder: "What's one small thing?",
    nudge_at_time: "You'll be nudged at",
    tasks_empty: "Quiet for now. Add one tiny task above.",
    reminder_title: "Reminder",
    add_time: "Add Time",
    add_nudge: "Add Nudge",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    test_notification: "Test Notification",
    test_notification_body: "This is a test from Focus Flow! ✨",
    select_language: "Select Language",
    footer_hint: "Add this app to your home screen for the best experience.",
  },
  pl: {
    app_name: "Focus Flow",
    tagline: "Czas pod kontrolą. Dla umysłów z ADHD i każdego z nas.",
    tasks: "Zadania",
    nudges: "Przypominajki",
    enable_nudges: "Włącz przypominajki",
    blocked: "Zablokowane",
    enable: "Włącz",
    streak_current: "TWOJA SERIA",
    streak_best: "Rekord Streaków",
    streak_desc: "Działaj dalej, by utrzymać Streak.",
    days: "dni",
    settings: "Ustawienia",
    settings_desc: "Dostosuj Focus Flow do swoich potrzeb.",
    dark_mode: "Tryb ciemny",
    light_mode: "Tryb jasny",
    language: "Język",
    version: "Wersja",
    sync_calendar: "Synchronizuj z kalendarzem",
    sync_calendar_desc: "Automatycznie dodawaj przypomnienia do kalendarza telefonu.",
    tasks_placeholder: "Coś małego na teraz...",
    reminders_title: "Przypominajki",
    reminders_desc: "Łagodne przypomnienia, które pomogą Ci zostać na fali.",
    boink_channel_name: "Powiadomienia Focus Flow",
    quick_add: "Szybkie dodawanie",
    custom_reminder: "Własne przypomnienie",
    your_daily_nudges: "Twoje codzienne przypominajki",
    add_preset_or_own: "Dodaj gotowe lub własne.",
    nudge_placeholder: "O czym Ci przypomnieć?",
    gentle_nudge_emoji: "Łagodne przypomnienie ✨",
    drink_water: "Pij wodę",
    take_meds: "Weź leki",
    stand_stretch: "Wstań i przeciągnij się",
    task_input_placeholder: "Co musisz zrobić?",
    nudge_at_time: "Dostaniesz informacje o",
    tasks_empty: "Na razie cicho. Dodaj zadanie powyżej.",
    reminder_title: "Przypomnienie",
    add_time: "Dodaj godzinę",
    add_nudge: "Dodaj przypomnienie",
    edit: "Edytuj",
    save: "Zapisz",
    cancel: "Anuluj",
    test_notification: "Testowe powiadomienie",
    test_notification_body: "To jest test z Focus Flow! ✨",
    select_language: "Wybierz język",
    footer_hint: "Dodaj aplikację do ekranu głównego, aby uzyskać najlepsze wrażenia.",
  }
};

export function useTranslation() {
  const { language } = useI18nStore();
  const t = (key: keyof typeof translations.en) => {
    return translations[language][key] || translations.en[key];
  };
  return { t, language };
}
