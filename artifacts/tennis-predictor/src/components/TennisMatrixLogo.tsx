export function TennisMatrixLogo() {
  return (
    <svg
      viewBox="0 0 40 40"
      width="32"
      height="32"
      className="drop-shadow-md"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background circle */}
      <circle cx="20" cy="20" r="19" fill="currentColor" className="text-accent" opacity="0.15" />
      
      {/* Tennis racket handle */}
      <rect x="17.5" y="24" width="5" height="10" rx="2.5" fill="currentColor" className="text-accent" />
      
      {/* Tennis racket frame (hexagon-ish) */}
      <path
        d="M 20 8 C 27 8 32 13 32 20 C 32 27 27 32 20 32 C 13 32 8 27 8 20 C 8 13 13 8 20 8"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-accent"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      {/* Tennis ball - circular elements */}
      <circle cx="20" cy="20" r="6.5" fill="currentColor" className="text-accent" opacity="0.8" />
      
      {/* Tennis ball curved line */}
      <path
        d="M 16 17 Q 20 18 24 17"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-background"
        strokeLinecap="round"
      />
      <path
        d="M 16 23 Q 20 22 24 23"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-background"
        strokeLinecap="round"
      />
      
      {/* Matrix-style grid elements */}
      <circle cx="14" cy="14" r="1.5" fill="currentColor" className="text-accent" opacity="0.5" />
      <circle cx="26" cy="14" r="1.5" fill="currentColor" className="text-accent" opacity="0.5" />
      <circle cx="14" cy="26" r="1.5" fill="currentColor" className="text-accent" opacity="0.5" />
      <circle cx="26" cy="26" r="1.5" fill="currentColor" className="text-accent" opacity="0.5" />
    </svg>
  )
}
