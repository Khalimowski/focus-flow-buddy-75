// Pulls the *when* out of a dictated task: "dentist tomorrow at half past
// four" becomes 16:30 on tomorrow's date plus the title "dentist", and
// "dentysta jutro o wpół do piątej" does the same in Polish.
//
// This exists because Vosk hands back one flat string, so without it every
// spoken time ends up baked into the title and the task gets no reminder at
// all. It is a hand-written matcher rather than a date library because the
// input is *spoken*, from a small acoustic model: numbers arrive as words
// ("four thirty", never "4:30"), there is no punctuation and no casing, and
// half the phrasings people use out loud never appear in typed text.
//
// Time and date are matched independently and each claims its own span of
// words, so they can appear in either order and either can be absent. A date
// with no time is a task on that day with no reminder — which is exactly what
// the composer does when you pick a day and skip the clock.
//
// The two languages get separate matchers rather than one table of translated
// words, because they don't share a grammar. English hangs a time off a
// preposition and counts minutes forward ("quarter past four"); Polish inflects
// the hour itself ("o piątej", "o siedemnastej") and its half-hour counts
// *toward* the coming hour — "wpół do piątej" is 4:30, not 5:30. Only the
// helpers below the fold are shared.
//
// The bar for a match is deliberately high in both. Leaving a time in the title
// costs the user one tap on the time picker; inventing one they didn't say
// gives them a reminder at the wrong hour, which is worse in an app whose whole
// job is telling you when to do things. So anything ambiguous is left alone.

import { addDays, startOfDay } from "date-fns";

import type { Language } from "./i18n";

export type SpokenSchedule = {
  /** "HH:MM" — the shape TimePicker and addTask() already speak. Null when no
   * time was said, which must leave the picker as it was rather than clear it. */
  time: string | null;
  /** Midnight on the day that was named, or null when none was. */
  date: Date | null;
  /** The transcript with the time and date phrases cut out. Can be empty. */
  title: string;
};

type Match = {
  /** Index of the first consumed word. */
  start: number;
  /** Index just past the last consumed word. */
  end: number;
  hour: number;
  minute: number;
  /** Whether the speaker pinned the half of the day themselves. */
  explicitHalf: boolean;
};

/**
 * Which part of the day the speaker named. "night" is not a synonym for pm:
 * "eleven at night" is 23:00 but "two at night" is 02:00, and Polish "w nocy"
 * behaves the same way.
 */
type DayPart = "am" | "pm" | "night";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DIACRITICS: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

/**
 * Splits into the words as spoken (for rebuilding the title) and a parallel
 * folded view (for matching). Polish diacritics are folded away rather than
 * matched, so one spelling of "piątej" in the tables covers a model — or a
 * user's keyboard — that drops them.
 */
function splitWords(text: string): { raw: string[]; norm: string[] } {
  const raw = text.split(/\s+/).filter(Boolean);
  const norm = raw.map((word) =>
    word
      .toLowerCase()
      .replace(/[ąćęłńóśźż]/g, (ch) => DIACRITICS[ch])
      .replace(/[^a-z0-9:]/g, ""),
  );
  return { raw, norm };
}

function applyDayPart(hour: number, part: DayPart): number {
  if (hour > 12) return hour; // Already 24-hour; "seventeen pm" is a mishearing.
  if (part === "am") return hour === 12 ? 0 : hour;
  if (part === "pm") return hour === 12 ? 12 : hour + 12;
  if (hour === 12) return 0;
  return hour <= 5 ? hour : hour + 12;
}

/**
 * The hour a "to"/"wpół do" phrase counts back from. One wraps to twelve rather
 * than to zero: "quarter to one" is 12:45, and "wpół do pierwszej" is 12:30.
 */
function previousHour(hour: number): number {
  if (hour === 1 || hour === 13) return 12;
  return hour === 0 ? 23 : hour - 1;
}

/**
 * Picks the half of the day for an hour the speaker left open. Fixed rather
 * than clever: hours 1–6 land in the afternoon, everything else stays as
 * spoken. A rule that shifted with the current time would give "at five" a
 * different meaning depending on when it was said, and a wrong time you can
 * predict is easier to live with than a wrong time you can't.
 */
function resolveHalf(hour: number): number {
  if (hour >= 1 && hour <= 6) return hour + 12;
  return hour;
}

function toClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "7:30" wherever it appears, in either language. */
function readClockFace(word: string): { hour: number; minute: number } | null {
  const digits = /^(\d{1,2}):(\d{2})$/.exec(word);
  if (!digits) return null;
  const hour = Number(digits[1]);
  const minute = Number(digits[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

const EN_ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

// A small model mishears short numbers as commoner words far more often than it
// invents them, and these are only ever consulted where a number is already
// expected — so "ate" reads as 8 after "at", and as a verb everywhere else.
const EN_HOMOPHONES: Record<string, number> = { won: 1, tu: 2, too: 2, for: 4, fore: 4, ate: 8 };

/** Zero-words, valid only in the minute slot: "four oh five". */
const EN_ZEROS = new Set(["oh", "o", "zero"]);

/** Words that mark what follows as a time rather than a quantity. */
const EN_LEAD_INS = new Set(["at", "around", "by"]);

/** Marks the minutes as counting up from the hour: "ten past four". */
const EN_PAST = new Set(["past", "after"]);
/** Marks them as counting down to it: "ten to four". */
const EN_TO = new Set(["to", "till", "til", "until"]);

/** A number 0–59 at `i`, spoken ("twenty five") or typed ("25"). */
function readEnNumber(norm: string[], i: number): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;

  if (/^\d{1,2}$/.test(word)) return { value: Number(word), next: i + 1 };

  const tens = EN_TENS[word];
  if (tens !== undefined) {
    const unit = EN_ONES[norm[i + 1]] ?? EN_HOMOPHONES[norm[i + 1]];
    // "twenty five" is one number; "twenty tasks" is just twenty.
    if (unit !== undefined && unit >= 1 && unit <= 9) return { value: tens + unit, next: i + 2 };
    return { value: tens, next: i + 1 };
  }

  const ones = EN_ONES[word] ?? EN_HOMOPHONES[word];
  return ones === undefined ? null : { value: ones, next: i + 1 };
}

/** "am" / "p m" / "in the evening" / "tonight" at `i`. */
function readEnDayPart(norm: string[], i: number): { part: DayPart; next: number } | null {
  const word = norm[i];
  if (!word) return null;

  if (word === "am") return { part: "am", next: i + 1 };
  if (word === "pm") return { part: "pm", next: i + 1 };
  // The model spells the abbreviations out as often as not.
  if ((word === "a" || word === "p") && norm[i + 1] === "m") {
    return { part: word === "p" ? "pm" : "am", next: i + 2 };
  }
  if (word === "tonight") return { part: "night", next: i + 1 };

  // "in the morning", "this afternoon" — the article is optional either way.
  if (word === "in" || word === "this") {
    let j = i + 1;
    if (norm[j] === "the") j += 1;
    const part = norm[j];
    if (part === "morning") return { part: "am", next: j + 1 };
    if (part === "afternoon" || part === "evening") return { part: "pm", next: j + 1 };
    if (part === "night") return { part: "night", next: j + 1 };
  }
  if (word === "at" && norm[i + 1] === "night") return { part: "night", next: i + 2 };

  return null;
}

/** The minutes trailing an hour: "o'clock", "thirty", "oh five". */
function readEnMinutes(norm: string[], i: number): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;

  if (word === "oclock") return { value: 0, next: i + 1 };
  // Military-style "seventeen hundred".
  if (word === "hundred") return { value: 0, next: i + 1 };

  if (EN_ZEROS.has(word)) {
    const unit = readEnNumber(norm, i + 1);
    if (unit && unit.value <= 9) return { value: unit.value, next: unit.next };
    return null;
  }

  const number = readEnNumber(norm, i);
  if (!number || number.value > 59) return null;
  // Single digits are only minutes when announced as such ("four oh five"),
  // handled above. A bare one here is far likelier to be the next word of the
  // task — "at two three people" must not become 2:03.
  if (number.value < 10 && !/^\d/.test(word)) return null;
  return { value: number.value, next: number.next };
}

function matchEnglishAt(norm: string[], i: number): Match | null {
  const start = i;
  let j = i;

  const leadIn = EN_LEAD_INS.has(norm[j]);
  if (leadIn) j += 1;

  // "at noon" / "midnight" — no ambiguity to resolve.
  if (norm[j] === "noon" || norm[j] === "midday") {
    return { start, end: j + 1, hour: 12, minute: 0, explicitHalf: true };
  }
  if (norm[j] === "midnight") {
    return { start, end: j + 1, hour: 0, minute: 0, explicitHalf: true };
  }

  // "half past four", "quarter to five", "ten past two". Tried before the plain
  // hour so that "at ten to four" doesn't match "at ten" and orphan "to four".
  const offsetWord = norm[j];
  const offset =
    offsetWord === "half"
      ? 30
      : offsetWord === "quarter"
        ? 15
        : (readEnNumber(norm, j)?.value ?? null);
  if (offset !== null && offset >= 1 && offset <= 59) {
    const afterOffset =
      offsetWord === "half" || offsetWord === "quarter" ? j + 1 : readEnNumber(norm, j)!.next;
    const direction = norm[afterOffset];
    if (EN_PAST.has(direction) || EN_TO.has(direction)) {
      const anchor = readEnNumber(norm, afterOffset + 1);
      if (anchor && anchor.value >= 1 && anchor.value <= 23) {
        let hour = anchor.value;
        let minute = offset;
        if (EN_TO.has(direction)) {
          minute = 60 - offset;
          hour = previousHour(hour);
        }
        const dayPart = readEnDayPart(norm, anchor.next);
        let end = anchor.next;
        let explicitHalf = false;
        if (dayPart) {
          hour = applyDayPart(hour, dayPart.part);
          end = dayPart.next;
          explicitHalf = true;
        }
        return { start, end, hour, minute, explicitHalf };
      }
    }
  }

  // Plain "<hour> [minutes] [am/pm]".
  const hourWord = norm[j] ?? "";
  const clockFace = readClockFace(hourWord);
  // Words that are only ever said about clocks, so they vouch for the match on
  // their own. A bare number never does — that's the whole ambiguity here.
  let timeWord = !!clockFace;

  let hour: number;
  let minute = 0;
  let end: number;
  let explicitHalf = false;

  if (clockFace) {
    hour = clockFace.hour;
    minute = clockFace.minute;
    end = j + 1;
  } else {
    const hourNumber = readEnNumber(norm, j);
    if (!hourNumber) return null;
    hour = hourNumber.value;
    if (hour > 23) return null;
    end = hourNumber.next;

    const minutes = readEnMinutes(norm, end);
    if (minutes) {
      minute = minutes.value;
      timeWord = norm[end] === "oclock" || norm[end] === "hundred";
      end = minutes.next;
    }
  }

  const dayPart = readEnDayPart(norm, end);
  if (dayPart) {
    hour = applyDayPart(hour, dayPart.part);
    end = dayPart.next;
    explicitHalf = true;
  }

  // What's left is a number sitting in a sentence, so it needs something else
  // in the phrasing to vouch for it. An hour past twelve counts only when it
  // was typed as digits: "17" is a deliberate 24-hour time, but "twenty" is
  // nearly always counting something ("email twenty people").
  const typedDigits = /^\d/.test(hourWord);
  if (!leadIn && !explicitHalf && !timeWord && !(typedDigits && hour >= 13)) return null;

  return { start, end, hour, minute, explicitHalf };
}

// ---------------------------------------------------------------------------
// Polish
// ---------------------------------------------------------------------------
//
// The hour is an inflected ordinal, and which ending it takes depends on the
// phrase it sits in — "o piątej" (locative) but "za kwadrans piąta"
// (nominative). Folding the diacritics away collapses the accusative "piątą"
// onto the nominative "piąta" for free, so "na piątą" needs no third table.

/** Hour after "o", "wpół do" or "po": o pi**ątej**. */
const PL_HOUR_INFLECTED: Record<string, number> = {
  pierwszej: 1,
  drugiej: 2,
  trzeciej: 3,
  czwartej: 4,
  piatej: 5,
  szostej: 6,
  siodmej: 7,
  osmej: 8,
  dziewiatej: 9,
  dziesiatej: 10,
  jedenastej: 11,
  dwunastej: 12,
  trzynastej: 13,
  czternastej: 14,
  pietnastej: 15,
  szesnastej: 16,
  siedemnastej: 17,
  osiemnastej: 18,
  dziewietnastej: 19,
  dwudziestej: 20,
};

/** Hour after "za": za kwadrans pi**ąta**. Also covers "na piątą". */
const PL_HOUR_PLAIN: Record<string, number> = {
  pierwsza: 1,
  druga: 2,
  trzecia: 3,
  czwarta: 4,
  piata: 5,
  szosta: 6,
  siodma: 7,
  osma: 8,
  dziewiata: 9,
  dziesiata: 10,
  jedenasta: 11,
  dwunasta: 12,
  trzynasta: 13,
  czternasta: 14,
  pietnasta: 15,
  szesnasta: 16,
  siedemnasta: 17,
  osiemnasta: 18,
  dziewietnasta: 19,
  dwudziesta: 20,
};

const PL_MIN_ONES: Record<string, number> = {
  zero: 0,
  jeden: 1,
  jedna: 1,
  dwa: 2,
  dwie: 2,
  trzy: 3,
  cztery: 4,
  piec: 5,
  szesc: 6,
  siedem: 7,
  osiem: 8,
  dziewiec: 9,
  dziesiec: 10,
  jedenascie: 11,
  dwanascie: 12,
  trzynascie: 13,
  czternascie: 14,
  pietnascie: 15,
  szesnascie: 16,
  siedemnascie: 17,
  osiemnascie: 18,
  dziewietnascie: 19,
};

const PL_MIN_TENS: Record<string, number> = {
  dwadziescia: 20,
  trzydziesci: 30,
  czterdziesci: 40,
  piecdziesiat: 50,
};

/** "o" (at), "około" (around), "na" (for). */
const PL_LEAD_INS = new Set(["o", "okolo", "na"]);

/**
 * An hour from one of the ordinal tables, joined up when it's two words:
 * "dwudziestej pierwszej" is 21.
 */
function readPlHour(
  norm: string[],
  i: number,
  table: Record<string, number>,
): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;
  if (/^\d{1,2}$/.test(word)) return { value: Number(word), next: i + 1 };

  const base = table[word];
  if (base === undefined) return null;
  if (base === 20) {
    const unit = table[norm[i + 1]];
    if (unit !== undefined && unit >= 1 && unit <= 4) return { value: 20 + unit, next: i + 2 };
  }
  return { value: base, next: i + 1 };
}

