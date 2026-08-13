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

export const APP_VERSION = "1.7.7";

export type ChangelogEntry = {
  version: string;
  /** One short line per change, user-facing. Skip anything invisible to them. */
  items: Record<Language, string[]>;
};

/** Newest first. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.7.7",
    items: {
      en: [
        "Dictation now sets the time as well as the title — say “dentist at half past four” and you get a task called Dentist at 16:30, reminder already on.",
        "It follows the everyday ways of saying it: “at nine thirty”, “quarter to seven”, “eight pm”, “at noon”, “at seventeen thirty”.",
        "Polish works the same, with its own phrasings — “o wpół do piątej”, “za kwadrans piąta”, “w południe”.",
        "Not sure it heard you right? The time lands in the picker next to the field, so you can see it before adding the task.",
      ],
      pl: [
        "Dyktowanie ustawia teraz nie tylko treść, ale i godzinę — powiedz „dentysta o wpół do piątej”, a dostaniesz zadanie Dentysta na 16:30, od razu z przypomnieniem.",
        "Rozumie zwykłe sposoby mówienia o godzinie: „o dziewiątej trzydzieści”, „za kwadrans piąta”, „kwadrans po piątej”, „w południe”, „o siedemnastej”.",
        "Po angielsku działa tak samo, w tamtejszych zwrotach — „at half past four”, „quarter to seven”, „at noon”.",
        "Nie masz pewności, czy dobrze usłyszał? Godzina trafia do pola obok, więc widzisz ją przed dodaniem zadania.",
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
