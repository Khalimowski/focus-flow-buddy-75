import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/Logo";
import { useI18nStore, type Language } from "@/lib/i18n";

// Public privacy policy page. Google Play wants a policy URL reachable without
// installing the app, and pointing that at a file in the GitHub repo means the
// link dies the day the repo goes private — so it lives here, outside the
// AuthGate and the PremiumGate, exactly like /delete-account.
//
// The text is kept in step with PRIVACY.md at the repo root by hand. If you
// change one, change the other: PRIVACY.md is what the repo shows, this is what
// users and Play reviewers read. Neither is generated from the other.
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — FlowDay" },
      {
        name: "description",
        content: "What FlowDay stores, what leaves your device, and who else is involved.",
      },
    ],
  }),
  component: PrivacyPage,
});

const UPDATED: Record<Language, string> = {
  en: "Last updated: August 25, 2026",
  pl: "Ostatnia aktualizacja: 25 sierpnia 2026",
};

type Block = { p: string } | { ul: string[] };
type Section = { heading: string; blocks: Block[] };

// Inline markup understood by renderInline below: **bold** and [label](href).
// A whole markdown renderer would be a dependency, and adding one means keeping
// bun.lock and package-lock.json in step for two lines of formatting.
const LINK_OR_BOLD = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g;

function renderInline(text: string): ReactNode[] {
  return text
    .split(LINK_OR_BOLD)
    .filter(Boolean)
    .map((piece, i) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(piece);
      if (link) {
        const [, label, href] = link;
        const internal = href.startsWith("/");
        return internal ? (
          <Link key={i} to={href} className="underline underline-offset-2">
            {label}
          </Link>
        ) : (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {label}
          </a>
        );
      }
      const bold = /^\*\*([^*]+)\*\*$/.exec(piece);
      if (bold) {
        return (
          <strong key={i} className="font-medium text-foreground">
            {bold[1]}
          </strong>
        );
      }
      return <span key={i}>{piece}</span>;
    });
}