/** A cardinal 0–59: "dwadzieścia pięć". */
function readPlNumber(norm: string[], i: number): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;
  if (/^\d{1,2}$/.test(word)) return { value: Number(word), next: i + 1 };

  const tens = PL_MIN_TENS[word];
  if (tens !== undefined) {
    const unit = PL_MIN_ONES[norm[i + 1]];
    if (unit !== undefined && unit >= 1 && unit <= 9) return { value: tens + unit, next: i + 2 };
    return { value: tens, next: i + 1 };
  }

  const ones = PL_MIN_ONES[word];
  return ones === undefined ? null : { value: ones, next: i + 1 };
}

/** "rano", "po południu", "wieczorem", "w nocy". */
function readPlDayPart(norm: string[], i: number): { part: DayPart; next: number } | null {
  const word = norm[i];
  if (!word) return null;

  if (word === "rano") return { part: "am", next: i + 1 };
  if (word === "nad" && norm[i + 1] === "ranem") return { part: "am", next: i + 2 };
  if (word === "wieczorem") return { part: "pm", next: i + 1 };
  // "po południu" — dative, so distinct from the noon "w południe" below.
  if (word === "po" && norm[i + 1] === "poludniu") return { part: "pm", next: i + 2 };
  if (word === "w" && norm[i + 1] === "nocy") return { part: "night", next: i + 2 };

  return null;
}

