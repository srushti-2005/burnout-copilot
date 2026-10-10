import { GlassCard } from '@/components/mindease/GlassCard';
import { Body, ErrorNote, H, Muted, Pill, Row } from '@/components/mindease/Kit';
import { Screen } from '@/components/mindease/Screen';
import { fetchCopilotData } from '@/lib/copilotData';
import { FEATURE_LABELS } from '@/lib/copilotPlan';
import { normCategory } from '@/lib/format';
import { accent, formatDelta, riskColor, useMindEase } from '@/lib/mindease-theme';
import { useLoad } from '@/lib/useLoad';
import { Text, View } from 'react-native';

function Line({ k, v }: { k: string; v: string }) {
  const { c } = useMindEase();
  return (
    <Row style={{ paddingVertical: 8 }}>
      <Muted>{k}</Muted>
      <Text style={{ color: c.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{v}</Text>
    </Row>
  );
}

export default function Twin() {
  const { c } = useMindEase();
  const { data, error, loading, reload } = useLoad(fetchCopilotData);
  const twin = data?.twin ?? null;
  const cs = twin?.current_state;
  const established = twin?.baseline.is_established;
  const n = twin?.baseline.session_count ?? 0;
  const cat = normCategory(cs?.risk_level);

  return (
    <Screen title="Digital Twin" subtitle="You, measured against your own normal" onRefresh={reload} refreshing={loading}>
      {error ? <ErrorNote msg={error} /> : null}

      <GlassCard>
        <H>Profile and state</H>
        <Line k="Age" v={twin?.profile.age != null ? String(twin.profile.age) : 'Not set'} />
        <Line k="Personal baseline" v={!twin ? '—' : established ? `Established from ${n} sessions` : `Calibrating ${n}/5`} />
        <Line k="Current state"
          v={cs ? `${Math.round(cs.cli * 100)}%${cs.risk_level ? ` · ${cs.risk_level}` : ''}` : '—'} />
        {cs?.recorded_at ? <Muted style={{ textAlign: 'right' }}>{new Date(cs.recorded_at).toLocaleString()}</Muted> : null}
        {cat ? <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Pill label={cat} color={riskColor(cat)} /></View> : null}
      </GlassCard>

      <GlassCard>
        <H>Deviation from baseline</H>
        {Object.entries(FEATURE_LABELS).map(([key, label]) => {
          const d = twin?.deviations?.[key];
          const status = d?.status ?? 'normal';
          const tint = status === 'above_normal' ? accent.coral : status === 'below_normal' ? accent.teal : c.muted;
          const text = !d ? '—' : status === 'normal' ? 'Normal' : formatDelta(d.difference_pct);
          return (
            <Row key={key} style={{ marginTop: 10, backgroundColor: tint + '1f', borderRadius: 14, padding: 12 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{label}</Text>
              <Text style={{ color: tint, fontWeight: '800' }}>{text}</Text>
            </Row>
          );
        })}
        {!established ? (
          <Body style={{ color: c.muted, marginTop: 12, fontSize: 12 }}>
            While your baseline is still small, percentages can swing widely. Treat them as a rough guide.
          </Body>
        ) : null}
      </GlassCard>
    </Screen>
  );
}