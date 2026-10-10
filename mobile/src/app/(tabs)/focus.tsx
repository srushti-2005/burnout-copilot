import { Btn, Card, Chip, H1, P, Ring, Screen } from '@/components/ui';
import { C } from '@/lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

const OPTIONS = [10, 20, 30, 45];
const TAG = 'focus';
const HISTORY_KEY = 'focus_history_local_v1';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

type HistoryItem = { date: string; plannedMin: number; usedMin: number; distractions: number; completed: boolean };

export default function Focus() {
  const [minutes, setMinutes] = useState(20);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(20 * 60);
  const [distractions, setDistractions] = useState(0);
  const [result, setResult] = useState<HistoryItem | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const endAt = useRef(0);
  const startedAt = useRef(0);
  const count = useRef(0);
  const done = useRef(true);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((raw) => { if (raw) setHistory(JSON.parse(raw)); });
    return () => { deactivateKeepAwake(TAG); };
  }, []);

  function start() {
    count.current = 0;
    done.current = false;
    setDistractions(0);
    setResult(null);
    startedAt.current = Date.now();
    endAt.current = Date.now() + minutes * 60_000;
    setRemaining(minutes * 60);
    setRunning(true);
    activateKeepAwakeAsync(TAG);
  }

  function finish(completed: boolean) {
    if (done.current) return;
    done.current = true;
    setRunning(false);
    deactivateKeepAwake(TAG);

    const usedMin = Math.max(0, Math.round((Date.now() - startedAt.current) / 60000));
    const item: HistoryItem = { date: new Date().toISOString(), plannedMin: minutes, usedMin, distractions: count.current, completed };
    setResult(item);
    const next = [item, ...history].slice(0, 20);
    setHistory(next);
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
  }

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) finish(true);
    }, 500);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') { count.current += 1; setDistractions(count.current); }
    });
    return () => { clearInterval(id); sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const pct = running ? (remaining / (minutes * 60)) * 100 : 100;

  return (
    <Screen>
      <H1>Focus Mode</H1>
      <P>This runs on this device only — it won't affect or sync with your web sessions.</P>

      <Card style={{ alignItems: 'center', gap: 14 }}>
        <Ring value={pct} size={180} label="FOCUS" />
        <Text style={{ fontSize: 44, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] }}>{fmt(remaining)}</Text>
        <P>Distractions: {distractions}</P>

        {!running && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {OPTIONS.map((m) => (
              <Chip key={m} label={`${m} min`} active={minutes === m}
                onPress={() => { setMinutes(m); setRemaining(m * 60); }} />
            ))}
          </View>
        )}
        <View style={{ alignSelf: 'stretch' }}>
          {running ? <Btn title="Stop" onPress={() => finish(false)} /> : <Btn title="Start" onPress={start} />}
        </View>
      </Card>

      {result ? (
        <Card>
          <Text style={{ fontWeight: '700', color: C.text }}>Session summary</Text>
          <P>{result.completed ? 'Completed' : 'Stopped early'} · {result.usedMin} min · {result.distractions} distraction{result.distractions === 1 ? '' : 's'}</P>
        </Card>
      ) : null}

      {history.length > 0 ? (
        <Card>
          <Text style={{ fontWeight: '700', color: C.text }}>Recent sessions (this device)</Text>
          {history.slice(0, 5).map((h, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <P>{new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</P>
              <P>{h.usedMin} min · {h.distractions} distraction{h.distractions === 1 ? '' : 's'}</P>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}