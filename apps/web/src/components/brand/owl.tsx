import { memo } from 'react';

interface OwlProps {
  size?: number;
  className?: string;
}

const CREAM = '#F6F1E8';
const CREAM_2 = '#EFE7D7';
const INK = '#1C1A14';
const ACCENT = '#D87B2A';
const ACCENT_DEEP = '#B65E13';
const ACCENT_SOFT = '#FBE7CF';
const SURFACE = '#FFFFFF';

function OwlBase({ size = 460, className }: OwlProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 600 600"
      fill="none"
      role="img"
      aria-label="Libertasian owl mascot"
      className={className}
      style={{ display: 'block' }}
    >
      <path
        d="M210 470 Q200 510 220 530 Q240 540 250 510"
        fill={CREAM}
        stroke={INK}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path
        d="M380 480 Q400 520 380 540 Q360 545 350 515"
        fill={CREAM}
        stroke={INK}
        strokeWidth="7"
        strokeLinejoin="round"
      />

      <path
        d="M150 320
           C150 180, 250 110, 300 110
           C350 110, 450 180, 450 320
           C450 440, 380 500, 300 500
           C220 500, 150 440, 150 320 Z"
        fill={CREAM}
        stroke={INK}
        strokeWidth="9"
        strokeLinejoin="round"
      />

      <path d="M218 355 Q230 343 242 355" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M250 360 Q262 348 274 360" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M326 360 Q338 348 350 360" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M358 355 Q370 343 382 355" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M228 410 Q240 398 252 410" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M260 420 Q272 408 284 420" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M316 420 Q328 408 340 420" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M348 410 Q360 398 372 410" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />

      <ellipse cx="300" cy="380" rx="80" ry="80" fill={ACCENT_SOFT} opacity="0.55" />

      <path d="M210 130 L195 80 L235 115 Z" fill={CREAM} stroke={INK} strokeWidth="8" strokeLinejoin="round" />
      <path d="M390 130 L405 80 L365 115 Z" fill={CREAM} stroke={INK} strokeWidth="8" strokeLinejoin="round" />

      <circle cx="240" cy="220" r="58" fill={SURFACE} stroke={INK} strokeWidth="9" />
      <path d="M298 215 Q300 205 302 215" stroke={INK} strokeWidth="9" strokeLinecap="round" fill="none" />

      <path d="M210 195 Q220 180 235 180" stroke={CREAM_2} strokeWidth="7" strokeLinecap="round" fill="none" />

      <circle cx="248" cy="225" r="9" fill={INK} />
      <circle cx="252" cy="221" r="3" fill={SURFACE} />

      {/* Right eye cluster — grouped so HeaderGlow can animate a wink.
          The class is inert everywhere else (no animation on the bare
          class; all motion is scoped under `.header-glow-owl`). */}
      <g className="owl-eye-right">
        <circle cx="360" cy="220" r="58" fill={SURFACE} stroke={INK} strokeWidth="9" />
        <path d="M330 195 Q340 180 355 180" stroke={CREAM_2} strokeWidth="7" strokeLinecap="round" fill="none" />
        <circle cx="352" cy="225" r="9" fill={INK} />
        <circle cx="356" cy="221" r="3" fill={SURFACE} />
      </g>

      <path
        d="M300 250 L283 285 L317 285 Z"
        fill={ACCENT}
        stroke={INK}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path d="M291 285 Q300 295 309 285" stroke={INK} strokeWidth="5" strokeLinecap="round" fill="none" />

      <ellipse cx="175" cy="265" rx="22" ry="14" fill={ACCENT} opacity="0.4" />
      <ellipse cx="425" cy="265" rx="22" ry="14" fill={ACCENT} opacity="0.4" />

      {/* Left wing — grouped so HeaderGlow can animate a wave. The class
          is inert everywhere else (all motion scoped under
          `.header-glow-owl`). */}
      <g className="owl-wing-left">
        <path
          d="M160 320
             C140 320, 130 360, 150 410
             C170 440, 210 440, 220 410
             L220 350 Z"
          fill={CREAM}
          stroke={INK}
          strokeWidth="8"
          strokeLinejoin="round"
        />
        <path d="M175 360 Q190 375 175 390" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M185 370 Q200 385 185 400" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>

      <path
        d="M440 320
           C460 320, 470 360, 450 410
           C430 440, 390 440, 380 410
           L380 350 Z"
        fill={CREAM}
        stroke={INK}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <path d="M425 360 Q410 375 425 390" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M415 370 Q400 385 415 400" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />

      <g transform="rotate(-22 410 430)">
        <rect x="395" y="425" width="60" height="22" rx="6" fill={ACCENT} stroke={INK} strokeWidth="6" />
        <rect x="418" y="445" width="14" height="60" rx="4" fill={ACCENT_DEEP} stroke={INK} strokeWidth="6" />
        <rect x="400" y="430" width="8" height="12" fill={INK} />
        <rect x="442" y="430" width="8" height="12" fill={INK} />
      </g>

      <path
        d="M260 495 L255 525 M275 495 L275 525 M290 495 L295 525"
        stroke={ACCENT_DEEP}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M310 495 L305 525 M325 495 L325 525 M340 495 L345 525"
        stroke={ACCENT_DEEP}
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const Owl = memo(OwlBase);
