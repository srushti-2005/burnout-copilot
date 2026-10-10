interface Props {
  className?: string;
}

/** Friendly blue robot in a white circle (the co-pilot icon). Scales to its container. */
export function RobotAvatar({ className = "" }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="MindEase co-pilot"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <circle cx="32" cy="32" r="31" fill="#ffffff" stroke="#e6e3f4" strokeWidth="1.5" />
      <line x1="32" y1="11" x2="32" y2="16" stroke="#4f7cff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="10" r="2.6" fill="#22d3ee" />
      <rect x="12" y="28" width="6" height="12" rx="3" fill="#4f7cff" />
      <rect x="46" y="28" width="6" height="12" rx="3" fill="#4f7cff" />
      <rect x="17" y="16" width="30" height="28" rx="13" fill="#e8efff" stroke="#4f7cff" strokeWidth="2" />
      <rect x="21" y="22" width="22" height="16" rx="8" fill="#1e2a5a" />
      <circle cx="27" cy="29" r="2.6" fill="#22d3ee" />
      <circle cx="37" cy="29" r="2.6" fill="#22d3ee" />
      <path d="M27 33.5 Q32 37.5 37 33.5" stroke="#22d3ee" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M24 46 h16 v3 a5 5 0 0 1 -5 5 h-6 a5 5 0 0 1 -5 -5z" fill="#4f7cff" />
    </svg>
  );
}

export default RobotAvatar;
