import { GlassCard } from '@/components/mindease/GlassCard';
import { Btn, Chip, H, Muted } from '@/components/mindease/Kit';
import { Screen } from '@/components/mindease/Screen';
import { api } from '@/lib/api';
import { useMindEase } from '@/lib/mindease-theme';
import { tracker } from '@/lib/tracker';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

const TYPES = ['work', 'hobby', 'entertainment', 'break', 'other'] as const;
const DURATIONS = [15, 30, 60];

export default function CheckIn() {
  const router = useRouter();
  const { c } = useMindEase();
  const [type, setType] = useState<(typeof TYPES)[number]>('work');
  const [engagement, setEngagement] = useState<number | null>(null);
  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const body = {
        activity_type: type,
        engagement_score: engagement,
        duration_min: duration,
        segment_start_utc: new Date(Date.now() - duration * 60_000).toISOString(),
        note: note.trim() || null,
      };
      const res = await api<any>('/activity/checkin', { method: 'POST', body: JSON.stringify(body) });
      Alert.alert('Saved', `Context multiplier: ${res?.context_multiplier ?? '-'}`);
      router.replace('/' as Href);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBusy(false);
    }
  }

  const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 10 };
  return (
    <Screen title="Quick check-in" subtitle="What was the last block?" fab={false}>
      <GlassCard><H>What were you doing?</H>
        <View style={row}>{TYPES.map((t) => <Chip key={t} label={t} active={type === t} onPress={() => setType(t)} />)}</View>
      </GlassCard>
      <GlassCard><H>How engaging was it? (1–5)</H>
        <View style={row}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={String(n)} active={engagement === n} onPress={() => setEngagement(n)} />)}</View>
      </GlassCard>
      <GlassCard><H>For how long?</H>
        <View style={row}>{DURATIONS.map((d) => <Chip key={d} label={`${d} min`} active={duration === d} onPress={() => setDuration(d)} />)}</View>
      </GlassCard>
      <GlassCard><H>Note (optional)</H>
        <Muted>Typing here also feeds your typing-rhythm signal.</Muted>
        <TextInput
          value={note} multiline placeholder="How did it feel?" placeholderTextColor={c.muted}
          onChangeText={(t) => { tracker.recordKeystroke(); setNote(t); }}
          style={{ marginTop: 10, borderRadius: 16, minHeight: 80, textAlignVertical: 'top', padding: 12, color: c.text, borderWidth: 1, borderColor: c.border }}
        />
      </GlassCard>
      <View style={{ gap: 10 }}>
        <Btn title={busy ? 'Saving…' : 'Submit'} onPress={submit} disabled={busy} />
        <Btn ghost title="Cancel" onPress={() => router.replace('/' as Href)} />
      </View>
    </Screen>
  );
}