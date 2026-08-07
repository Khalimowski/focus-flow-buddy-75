import { useId } from "react";

/**
 * The app mark: a broken orbit ring with dot terminals around a check.
 * Same geometry as public/logo.svg and the Android launcher/notification
 * icons — change one, regenerate the others.
 */
export function Logo({ className }: { className?: string }) {
  // Gradient ids must be unique per instance; several logos can share a page.
  const uid = useId().replace(/:/g, "");
  const orbit = `logo-orbit-${uid}`;
  const teal = `logo-teal-${uid}`;
  const check = `logo-check-${uid}`;

  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-hidden="true">
      <defs>
        <linearGradient id={orbit} gradientUnits="userSpaceOnUse" x1="96" y1="430" x2="404" y2="88">
          <stop offset="0" stopColor="#A96AF5" />
          <stop offset="0.45" stopColor="#7C6AF8" />
          <stop offset="1" stopColor="#3C8DFF" />
        </linearGradient>
        <linearGradient id={teal} gradientUnits="userSpaceOnUse" x1="230" y1="430" x2="416" y2="238">
          <stop offset="0" stopColor="#43DFD4" />
          <stop offset="1" stopColor="#2FC8D6" />
        </linearGradient>
        <linearGradient id={check} gradientUnits="userSpaceOnUse" x1="196" y1="308" x2="318" y2="208">
          <stop offset="0" stopColor="#9B6BF5" />
          <stop offset="1" stopColor="#46CFD8" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round">
        <path d="M 357.56 134.96 A 158 158 0 1 0 177 392.83" stroke={`url(#${orbit})`} strokeWidth="17" />
        <circle cx="357.56" cy="134.96" r="15" fill={`url(#${orbit})`} />
        <path d="M 153.29 222.63 A 108 108 0 0 1 351.36 205.3" stroke={`url(#${orbit})`} strokeWidth="16" />
        <circle cx="351.36" cy="205.3" r="14" fill={`url(#${orbit})`} />
        <path d="M 340.85 357.12 A 132 132 0 0 1 167.67 354.1" stroke={`url(#${teal})`} strokeWidth="16" />
        <circle cx="167.67" cy="354.1" r="14" fill={`url(#${teal})`} />
        <path d="M 405.69 282.39 A 152 152 0 0 1 357.71 368.96" stroke={`url(#${teal})`} strokeWidth="15" />
        <circle cx="357.71" cy="368.96" r="13" fill={`url(#${teal})`} />
        <path d="M 206 262 L 240 298 L 308 218" stroke={`url(#${check})`} strokeWidth="30" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
