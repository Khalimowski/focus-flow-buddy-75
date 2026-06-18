import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'pl';
export type Theme = 'light' | 'dark';

interface I18nState {
  language: Language;
  theme: Theme;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: 'en',
      theme: 'dark',
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'focus-flow-settings',
    }
  )
);

export const translations = {
  en: {
    app_name: "Focus Flow",
    tagline: "Calm focus for ADHD brains",
    focus: "Focus",
    tasks: "Tasks",
    nudges: "Nudges",
    enable_nudges: "Enable nudges",
    blocked: "Blocked",
    enable: "Enable",
    streak_current: "CURRENT STREAK",
    streak_best: "Best",
    streak_desc: "Complete one task or finish a focus session to keep the chain alive.",
    settings: "Settings",
    settings_desc: "Customize your Focus Flow experience.",
    dark_mode: "Dark Mode",
    language: "Language",
    version: "Version",
    focus_timer_stay: "STAY WITH IT",
    focus_timer_start: "Start",
    focus_timer_pause: "Pause",
    focus_timer_reset: "Reset",
    focus_timer_done: "Focus session done",
    focus_timer_done_body: "Nice work. Time for a short break.",
    break_over: "Break over",
    break_over_body: "Ready for another focus session?",
    tasks_placeholder: "Add a tiny task...",
    reminders_title: "Gentle Nudges",
    reminders_desc: "Daily reminders to keep you on track.",
    boink_channel_name: "Nudge Notifications",
    quick_add: "Quick Add",
    custom_reminder: "Custom Reminder",
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
    breathe: "BREATHE",
    sessions_today: "Sessions today",
    minute_unit: "min",
    focus_label: "Focus",
    break_label: "Break",
    add_time: "Add Time",
    add_nudge: "Add Nudge",
  },
  pl: {
    app_name: "Focus Flow",
    tagline: "Spokojne skupienie w Twoim tempie",
    focus: "Skupienie",
    tasks: "Zadania",
    nudges: "Łagodne Przypominajki",
    enable_nudges: "Włącz przypominajki",
    blocked: "Zablokowane",
    enable: "Włącz",
    streak_current: "TWOJA SERIA",
    streak_best: "Rekord Streaków",
    streak_desc: "Działaj dalej, by utrzymać Streak.",
    settings: "Ustawienia",
    settings_desc: "Dostosuj Focus Flow do swoich potrzeb.",
    dark_mode: "Tryb ciemny",
    language: "Język",
    version: "Wersja",
    focus_timer_stay: "Pełne Skupienie",
    focus_timer_start: "Start",
    focus_timer_pause: "Pauza",
    focus_timer_reset: "Resetuj",
    focus_timer_done: "Udało się!",
    focus_timer_done_body: "Dobra robota. Czas na krótką przerwę.",
    break_over: "Przerwa",
    break_over_body: "Gotowy na kolejną sesję?",
    tasks_placeholder: "Coś małego na teraz...",
    reminders_title: "Łagodne Przypominajki",
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
    breathe: "ODDYCHAJ",
    sessions_today: "Dzisiejsze sesje",
    minute_unit: "min",
    focus_label: "Skupienie",
    break_label: "Przerwa",
    add_time: "Dodaj godzinę",
    add_nudge: "Dodaj przypomnienie",
  }
};

export function useTranslation() {
  const { language } = useI18nStore();
  const t = (key: keyof typeof translations.en) => {
    return translations[language][key] || translations.en[key];
  };
  return { t, language };
}
