import { isNative } from "./native";

// AdMob banner (Android only — no-ops on web, where AdMob can't serve).
//
// Currently running on Google's public TEST ids so ads work before the app is
// live. To go live: create the app + a banner ad unit in the AdMob console,
// then (1) replace BANNER_AD_ID below, (2) replace the APPLICATION_ID
// meta-data in android/app/src/main/AndroidManifest.xml, (3) set isTesting to
// false in showBanner below. Real ads only serve once AdMob approves the app
// (usually needs the Play Store listing linked + app-ads.txt).
const BANNER_AD_ID = "ca-app-pub-3940256099942544/6300978111";

let started = false;

export async function initAds() {
  if (!isNative() || started) return;
  started = true;
  try {
    const { AdMob, BannerAdPosition, BannerAdSize, BannerAdPluginEvents, AdmobConsentStatus } =
      await import("@capacitor-community/admob");

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
      document.body.style.paddingBottom = size.height > 0 ? `${size.height}px` : "";
      document.documentElement.style.setProperty(
        "--ad-banner-height",
        `${Math.max(size.height, 0)}px`,
      );
    });
    await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err) => {
      console.warn("[Ads] Banner failed to load", err);
    });

    await AdMob.showBanner({
      adId: BANNER_AD_ID,
      isTesting: true,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
    });
    console.log("[Ads] Banner requested");
  } catch (e) {
    console.warn("[Ads] init failed", e);
  }
}
