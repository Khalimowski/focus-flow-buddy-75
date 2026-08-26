// Release notes shown to the user once, the first time they open a build newer
// than the one they last saw (see components/WhatsNew.tsx).
//
// Per release: bump APP_VERSION and add an entry at the TOP of CHANGELOG with
// the same version string. That string is the single source of truth for the
// version the app reports — keep it equal to `versionName` in
// android/app/build.gradle, whose `versionCode` still has to go up by one.
//
// The text lives here rather than in i18n.ts because a release is one edit in
// one place; and it ships inside the bundle, so the notes are the notes for
// *this* build even with no network.
import type { Language } from "./i18n";
import { STORAGE_KEYS, loadJSON, saveJSON } from "./storage";

export const APP_VERSION = "1.11.1";

export type ChangelogEntry = {
  version: string;
  /** One short line per change, user-facing. Skip anything invisible to them. */
  items: Record<Language, string[]>;
};

/** Newest first. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.11.1",
    items: {
      en: [
        "Timeline view: when several tasks share the same time, their names are readable again instead of squeezed away by the buttons. Tap a narrow block to open it full width with its tick, edit and delete controls.",
      ],
      pl: [
        "Widok osi czasu: gdy kilka zadań przypada na tę samą godzinę, ich nazwy znów są czytelne, zamiast być wyparte przez przyciski. Dotknij wąskiego bloku, aby otworzyć go na całą szerokość razem z zaznaczaniem, edycją i usuwaniem.",
      ],
    },
  },
  {
    version: "1.11.0",
    items: {
      en: [
        "Tasks with a time can now also get a duration — pick 15 minutes up to 2 hours right after setting the time. It sizes the block on the Timeline view and how long the matching calendar event runs.",
      ],
      pl: [
        "Zadania z ustawioną godziną mogą teraz też mieć czas trwania — wybierz od 15 minut do 2 godzin zaraz po ustawieniu godziny. Wpływa on na rozmiar bloku w widoku osi czasu i długość powiązanego wydarzenia w kalendarzu.",
      ],
    },
  },
  {
    version: "1.10.1",
    items: {
      en: [
        "Habits can now repeat on chosen days instead of every day — set \"Gym\" for Mondays at 18:00 and it only shows up on Mondays.",
        "A habit's days appear next to its times in the list, and it only turns up in Tasks on the days it runs.",
        "The home-screen task widget has been redrawn to match the rest of the app.",
      ],
      pl: [
        "Nawyki mogą teraz powtarzać się w wybrane dni, nie tylko codziennie — ustaw „Siłownia” na poniedziałki o 18:00, a pojawi się tylko w poniedziałki.",
        "Dni nawyku widać obok jego godzin na liście, a w Zadaniach pojawia się tylko w te dni, w które faktycznie działa.",
        "Widżet z zadaniami na ekranie głównym został przerysowany, żeby pasował do reszty aplikacji.",
      ],
    },
  },
  {
    version: "1.10.0",
    items: {
      en: [
        "The privacy policy now lives in the app — open it from the bottom of Settings, in English or Polish.",
      ],
      pl: [
        "Polityka prywatności jest teraz w aplikacji — otworzysz ją na dole Ustawień, po polsku lub po angielsku.",
      ],
    },
  },
  {
    version: "1.9.9",
    items: {
      en: [
        "Fixed a gap that could show up between the ad banner and the bottom navigation bar.",
      ],
      pl: [
        "Naprawiono lukę, która mogła pojawić się między banerem reklamowym a dolnym paskiem nawigacji.",
      ],
    },
  },
  {
    version: "1.9.5",
    items: {
      en: [
        "New look for the FlowDay mark: a marble bust with a checklist orbiting it, in ink green and gold.",
        "The full logo now sits at the top of the screen, and the app icon on your home screen matches it.",
      ],
      pl: [
        "Nowy znak FlowDay: marmurowe popiersie z listą zadań krążącą wokół głowy, w zieleni i złocie.",
        "Pełne logo pojawia się teraz na górze ekranu, a ikona aplikacji na ekranie głównym do niego pasuje.",
      ],
    },
  },
  {
    version: "1.9.4",
    items: {
      en: [
        "The streak strip shows the date on each day again, so you can see at a glance which days you kept and which you missed.",
      ],
      pl: [
        "Pasek passy znów pokazuje datę na każdym dniu, więc od razu widać, które dni się udały, a które przepadły.",
      ],
    },
  },
  {
    version: "1.9.3",
    items: {
      en: [
        "FlowDay has a new look: a calm, printed-page feel with a serif face throughout, solid cards and a quieter palette.",
        "Navigation has moved to the bottom of the screen, within easy reach.",
        "The browser version gets the new look too, with the tabs floating as a centred bar.",
      ],
      pl: [
        "FlowDay ma nowy wygląd: spokojny, jak drukowana strona — szeryfowy krój pisma, pełne karty i stonowana paleta.",
        "Nawigacja przeniosła się na dół ekranu, pod kciuk.",
        "Wersja w przeglądarce też dostaje nowy wygląd, a zakładki unoszą się tam jako wyśrodkowany pasek.",
      ],
    },
  },
  {
    version: "1.8.8",
    items: {
      en: [
        "Nudges are now called Habits — same daily reminders, a name that says what they're for. Everything you already set up carries over untouched.",
      ],
      pl: [
        "Przypominajki nazywają się teraz Nawyki — te same codzienne przypomnienia, nazwa lepiej mówi, po co są. Wszystko, co masz już ustawione, zostaje bez zmian.",
      ],
    },
  },
  {
    version: "1.8.7",
    items: {
      en: [
        "The tutorial now covers more of the app: dictating a task with the mic, the month calendar, and — in the browser — Insights.",
        "Buy Premium and you get a short tour of what it just unlocked: the browser version, voice input, and no more ads.",
        "Opening FlowDay in your browser for the first time now gets its own quick introduction, so Insights and dictation don't stay hidden.",
        "Settings can replay either tour whenever you want.",
      ],
      pl: [
        "Samouczek pokazuje teraz więcej: dyktowanie zadania mikrofonem, kalendarz miesiąca, a w przeglądarce także Podsumowania.",
        "Po zakupie Premium zobaczysz krótki przewodnik po tym, co się właśnie otworzyło: wersja w przeglądarce, dyktowanie i koniec z reklamami.",
        "Pierwsze otwarcie FlowDay w przeglądarce ma teraz własne krótkie wprowadzenie, żeby Podsumowania i dyktowanie nie zostały niezauważone.",
        "W Ustawieniach powtórzysz każdy z przewodników, kiedy zechcesz.",
      ],
    },
  },
  {
    version: "1.8.6",
    items: {
      en: [
        "Ticked-off to-dos now tuck themselves into a Done group at the bottom of the list, so what's left stays front and centre. Tap it to look back at what you've finished.",
      ],
      pl: [
        "Odhaczone zadania z listy To-Do chowają się teraz w grupie „Zrobione” na dole, żeby na wierzchu zostało to, co jeszcze przed Tobą. Kliknij, żeby zobaczyć, co masz już za sobą.",
      ],
    },
  },
  {
    version: "1.8.4",
    items: {
      en: [
        "New in the browser version: Insights — see how much of what you planned actually got done, day by day, week by week and month by month.",
        "It also shows what happens to everything else: how much you reschedule, postpone at the end of the day, or delete — and which day of the week you finish the most on.",
        "Your phone keeps the tally, so the browser shows what you did on either device.",
      ],
      pl: [
        "Nowość w wersji przeglądarkowej: Podsumowania — zobacz, ile z tego, co zaplanowane, naprawdę udało się zrobić: dzień po dniu, tydzień po tygodniu, miesiąc po miesiącu.",
        "Widać tam też, co dzieje się z resztą: ile zadań przenosisz, odkładasz wieczorem albo usuwasz — i w który dzień tygodnia kończysz najwięcej.",
        "Telefon zlicza wszystko po cichu, więc w przeglądarce widzisz to, co robisz na obu urządzeniach.",
      ],
    },
  },
  {
    version: "1.8.3",
    items: {
      en: [
        "AI Flow Coach now shows it's in testing so you know what to expect.",
      ],
      pl: [
        "Asystent AI Flow Coach teraz wyraźnie pokazuje, że jest testowany.",
      ],
    },
  },
  {
    version: "1.8.0",
    items: {
      en: [
        "The Polish translation now reads the way a native speaker would actually write it, rather than like a translation.",
      ],
      pl: [
        "Polskie tłumaczenie brzmi teraz tak, jak napisałby je Polak, a nie jak tłumaczenie — mniej sztywnych zwrotów, więcej normalnego języka.",
      ],
    },
  },
  {
    version: "1.7.9",
    items: {
      en: [
        "Every Premium feature is free for everyone while FlowDay is in early access — the browser version and voice input included, with nothing to buy.",
        "Open flowday.day in your browser, sign in with the same account, and everything's there.",
      ],
      pl: [
        "Każda funkcja Premium jest teraz darmowa dla wszystkich, dopóki FlowDay jest we wczesnym dostępie — łącznie z wersją przeglądarkową i dodawaniem zadań głosem. Nic nie trzeba kupować.",
        "Otwórz flowday.day w przeglądarce, zaloguj się tym samym kontem i wszystko tam jest.",
      ],
    },
  },
  {
    version: "1.7.8",
    items: {
      en: [
        "Adding tasks by voice is now part of FlowDay Premium, alongside the browser version and no banner ads.",
        "Already have Premium? Nothing changes — the microphone works exactly as before.",
        "Without it, the microphone stays on screen with a sparkle; tap it to see where to unlock it. Tasks you already dictated are untouched.",
      ],
      pl: [
        "Dodawanie zadań głosem jest teraz częścią FlowDay Premium — obok wersji przeglądarkowej i braku banerów reklamowych.",
        "Masz już Premium? Nic się nie zmienia — mikrofon działa dokładnie tak jak wcześniej.",
        "Bez niego mikrofon zostaje na ekranie z gwiazdką; dotknij go, aby zobaczyć, gdzie go odblokować. Wcześniej podyktowane zadania pozostają nietknięte.",
      ],
    },
  },
  {
    version: "1.7.7",
    items: {
      en: [
        "Dictation now sets the day and time as well as the title — say “dentist tomorrow at half past four” and you get a task called Dentist, on tomorrow's date, at 16:30 with the reminder on.",
        "Times follow the everyday ways of saying them: “at nine thirty”, “quarter to seven”, “eight pm”, “at noon”, “at seventeen thirty”.",
        "So do days: “today”, “tomorrow”, “the day after tomorrow”, “on Monday”, “by Friday”, “in three days”, “next week”, “on the fifteenth”, “on the third of September”.",
        "Polish works the same, in its own phrasings — “o wpół do piątej”, “za kwadrans piąta”, “jutro”, “pojutrze”, “w środę”, “za trzy dni”, “piętnastego marca”.",
        "Not sure it heard you right? The day and time land in the buttons next to the field, so you can see them before adding the task.",
      ],
      pl: [
        "Dyktowanie ustawia teraz nie tylko treść, ale i dzień oraz godzinę — powiedz „dentysta jutro o wpół do piątej”, a dostaniesz zadanie Dentysta na jutro, na 16:30, od razu z przypomnieniem.",
        "Rozumie zwykłe sposoby mówienia o godzinie: „o dziewiątej trzydzieści”, „za kwadrans piąta”, „kwadrans po piątej”, „w południe”, „o siedemnastej”.",
        "Tak samo z dniami: „dzisiaj”, „jutro”, „pojutrze”, „w poniedziałek”, „we wtorek”, „za trzy dni”, „w przyszłym tygodniu”, „piętnastego”, „trzeciego września”.",
        "Po angielsku działa tak samo, w tamtejszych zwrotach — „at half past four”, „tomorrow”, „on Monday”, „in three days”.",
        "Nie masz pewności, czy dobrze usłyszał? Dzień i godzina trafiają do przycisków obok pola, więc widzisz je przed dodaniem zadania.",
      ],
    },
  },
  {
    version: "1.7.6",
    items: {
      en: [
        "Say your task instead of typing it — the microphone next to the add button writes the words straight into the field, and stops on its own once you go quiet.",
        "Understands English and Polish, matching whichever language the app is set to.",
        "Dictation runs entirely on your phone, so it works with no signal. The first tap downloads the voice pack (about 40 MB) once.",
      ],
      pl: [
        "Powiedz zadanie zamiast je wpisywać — mikrofon obok przycisku dodawania wpisuje słowa prosto do pola i sam kończy, gdy przestaniesz mówić.",
        "Rozumie polski i angielski — dyktuje w języku, na który ustawiona jest aplikacja.",
        "Dyktowanie działa w całości na telefonie, więc nie potrzebuje zasięgu. Pierwsze użycie pobiera pakiet głosowy (około 53 MB).",
      ],
    },
  },
  {
    version: "1.7.5",
    items: {
      en: [
        "Picking a time now opens FlowDay's own clock instead of the phone's grey dial — drag the hand around the 24-hour face.",
        "Prefer typing? The keyboard button turns the clock into two fields you can type the time straight into.",
      ],
      pl: [
        "Wybór godziny otwiera teraz własny zegar FlowDay zamiast szarej tarczy z telefonu — przeciągnij wskazówkę po 24-godzinnej tarczy.",
        "Wolisz wpisać godzinę? Przycisk klawiatury zamienia zegar na dwa pola, w które wpiszesz ją wprost.",
      ],
    },
  },
  {
    version: "1.7.1",
    items: {
      en: [
        "After every update you'll get a short note like this one, listing what changed.",
        "You can read it again any time from Settings.",
      ],
      pl: [
        "Po każdej aktualizacji zobaczysz krótką notkę taką jak ta, z listą zmian.",
        "Możesz ją przeczytać ponownie w każdej chwili w Ustawieniach.",
      ],
    },
  },
  {
    version: "1.7.0",
    items: {
      en: [
        "A calendar view with day, week and month scales — open it to add a task straight to a date.",
        "A timeline list that makes moving tasks between days easier.",
        "An end-of-day check-in that asks what to do with anything still unfinished.",
        "Google Calendar and Gmail settings now follow your account across devices.",
      ],
      pl: [
        "Widok kalendarza w skali dnia, tygodnia i miesiąca — otwórz go, by dodać zadanie od razu na wybrany dzień.",
        "Lista osi czasu, która ułatwia przenoszenie zadań między dniami.",
        "Wieczorne podsumowanie, które pyta, co zrobić z niedokończonymi zadaniami.",
        "Ustawienia Kalendarza Google i Gmaila podążają teraz za kontem na wszystkich urządzeniach.",
      ],
    },
  },
];

/** Device-local — see STORAGE_KEYS.whatsNew. */
type WhatsNewState = { lastSeenVersion?: string };

function parts(version: string): number[] {
  return version.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Negative when a < b, positive when a > b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Everything released since the user last read the notes — usually one entry,
 * more if they skipped a version. Empty when they're up to date.
 *
 * A device that has never recorded a version gets only the current entry: it
 * either just updated from a build that predates this feature, or it's a fresh
 * install, and neither wants the whole back catalogue.
 */
export function unseenEntries(): ChangelogEntry[] {
  const { lastSeenVersion } = loadJSON<WhatsNewState>(STORAGE_KEYS.whatsNew, {});
  if (!lastSeenVersion) {
    return CHANGELOG.filter((entry) => entry.version === APP_VERSION);
  }
  if (compareVersions(lastSeenVersion, APP_VERSION) >= 0) return [];
  return CHANGELOG.filter((entry) => compareVersions(entry.version, lastSeenVersion) > 0);
}

export function markChangelogSeen() {
  saveJSON<WhatsNewState>(STORAGE_KEYS.whatsNew, { lastSeenVersion: APP_VERSION });
}
