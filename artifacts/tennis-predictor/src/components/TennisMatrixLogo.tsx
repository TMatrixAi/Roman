export function TennisMatrixLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="tmBg" cx="38%" cy="28%" r="75%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="60%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#065f46" />
        </radialGradient>
        <radialGradient id="tmGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
        <filter id="tmShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#065f46" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Drop shadow ring */}
      <circle cx="24" cy="25" r="20.5" fill="#065f46" opacity="0.3" />

      {/* Main filled circle */}
      <circle cx="24" cy="24" r="21" fill="url(#tmBg)" filter="url(#tmShadow)" />

      {/* Inner glow */}
      <circle cx="24" cy="24" r="21" fill="url(#tmGlow)" />

      {/* Tennis ball seam — top arc */}
      <path
        d="M 5 24 Q 13 7 24 24 Q 35 41 43 24"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.92"
      />
      {/* Tennis ball seam — bottom arc */}
      <path
        d="M 5 24 Q 13 41 24 24 Q 35 7 43 24"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.92"
      />

      {/* Center precision dot */}
      <circle cx="24" cy="24" r="2.8" fill="white" opacity="0.96" />

      {/* Four data-point markers in quadrants */}
      <circle cx="15" cy="15" r="1.4" fill="white" opacity="0.55" />
      <circle cx="33" cy="15" r="1.4" fill="white" opacity="0.55" />
      <circle cx="15" cy="33" r="1.4" fill="white" opacity="0.55" />
      <circle cx="33" cy="33" r="1.4" fill="white" opacity="0.55" />

      {/* Subtle highlight arc for depth */}
      <path
        d="M 9 16 Q 18 9 31 13"
        fill="none"
        stroke="white"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.25"
      />
    </svg>
  )
}
