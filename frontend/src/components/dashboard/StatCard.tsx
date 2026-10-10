import { MoreVertical, ArrowUp, ArrowDown } from "lucide-react";
import { useId, type ComponentType } from "react";

import { smoothPath, type Pt } from "@/lib/flow";

interface Props {
  label: string;
  value: string;
  caption: string;
  direction: "up" | "down" | "flat";
  icon: ComponentType<{ className?: string }>;
  tone: "purple" | "blue" | "pink";
  spark: number[];
}

const TONE = {
  purple: { chip: "bg-clay-purple", text: "text-clay-purple", a: "var(--clay-purple)", b: "var(--clay-pink)" },
  blue: { chip: "bg-clay-teal", text: "text-clay-teal", a: "var(--clay-teal)", b: "var(--clay-purple)" },
  pink: { chip: "bg-clay-coral", text: "text-clay-coral", a: "var(--clay-coral)", b: "var(--clay-pink)" },
} as const;

export function StatCard({ label, value, caption, direction, icon: Icon, tone, spark }: Props) {
  const t = TONE[tone];
  const uid = useId().replace(/:/g, "");
  const pts = spark.length > 1 ? spark : [0, 0, 0, 0, 0, 0];
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const coords = pts.map((p, i): Pt => [
    (i / Math.max(pts.length - 1, 1)) * 120,
    34 - ((p - min) / Math.max(max - min, 1)) * 28,
  ]);
  const line = smoothPath(coords);
  const area = `${line} L120,40 L0,40 Z`;

  return (
    <div className="clay-card flex-1 p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className={`grid size-11 place-items-center rounded-full ${t.chip}`}>
            <Icon className="size-5 text-card" />
          </span>
          <div>
            <div className="text-[0.95rem] font-semibold">{label}</div>
            <div className={`font-display text-4xl font-semibold ${t.text}`}>{value}</div>
          </div>
        </div>
        <MoreVertical className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          {direction === "down" ? (
            <ArrowDown className="size-3.5 text-clay-coral" />
          ) : (
            <ArrowUp className="size-3.5 text-risk-low" />
          )}
          {caption}
        </span>

        {/* Flowing wave: smooth gradient line that slowly shifts colour, soft fill underneath, soft glow. */}
        <svg viewBox="0 0 120 40" className="h-9 w-32 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}s`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="120" y2="0" spreadMethod="reflect">
              <stop offset="0" stopColor={t.a} />
              <stop offset="1" stopColor={t.b} />
              <animate attributeName="x1" values="0;60;0" dur="9s" repeatCount="indefinite" />
              <animate attributeName="x2" values="120;180;120" dur="9s" repeatCount="indefinite" />
            </linearGradient>
            <linearGradient id={`${uid}f`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="40">
              <stop offset="0" stopColor={t.a} stopOpacity="0.35" />
              <stop offset="1" stopColor={t.a} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${uid}f)`} />
          <path d={line} fill="none" stroke={`url(#${uid}s)`} strokeWidth="5" strokeLinecap="round" opacity="0.35" style={{ filter: "blur(2.5px)" }} />
          <path d={line} fill="none" stroke={`url(#${uid}s)`} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}