import { GlassCard } from '@/components/mindease/GlassCard';
import { Body, Btn, ErrorNote, H, Muted, Row, StatTile } from '@/components/mindease/Kit';
import { Screen } from '@/components/mindease/Screen';
import { fetchCopilotData } from '@/lib/copilotData';
import { activityMix } from '@/lib/copilotPlan';
import { ACTIVITY_COLORS } from '@/lib/format';
import { accent, useMindEase } from '@/lib/mindease-theme';
import { useLoad } from '@/lib/useLoad';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';

export default function Insights() {
  const { c } = useMindEase();
  const { data, error, loading, reload } = useLoad(fetchCopilotData);
  const [all, setAll] = useState(false);

  const dash = data?.dashboard;
  const hist = data?.twin?.historical_state;
  const mix = activityMix(data?.activity ?? null);
  const suggestions = dash?.suggestions ?? [];
  const drivers = dash?.drivers ?? [];
  const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

  return (
    <Screen title="AI Insights" subtitle="What is shaping your score" onRefresh={reload} refreshing={loading}>
      {error ? <ErrorNote msg={error} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <StatTile icon="layers-outline" label="Sessions" value={String(dash?.session_count ?? hist?.session_count ?? 0)} />
        <StatTile icon="pulse-outline" label="Average load" color={accent.teal} value={pct(hist?.average_cli)} />
        <StatTile icon="trending-up-outline" label="Peak load" color={accent.coral} value={pct(hist?.peak_cli)} />
        <StatTile icon="moon-outline" label="Late nights" color={accent.pink} value={String(dash?.late_night_count ?? 0)} />
      </View>

      <GlassCard>
        <H>AI Insights for You</H>
        {dash?.headline ? (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{dash.headline.title}</Text>
            <Body style={{ color: c.muted, marginTop: 4 }}>{dash.headline.body}</Body>
          </View>
        ) : (
          <Body style={{ marginTop: 8 }}>Insights appear once a few sessions are tracked.</Body>
        )}
        {suggestions.length > 0 ? (
          <>
            <Btn ghost small style={{ marginTop: 12, alignSelf: 'flex-start' }}
              title={all ? 'Show less' : `View all insights (${suggestions.length})`} onPress={() => setAll((v) => !v)} />
            {all ? suggestions.map((s, i) => (
              <View key={i} style={{ marginTop: 12 }}>
                <Text style={{ color: c.text, fontWeight: '700' }}>{s.title}</Text>
                <Muted>{s.body}</Muted>
              </View>
            )) : null}
          </>
        ) : null}

        {drivers.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <H size={15}>Key drivers</H>
            {drivers.map((d, i) => {
              const up = d.direction === 'up';
              const col = up ? accent.coral : accent.teal;
              return (
                <Row key={i} style={{ marginTop: 12, alignItems: 'flex-start' }}>
                  <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>
                    <Ionicons name={up ? 'arrow-up-circle' : 'arrow-down-circle'} size={24} color={col} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700' }}>{d.label}</Text>
                      {d.caption ? <Muted>{d.caption}</Muted> : null}
                      {d.note ? <Muted>{d.note}</Muted> : null}
                    </View>
                  </View>
                  {d.value != null ? <Text style={{ color: col, fontWeight: '800' }}>{String(d.value)}</Text> : null}
                </Row>
              );
            })}
          </View>
        ) : null}
      </GlassCard>

      <GlassCard>
        <H>Fair load</H>
        <Muted style={{ marginBottom: 12 }}>Draining work counts fully toward burnout. Time you enjoy counts far less.</Muted>
        {mix.length === 0 ? (
          <Body>No check-ins yet. Answer the next popup and this card fills in.</Body>
        ) : (
          <>
            <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: c.border }}>
              {mix.map((m) => <View key={m.type} style={{ flex: m.pct, backgroundColor: ACTIVITY_COLORS[m.type] }} />)}
            </View>
            <View style={{ marginTop: 14, gap: 8 }}>
              {mix.map((m) => (
                <View key={m.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ACTIVITY_COLORS[m.type] }} />
                  <Text style={{ color: c.text, flex: 1 }}>{m.label}</Text>
                  <Text style={{ color: c.text, fontWeight: '700' }}>{m.pct}%</Text>
                </View>
              ))}
            </View>
            <Muted style={{ marginTop: 12 }}>
              {data?.activity?.checkin_count ?? 0} check-ins
              {data?.activity?.avg_engagement_score != null ? ` · avg engagement ${data.activity.avg_engagement_score.toFixed(1)}/5` : ''}
            </Muted>
          </>
        )}
      </GlassCard>
    </Screen>
  );
}