/** The minutes trailing an hour: "o piątej trzydzieści". */
function readPlMinutes(norm: string[], i: number): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;

  if (word === "zero") {
    const unit = readPlNumber(norm, i + 1);
    if (unit && unit.value <= 9) return { value: unit.value, next: unit.next };
    return null;
  }

  const number = readPlNumber(norm, i);
  if (!number || number.value > 59) return null;
  // Same guard as English: a bare small number after the hour is far likelier
  // to be the next word of the task than a minute nobody announced.
  if (number.value < 10 && !/^\d/.test(word)) return null;
  return { value: number.value, next: number.next };
}

function matchPolishAt(norm: string[], i: number): Match | null {
  const start = i;
  let j = i;

  const leadInWord = PL_LEAD_INS.has(norm[j]) ? norm[j] : null;
  const leadIn = leadInWord !== null;
  if (leadIn) j += 1;

  // "w południe" / "o północy".
  if (norm[j] === "poludnie" || (norm[j] === "w" && norm[j + 1] === "poludnie")) {
    return {
      start,
      end: norm[j] === "w" ? j + 2 : j + 1,
      hour: 12,
      minute: 0,
      explicitHalf: true,
    };
  }
  if (norm[j] === "polnocy" || norm[j] === "polnoc") {
    return { start, end: j + 1, hour: 0, minute: 0, explicitHalf: true };
  }

  // "wpół do piątej" — half an hour *before* five, so 4:30. Written as one word
  // or two depending on who is typing.
  let afterWpol: number | null = null;
  if (norm[j] === "wpol" && norm[j + 1] === "do") afterWpol = j + 2;
  else if (norm[j] === "w" && norm[j + 1] === "pol" && norm[j + 2] === "do") afterWpol = j + 3;
  if (afterWpol !== null) {
    const anchor = readPlHour(norm, afterWpol, PL_HOUR_INFLECTED);
    if (anchor && anchor.value >= 1 && anchor.value <= 24) {
      let hour = previousHour(anchor.value === 24 ? 0 : anchor.value);
      let end = anchor.next;
      let explicitHalf = false;
      const dayPart = readPlDayPart(norm, anchor.next);
      if (dayPart) {
        hour = applyDayPart(hour, dayPart.part);
        end = dayPart.next;
        explicitHalf = true;
      }
      return { start, end, hour, minute: 30, explicitHalf };
    }
  }

  // "za kwadrans piąta", "za dziesięć piąta" — counting down to a plain hour.
  if (norm[j] === "za") {
    const offset =
      norm[j + 1] === "kwadrans" ? { value: 15, next: j + 2 } : readPlNumber(norm, j + 1);
    if (offset && offset.value >= 1 && offset.value <= 59) {
      const anchor = readPlHour(norm, offset.next, PL_HOUR_PLAIN);
      if (anchor && anchor.value >= 1 && anchor.value <= 24) {
        let hour = previousHour(anchor.value === 24 ? 0 : anchor.value);
        let end = anchor.next;
        let explicitHalf = false;
        const dayPart = readPlDayPart(norm, anchor.next);
        if (dayPart) {
          hour = applyDayPart(hour, dayPart.part);
          end = dayPart.next;
          explicitHalf = true;
        }
        return { start, end, hour, minute: 60 - offset.value, explicitHalf };
      }
    }
  }

  // "kwadrans po piątej", "dziesięć po piątej" — counting up from an inflected
  // hour. Tried before the plain form so "po" can't be mistaken for a lead-in.
  const offsetWord = norm[j];
  const offset = offsetWord === "kwadrans" ? { value: 15, next: j + 1 } : readPlNumber(norm, j);
  if (offset && offset.value >= 1 && offset.value <= 59 && norm[offset.next] === "po") {
    const anchor = readPlHour(norm, offset.next + 1, PL_HOUR_INFLECTED);
    if (anchor && anchor.value >= 1 && anchor.value <= 24) {
      let hour = anchor.value === 24 ? 0 : anchor.value;
      let end = anchor.next;
      let explicitHalf = false;
      const dayPart = readPlDayPart(norm, anchor.next);
      if (dayPart) {
        hour = applyDayPart(hour, dayPart.part);
        end = dayPart.next;
        explicitHalf = true;
      }
      return { start, end, hour, minute: offset.value, explicitHalf };
    }
  }

  // Plain "o <hour> [minutes] [rano/wieczorem/…]".
  const hourWord = norm[j] ?? "";
  const clockFace = readClockFace(hourWord);

  let hour: number;
  let minute = 0;
  let end: number;
  let explicitHalf = false;
  let sawMinutes = false;

  if (clockFace) {
    hour = clockFace.hour;
    minute = clockFace.minute;
    end = j + 1;
  } else {
    // Either inflection can turn up here: "o piątej" is the usual one, but
    // "na piątą" folds onto the plain table.
    const hourNumber = readPlHour(norm, j, PL_HOUR_INFLECTED) ?? readPlHour(norm, j, PL_HOUR_PLAIN);
    if (!hourNumber) return null;
    hour = hourNumber.value === 24 ? 0 : hourNumber.value;
    if (hour > 23) return null;
    end = hourNumber.next;

    const minutes = readPlMinutes(norm, end);
    if (minutes) {
      minute = minutes.value;
      end = minutes.next;
      sawMinutes = true;
    }
  }

  const dayPart = readPlDayPart(norm, end);
  if (dayPart) {
    hour = applyDayPart(hour, dayPart.part);
    end = dayPart.next;
    explicitHalf = true;
  }

  // An inflected ordinal past twelve ("siedemnastej") is only ever said about
  // a clock, so it stands on its own. Below that, "o" or a named part of the
  // day has to vouch for it — the bare forms double as ordinary adjectives
  // ("piąta lekcja").
  if (!leadIn && !explicitHalf && !clockFace && hour < 13) return null;

  // "na" is the weakest lead-in of the three: "na piątą" is a time, but "na
  // drugą stronę" is an ordinary noun phrase built exactly the same way, and
  // folding the diacritics makes the two forms identical. So after "na" the
  // hour has to end the sentence or carry minutes or a part of the day —
  // anything still trailing means it was modifying a noun, not naming a time.
  if (leadInWord === "na" && !explicitHalf && !sawMinutes && !clockFace && end < norm.length) {
    return null;
  }

  return { start, end, hour, minute, explicitHalf };
}