const POLICY: Record<Language, Section[]> = {
  en: [
    {
      heading: "The short version",
      blocks: [
        {
          ul: [
            "**Guest mode keeps everything on your phone.** No account, no server, nothing transmitted. It is available on Android only.",
            "**With an account, your task data syncs** to a private row in our database in the EU so your phone and your browser stay in step. We do not read, mine, profile or sell it.",
            "**There is no analytics SDK and no crash-reporting SDK.** The Insights screen is calculated on your device from your own data.",
            "**The free Android version shows ads** (Google AdMob), which use the Android advertising ID. Premium removes them.",
            "**Google Calendar/Gmail and voice dictation are optional and off by default.**",
          ],
        },
      ],
    },
    {
      heading: "Guest mode vs. an account",
      blocks: [
        {
          p: "**Guest mode (Android only).** Tap “continue as guest” and the app never contacts our servers at all. Everything under “Data stored on your device” applies; nothing under “Data that syncs to the cloud” does. Uninstalling the app deletes the data.",
        },
        {
          p: "**With an account.** Signing in exists so the same tasks appear on your phone and in the browser. The browser version always requires an account — there is no guest mode on the web.",
        },
      ],
    },
    {
      heading: "Data stored on your device",
      blocks: [
        { p: "Saved in the app's private storage (Android) or your browser's local storage:" },
        {
          ul: [
            "Tasks, to-do items, and habits (recurring reminders) you create",
            "Your streak, and per-day activity counters that power the Insights screen",
            "The short “AI coach” profile you can fill in: life stage, usual work or school hours, and which sports you do on which days",
            "App preferences (theme, language, notification, calendar and vibration settings)",
            "AI-coach suggestion history and in-app notifications",
            "Your Premium entitlement, if you bought it",
            "Your Google access token, if you connected Google",
          ],
        },
        {
          p: "You can inspect what the coach has recorded under **Settings → AI Insights → Inspect AI Memory**.",
        },
      ],
    },
    {
      heading: "Data that syncs to the cloud (accounts only)",
      blocks: [
        {
          p: "When you are signed in, these values are mirrored to your own row in our database and pulled back onto your other devices:",
        },
        {
          ul: [
            "Tasks, to-do items, habits, and your streak",
            "The AI-coach profile answers listed above",
            "The Insights activity counters",
            "Your Premium entitlement",
            "Whether the Google Calendar/Gmail features are switched on",
          ],
        },
        {
          p: "**Where it lives.** A managed Postgres database run by Neon, hosted on AWS in eu-central-1 (Frankfurt, EU). Every row is protected by Postgres row-level security keyed to your account, so one account cannot read another's data. The values are stored exactly as your device wrote them — they are not analysed, enriched, or shared with anyone.",
        },
        {
          p: "**There is no application server.** The app talks to the database directly from your device, which is also why the same code can run inside the Android app.",
        },
        {
          p: "**Deliberately not synced:** your Google access token, your theme and language, device-local prompts, and anything to do with dictation.",
        },
      ],
    },
    {
      heading: "Your account",
      blocks: [
        {
          p: "Accounts are handled by Neon Auth. We store your **email address** and a **hashed password** (we never see the password itself), plus the session that keeps you signed in. Your email address is used to sign you in, to send a one-time code if you reset your password, and — if you buy Premium — to send you the link to the browser version. It is not used for marketing and is not shared.",
        },
      ],
    },
    {
      heading: "Permissions the app requests and why",
      blocks: [
        {
          ul: [
            "**Notifications** — to show the task reminders and daily habits you schedule. Optional.",
            "**Exact alarms** — so reminders fire at the exact time you chose, even when the app is closed.",
            "**Calendar (read/write)** — only if you enable “Sync to Calendar” in Settings, to add and remove your own tasks and habits in your device calendar. Optional; off by default.",
            "**Microphone** — only for voice dictation, which runs offline. Optional; decline it and the dictation button stays hidden.",
            "**Run at startup** — to re-register your scheduled reminders after the phone reboots.",
            "**Advertising ID** — used by the ad banner in the free version only.",
            "**Internet** — for cloud sync, the optional Google features, the update check, and ads.",
          ],
        },
      ],
    },
    {
      heading: "Optional: Google Calendar and Gmail",
      blocks: [
        {
          p: "Off by default. If you turn them on in Settings, the app asks Google for permission and then:",
        },
        {
          ul: [
            "**Calendar** (calendar.events) — creates, updates and removes calendar events for the tasks and habits *you* made in FlowDay. It does not read the rest of your calendar.",
            "**Gmail** (gmail.readonly) — reads only the **Subject, From and Date headers** of recent inbox messages, so you can turn an email into a task. The app requests message metadata only; message bodies and attachments are never fetched.",
          ],
        },
        {
          p: "Nothing from Google is sent to our servers. It is fetched by the app on your device, and a task you create from it is treated like any other task you typed. Your Google access token stays on the device that granted it and is never synced. You can revoke access at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).",
        },
        {
          p: "FlowDay's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
        },
      ],
    },
    {
      heading: "Optional: voice dictation",
      blocks: [
        {
          p: "Speech recognition runs **offline, inside the app**, using a WebAssembly build of Vosk. Your audio is never uploaded, never recorded and never stored — it is turned into text on the device and discarded.",
        },
        {
          p: "The first time you use dictation, the app downloads a speech model (tens of megabytes) from a public static host. That host sees an ordinary file download — IP address and user agent, as any web server does. No audio and no personal data are sent with it.",
        },
      ],
    },
    {
      heading: "Ads (free Android version)",
      blocks: [
        {
          p: "The free Android version shows a banner from **Google AdMob**. AdMob uses the Android **advertising ID** and standard ad-request data (IP address, device and app information) to select and measure ads; that processing is Google's and is governed by [Google's privacy policy](https://policies.google.com/privacy). Where the law requires it, Google's consent prompt is shown before personalised ads are requested.",
        },
        {
          p: "You can reset or delete your advertising ID in Android **Settings → Privacy → Ads**. Buying Premium removes the banner entirely. The web version has no ads.",
        },
      ],
    },
    {
      heading: "Purchases",
      blocks: [
        {
          p: "Premium is a one-time purchase through **Google Play**. Google handles the payment; we never see your card or billing details.",
        },
        {
          p: "To confirm that a purchase is genuine and to email you the link to the browser version, the app can send your **purchase token, order id, product id and account email** to a small service we run on Cloudflare Workers. That service checks the token against Google Play's API and sends you a single email through the delivery provider Resend. The address is not added to any list and is not used for anything else.",
        },
      ],
    },
    {
      heading: "Update check",
      blocks: [
        {
          p: "The Android app fetches a small public version file from GitHub to tell you when a newer build exists. GitHub logs standard connection metadata such as your IP address, as any web server does. No personal data is sent with the request.",
        },
      ],
    },
    {
      heading: "Analytics and tracking",
      blocks: [
        {
          p: "**None.** The app contains no analytics SDK, no crash-reporting SDK and no tracking pixels. The Insights and streak screens are computed on your device from data you already have. The only third party that receives device-level advertising data is AdMob, described above, and only in the free Android version.",
        },
        {
          p: "One exception worth naming: a preview build of the web app is hosted on Lovable, and that hosting environment can capture JavaScript error reports. The Google Play app and flowday.day do not.",
        },
      ],
    },
    {
      heading: "Hosting",
      blocks: [
        {
          p: "The web app is served by Cloudflare Workers, which processes standard request logs (IP address, user agent, requested URL) as part of delivering the site.",
        },
      ],
    },
    {
      heading: "Children",
      blocks: [
        {
          p: "FlowDay is not directed at children under 13, and we do not knowingly collect personal data from them. If you believe a child has created an account, email us and we will delete it.",
        },
      ],
    },
    {
      heading: "Deleting your data",
      blocks: [
        {
          ul: [
            "**Delete your account and everything in it:** [flowday.day/delete-account](/delete-account). It works without installing the app. You confirm with your email and password; the page then deletes every synced row, deletes the account itself, and wipes the copy on the device you used.",
            "**Guest mode / local data:** uninstalling the app — or clearing site data in the browser — removes it. There is nothing else to delete.",
            "**Prefer email?** Write to [khalim163@gmail.com](mailto:khalim163@gmail.com) and we will delete your account for you.",
          ],
        },
      ],
    },
    {
      heading: "Retention",
      blocks: [
        {
          p: "Synced rows stay until you change them, delete them, or delete your account. Our database provider keeps short-lived automatic backups as part of its service; those expire on the provider's own schedule and are not used for anything else.",
        },
      ],
    },
    {
      heading: "Your rights",
      blocks: [
        {
          p: "If you are in the EU/EEA or the UK, you have the right to access, correct, export or delete your personal data, and to object to its processing. The deletion page above covers the common case immediately; for anything else, email [khalim163@gmail.com](mailto:khalim163@gmail.com).",
        },
        {
          p: "We do not sell personal data, and we do not share it with advertisers or data brokers.",
        },
      ],
    },
    {
      heading: "Changes",
      blocks: [
        {
          p: "If this policy changes, the updated version is published at the same URL with a new date.",
        },
      ],
    },
    {
      heading: "Contact",
      blocks: [
        {
          p: "Questions about this policy: [khalim163@gmail.com](mailto:khalim163@gmail.com).",
        },
      ],
    },
  ],
  pl: [
    {
      heading: "W skrócie",
      blocks: [
        {
          ul: [
            "**Tryb gościa zostawia wszystko w telefonie.** Bez konta, bez serwera, nic nie jest wysyłane. Dostępny tylko na Androidzie.",
            "**Z kontem Twoje zadania synchronizują się** do prywatnego wiersza w naszej bazie danych w UE, żeby telefon i przeglądarka miały to samo. Nie czytamy ich, nie analizujemy, nie profilujemy i nie sprzedajemy.",
            "**Nie ma tu żadnego SDK analitycznego ani zgłaszania awarii.** Ekran Statystyk liczy się na Twoim urządzeniu, z Twoich własnych danych.",
            "**Darmowa wersja na Androida wyświetla reklamy** (Google AdMob), które korzystają z identyfikatora reklamowego. Premium je usuwa.",
            "**Kalendarz Google, Gmail i dyktowanie są opcjonalne i domyślnie wyłączone.**",
          ],
        },
      ],
    },
    {
      heading: "Tryb gościa a konto",
      blocks: [
        {
          p: "**Tryb gościa (tylko Android).** Wybierz „kontynuuj jako gość”, a aplikacja w ogóle nie kontaktuje się z naszymi serwerami. Obowiązuje wszystko z sekcji „Dane zapisane na Twoim urządzeniu”; nic z sekcji „Dane synchronizowane z chmurą”. Odinstalowanie aplikacji kasuje te dane.",
        },
        {
          p: "**Z kontem.** Logowanie istnieje po to, żeby te same zadania były w telefonie i w przeglądarce. Wersja przeglądarkowa zawsze wymaga konta — w internecie nie ma trybu gościa.",
        },
      ],
    },
    {
      heading: "Dane zapisane na Twoim urządzeniu",
      blocks: [
        {
          p: "Zapisywane w prywatnej pamięci aplikacji (Android) lub w pamięci lokalnej przeglądarki:",
        },
        {
          ul: [
            "Zadania, lista do zrobienia i nawyki (cykliczne przypomnienia), które tworzysz",
            "Twoja passa oraz dzienne liczniki aktywności zasilające ekran Statystyk",
            "Krótki profil „asystenta AI”, jeśli go wypełnisz: etap życia, zwykłe godziny pracy lub szkoły oraz w które dni uprawiasz sport",
            "Ustawienia aplikacji (motyw, język, powiadomienia, kalendarz, wibracje)",
            "Historia podpowiedzi asystenta i powiadomienia w aplikacji",
            "Twoje uprawnienie Premium, jeśli je kupiłaś/kupiłeś",
            "Token dostępu Google, jeśli połączysz konto Google",
          ],
        },
        {
          p: "To, co zapisał asystent, obejrzysz w **Ustawienia → Statystyki AI → Podejrzyj pamięć AI**.",
        },
      ],
    },
    {
      heading: "Dane synchronizowane z chmurą (tylko konta)",
      blocks: [
        {
          p: "Gdy jesteś zalogowana/zalogowany, te wartości trafiają do Twojego własnego wiersza w naszej bazie i wracają na pozostałe urządzenia:",
        },
        {
          ul: [
            "Zadania, lista do zrobienia, nawyki i passa",
            "Odpowiedzi z profilu asystenta wymienione wyżej",
            "Liczniki aktywności ze Statystyk",
            "Uprawnienie Premium",
            "To, czy funkcje Kalendarza Google i Gmaila są włączone",
          ],
        },
        {
          p: "**Gdzie to leży.** W zarządzanej bazie Postgres prowadzonej przez Neon, hostowanej w AWS w regionie eu-central-1 (Frankfurt, UE). Każdy wiersz chroni zabezpieczenie na poziomie wiersza (RLS) przypisane do Twojego konta, więc jedno konto nie może czytać danych drugiego. Wartości są przechowywane dokładnie tak, jak zapisało je Twoje urządzenie — nie są analizowane, wzbogacane ani nikomu udostępniane.",
        },
        {
          p: "**Nie ma serwera aplikacji.** Aplikacja rozmawia z bazą bezpośrednio z Twojego urządzenia — dlatego ten sam kod działa też w aplikacji na Androida.",
        },
        {
          p: "**Celowo niesynchronizowane:** token dostępu Google, motyw i język, lokalne podpowiedzi oraz wszystko związane z dyktowaniem.",
        },
      ],
    },
    {
      heading: "Twoje konto",
      blocks: [
        {
          p: "Konta obsługuje Neon Auth. Przechowujemy Twój **adres e-mail** oraz **hasło w postaci skrótu** (samego hasła nigdy nie widzimy) i sesję, która utrzymuje Cię zalogowaną/zalogowanym. Adres e-mail służy do logowania, do wysłania jednorazowego kodu przy resetowaniu hasła oraz — jeśli kupisz Premium — do przesłania linku do wersji przeglądarkowej. Nie używamy go do marketingu i nikomu go nie udostępniamy.",
        },
      ],
    },
    {
      heading: "O jakie uprawnienia prosi aplikacja i po co",
      blocks: [
        {
          ul: [
            "**Powiadomienia** — żeby pokazywać zaplanowane przypomnienia o zadaniach i codzienne nawyki. Opcjonalne.",
            "**Dokładne alarmy** — żeby przypomnienia odpalały o wybranej godzinie, nawet gdy aplikacja jest zamknięta.",
            "**Kalendarz (odczyt/zapis)** — tylko jeśli włączysz „Synchronizuj z kalendarzem” w Ustawieniach, żeby dodawać i usuwać Twoje własne zadania i nawyki w kalendarzu urządzenia. Opcjonalne, domyślnie wyłączone.",
            "**Mikrofon** — wyłącznie do dyktowania, które działa offline. Opcjonalne; jeśli odmówisz, przycisk dyktowania po prostu się nie pokaże.",
            "**Uruchamianie przy starcie** — żeby po restarcie telefonu przywrócić zaplanowane przypomnienia.",
            "**Identyfikator reklamowy** — używany tylko przez baner reklamowy w wersji darmowej.",
            "**Internet** — do synchronizacji, opcjonalnych funkcji Google, sprawdzania aktualizacji i reklam.",
          ],
        },
      ],
    },
    {
      heading: "Opcjonalnie: Kalendarz Google i Gmail",
      blocks: [
        {
          p: "Domyślnie wyłączone. Jeśli włączysz je w Ustawieniach, aplikacja poprosi Google o zgodę, a następnie:",
        },
        {
          ul: [
            "**Kalendarz** (calendar.events) — tworzy, aktualizuje i usuwa wydarzenia dla zadań i nawyków, które *Ty* utworzyłaś/utworzyłeś w FlowDay. Nie czyta reszty Twojego kalendarza.",
            "**Gmail** (gmail.readonly) — czyta wyłącznie **nagłówki Temat, Od i Data** ostatnich wiadomości ze skrzynki, żebyś mogła/mógł zamienić e-mail w zadanie. Aplikacja prosi tylko o metadane wiadomości; treści ani załączników nigdy nie pobiera.",
          ],
        },
        {
          p: "Nic z Google nie trafia na nasze serwery. Pobiera to aplikacja na Twoim urządzeniu, a utworzone w ten sposób zadanie traktowane jest jak każde inne, które wpiszesz. Token dostępu Google zostaje na urządzeniu, które go przyznało, i nigdy nie jest synchronizowany. Dostęp możesz w każdej chwili cofnąć na [myaccount.google.com/permissions](https://myaccount.google.com/permissions).",
        },
        {
          p: "Korzystanie przez FlowDay z informacji otrzymanych z interfejsów API Google odbywa się zgodnie z [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), w tym z wymogami Limited Use.",
        },
      ],
    },
    {
      heading: "Opcjonalnie: dyktowanie głosowe",
      blocks: [
        {
          p: "Rozpoznawanie mowy działa **offline, wewnątrz aplikacji**, na kompilacji Vosk w WebAssembly. Twoje nagranie nigdy nie jest wysyłane, zapisywane ani przechowywane — zamienia się w tekst na urządzeniu i znika.",
        },
        {
          p: "Przy pierwszym użyciu dyktowania aplikacja pobiera model mowy (kilkadziesiąt megabajtów) z publicznego serwera plików. Ten serwer widzi zwykłe pobranie pliku — adres IP i wersję przeglądarki, jak każdy serwer WWW. Nie wysyłamy przy tym żadnego dźwięku ani danych osobowych.",
        },
      ],
    },
    {
      heading: "Reklamy (darmowa wersja na Androida)",
      blocks: [
        {
          p: "Darmowa wersja na Androida wyświetla baner **Google AdMob**. AdMob korzysta z **identyfikatora reklamowego** Androida i standardowych danych żądania reklamy (adres IP, informacje o urządzeniu i aplikacji), żeby dobrać i zmierzyć reklamy; to przetwarzanie należy do Google i podlega [polityce prywatności Google](https://policies.google.com/privacy). Tam, gdzie wymaga tego prawo, przed wyświetleniem reklam spersonalizowanych pojawia się okno zgody Google.",
        },
        {
          p: "Identyfikator reklamowy zresetujesz lub usuniesz w **Ustawienia → Prywatność → Reklamy** w Androidzie. Zakup Premium usuwa baner całkowicie. Wersja przeglądarkowa nie ma reklam.",
        },
      ],
    },
    {
      heading: "Zakupy",
      blocks: [
        {
          p: "Premium to jednorazowy zakup przez **Google Play**. Płatność obsługuje Google; nigdy nie widzimy danych Twojej karty ani rozliczeń.",
        },
        {
          p: "Żeby potwierdzić, że zakup jest prawdziwy, i wysłać Ci link do wersji przeglądarkowej, aplikacja może przesłać **token zakupu, identyfikator zamówienia, identyfikator produktu i adres e-mail konta** do niewielkiej usługi, którą prowadzimy na Cloudflare Workers. Usługa sprawdza token w API Google Play i wysyła jeden e-mail przez dostawcę Resend. Adres nie trafia na żadną listę i nie jest używany do niczego innego.",
        },
      ],
    },
    {
      heading: "Sprawdzanie aktualizacji",
      blocks: [
        {
          p: "Aplikacja na Androida pobiera z GitHuba mały publiczny plik z numerem wersji, żeby powiedzieć Ci, że jest nowsza kompilacja. GitHub zapisuje standardowe metadane połączenia, na przykład adres IP, jak każdy serwer WWW. Nie wysyłamy przy tym żadnych danych osobowych.",
        },
      ],
    },
    {
      heading: "Analityka i śledzenie",
      blocks: [
        {
          p: "**Brak.** Aplikacja nie zawiera SDK analitycznego, SDK zgłaszania awarii ani pikseli śledzących. Ekrany Statystyk i passy liczone są na Twoim urządzeniu z danych, które już masz. Jedyną stroną trzecią otrzymującą dane reklamowe urządzenia jest opisany wyżej AdMob — i tylko w darmowej wersji na Androida.",
        },
        {
          p: "Jeden wyjątek wart nazwania: podglądowa kompilacja wersji webowej jest hostowana na Lovable, a to środowisko może zbierać zgłoszenia błędów JavaScriptu. Aplikacja z Google Play i flowday.day tego nie robią.",
        },
      ],
    },
    {
      heading: "Hosting",
      blocks: [
        {
          p: "Wersję webową serwuje Cloudflare Workers, który w ramach dostarczania strony przetwarza standardowe logi żądań (adres IP, przeglądarka, żądany adres).",
        },
      ],
    },
    {
      heading: "Dzieci",
      blocks: [
        {
          p: "FlowDay nie jest kierowany do dzieci poniżej 13. roku życia i świadomie nie zbieramy od nich danych osobowych. Jeśli sądzisz, że konto założyło dziecko, napisz do nas, a je usuniemy.",
        },
      ],
    },
    {
      heading: "Usuwanie danych",
      blocks: [
        {
          ul: [
            "**Usuń konto i wszystko, co w nim jest:** [flowday.day/delete-account](/delete-account). Działa bez instalowania aplikacji. Potwierdzasz e-mailem i hasłem; strona kasuje wtedy każdy zsynchronizowany wiersz, usuwa samo konto i czyści kopię na urządzeniu, z którego korzystasz.",
            "**Tryb gościa / dane lokalne:** znikają po odinstalowaniu aplikacji lub wyczyszczeniu danych witryny w przeglądarce. Nie ma nic więcej do usunięcia.",
            "**Wolisz e-mail?** Napisz na [khalim163@gmail.com](mailto:khalim163@gmail.com), a usuniemy konto za Ciebie.",
          ],
        },
      ],
    },
    {
      heading: "Przechowywanie",
      blocks: [
        {
          p: "Zsynchronizowane wiersze zostają, dopóki ich nie zmienisz, nie skasujesz albo nie usuniesz konta. Nasz dostawca bazy danych utrzymuje w ramach usługi krótkotrwałe kopie automatyczne; wygasają one według jego własnego harmonogramu i nie są używane do niczego innego.",
        },
      ],
    },
    {
      heading: "Twoje prawa",
      blocks: [
        {
          p: "Jeśli jesteś w UE/EOG lub Wielkiej Brytanii, masz prawo dostępu do swoich danych, ich sprostowania, przeniesienia i usunięcia oraz prawo sprzeciwu wobec przetwarzania. Powyższa strona usuwania załatwia typowy przypadek od ręki; w każdej innej sprawie napisz na [khalim163@gmail.com](mailto:khalim163@gmail.com).",
        },
        {
          p: "Nie sprzedajemy danych osobowych i nie udostępniamy ich reklamodawcom ani brokerom danych.",
        },
      ],
    },
    {
      heading: "Zmiany",
      blocks: [
        {
          p: "Jeśli ta polityka się zmieni, zaktualizowaną wersję opublikujemy pod tym samym adresem, z nową datą.",
        },
      ],
    },
    {
      heading: "Kontakt",
      blocks: [
        {
          p: "Pytania o tę politykę: [khalim163@gmail.com](mailto:khalim163@gmail.com).",
        },
      ],
    },
  ],
};

