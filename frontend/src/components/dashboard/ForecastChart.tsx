import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPoint } from "@/lib/dashboard.types";

interface Props {
  data: ForecastPoint[];
}

function fmt(d: string) {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Flowing-wave forecast. The glowing line with dots is the real forecast (CLI).
 * The softer layered ribbons beneath it are decorative echoes of the same series that give
 * the chart its flowing look; they are not extra data and are hidden from the tooltip.
 */
export function ForecastChart({ data }: Props) {
  const uid = useId().replace(/:/g, "");
  const at = (j: number) => data[Math.min(Math.max(j, 0), data.length - 1)]?.CLI ?? 0;
  // A perfectly flat series has a zero-height bounding box, which makes SVG gradients vanish.
  const flat = data.length > 0 && data.every((p) => p.CLI === data[0]?.CLI);

  const rows = data.map((p, i) => ({
    date: fmt(p.date),
    CLI: p.CLI + (flat ? i * 1e-4 : 0),
    w2: (p.CLI * 0.6 + at(i - 1) * 0.4) * 0.82,
    w3: (p.CLI * 0.5 + at(i + 1) * 0.5) * 0.6,
    w4: ((at(i - 1) + p.CLI + at(i + 1)) / 3) * 0.38,
  }));

  const id = (n: string) => `${uid}-${n}`;
  const ANIM = { animationDuration: 2200, animationEasing: "ease-out" as const };

  return (
    <div className="clay-card flex flex-1 flex-col p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl">7-Day Burnout Forecast</h2>
        <span className="rounded-xl border border-border px-3 py-1.5 text-sm font-semibold">
          7 Days
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-5 text-sm font-semibold">
        {[
          { l: "Low Risk", c: "bg-clay-purple" },
          { l: "Moderate Risk", c: "bg-clay-yellow" },
          { l: "High Risk", c: "bg-clay-pink" },
        ].map((i) => (
          <span key={i.l} className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${i.c}`} />
            {i.l}
          </span>
        ))}
      </div>

      <div className="mt-4 h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
            <defs>
              {/* slowly flowing colour sweeps (coral > yellow > green > teal > purple) */}
              <linearGradient id={id("stroke")} x1="0" y1="0" x2="1" y2="0" spreadMethod="reflect">
                <stop offset="0" stopColor="var(--clay-coral)" />
                <stop offset="0.3" stopColor="var(--clay-yellow)" />
                <stop offset="0.55" stopColor="var(--clay-green)" />
                <stop offset="0.8" stopColor="var(--clay-teal)" />
                <stop offset="1" stopColor="var(--clay-purple)" />
                <animate attributeName="x1" values="0;0.5;0" dur="16s" repeatCount="indefinite" />
                <animate attributeName="x2" values="1;1.5;1" dur="16s" repeatCount="indefinite" />
              </linearGradient>
              <linearGradient id={id("f1")} x1="0" y1="0" x2="1" y2="0" spreadMethod="reflect">
                <stop offset="0" stopColor="var(--clay-coral)" stopOpacity="0.32" />
                <stop offset="0.5" stopColor="var(--clay-yellow)" stopOpacity="0.28" />
                <stop offset="1" stopColor="var(--clay-purple)" stopOpacity="0.3" />
                <animate attributeName="x1" values="0;0.4;0" dur="19s" repeatCount="indefinite" />
                <animate attributeName="x2" values="1;1.4;1" dur="19s" repeatCount="indefinite" />
              </linearGradient>
              <linearGradient id={id("f2")} x1="0" y1="0" x2="1" y2="0" spreadMethod="reflect">
                <stop offset="0" stopColor="var(--clay-purple)" stopOpacity="0.3" />
                <stop offset="0.5" stopColor="var(--clay-teal)" stopOpacity="0.3" />
                <stop offset="1" stopColor="var(--clay-green)" stopOpacity="0.3" />
                <animate attributeName="x1" values="0.4;0;0.4" dur="23s" repeatCount="indefinite" />
                <animate attributeName="x2" values="1.4;1;1.4" dur="23s" repeatCount="indefinite" />
              </linearGradient>
              <linearGradient id={id("f3")} x1="0" y1="0" x2="1" y2="0" spreadMethod="reflect">
                <stop offset="0" stopColor="var(--clay-pink)" stopOpacity="0.34" />
                <stop offset="0.5" stopColor="var(--clay-purple)" stopOpacity="0.32" />
                <stop offset="1" stopColor="var(--clay-teal)" stopOpacity="0.3" />
                <animate attributeName="x1" values="0;0.5;0" dur="27s" repeatCount="indefinite" />
                <animate attributeName="x2" values="1;1.5;1" dur="27s" repeatCount="indefinite" />
              </linearGradient>
              <linearGradient id={id("f4")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            <ReferenceArea y1={0} y2={0.4} fill="var(--clay-purple)" fillOpacity={0.04} />
            <ReferenceArea y1={0.4} y2={0.7} fill="var(--risk-mid)" fillOpacity={0.05} />
            <ReferenceArea y1={0.7} y2={1} fill="var(--clay-pink)" fillOpacity={0.04} />
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.3, 0.6, 1]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 14,
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--foreground)",
                fontFamily: "var(--font-sans)",
              }}
              formatter={(v: number) => [v.toFixed(3), "CLI"]}
            />

            {/* decorative flowing ribbons (not data) */}
            <Area type="monotone" dataKey="CLI" stroke="none" fill={`url(#${id("f1")})`} tooltipType="none" {...ANIM} />
            <Area type="monotone" dataKey="w2" stroke="none" fill={`url(#${id("f2")})`} tooltipType="none" {...ANIM} />
            <Area type="monotone" dataKey="w3" stroke="none" fill={`url(#${id("f3")})`} tooltipType="none" {...ANIM} />
            <Area type="monotone" dataKey="w4" stroke="none" fill={`url(#${id("f4")})`} tooltipType="none" {...ANIM} />

            {/* real forecast: glow + line + dots */}
            <Line
              type="monotone"
              dataKey="CLI"
              stroke={`url(#${id("stroke")})`}
              strokeWidth={9}
              strokeOpacity={0.28}
              dot={false}
              activeDot={false}
              tooltipType="none"
              style={{ filter: "blur(6px)" }}
              {...ANIM}
            />
            <Line
              type="monotone"
              dataKey="CLI"
              stroke={`url(#${id("stroke")})`}
              strokeWidth={3}
              dot={{ r: 4.5, fill: "var(--card)", stroke: "var(--clay-purple)", strokeWidth: 2 }}
              activeDot={{ r: 7, fill: "var(--clay-pink)", stroke: "#ffffff", strokeWidth: 2 }}
              {...ANIM}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}