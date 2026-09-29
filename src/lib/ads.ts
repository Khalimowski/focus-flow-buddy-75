import { isNative } from "./native";
import { PREMIUM_CHANGED_EVENT, hasPurchasedPremium } from "./premium";
import { REMOTE_UPDATE_EVENT } from "./sync";

// AdMob banner (Android only — no-ops on web, where AdMob can't serve).
//
// Live AdMob ids (no longer Google's public test ids). Three things have to
// agree, or the banner silently stops filling: this ad unit, the
// APPLICATION_ID meta-data in android/app/src/main/AndroidManifest.xml, and
// the publisher id in public/app-ads.txt — all under publisher
// pub-4324430922370171.
//
// Expect no-fill until AdMob approves the app: that needs the Play listing
// linked and app-ads.txt crawled at https://flowday.day/app-ads.txt. A
// FailedToLoad with "no ad config"/no-fill during that window is normal, not
// a wiring bug.
const BANNER_AD_ID = "ca-app-pub-4324430922370171/5044191074";

// Master switch: flip to false to pull the banner (everything below —
// consent flow, layout padding, banner request — stays wired up and dormant).
const ADS_ENABLED = true;

type AdMobModule = typeof import("@capacitor-community/admob");

// Whether the banner is (or is about to be) on screen. Every show/remove bumps
// `generation`, so a show still awaiting the SDK can tell it has been
// overtaken — premium arriving mid-init must not let a stale show land.
let showing = false;
let generation = 0;
let watching = false;
let setup: Promise<AdMobModule | null> | null = null;

/**
 * One-time SDK setup: initialize, consent, and the listeners. Kept apart from
 * showing the banner so it can be shown again later (premium withdrawn) without
 * stacking a second set of listeners.
 */
function ensureSetup(): Promise<AdMobModule | null> {
  setup ??= (async () => {
    try {
      const mod = await import("@capacitor-community/admob");
      const { AdMob, BannerAdPluginEvents, AdmobConsentStatus } = mod;

      await AdMob.initialize();

      // GDPR consent (UMP). Does nothing until a consent message is configured
      // in the AdMob console, but required for EEA users once live.
      try {
        const consent = await AdMob.requestConsentInfo();
        if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
          await AdMob.showConsentForm();
        }
      } catch (e) {
        console.warn("[Ads] Consent flow skipped", e);
      }

      // The banner overlays the webview; pad the page bottom so content
      // (and the app's own bottom spacing) stays reachable above it. Body
      // padding doesn't reach position:fixed overlays (Settings sheet, dialogs),
      // so also publish the height as a CSS var for them to consume.
      await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
        if (!showing) return;
        document.body.style.paddingBottom = size.height > 0 ? `${size.height}px` : "";
        document.documentElement.style.setProperty(
          "--ad-banner-height",
          `${Math.max(size.height, 0)}px`,
        );
      });
      await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err) => {
        console.warn("[Ads] Banner failed to load", err);
      });

      // While the soft keyboard is open, Android lifts the bottom-anchored
      // banner above it — right on top of whatever field is being edited. Hide
      // the banner for the duration and bring it back when the keyboard closes.
      // The webview doesn't reliably resize with the keyboard (so a
      // visualViewport heuristic never fires); the native Keyboard plugin
      // reports show/hide regardless of soft-input mode.
      const { Keyboard } = await import("@capacitor/keyboard");
      await Keyboard.addListener("keyboardWillShow", () => {
        if (showing) AdMob.hideBanner().catch(() => {});
      });
      await Keyboard.addListener("keyboardWillHide", () => {
        // Don't resurrect a banner that premium removed while the keyboard was up.
        if (showing) AdMob.resumeBanner().catch(() => {});
      });
      return mod;
    } catch (e) {
      console.warn("[Ads] init failed", e);
      setup = null;
      return null;
    }
  })();
  return setup;
}

function clearBannerPadding() {
  document.body.style.paddingBottom = "";
  document.documentElement.style.setProperty("--ad-banner-height", "0px");
}

async function showBanner() {
  if (showing || hasPurchasedPremium()) return;
  showing = true;
  const gen = ++generation;
  const mod = await ensureSetup();
  // Premium may have landed (restore, sync pull) while the SDK was starting.
  if (gen !== generation) return;
  if (!mod || hasPurchasedPremium()) {
    showing = false;
    return;
  }
  const { AdMob, BannerAdPosition, BannerAdSize } = mod;
  try {
    await AdMob.showBanner({
      adId: BANNER_AD_ID,
      isTesting: false,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
    });
    console.log("[Ads] Banner requested");
  } catch (e) {
    console.warn("[Ads] Banner request failed", e);
    if (gen === generation) showing = false;
    return;
  }
  // Removed while the request was in flight: take down what just went up.
  if (gen !== generation) AdMob.removeBanner().catch(() => {});
}

/**
 * Drop the banner and the layout padding it reserved. Called when premium turns
 * on mid-session — either the user just bought it, or a purchase made on
 * another device arrived through sync.
 */
async function removeBanner() {
  if (!showing) return;
  showing = false;
  generation++;
  clearBannerPadding();
  // Nothing to take down if setup never finished; a show still waiting on it
  // sees the bumped generation and stands down.
  const mod = await setup;
  if (!mod) return;
  try {
    await mod.AdMob.removeBanner();
  } catch (e) {
    console.warn("[Ads] Banner removal failed", e);
  }
  console.log("[Ads] Banner removed (premium)");
}

/**
 * Premium removes ads; anything that can flip the entitlement re-checks here,
 * both ways — a purchase takes the banner down, and a sign-out or revocation
 * brings it back. Only a real purchase counts — the early-access unlock
 * (PREMIUM_FREE_FOR_ALL) opens the features but leaves the free tier
 * ad-supported, so the banner keeps getting exercised by testers.
 */
function watchEntitlement() {
  const check = () => {
    if (hasPurchasedPremium()) void removeBanner();
    else void showBanner();
  };
  window.addEventListener(PREMIUM_CHANGED_EVENT, check);
  window.addEventListener(REMOTE_UPDATE_EVENT, check);
}

export async function initAds() {
  if (!ADS_ENABLED || !isNative()) return;
  // Purchases can land after boot (restore, or a sync pull from another
  // device), so watch even when we're skipping the banner right now.
  if (!watching) {
    watching = true;
    watchEntitlement();
  }
  if (hasPurchasedPremium()) {
    console.log("[Ads] Skipped — premium entitlement active");
    return;
  }
  await showBanner();
}
