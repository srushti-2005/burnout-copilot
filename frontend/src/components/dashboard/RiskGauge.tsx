import { Heart, MoreVertical, Sparkles } from "lucide-react";
import { useId } from "react";

interface Props {
  cli: number;
  category: string;
  stress?: string | undefined;
  energy?: string | undefined;
  recovery?: string | undefined;
  headline?: string | undefined;
}

export function RiskGauge({ cli, category, stress, energy, recovery, headline }: Props) {
  const uid = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(cli, 1));
  const percent = Math.round(pct * 100);

  const riskCategory =
    category || (percent <= 25 ? "Low" : percent <= 70 ? "Medium" : "High");
  const stressValue = stress || `${percent}%`;
  const energyValue = energy || `${100 - percent}%`;
  const recoveryValue =
    recovery ||
    (percent <= 25 ? "Good" : percent <= 70 ? "Moderate" : "Needs attention");
  const headlineValue =
    headline ||
    (percent <= 25
      ? "Your current workload is within a healthy range."
      : percent <= 70
        ? "Consider balancing workload with short recovery breaks."
        : "Your workload is elevated — consider taking a break.");

  const R = 110;
  const CX = 130;
  const CY = 130;
  const angle = Math.PI * (1 - pct);
  const knobX = CX + R * Math.cos(angle);
  const knobY = CY - R * Math.sin(angle);
  const arc = Math.PI * R;
  const track = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  return (
    <div className="clay-card flex flex-1 flex-col p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl">Real-time Burnout Risk</h2>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold">
            <span className="size-2 rounded-full bg-clay-coral" />
            Live
          </span>
          <MoreVertical className="size-4 text-muted-foreground" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="relative grid place-items-center">
          <svg viewBox="0 0 260 150" className="w-full max-w-[280px] overflow-visible">
            <defs>
              <linearGradient id={`${uid}g`} gradientUnits="userSpaceOnUse" x1={CX - R} y1="0" x2={CX + R} y2="0" spreadMethod="reflect">
                <stop offset="0" stopColor="var(--clay-teal)" />
                <stop offset="0.5" stopColor="var(--clay-purple)" />
                <stop offset="1" stopColor="var(--clay-pink)" />
                <animate attributeName="x1" values={`${CX - R};${CX - R + 70};${CX - R}`} dur="10s" repeatCount="indefinite" />
                <animate attributeName="x2" values={`${CX + R};${CX + R + 70};${CX + R}`} dur="10s" repeatCount="indefinite" />
              </linearGradient>
            </defs>
            <path d={track} fill="none" stroke="var(--muted)" strokeWidth="22" strokeLinecap="round" />
            {/* soft glow under the arc */}
            <path
              d={track}
              fill="none"
              stroke={`url(#${uid}g)`}
              strokeWidth="26"
              strokeLinecap="round"
              strokeDasharray={`${arc * pct} ${arc}`}
              opacity="0.35"
              style={{ filter: "blur(8px)", transition: "stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)" }}
            />
            <path
              d={track}
              fill="none"
              stroke={`url(#${uid}g)`}
              strokeWidth="22"
              strokeLinecap="round"
              strokeDasharray={`${arc * pct} ${arc}`}
              style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)" }}
            />
            <circle cx={knobX} cy={knobY} r="11" fill="var(--card)" stroke={`url(#${uid}g)`} strokeWidth="5" />
            <text
              x={CX}
              y={CY - 20}
              textAnchor="middle"
              className="fill-foreground font-display"
              fontSize="42"
              fontWeight="600"
            >
              {percent}
              <tspan fontSize="24">%</tspan>
            </text>
            <text
              x={CX}
              y={CY + 4}
              textAnchor="middle"
              className="fill-clay-purple"
              fontSize="14"
              fontWeight="600"
            >
              {riskCategory.toUpperCase()}
            </text>
          </svg>
          <span className="mt-1 grid size-9 place-items-center rounded-full border border-border">
            <Heart className="size-4 text-clay-pink" />
          </span>
        </div>

        <div className="flex flex-col justify-center gap-4">
          {[
            { label: "Stress Levels", value: stressValue, dot: "bg-clay-purple", text: "text-clay-purple" },
            { label: "Energy Levels", value: energyValue, dot: "bg-clay-yellow", text: "text-clay-yellow" },
            { label: "Recovery State", value: recoveryValue, dot: "bg-clay-teal", text: "text-clay-teal" },
          ].map((r) => (
            <div key={r.label} className="flex items-start gap-3">
              <span className={`mt-1.5 size-2.5 rounded-full ${r.dot}`} />
              <div>
                <div className="text-[0.95rem] font-semibold">{r.label}</div>
                <div className={`text-[0.95rem] font-semibold ${r.text}`}>{r.value || "—"}</div>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-clay-purple">
            <Sparkles className="size-4" />
            {headlineValue}
          </div>
        </div>
      </div>
    </div>
  );
}