const INTRO: Record<Language, string> = {
  en: "FlowDay (“the app”) is a task, reminder and focus app designed for ADHD brains. It ships as an Android app and as a web app at flowday.day. This policy explains what the app stores, what leaves your device, and who else is involved. FlowDay is made by an independent developer.",
  pl: "FlowDay („aplikacja”) to aplikacja do zadań, przypomnień i skupienia, zaprojektowana dla mózgów z ADHD. Działa jako aplikacja na Androida i jako aplikacja webowa pod adresem flowday.day. Ta polityka wyjaśnia, co aplikacja przechowuje, co opuszcza Twoje urządzenie i kto jeszcze jest w to zaangażowany. FlowDay tworzy niezależny deweloper.",
};

function PrivacyPage() {
  const { theme, language } = useI18nStore();
  // Local to the page: a Play reviewer reading in one language shouldn't have
  // their app-wide language setting changed by looking at the policy.
  const [lang, setLang] = useState<Language>(language);

  useEffect(() => {
    // Standalone route: apply the stored theme ourselves (Home normally does this)
    const root = window.document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme !== "dark");
  }, [theme]);

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="mb-4 size-16" />
          <h1 className="font-serif text-3xl leading-tight">
            {lang === "pl" ? "Polityka prywatności" : "Privacy Policy"}
          </h1>
          <div className="mt-4 h-px w-16 bg-border" />
          <p className="mt-4 text-xs text-muted-foreground">{UPDATED[lang]}</p>

          <div className="mt-5 inline-flex overflow-hidden rounded-full border border-border text-xs">
            {(["en", "pl"] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={
                  lang === code
                    ? "bg-foreground px-4 py-1.5 font-medium text-background"
                    : "px-4 py-1.5 text-muted-foreground hover:text-foreground"
                }
              >
                {code === "en" ? "English" : "Polski"}
              </button>
            ))}
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{INTRO[lang]}</p>

        <div className="mt-10 space-y-9">
          {POLICY[lang].map((section) => (
            <section key={section.heading}>
              <h2 className="font-serif text-lg leading-snug">{section.heading}</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                {section.blocks.map((block, i) =>
                  "ul" in block ? (
                    <ul key={i} className="ml-4 list-disc space-y-2 marker:text-border">
                      {block.ul.map((item, j) => (
                        <li key={j}>{renderInline(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={i}>{renderInline(block.p)}</p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link to="/" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            ← FlowDay
          </Link>
        </div>
      </div>
    </div>
  );
}
