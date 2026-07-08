// Self-hosted update check — compares the installed app's versionCode against
// a version.json file you control. Bump version.json (repo root) and push to
// main whenever you cut a new APK; the raw file is what the app polls.
import { App } from "@capacitor/app";
import { isNative } from "./native";

const VERSION_CHECK_URL =
  "https://raw.githubusercontent.com/Khalimowski/focus-flow-buddy-75/main/version.json";

export type UpdateInfo = {
  versionCode: number;
  versionName: string;
  url: string;
  notes?: string;
};

const DISMISSED_KEY = "ff.update_dismissed_version";

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isNative()) return null;

  try {
    const info = await App.getInfo();
    const currentBuild = parseInt(info.build, 10);

    const res = await fetch(VERSION_CHECK_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const remote = (await res.json()) as Partial<UpdateInfo>;

    if (!remote?.versionCode || !remote.url) return null;
    if (remote.versionCode <= currentBuild) return null;

    const dismissed = Number(window.localStorage.getItem(DISMISSED_KEY) || "0");
    if (dismissed >= remote.versionCode) return null;

    return remote as UpdateInfo;
  } catch (e) {
    console.warn("[Update] Check failed", e);
    return null;
  }
}

export function dismissUpdate(versionCode: number) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(versionCode));
  } catch {
    /* ignore */
  }
}
