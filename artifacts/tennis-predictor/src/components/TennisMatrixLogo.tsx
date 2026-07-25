export function TennisMatrixLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      width="36"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-lg"
    >
      <defs>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#34d399" stopOpacity={0.85} />
          <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="logoGrad" x1="8%" y1="8%" x2="92%" y2="92%">
          <stop offset="0%" stopColor="#6ee7b7" stopOpacity={1} />
          <stop offset="48%" stopColor="#10b981" stopOpacity={1} />
          <stop offset="100%" stopColor="#047857" stopOpacity={1} />
        </linearGradient>
        <linearGradient id="spark" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>

      {/* Ambient glow */}
      <circle cx="24" cy="24" r="21" fill="url(#coreGlow)" />

      {/* Main ring */}
      <circle cx="24" cy="24" r="17" fill="none" stroke="url(#logoGrad)" strokeWidth="2.6" />

      {/* Matrix M monogram */}
      <path
        d="M14 31V16l6 8 4-6 4 6 6-8v15"
        fill="none"
        stroke="url(#logoGrad)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Orbit stroke */}
      <path
        d="M8 28c2.4 6.2 7.9 11 15.2 12.3C32.8 42 41.2 36.3 43 27"
        fill="none"
        stroke="url(#spark)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.95"
      />

      {/* Ball */}
      <circle cx="37.5" cy="28.5" r="5.5" fill="#d9f99d" />
      <path
        d="M34.7 27.6q2.8 1.8 5.6 0"
        stroke="#84cc16"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M34.7 29.4q2.8-1.8 5.6 0"
        stroke="#84cc16"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Accent nodes */}
      <circle cx="9" cy="13" r="1.2" fill="url(#spark)" opacity="0.9" />
      <circle cx="12" cy="10" r="0.9" fill="url(#spark)" opacity="0.75" />
      <circle cx="39" cy="11" r="1" fill="url(#spark)" opacity="0.8" />
    </svg>
  )
}
