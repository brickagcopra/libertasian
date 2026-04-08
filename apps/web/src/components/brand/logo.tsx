'use client';

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
  animated?: boolean;
}

export function Logo({ className, width = 280, height = 60, animated = true }: LogoProps) {
  const fireId = 'fire-gradient';
  const glowId = 'text-glow';
  const sparkId = 'spark';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 560 100"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="LIBERTASIAN"
    >
      <defs>
        {/* Fire gradient behind text */}
        <linearGradient id={fireId} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff4500" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#ff6a00" stopOpacity="0.7" />
          <stop offset="70%" stopColor="#ffa500" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffd700" stopOpacity="0" />
        </linearGradient>

        {/* Text glow filter */}
        <filter id={glowId} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feFlood floodColor="#ff6a00" floodOpacity="0.3" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Spark/ember radial gradient */}
        <radialGradient id={sparkId}>
          <stop offset="0%" stopColor="#fff7e0" stopOpacity="1" />
          <stop offset="40%" stopColor="#ffd700" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>

        {/* Turbulence for fire distortion */}
        <filter id="fire-turbulence" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03 0.06"
            numOctaves="3"
            seed="2"
            result="noise"
          >
            {animated && (
              <animate
                attributeName="seed"
                values="2;5;8;3;6;2"
                dur="3s"
                repeatCount="indefinite"
              />
            )}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" />
        </filter>
      </defs>

      {/* === FIRE LAYER (behind text) === */}
      <g filter="url(#fire-turbulence)" opacity="0.85">
        {/* Main fire body */}
        <ellipse cx="280" cy="65" rx="220" ry="30" fill={`url(#${fireId})`}>
          {animated && (
            <animate
              attributeName="ry"
              values="30;35;28;33;30"
              dur="2s"
              repeatCount="indefinite"
            />
          )}
        </ellipse>

        {/* Fire tongues */}
        {[80, 150, 220, 280, 340, 410, 480].map((cx, i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={50}
            rx={12 + (i % 3) * 4}
            ry={20 + (i % 2) * 8}
            fill={`url(#${fireId})`}
            opacity={0.6 + (i % 3) * 0.15}
          >
            {animated && (
              <>
                <animate
                  attributeName="ry"
                  values={`${20 + (i % 2) * 8};${28 + (i % 3) * 4};${18 + (i % 2) * 6};${24 + (i % 3) * 3};${20 + (i % 2) * 8}`}
                  dur={`${1.5 + i * 0.2}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="cy"
                  values={`50;${44 - (i % 3) * 3};52;${46 - (i % 2) * 4};50`}
                  dur={`${1.8 + i * 0.15}s`}
                  repeatCount="indefinite"
                />
              </>
            )}
          </ellipse>
        ))}
      </g>

      {/* === SPARKS/EMBERS === */}
      {animated && (
        <g>
          {[
            { cx: 100, delay: '0s', dur: '2.5s' },
            { cx: 180, delay: '0.4s', dur: '2.8s' },
            { cx: 240, delay: '0.8s', dur: '2.2s' },
            { cx: 310, delay: '1.2s', dur: '2.6s' },
            { cx: 370, delay: '0.2s', dur: '3.0s' },
            { cx: 430, delay: '0.6s', dur: '2.4s' },
            { cx: 490, delay: '1.0s', dur: '2.7s' },
            { cx: 140, delay: '1.4s', dur: '2.3s' },
            { cx: 350, delay: '0.9s', dur: '2.9s' },
            { cx: 460, delay: '1.6s', dur: '2.1s' },
            { cx: 200, delay: '0.3s', dur: '2.5s' },
            { cx: 270, delay: '1.1s', dur: '2.8s' },
          ].map((spark, i) => (
            <circle key={i} r={1.5 + (i % 3)} fill={`url(#${sparkId})`}>
              <animate
                attributeName="cx"
                values={`${spark.cx};${spark.cx + (i % 2 === 0 ? 15 : -15)};${spark.cx + (i % 3) * 5}`}
                dur={spark.dur}
                begin={spark.delay}
                repeatCount="indefinite"
              />
              <animate
                attributeName="cy"
                values="70;20;-10"
                dur={spark.dur}
                begin={spark.delay}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;1;0.8;0"
                dur={spark.dur}
                begin={spark.delay}
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values={`${1.5 + (i % 3)};${2 + (i % 2)};0.5`}
                dur={spark.dur}
                begin={spark.delay}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </g>
      )}

      {/* === TEXT === */}
      <text
        x="280"
        y="68"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="52"
        letterSpacing="6"
        fill="#1a1a1a"
        filter={`url(#${glowId})`}
      >
        LIBERTASIAN
      </text>

      {/* Subtle gold highlight on text */}
      <text
        x="280"
        y="68"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="52"
        letterSpacing="6"
        fill="none"
        stroke="#ffd700"
        strokeWidth="0.5"
        opacity="0.4"
      >
        LIBERTASIAN
      </text>
    </svg>
  );
}

/** Compact logo mark for sidebar/favicon usage */
export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="L"
    >
      <defs>
        <linearGradient id="mark-fire" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff4500" />
          <stop offset="50%" stopColor="#ff6a00" />
          <stop offset="100%" stopColor="#ffd700" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="90" height="90" rx="16" fill="#1a1a1a" />
      <text
        x="50"
        y="70"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="60"
        fill="url(#mark-fire)"
      >
        L
      </text>
    </svg>
  );
}