// ---------------------------------------------------------------------------
// Dates — shared resolution
// ---------------------------------------------------------------------------

type DateMatch = {
  start: number;
  end: number;
  date: Date;
};

/**
 * The next weekday strictly ahead of today, so "Monday" said on a Monday means
 * the coming one rather than the day that is already half over. Someone who
 * means today has a shorter word for it.
 */
function nextWeekday(today: Date, target: number): Date {
  const delta = (target - today.getDay() + 7) % 7;
  return addDays(today, delta === 0 ? 7 : delta);
}

/**
 * The next date with this day number, optionally pinned to a month. Walks
 * forward a month at a time so "the 31st" skips the months that haven't got
 * one instead of silently landing on the 1st.
 */
function onDayOfMonth(today: Date, day: number, month: number | null): Date | null {
  if (day < 1 || day > 31) return null;

  const candidates: Date[] = [];
  if (month === null) {
    for (let ahead = 0; ahead < 13; ahead += 1) {
      candidates.push(new Date(today.getFullYear(), today.getMonth() + ahead, day));
    }
  } else {
    candidates.push(new Date(today.getFullYear(), month, day));
    candidates.push(new Date(today.getFullYear() + 1, month, day));
  }

  for (const candidate of candidates) {
    // A day the month doesn't have rolls over into the next one — reject that
    // rather than book the wrong date.
    if (candidate.getDate() !== day) continue;
    if (candidate >= today) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates — English
// ---------------------------------------------------------------------------

const EN_WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const EN_MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const EN_ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
};

/** Words that mark a following weekday as scheduling rather than describing. */
const EN_DATE_LEAD_INS = new Set(["on", "this", "next", "coming", "by", "for"]);

/** A day of the month: "fifteenth", "twenty first", "15th", "15". */
function readEnDayNumber(norm: string[], i: number): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;

  const suffixed = /^(\d{1,2})(st|nd|rd|th)$/.exec(word);
  if (suffixed) return { value: Number(suffixed[1]), next: i + 1 };
  if (/^\d{1,2}$/.test(word)) return { value: Number(word), next: i + 1 };

  // "twenty first", "thirty first".
  const tens = EN_TENS[word];
  if (tens === 20 || tens === 30) {
    const unit = EN_ORDINALS[norm[i + 1]];
    if (unit !== undefined && unit >= 1 && unit <= 9) return { value: tens + unit, next: i + 2 };
  }

  const ordinal = EN_ORDINALS[word];
  if (ordinal === undefined) return null;
  // Never read the tail of a compound as a number of its own. The scan tries
  // every starting word, so without this "the thirty first of September" —
  // a day September hasn't got — quietly falls through to "first of
  // September" and books the wrong date instead of declining.
  const preceding = EN_TENS[norm[i - 1]];
  if (i > 0 && (preceding === 20 || preceding === 30) && ordinal <= 9) return null;
  return { value: ordinal, next: i + 1 };
}

