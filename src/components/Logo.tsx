import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The FlowDay mark: two broken orbits with dot terminals around a check.
 *
 * Drawn on a transparent background so it reads on either theme — the light
 * and dark tiles from the brand sheet live in public/icon-{light,dark}.svg and
 * are only used where a launcher-style icon is expected (favicon, PWA).
 *
 * Geometry is fixed in a 100x100 box; size it with a className (`size-9`).
 */
export function LogoMark({ className }: { className?: string }) {
  // Gradient ids must be unique per instance — several marks can be on screen
  // at once, and duplicate ids make every copy use the first one's stops.
  const raw = useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, "");
  const g = (name: string) => `ff-${uid}-${name}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("shrink-0", className)}
      role="img"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Outer orbit, upper-left sweep: purple rising into blue */}
        <linearGradient id={g("a")} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
        {/* Outer orbit, lower-right sweep: teal into cyan */}
        <linearGradient id={g("b")} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#3BAFDA" />
        </linearGradient>
        {/* Inner orbit, top */}
        <linearGradient id={g("c")} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
        {/* Inner orbit, bottom */}
        <linearGradient id={g("d")} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22B8CF" />
          <stop offset="100%" stopColor="#2DD4BF" />
        </linearGradient>
        {/* The check: purple at the short arm, teal at the tip */}
        <linearGradient id={g("k")} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="55%" stopColor="#4F9BE8" />
          <stop offset="100%" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>

      <g strokeLinecap="round" fill="none">
        {/* Outer orbit */}
        <path
          d="M 69.61 18.62 A 37 37 0 0 0 18.62 69.61"
          stroke={`url(#${g("a")})`}
          strokeWidth="5.4"
        />
        <path
          d="M 34.95 83.8 A 37 37 0 0 0 85.57 60.2"
          stroke={`url(#${g("b")})`}
          strokeWidth="5.4"
        />
        {/* Inner orbit */}
        <path
          d="M 70.23 35.31 A 25 25 0 0 0 26.82 40.63"
          stroke={`url(#${g("c")})`}
          strokeWidth="4.8"
        />
        <path
          d="M 26.51 58.55 A 25 25 0 0 0 64.69 70.23"
          stroke={`url(#${g("d")})`}
          strokeWidth="4.8"
        />
        {/* Short spark between the orbits, on the right */}
        <path
          d="M 74.82 30.61 A 31.5 31.5 0 0 1 81.48 48.9"
          stroke={`url(#${g("b")})`}
          strokeWidth="4.2"
        />
      </g>

      {/* Dot terminals */}
      <circle cx="69.61" cy="18.62" r="5.6" fill="#3B82F6" />
      <circle cx="34.95" cy="83.8" r="5.6" fill="#2DD4BF" />
      <circle cx="70.23" cy="35.31" r="4.9" fill="#3B82F6" />
      <circle cx="81.48" cy="48.9" r="3.9" fill="#2DD4BF" />

      {/* Check */}
      <path
        d="M 36 51 L 45 60 L 64 39"
        stroke={`url(#${g("k")})`}
        strokeWidth="9.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
