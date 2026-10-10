import { GlassCard } from '@/components/mindease/GlassCard';
import { Bar, Body, Btn, ErrorNote, H, IconName, Muted, Row, StatTile } from '@/components/mindease/Kit';
import { RecommendationArt } from '@/components/mindease/RecommendationArt';
import { RiskRing } from '@/components/mindease/RiskRing';
import { Screen } from '@/components/mindease/Screen';
import { TimerButton } from '@/components/mindease/Timer';
import { api } from '@/lib/api';
import { fetchCopilotData } from '@/lib/copilotData';
import { buildPlan, exhaustionProfile, resetsFor } from '@/lib/copilotPlan';
import { asPct, normCategory } from '@/lib/format';
import { accent, useMindEase } from '@/lib/mindease-theme';
import { runAction } from '@/lib/nav';
import { useLoad } from '@/lib/useLoad';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Text, View } from 'react-native';

function MetricBar({ icon, label, value, color }: { icon: IconName; label: string; value: number | null; color: string }) {
  const { c } = useMindEase();
  return (
    <View style={{ marginTop: 14 }}>
      <Row style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color + '26', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={22} color={color} />
          </View>
          <Muted>{label}</Muted>
        </View>
        <Text style={{ color: c.text, fontSize: 24, fontWeight: '800' }}>{value === null ? '—' : `${value}%`}</Text>
      </Row>
      <Bar value={(value ?? 0) / 100} color={color} />
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const { c } = useMindEase();
  const { data, error, loading, reload } = useLoad(async () => {
    const [ses, prof, cp] = await Promise.allSettled([
      api<any[]>('/sessions?limit=1'),
      api<any>('/auth/profile'),
      fetchCopilotData(),
    ]);
    return {
      session: ses.status === 'fulfilled' ? ses.value?.[0] : undefined,
      profile: prof.status === 'fulfilled' ? prof.value : undefined,
      cp: cp.status === 'fulfilled' ? cp.value : null,
      allFailed: [ses, prof, cp].every((r) => r.status === 'rejected'),
    };
  });

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (data?.profile?.display_name ?? '').split(' ')[0];
  const dateStr = `${now.toLocaleDateString('en-US', { weekday: 'long' })} · ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;

  const cp = data?.cp;
  const dash = cp?.dashboard;
  const twin = cp?.twin ?? null;
  const hasData = !!data?.session || (dash?.session_count ?? 0) > 0;
  const cli = dash?.cli ?? data?.session?.cli_score ?? 0;
  const category = normCategory(dash?.cli_category) ?? normCategory(data?.session?.risk_level);

  const plan = cp ? buildPlan(cp.dashboard, cp.twin, cp.activity, cp.intervention) : [];
  const lead = plan[0];
  const avoid = lead?.avoid ?? plan.find((i) => i.avoid)?.avoid;
  const next = plan.find((i) => i.action);
  const iv = cp?.intervention ?? null;

  const prof = cp ? exhaustionProfile(cp.dashboard, cp.twin, cp.activity) : null;
  const resets = prof ? resetsFor(prof.type, twin?.profile.age ?? null, 3) : [];
  const insights = (dash?.suggestions ?? []).slice(0, 3);

  const stat = (n: number | null) => (n === null ? '—' : `${n}%`);

  return (
    <Screen title={`${greet}${first ? `, ${first}` : ''}.`} subtitle={dateStr} onRefresh={reload} refreshing={loading}>
      <Muted style={{ marginBottom: 12 }}>A gentler day starts here.</Muted>
      {(error || data?.allFailed) ? <ErrorNote msg={error ?? 'Could not reach the server.'} /> : null}

      {/* Hero */}
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          {hasData
            ? <RiskRing cli={cli} category={category} size={128} />
            : <View style={{ width: 128, height: 128, alignItems: 'center', justifyContent: 'center' }}><Muted>No data yet</Muted></View>}
          <View style={{ flex: 1, gap: 4 }}>
            <Muted>Today's burnout risk</Muted>
            <H size={18}>{dash?.headline?.title ?? (hasData ? 'Your day at a glance' : 'Waiting for your first session')}</H>
            <Body style={{ color: c.muted }}>
              {dash?.headline?.body ?? (hasData ? '' : 'Your first session logs automatically within a few minutes.')}
            </Body>
          </View>
        </View>
        <MetricBar icon="pulse" label="Mental load" value={asPct(dash?.stress_level)} color={accent.coral} />
        <MetricBar icon="flash" label="Energy" value={asPct(dash?.energy_level)} color={accent.teal} />
      </GlassCard>

      {/* Plan for today */}
      <GlassCard>
        <H>Plan for today</H>
        {plan.length === 0 ? (
          <Body style={{ marginTop: 8 }}>You're in a healthy rhythm. Nothing needs your attention.</Body>
        ) : (
          <View style={{ marginTop: 10, gap: 10 }}>
            {avoid ? (
              <View style={{ backgroundColor: accent.coral + '1f', borderRadius: 14, padding: 12 }}>
                <Text style={{ color: accent.coral, fontWeight: '800', fontSize: 12 }}>AVOID</Text>
                <Body>{avoid}</Body>
              </View>
            ) : null}
            <View style={{ backgroundColor: accent.teal + '1f', borderRadius: 14, padding: 12 }}>
              <Text style={{ color: accent.teal, fontWeight: '800', fontSize: 12 }}>DO THIS</Text>
              <Body>{lead.doThis}</Body>
            </View>
            {next?.action ? (
              <View style={{ marginTop: 4, gap: 8 }}>
                <Muted>Best next step: {next.title}</Muted>
                <Btn title="I'll do it" onPress={() => runAction(router, next.action!.act)} />
              </View>
            ) : null}
          </View>
        )}
      </GlassCard>

      {/* Backend intervention */}
      {iv ? (
        <GlassCard>
          <Muted>SUGGESTED INTERVENTION</Muted>
          <H style={{ marginTop: 2 }}>{iv.title}</H>
          <Body style={{ marginTop: 4 }}>{iv.what}</Body>
          <Muted style={{ marginTop: 4 }}>{iv.why}</Muted>
          <Btn small style={{ marginTop: 12, alignSelf: 'flex-start' }}
            title={iv.action_label ?? 'Take action'}
            onPress={() => router.push((iv.ui_action?.kind === 'focus_protection' ? '/focus' : '/recommendations') as Href)} />
        </GlassCard>
      ) : null}

      {/* Stat tiles */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <StatTile icon="time-outline" label="Work time" color={accent.purple}
          value={dash?.avg_duration != null ? `${dash.avg_duration.toFixed(1)}h` : '—'} note="avg session" />
        <StatTile icon="eye-outline" label="Focus" color={accent.teal} value={stat(asPct(dash?.focus_pct))} note="of session time" />
        <StatTile icon="cafe-outline" label="Rest" color={accent.yellow} value={stat(asPct(dash?.rest_pct))}
          note={`${dash?.late_night_count ?? 0} late night${(dash?.late_night_count ?? 0) === 1 ? '' : 's'}`} />
        <StatTile icon="moon-outline" label="Sleep" color={accent.pink} value="—" note="Not tracked yet" />
      </View>

      {/* Insights */}
      {insights.length > 0 && (
        <GlassCard>
          <H>Insights</H>
          {insights.map((s, i) => (
            <View key={i} style={{ marginTop: 10 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{s.title}</Text>
              <Muted>{s.body}</Muted>
            </View>
          ))}
        </GlassCard>
      )}

      {/* Quick resets */}
      {resets.length > 0 && (
        <>
          <H style={{ marginVertical: 8 }}>Choose what feels easy</H>
          {resets.map((r) => (
            <GlassCard key={r.id}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Row><Text style={{ color: c.text, fontWeight: '800', flex: 1 }}>{r.title}</Text><Muted>{r.minutes} min</Muted></Row>
                  <Muted>{r.how}</Muted>
                  <View style={{ marginTop: 6 }}><TimerButton minutes={r.minutes} /></View>
                </View>
                <RecommendationArt title={r.title} id={r.id} width={84} />
              </View>
            </GlassCard>
          ))}
        </>
      )}

      <View style={{ gap: 10, marginTop: 4 }}>
        <Btn title="Check in: what was the last block?" onPress={() => router.push('/checkin' as Href)} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn ghost style={{ flex: 1 }} title="Focus mode" onPress={() => router.push('/focus' as Href)} />
          <Btn ghost style={{ flex: 1 }} title="Profile" onPress={() => router.push('/settings' as Href)} />
        </View>
      </View>
    </Screen>
  );
}