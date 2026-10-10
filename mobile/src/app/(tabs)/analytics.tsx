import { Donut, ForecastBars } from '@/components/mindease/charts';
import { GlassCard } from '@/components/mindease/GlassCard';
import { Body, Chip, ErrorNote, H, Muted, StatTile } from '@/components/mindease/Kit';
import { RiskRing } from '@/components/mindease/RiskRing';
import { Screen } from '@/components/mindease/Screen';
import { fetchCopilotData } from '@/lib/copilotData';
import { activityMix, forecastDays } from '@/lib/copilotPlan';
import { ACTIVITY_COLORS, normCategory, peakInRange } from '@/lib/format';
import { accent, useMindEase } from '@/lib/mindease-theme';
import { rangeStats } from '@/lib/reports';
import { useLoad } from '@/lib/useLoad';
import React from 'react';
import { Text, View } from 'react-native';

const RANGES = [7, 30, 90] as const;

export default function Analytics() {
  const { c } = useMindEase();
  const { data, error, loading, reload } = useLoad(fetchCopilotData);
  const [days, setDays] = React.useState<(typeof RANGES)[number]>(7);

  const dash = data?.dashboard ?? { cli: 0, forecast: [] };
  const trend = dash.trend ?? [];
  const stats = rangeStats(trend, days);
  const peak = peakInRange(trend, days);
  const mix = activityMix(data?.activity ?? null);
  const fc = forecastDays(dash);
  const hasSessions = (dash.session_count ?? 0) > 0 || trend.length > 0;

  return (
    <Screen title="Analytics" subtitle="How your load moves over time" onRefresh={reload} refreshing={loading}>
      {error ? <ErrorNote msg={error} /> : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {RANGES.map((r) => <Chip key={r} label={`${r}D`} active={days === r} onPress={() => setDays(r)} />)}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <StatTile icon="speedometer-outline" label="Average risk" value={stats.avgRiskPct === null ? '—' : `${stats.avgRiskPct}%`} note={`last ${days} days`} />
        <StatTile icon="trending-up-outline" label="Peak risk" color={accent.coral} value={peak === null ? '—' : `${peak}%`} />
        <StatTile icon="layers-outline" label="Sessions" color={accent.teal} value={String(stats.sessions)} />
        <StatTile icon="sunny-outline" label="Calmest hour" color={accent.yellow}
          value={stats.calmestHour === null ? '—' : `${stats.calmestHour}:00`} note={stats.calmestHour === null ? 'Needs 3+ sessions' : 'lowest average load'} />
      </View>

      <GlassCard>
        <H>Risk gauge</H>
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          {hasSessions
            ? <RiskRing cli={dash.cli} category={normCategory(dash.cli_category)} size={150} />
            : <Muted>No sessions yet.</Muted>}
        </View>
      </GlassCard>

      <GlassCard>
        <H>Screen time breakdown</H>
        <Muted style={{ marginBottom: 12 }}>
          This is the split of your activity check-ins, not real per-app screen time.
        </Muted>
        {mix.length === 0 ? (
          <Body>No check-ins yet. Answer the next check-in and this fills in.</Body>
        ) : (
          <View style={{ alignItems: 'center', gap: 14 }}>
            <Donut parts={mix.map((m) => ({ key: m.type, pct: m.pct, color: ACTIVITY_COLORS[m.type] }))} />
            <View style={{ alignSelf: 'stretch', gap: 6 }}>
              {mix.map((m) => (
                <View key={m.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ACTIVITY_COLORS[m.type] }} />
                  <Text style={{ color: c.text, flex: 1 }}>{m.label}</Text>
                  <Text style={{ color: c.text, fontWeight: '700' }}>{m.pct}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </GlassCard>

      <GlassCard>
        <H>7-day burnout forecast</H>
        {fc.length === 0 ? (
          <Body style={{ marginTop: 8 }}>I need a few more sessions before I can forecast your week.</Body>
        ) : (
          <View style={{ marginTop: 8 }}>
            <ForecastBars days={fc} />
            <Muted>Red = heavier than now, green = lighter, purple = steady.</Muted>
          </View>
        )}
      </GlassCard>
    </Screen>
  );
}