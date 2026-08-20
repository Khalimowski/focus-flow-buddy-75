import { cn } from "@/lib/utils";
import { useI18nStore } from "@/lib/i18n";

/**
 * The FlowDay brand: a classical bust in profile with a checklist orbiting the
 * back of the head, drawn in ink green, marble cream and gold.
 *
 * Both files are cut out of the brand sheet onto transparency, so they sit on
 * whatever the page colour is. The launcher-style cream tile lives separately
 * in public/icon-{192,512}.png and is only used where an app icon is expected.
 */

/** The mark on its own. Size it with a square class (`size-9`). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}

/**
 * The full horizontal lockup — mark, wordmark and rule-flanked tagline.
 *
 * The wordmark is ink green, which disappears on the dark theme, so the sheet
 * ships twice: the original for light, and one whose type is re-matted in
 * cream for dark. Which one shows follows the theme the user picked in the
 * app, the same way the favicon does. Size it with a height class (`h-12`).
 */
export function LogoLockup({ className }: { className?: string }) {
  const theme = useI18nStore((s) => s.theme);

  return (
    <img
      src={theme === "dark" ? "/logo-lockup-dark.png" : "/logo-lockup.png"}
      alt="FlowDay"
      draggable={false}
      className={cn("w-auto select-none object-contain", className)}
    />
  );
}
