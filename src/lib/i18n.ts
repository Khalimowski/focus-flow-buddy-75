import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'pl';

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: 'en',
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'focus-flow-language',
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
  },
  pl: {
    app_name: "Focus Flow",
    tagline: "Spokojne skupienie dla mózgów ADHD",
    focus: "Skupienie",
    tasks: "Zadania",
    nudges: "Szturchnięcia",
    enable_nudges: "Włącz powiadomienia",
    blocked: "Zablokowane",
    enable: "Włącz",
    streak_current: "AKTUALNA SERIA",
    streak_best: "Najlepsza",
    streak_desc: "Wykonaj zadanie lub ukończ sesję skupienia, aby utrzymać serię.",
    settings: "Ustawienia",
    settings_desc: "Dostosuj swoje doświadczenie z Focus Flow.",
    dark_mode: "Tryb Ciemny",
    language: "Język",
    version: "Wersja",
    focus_timer_stay: "ZOSTAŃ PRZY TYM",
    focus_timer_start: "Start",
    focus_timer_pause: "Pauza",
    focus_timer_reset: "Resetuj",
    focus_timer_done: "Sesja skupienia zakończona",
    focus_timer_done_body: "Dobra robota. Czas na krótką przerwę.",
    break_over: "Koniec przerwy",
    break_over_body: "Gotowy na kolejną sesję skupienia?",
    tasks_placeholder: "Dodaj małe zadanie...",
    reminders_title: "Delikatne Szturchnięcia",
    reminders_desc: "Codzienne przypomnienia, które pomogą Ci trzymać się planu.",
    boink_channel_name: "Powiadomienia Szturchnięcia",
  }
};

export function useTranslation() {
  const { language } = useI18nStore();
  const t = (key: keyof typeof translations.en) => {
    return translations[language][key] || translations.en[key];
  };
  return { t, language };
}