function matchEnglishDateAt(norm: string[], i: number, today: Date): DateMatch | null {
  const start = i;
  const word = norm[i];
  if (!word) return null;

  // Plain names for a day — never ambiguous, so they need nothing around them.
  if (word === "today") return { start, end: i + 1, date: today };
  if (word === "tomorrow") return { start, end: i + 1, date: addDays(today, 1) };
  if (word === "overmorrow") return { start, end: i + 1, date: addDays(today, 2) };
  if (word === "day" && norm[i + 1] === "after" && norm[i + 2] === "tomorrow") {
    return { start, end: i + 3, date: addDays(today, 2) };
  }
  if (
    word === "the" &&
    norm[i + 1] === "day" &&
    norm[i + 2] === "after" &&
    norm[i + 3] === "tomorrow"
  ) {
    return { start, end: i + 4, date: addDays(today, 2) };
  }

  // "next week" / "next Monday" — "next" alone only means anything with a unit.
  if (word === "next" && (norm[i + 1] === "week" || norm[i + 1] === "monday")) {
    if (norm[i + 1] === "week") return { start, end: i + 2, date: addDays(today, 7) };
  }
  if (word === "next" && norm[i + 1] === "month") {
    return { start, end: i + 2, date: addDays(today, 30) };
  }

  // "in three days", "in a week", "in two weeks".
  if (word === "in") {
    const article = norm[i + 1] === "a" || norm[i + 1] === "an";
    const count = article ? { value: 1, next: i + 2 } : readEnNumber(norm, i + 1);
    if (count && count.value >= 1 && count.value <= 365) {
      const unit = norm[count.next];
      if (unit === "days" || unit === "day") {
        return { start, end: count.next + 1, date: addDays(today, count.value) };
      }
      if (unit === "weeks" || unit === "week") {
        return { start, end: count.next + 1, date: addDays(today, count.value * 7) };
      }
    }
  }

  // [on|this|next|…] <weekday>
  const leadIn = EN_DATE_LEAD_INS.has(word);
  const weekdayAt = leadIn ? i + 1 : i;
  const weekday = EN_WEEKDAYS[norm[weekdayAt]];
  if (weekday !== undefined) {
    const end = weekdayAt + 1;
    // A weekday in the middle of a sentence is usually describing something
    // ("review Monday notes"); at either edge of it, or after a preposition,
    // it is scheduling. Guessing wrong here silently moves the task a week.
    if (leadIn || start === 0 || end === norm.length) {
      return { start, end, date: nextWeekday(today, weekday) };
    }
  }

  // [on] [the] <day> [of] [<month>], and "March fifteenth".
  let j = i;
  const datePreposition = word === "on";
  if (datePreposition) j += 1;
  const article = norm[j] === "the";
  if (article) j += 1;

  const monthFirst = EN_MONTHS[norm[j]];
  if (monthFirst !== undefined) {
    const day = readEnDayNumber(norm, j + 1);
    if (day) {
      const date = onDayOfMonth(today, day.value, monthFirst);
      if (date) return { start, end: day.next, date };
    }
  }

  const day = readEnDayNumber(norm, j);
  // A bare number is a quantity until something says otherwise: "the" or "on"
  // in front of it, or a month behind it.
  if (day) {
    let end = day.next;
    let month: number | null = null;
    let k = day.next;
    if (norm[k] === "of") k += 1;
    const named = EN_MONTHS[norm[k]];
    if (named !== undefined) {
      month = named;
      end = k + 1;
    }
    if (article || datePreposition || month !== null) {
      const date = onDayOfMonth(today, day.value, month);
      if (date) return { start, end, date };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dates — Polish
// ---------------------------------------------------------------------------
//
// Weekdays turn up in the accusative after "w" ("w środę"), so both that and
// the dictionary form are listed. Days of the month are genitive
// ("piętnastego"), which is a form nothing else uses — so unlike the English
// "the fifteenth", it needs no preposition to be recognisable.

const PL_WEEKDAYS: Record<string, number> = {
  niedziela: 0,
  niedziele: 0,
  poniedzialek: 1,
  wtorek: 2,
  sroda: 3,
  srode: 3,
  czwartek: 4,
  piatek: 5,
  sobota: 6,
  sobote: 6,
};

const PL_MONTHS: Record<string, number> = {
  stycznia: 0,
  lutego: 1,
  marca: 2,
  kwietnia: 3,
  maja: 4,
  czerwca: 5,
  lipca: 6,
  sierpnia: 7,
  wrzesnia: 8,
  pazdziernika: 9,
  listopada: 10,
  grudnia: 11,
};

const PL_DAY_ORDINALS: Record<string, number> = {
  pierwszego: 1,
  drugiego: 2,
  trzeciego: 3,
  czwartego: 4,
  piatego: 5,
  szostego: 6,
  siodmego: 7,
  osmego: 8,
  dziewiatego: 9,
  dziesiatego: 10,
  jedenastego: 11,
  dwunastego: 12,
  trzynastego: 13,
  czternastego: 14,
  pietnastego: 15,
  szesnastego: 16,
  siedemnastego: 17,
  osiemnastego: 18,
  dziewietnastego: 19,
  dwudziestego: 20,
  trzydziestego: 30,
};

/** "w"/"we" (on), "na" (for), plus the "przyszły" family for "next". */
const PL_DATE_LEAD_INS = new Set(["w", "we", "na"]);
const PL_NEXT = new Set(["przyszly", "przyszla", "przyszlym", "przyszlo", "nastepny", "nastepna"]);

/** A day of the month: "piętnastego", "dwudziestego pierwszego", "15". */
function readPlDayNumber(norm: string[], i: number): { value: number; next: number } | null {
  const word = norm[i];
  if (!word) return null;
  if (/^\d{1,2}$/.test(word)) return { value: Number(word), next: i + 1 };

  const base = PL_DAY_ORDINALS[word];
  if (base === undefined) return null;
  if (base === 20 || base === 30) {
    const unit = PL_DAY_ORDINALS[norm[i + 1]];
    if (unit !== undefined && unit >= 1 && unit <= 9) return { value: base + unit, next: i + 2 };
  }
  return { value: base, next: i + 1 };
}

function matchPolishDateAt(norm: string[], i: number, today: Date): DateMatch | null {
  const start = i;
  const word = norm[i];
  if (!word) return null;

  if (word === "dzis" || word === "dzisiaj") return { start, end: i + 1, date: today };
  if (word === "jutro") return { start, end: i + 1, date: addDays(today, 1) };
  if (word === "pojutrze") return { start, end: i + 1, date: addDays(today, 2) };

  // "za trzy dni", "za tydzień", "za dwa tygodnie".
  if (word === "za") {
    const unitAt = norm[i + 1];
    if (unitAt === "tydzien") return { start, end: i + 2, date: addDays(today, 7) };
    if (unitAt === "miesiac") return { start, end: i + 2, date: addDays(today, 30) };

    const count = readPlNumber(norm, i + 1);
    if (count && count.value >= 1 && count.value <= 365) {
      const unit = norm[count.next];
      if (unit === "dni" || unit === "dzien") {
        return { start, end: count.next + 1, date: addDays(today, count.value) };
      }
      if (unit === "tygodnie" || unit === "tygodni") {
        return { start, end: count.next + 1, date: addDays(today, count.value * 7) };
      }
    }
  }

  // "w przyszłym tygodniu", "w przyszły poniedziałek".
  let j = i;
  const leadIn = PL_DATE_LEAD_INS.has(word);
  if (leadIn) j += 1;
  const sawNext = PL_NEXT.has(norm[j]);
  if (sawNext) j += 1;

  if (sawNext && (norm[j] === "tygodniu" || norm[j] === "tydzien")) {
    return { start, end: j + 1, date: addDays(today, 7) };
  }
  if (sawNext && (norm[j] === "miesiacu" || norm[j] === "miesiac")) {
    return { start, end: j + 1, date: addDays(today, 30) };
  }

  const weekday = PL_WEEKDAYS[norm[j]];
  if (weekday !== undefined) {
    const end = j + 1;
    // Same edge rule as English: "w środę" is scheduling, but a weekday buried
    // mid-sentence is usually naming something.
    if (leadIn || sawNext || start === 0 || end === norm.length) {
      return { start, end, date: nextWeekday(today, weekday) };
    }
  }

  // "piętnastego", "piętnastego marca".
  const day = readPlDayNumber(norm, i);
  if (day) {
    const named = PL_MONTHS[norm[day.next]];
    const month = named === undefined ? null : named;
    // A bare figure ("15") could be anything; the genitive ordinal could not.
    const spelled = !/^\d/.test(word);
    if (spelled || month !== null) {
      const date = onDayOfMonth(today, day.value, month);
      if (date) return { start, end: month === null ? day.next : day.next + 1, date };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const TIME_MATCHERS: Record<Language, (norm: string[], i: number) => Match | null> = {
  en: matchEnglishAt,
  pl: matchPolishAt,
};

const DATE_MATCHERS: Record<
  Language,
  (norm: string[], i: number, today: Date) => DateMatch | null
> = {
  en: matchEnglishDateAt,
  pl: matchPolishDateAt,
};

type Span = { start: number; end: number };

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function findTime(norm: string[], lang: Language): { span: Span; time: string } | null {
  const matchAt = TIME_MATCHERS[lang];
  if (!matchAt) return null;

  for (let i = 0; i < norm.length; i += 1) {
    const match = matchAt(norm, i);
    if (!match) continue;

    const hour = match.explicitHalf ? match.hour : resolveHalf(match.hour);
    if (hour > 23 || match.minute > 59) continue;

    return { span: { start: match.start, end: match.end }, time: toClock(hour, match.minute) };
  }
  return null;
}

function findDate(
  norm: string[],
  lang: Language,
  today: Date,
  taken: Span | null,
): { span: Span; date: Date } | null {
  const matchAt = DATE_MATCHERS[lang];
  if (!matchAt) return null;

  for (let i = 0; i < norm.length; i += 1) {
    if (taken && i >= taken.start && i < taken.end) continue;
    const match = matchAt(norm, i, today);
    if (!match) continue;
    // The time phrase has already claimed its words; a date reading that wants
    // the same ones is reaching.
    if (taken && overlaps(match, taken)) continue;
    return { span: { start: match.start, end: match.end }, date: match.date };
  }
  return null;
}

/**
 * Pulls a time, a date, or both out of `text` and returns them with those
 * phrases cut out of the title, or null when nothing was said clearly enough
 * to act on. `now` is injectable so the relative forms ("tomorrow", "za trzy
 * dni") can be tested against a fixed day.
 */
export function extractSchedule(
  text: string,
  lang: Language,
  now: Date = new Date(),
): SpokenSchedule | null {
  const { raw, norm } = splitWords(text);
  const today = startOfDay(now);

  const time = findTime(norm, lang);
  const date = findDate(norm, lang, today, time?.span ?? null);
  if (!time && !date) return null;

  const dropped = new Set<number>();
  for (const span of [time?.span, date?.span]) {
    if (!span) continue;
    for (let k = span.start; k < span.end; k += 1) dropped.add(k);
  }

  const title = raw
    .filter((_, index) => !dropped.has(index))
    .join(" ")
    .trim();

  return { time: time?.time ?? null, date: date?.date ?? null, title };
}
