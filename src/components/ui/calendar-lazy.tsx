import { lazy, Suspense, type ComponentProps } from "react";
import type { Calendar as CalendarImpl } from "@/components/ui/calendar";

// react-day-picker is only ever drawn inside a popover or dialog the user has
// to open, so it does not need to be parsed before the first screen paints.
// The chunk is fetched in the background once the app is idle (see
// preloadCalendar), which normally makes the first open as instant as before.
let Loaded: typeof CalendarImpl | null = null;
const loadCalendar = () =>
  import("@/components/ui/calendar").then((m) => {
    Loaded = m.Calendar;
    return { default: m.Calendar };
  });

const LazyCalendar = lazy(loadCalendar);

let preloaded = false;
export function preloadCalendar() {
  if (preloaded || typeof window === "undefined") return;
  preloaded = true;
  const start = () => void loadCalendar();
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1500);
}

export function Calendar(props: ComponentProps<typeof CalendarImpl>) {
  // Once preloaded, render it directly: React.lazy would still suspend for a
  // tick on first use and let the popover measure the placeholder instead.
  if (Loaded) return <Loaded {...props} />;
  return (
    // Roughly a month grid's footprint, so the popover doesn't jump when the
    // real calendar replaces it on a slow first open.
    <Suspense fallback={<div className="h-[18rem] w-[15.5rem]" aria-busy="true" />}>
      <LazyCalendar {...props} />
    </Suspense>
  );
}
