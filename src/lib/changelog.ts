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

export const APP_VERSION = "1.7.2";

export type ChangelogEntry = {
  version: string;
  /** One short line per change, user-facing. Skip anything invisible to them. */
  items: Record<Language, string[]>;
};

/** Newest first. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.7.2",
    items: {
      en: [
        "Postponing a reminder from the notification now really moves the task 15 minutes later — the new time shows up in the app, the widget and your calendar.",
        "Notification buttons are now in your chosen language.",
      ],
      pl: [
        "Odłożenie przypomnienia z powiadomienia naprawdę przesuwa zadanie o 15 minut — nowa godzina pojawia się w aplikacji, widżecie i kalendarzu.",
        "Przyciski w powiadomieniach są teraz w wybranym języku.",
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
