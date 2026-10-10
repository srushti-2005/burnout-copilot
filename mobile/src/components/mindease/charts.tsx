import type { ForecastDay } from '@/lib/copilotPlan';
import { accent, useMindEase } from '@/lib/mindease-theme';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

export function Donut({ parts, size = 150, stroke = 22 }: {
  parts: { key: string; pct: number; color: string }[]; size?: number; stroke?: number;
}) {
  const { c } = useMindEase();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <Svg width={size} height={size}>
      <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
        {parts.map((p) => {
          const len = (circ * p.pct) / 100;
          const el = (
            <Circle key={p.key} cx={size / 2} cy={size / 2} r={r} stroke={p.color} strokeWidth={stroke}
              fill="none" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} />
          );
          acc += len;
          return el;
        })}
      </G>
    </Svg>
  );
}

const LEVEL_COLOR = { heavier: accent.coral, steady: accent.purple, lighter: accent.teal };

export function ForecastBars({ days }: { days: ForecastDay[] }) {
  const { c } = useMindEase();
  const W = 320, H = 160, pad = 12;
  const bw = (W - 2 * pad) / Math.max(days.length, 1);
  const max = Math.max(...days.map((d) => d.pct), 10);
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {days.map((d, i) => {
        const h = ((H - 56) * d.pct) / max;
        const x = pad + i * bw + bw * 0.2;
        const y = H - 28 - h;
        return (
          <G key={d.date}>
            <Rect x={x} y={y} width={bw * 0.6} height={Math.max(h, 2)} rx={6} fill={LEVEL_COLOR[d.level]} />
            <SvgText x={x + bw * 0.3} y={y - 5} fontSize={11} fill={c.text} textAnchor="middle" fontWeight="700">{d.pct}%</SvgText>
            <SvgText x={x + bw * 0.3} y={H - 10} fontSize={11} fill={c.muted} textAnchor="middle">{d.day}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}