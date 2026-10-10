import { GlassCard } from '@/components/mindease/GlassCard';
import { Body, Btn, ErrorNote, H, Muted, Pill, Row } from '@/components/mindease/Kit';
import { Screen } from '@/components/mindease/Screen';
import { fetchCopilotData } from '@/lib/copilotData';
import { FEATURE_LABELS, exhaustionProfile, rankedDeviations, resetsFor } from '@/lib/copilotPlan';
import { TREND_LABEL } from '@/lib/format';
import { accent, formatDelta, formatTrend, useMindEase } from '@/lib/mindease-theme';
import { doneCountsByDay } from '@/lib/recoStore';
import { STATUS_LABEL, buildWeeks, toCsv, toJson, type WeekStatus } from '@/lib/reports';
import { useLoad } from '@/lib/useLoad';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';

const STATUS_COLOR: Record<WeekStatus, string> = {
  rising: accent.coral, easing: accent.teal, steady: accent.purple, first: '#9a96ad', none: '#9a96ad',
};

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  const { c } = useMindEase();
  return (
    <View style={{ width: '48.5%', backgroundColor: c.border, borderRadius: 16, padding: 12, marginBottom: 10 }}>
      <Muted>{label}</Muted>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      {note ? <Muted>{note}</Muted> : null}
    </View>
  );
}

export default function Reports() {
  const { c } = useMindEase();
  const { data, error, loading, reload } = useLoad(async () => ({
    cp: await fetchCopilotData(),
    done: await doneCountsByDay(),
  }));
  const [sel, setSel] = useState<string | null>(null);

  const cp = data?.cp;
  const weeks = useMemo(() => buildWeeks(cp?.dashboard.trend ?? [], data?.done ?? {}), [cp, data]);
  const week = weeks.find((w) => w.id === sel) ?? weeks[0];

  const twin = cp?.twin ?? null;
  const prof = cp ? exhaustionProfile(cp.dashboard, cp.twin, cp.activity) : null;
  const bestReset = prof ? resetsFor(prof.type, twin?.profile.age ?? null, 1)[0] : null;
  const devs = rankedDeviations(twin);
  const trendKeys = ['cli', ...Object.keys(FEATURE_LABELS)];
  const hist = twin?.historical_state;
  const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

  async function share(kind: 'csv' | 'json') {
    if (!weeks.length) return;
    const message = kind === 'csv' ? toCsv(weeks) : toJson(weeks);
    await Share.share({ title: `mindease-weeks.${kind}`, message });
  }

  return (
    <Screen title="Reports" subtitle="Summaries" onRefresh={reload} refreshing={loading}>
      <Muted style={{ marginBottom: 12 }}>Weekly summaries of your wellbeing.</Muted>
      {error ? <ErrorNote msg={error} /> : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <Btn small ghost title="CSV" onPress={() => share('csv')} />
        <Btn small ghost title="JSON" onPress={() => share('json')} />
      </View>

      {weeks.length === 0 ? (
        <GlassCard><Body>No sessions recorded yet. Your first weekly summary appears after a few tracked sessions.</Body></GlassCard>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
            {weeks.map((w) => {
              const active = w.id === week?.id;
              return (
                <Pressable key={w.id} onPress={() => setSel(w.id)} style={{
                  paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1,
                  borderColor: active ? accent.purple : c.border, backgroundColor: active ? accent.purple + '33' : 'transparent',
                }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{w.label}</Text>
                  <Muted>{STATUS_LABEL[w.status]}</Muted>
                </Pressable>
              );
            })}
          </ScrollView>

          {week ? (
            <GlassCard>
              <Row><H>{week.label}</H><Pill label={STATUS_LABEL[week.status]} color={STATUS_COLOR[week.status]} /></Row>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 }}>
                <Tile label="Avg risk" value={week.avgRiskPct === null ? '—' : `${week.avgRiskPct}%`} />
                <Tile label="Peak risk" value={week.peakRiskPct === null ? '—' : `${week.peakRiskPct}%`} />
                <Tile label="Sessions" value={String(week.sessions)} />
                <Tile label="Avg sleep" value="—" note="Not tracked yet" />
                <Tile label="Tips done" value={String(week.tipsDone)} note="on this device" />
                <Tile label="Status" value={STATUS_LABEL[week.status]} />
              </View>
              <Muted style={{ marginTop: 4 }}>SUMMARY</Muted>
              <Body>{week.summary}</Body>
            </GlassCard>
          ) : null}
        </>
      )}

      <GlassCard>
        <H>Digital twin snapshot</H>
        {prof ? (
          <View style={{ marginTop: 10 }}>
            <Muted>EXHAUSTION FINGERPRINT</Muted>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{prof.label}</Text>
            <Body style={{ color: c.muted }}>{prof.summary}</Body>
          </View>
        ) : null}

        {devs.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            <Muted>SIGNALS VS YOUR USUAL</Muted>
            {devs.map(([f, d]) => (
              <Row key={f} style={{ paddingVertical: 6 }}>
                <Text style={{ color: c.text }}>{FEATURE_LABELS[f]}</Text>
                <Text style={{ color: d.status === 'above_normal' ? accent.coral : d.status === 'below_normal' ? accent.teal : c.muted, fontWeight: '700' }}>
                  {d.status === 'normal' ? 'Normal' : formatDelta(d.difference_pct)}
                </Text>
              </Row>
            ))}
          </View>
        ) : null}

        {bestReset ? (
          <View style={{ marginTop: 12 }}>
            <Muted>BEST RESET</Muted>
            <Text style={{ color: c.text, fontWeight: '700' }}>{bestReset.title} ({bestReset.minutes} min)</Text>
          </View>
        ) : null}

        {twin?.trends ? (
          <View style={{ marginTop: 14 }}>
            <Muted>TRENDS</Muted>
            {trendKeys.map((k) => {
              const t = twin.trends?.[k];
              if (!t) return null;
              return (
                <Row key={k} style={{ paddingVertical: 6 }}>
                  <Text style={{ color: c.text, flex: 1 }}>{k === 'cli' ? 'Overall load' : FEATURE_LABELS[k]}</Text>
                  <Muted>{TREND_LABEL[t.direction] ?? t.direction}</Muted>
                  <Text style={{ color: c.text, fontWeight: '700', width: 100, textAlign: 'right' }}>
                    {t.direction === 'insufficient_data' ? '—' : formatTrend(t.change_pct)}
                  </Text>
                </Row>
              );
            })}
          </View>
        ) : null}

        <Row style={{ marginTop: 14 }}>
          <Muted>Total sessions: {hist?.session_count ?? '—'}</Muted>
          <Muted>Avg {pct(hist?.average_cli)} · Peak {pct(hist?.peak_cli)}</Muted>
        </Row>
      </GlassCard>
      <Muted>Sleep and screen time are not tracked yet, so they are not included. General wellbeing guidance, not medical advice.</Muted>
    </Screen>
  );
}