import type { Theme } from "@/lib/i18n";

// The brand sheet ships the mark on two tiles — white and navy. Which one is
// right depends on the theme the user picked in the app, not on the OS, so the
// swap is done here at runtime rather than with a prefers-color-scheme media
// attribute on the <link>.
const ICONS: Record<Theme, string> = {
  light: "/icon-light.svg",
  dark: "/icon-dark.svg",
};

/**
 * Point the tab icon at the tile that matches the active theme. No-ops outside
 * the browser (SSR/prerender) and on Capacitor, where there is no tab.
 */
export function applyFavicon(theme: Theme) {
  if (typeof document === "undefined") return;
  const href = ICONS[theme] ?? ICONS.dark;

  // Replace the themed link rather than every icon: the PNG fallback stays in
  // place for browsers that don't take SVG favicons.
  let link = document.querySelector<HTMLLinkElement>('link[data-ff-icon="theme"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.dataset.ffIcon = "theme";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
