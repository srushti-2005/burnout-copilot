import { GlassCard } from '@/components/mindease/GlassCard';
import { Bar, Body, Btn, Chip, ErrorNote, H, Muted, Pill, Row } from '@/components/mindease/Kit';
import { RecommendationArt } from '@/components/mindease/RecommendationArt';
import { Screen } from '@/components/mindease/Screen';
import { TimerButton } from '@/components/mindease/Timer';
import { fetchCopilotData } from '@/lib/copilotData';
import { exhaustionProfile } from '@/lib/copilotPlan';
import { accent, useMindEase } from '@/lib/mindease-theme';
import {
  CATEGORIES,
  buildCtx,
  selectForNow,
  type Ctx,
  type Scored,
} from '@/lib/recoCatalog';
import { doneToday, setDone as saveDone } from '@/lib/recoStore';
import { useLoad } from '@/lib/useLoad';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

const IMPACT_COLOR: Record<string, string> = {
  Low: accent.low,
  Medium: accent.yellow,
  High: accent.coral,
};

function RecoCard({ s, done, onSet }: { s: Scored; done: boolean; onSet: (on: boolean) => void }) {
  const { c } = useMindEase();
  const { item } = s;
  return (
    <GlassCard style={{ opacity: done ? 0.65 : 1 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={() => onSet(!done)} hitSlop={10} accessibilityLabel={`Mark ${item.title} done`}>
          <Ionicons
            name={done ? 'checkmark-circle' : 'ellipse-outline'}
            size={28}
            color={done ? accent.teal : c.muted}
          />
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Row>
            <Text
              style={{
                color: c.text,
                fontWeight: '800',
                fontSize: 16,
                flex: 1,
                textDecorationLine: done ? 'line-through' : 'none',
              }}
            >
              {item.title}
            </Text>
            {item.minutes ? <Muted>{item.minutes} min</Muted> : null}
          </Row>
          <Body>{item.how}</Body>
          <Muted>{item.why}</Muted>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <Pill label={item.category} />
        <Pill label={`${item.impact} impact`} color={IMPACT_COLOR[item.impact]} />
        {s.suggested ? <Pill label="Suggested for you" color={accent.teal} /> : null}
      </View>
      {s.suggested && s.reason ? <Muted style={{ marginTop: 8 }}>Because: {s.reason}</Muted> : null}

      <Row style={{ marginTop: 12 }}>
        {item.minutes ? <TimerButton minutes={item.minutes} onDone={() => onSet(true)} /> : <View />}
        <RecommendationArt title={item.title} id={item.id} width={80} />
      </Row>
    </GlassCard>
  );
}

export default function Recommendations() {
  const router = useRouter();
  const { c } = useMindEase();
  const { data, error, loading, reload } = useLoad(fetchCopilotData);
  const [done, setDoneIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<(typeof CATEGORIES)[number]>('All');
  const [hide, setHide] = useState(false);

  // Every time the tab is opened: reload today's ticks AND the latest CLI/activity.
  useFocusEffect(
    useCallback(() => {
      doneToday().then(setDoneIds);
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const ctx: Ctx | null = useMemo(() => {
    if (!data) return null;
    const prof = exhaustionProfile(data.dashboard, data.twin, data.activity);
    return buildCtx(data.dashboard, data.twin, prof.type);
  }, [data]);

  // Only the picks that fit the user's current CLI and activity, not the whole catalogue.
  const ranked: Scored[] = useMemo(() => (ctx ? selectForNow(ctx) : []), [ctx]);

  async function setOne(id: string, on: boolean) {
    setDoneIds(await saveDone(id, on));
  }

  const total = ranked.length;
  const doneCount = ranked.filter((s) => done.includes(s.item.id)).length;

  const list = ranked
    .filter((s) => filter === 'All' || s.item.category === filter)
    .filter((s) => !(hide && done.includes(s.item.id)));

  const iv = data?.intervention;

  return (
    <Screen
      title="Recommendations"
      subtitle="Small resets that fit you right now"
      onRefresh={reload}
      refreshing={loading}
    >
      {error ? <ErrorNote msg={error} /> : null}

      {iv ? (
        <GlassCard>
          <Muted>RIGHT NOW</Muted>
          <H>{iv.title}</H>
          <Body style={{ marginTop: 4 }}>{iv.what}</Body>
          <Muted style={{ marginTop: 4 }}>{iv.why}</Muted>
          {iv.ui_action?.kind === 'focus_protection' ? (
            <Btn
              small
              style={{ marginTop: 10, alignSelf: 'flex-start' }}
              title={iv.action_label ?? 'Start focus'}
              onPress={() => router.push('/focus' as Href)}
            />
          ) : null}
        </GlassCard>
      ) : null}

      <GlassCard>
        <Row>
          <H>Today's progress</H>
          <Muted>{doneCount} of {total} done</Muted>
        </Row>
        <View style={{ marginTop: 10 }}>
          <Bar value={total ? doneCount / total : 0} color={accent.teal} />
        </View>
        {ctx ? (
          <Muted style={{ marginTop: 8 }}>
            Picked for right now: {ctx.risk} load (CLI {Number(ctx.cli ?? 0).toFixed(2)}).
          </Muted>
        ) : null}
      </GlassCard>

      <GlassCard style={{ backgroundColor: accent.purple + '1f' }}>
        <Muted>
          AI-generated recommendations tailored to what's driving your score. Integration coming soon.
        </Muted>
      </GlassCard>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
      >
        {CATEGORIES.map((cat) => (
          <Chip key={cat} label={cat} active={filter === cat} onPress={() => setFilter(cat)} />
        ))}
      </ScrollView>

      <Row style={{ marginBottom: 14 }}>
        <Text style={{ color: c.muted }}>Hide completed</Text>
        <Switch
          value={hide}
          onValueChange={setHide}
          trackColor={{ true: accent.purple, false: '#cfcbe0' }}
          thumbColor="#fff"
        />
      </Row>

      {!data && loading ? <Muted>Reading your current activity…</Muted> : null}
      {data && list.length === 0 ? <Muted>Nothing in this category for right now. Try another filter.</Muted> : null}
      {list.map((s) => (
        <RecoCard
          key={s.item.id}
          s={s}
          done={done.includes(s.item.id)}
          onSet={(on) => setOne(s.item.id, on)}
        />
      ))}

      <Muted>General wellbeing suggestions, not medical advice.</Muted>
    </Screen>
  );
}