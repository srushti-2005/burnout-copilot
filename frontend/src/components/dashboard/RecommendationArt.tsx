const P = "#8b83f0";
const L = "#d9d5fb";
const S = "#f2c9a0";
const D = "#5b54c9";
const INK = "#1e2a5a";

function Head({ x = 60, y = 30 }: { x?: number; y?: number }) {
  return <circle cx={x} cy={y} r="8" fill={S} />;
}

function scene(key: string) {
  if (key.includes("stretch"))
    return (
      <>
        <rect x="22" y="80" width="76" height="4" rx="2" fill={L} />
        <rect x="26" y="62" width="34" height="4" rx="2" fill={D} />
        <rect x="30" y="66" width="3" height="16" fill={D} />
        <rect x="53" y="66" width="3" height="16" fill={D} />
        <Head />
        <rect x="52" y="38" width="16" height="26" rx="8" fill={P} />
        <path d="M66 42 L82 14" stroke={P} strokeWidth="7" strokeLinecap="round" />
        <path d="M54 42 L44 56" stroke={P} strokeWidth="7" strokeLinecap="round" />
        <path d="M56 64 L52 84 M64 64 L74 84" stroke={D} strokeWidth="7" strokeLinecap="round" />
      </>
    );
  if (key.includes("breath"))
    return (
      <>
        <rect x="26" y="20" width="68" height="64" rx="8" fill="none" stroke={L} strokeWidth="3" strokeDasharray="6 6" />
        <Head />
        <rect x="52" y="38" width="16" height="26" rx="8" fill={P} />
        <path d="M54 46 L60 58 L66 46" stroke={P} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 64 L48 80 M66 64 L76 80" stroke={D} strokeWidth="7" strokeLinecap="round" />
      </>
    );
  if (key.includes("nap") || key.includes("sleep"))
    return (
      <>
        <rect x="16" y="64" width="88" height="14" rx="7" fill={L} />
        <circle cx="30" cy="56" r="8" fill={S} />
        <rect x="38" y="50" width="52" height="14" rx="7" fill={P} />
        <text x="76" y="36" fontSize="14" fill={D} fontWeight="700">z</text>
        <text x="90" y="24" fontSize="18" fill={D} fontWeight="700">Z</text>
      </>
    );
  if (key.includes("walk") || key.includes("outside") || key.includes("stroll"))
    return (
      <>
        <rect x="10" y="84" width="100" height="4" rx="2" fill={L} />
        <Head />
        <rect x="52" y="38" width="16" height="26" rx="8" fill={P} />
        <path d="M54 44 L44 58 M66 44 L78 56" stroke={P} strokeWidth="6" strokeLinecap="round" />
        <path d="M56 64 L46 84 M64 64 L78 82" stroke={D} strokeWidth="7" strokeLinecap="round" />
      </>
    );
  if (key.includes("puzzle"))
    return (
      <>
        <rect x="30" y="28" width="30" height="30" rx="5" fill={P} />
        <rect x="60" y="28" width="30" height="30" rx="5" fill={L} />
        <rect x="30" y="58" width="30" height="30" rx="5" fill={L} />
        <circle cx="75" cy="73" r="15" fill={D} />
      </>
    );
  if (key.includes("brainstorm") || key.includes("idea"))
    return (
      <>
        <circle cx="60" cy="44" r="22" fill={L} stroke={P} strokeWidth="3" />
        <rect x="50" y="66" width="20" height="10" rx="3" fill={P} />
        <path d="M60 12 V4 M30 22 L24 16 M90 22 L96 16" stroke={D} strokeWidth="3" strokeLinecap="round" />
      </>
    );
  if (key.includes("eye") || key.includes("20-20"))
    return (
      <>
        <path d="M12 50 Q60 8 108 50 Q60 92 12 50Z" fill={L} stroke={P} strokeWidth="3" />
        <circle cx="60" cy="50" r="14" fill={P} />
        <circle cx="60" cy="50" r="6" fill={INK} />
      </>
    );
  if (key.includes("water") || key.includes("hydrat") || key.includes("drink"))
    return (
      <>
        <path d="M38 24 H82 L76 82 H44Z" fill={L} stroke={P} strokeWidth="3" />
        <path d="M41 50 H79 L76 82 H44Z" fill={P} opacity="0.7" />
      </>
    );
  if (key.includes("music") || key.includes("listen") || key.includes("sound"))
    return (
      <>
        <path d="M32 58 V50 a28 28 0 0 1 56 0 V58" fill="none" stroke={D} strokeWidth="5" strokeLinecap="round" />
        <rect x="26" y="54" width="12" height="22" rx="6" fill={P} />
        <rect x="82" y="54" width="12" height="22" rx="6" fill={P} />
      </>
    );
  if (key.includes("notif") || key.includes("mute"))
    return (
      <>
        <path d="M60 18 a22 22 0 0 1 22 22 v16 l8 10 H30 l8 -10 V40 a22 22 0 0 1 22 -22Z" fill={L} stroke={P} strokeWidth="3" />
        <circle cx="60" cy="82" r="6" fill={P} />
        <path d="M30 28 L90 80" stroke={D} strokeWidth="5" strokeLinecap="round" />
      </>
    );
  if (key.includes("gratitude") || key.includes("note") || key.includes("journal"))
    return (
      <>
        <rect x="32" y="16" width="50" height="66" rx="6" fill="#fff" stroke={P} strokeWidth="3" />
        <path d="M42 34 H72 M42 46 H72 M42 58 H62" stroke={L} strokeWidth="4" strokeLinecap="round" />
        <path d="M70 80 L92 36 L100 40 L78 84Z" fill={D} />
      </>
    );
  if (key.includes("recovery") || key.includes("protect") || key.includes("wrap"))
    return (
      <>
        <path d="M60 84 C16 56 30 20 60 40 C90 20 104 56 60 84Z" fill={L} stroke={P} strokeWidth="3" />
        <path d="M60 36 V62 M50 54 L60 64 L70 54" stroke={D} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  // default: calm person sitting cross-legged
  return (
    <>
      <Head y={28} />
      <rect x="52" y="36" width="16" height="26" rx="8" fill={P} />
      <path d="M54 44 L42 62 M66 44 L78 62" stroke={P} strokeWidth="6" strokeLinecap="round" />
      <path d="M36 74 Q60 58 84 74 Q60 86 36 74Z" fill={D} />
    </>
  );
}

interface Props {
  title: string;
  id?: string;
  className?: string;
}

/** Small illustration chosen from the card's title/id. Unknown titles get a calm seated figure. */
export function RecommendationArt({ title, id = "", className = "" }: Props) {
  const key = `${title} ${id}`.toLowerCase();
  return (
    <svg viewBox="0 0 120 100" width="96" height="80" className={className} aria-hidden="true">
      <circle cx="60" cy="52" r="44" fill={L} opacity="0.35" />
      {scene(key)}
    </svg>
  );
}

export default RecommendationArt;
