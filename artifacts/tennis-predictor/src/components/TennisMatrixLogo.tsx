export function TennisMatrixLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      width="36"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-lg"
    >
      {/* Gradient background */}
      <defs>
        <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#10b981', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#059669', stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Main racket frame circle */}
      <circle cx="24" cy="18" r="12" fill="none" stroke="url(#logoGrad)" strokeWidth="2.5" />

      {/* Racket strings - horizontal */}
      <line x1="14" y1="12" x2="34" y2="12" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.6" />
      <line x1="13.5" y1="15" x2="34.5" y2="15" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.5" />
      <line x1="13" y1="18" x2="35" y2="18" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.5" />
      <line x1="13.5" y1="21" x2="34.5" y2="21" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.5" />
      <line x1="14" y1="24" x2="34" y2="24" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.6" />

      {/* Racket strings - vertical */}
      <line x1="18" y1="8" x2="18" y2="28" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.6" />
      <line x1="21" y1="7" x2="21" y2="29" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.5" />
      <line x1="24" y1="6.5" x2="24" y2="29.5" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.5" />
      <line x1="27" y1="7" x2="27" y2="29" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.5" />
      <line x1="30" y1="8" x2="30" y2="28" stroke="url(#logoGrad)" strokeWidth="1" opacity="0.6" />

      {/* Racket handle */}
      <rect x="21.5" y="28" width="5" height="14" rx="2.5" fill="url(#logoGrad)" />

      {/* Tennis ball - positioned off to the side */}
      <circle cx="38" cy="32" r="6" fill="#FFEB3B" />
      <path
        d="M 36 30 Q 38 31 40 30"
        stroke="#FDD835"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 36 34 Q 38 33 40 34"
        stroke="#FDD835"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Matrix accent dots */}
      <circle cx="12" cy="34" r="1.5" fill="url(#logoGrad)" opacity="0.7" />
      <circle cx="16" cy="36" r="1" fill="url(#logoGrad)" opacity="0.5" />
      <circle cx="10" cy="40" r="1.2" fill="url(#logoGrad)" opacity="0.6" />
    </svg>
  )
}
