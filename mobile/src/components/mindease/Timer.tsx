import { accent } from '@/lib/mindease-theme';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Btn } from './Kit';

export function TimerButton({ minutes, onDone, label = 'Start timer' }: {
  minutes: number; onDone?: () => void; label?: string;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const endRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const running = left !== null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const s = Math.ceil((endRef.current - Date.now()) / 1000);
      if (s <= 0) { clearInterval(id); setLeft(null); doneRef.current?.(); }
      else setLeft(s);
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  if (!running) {
    return <Btn small ghost title={label} onPress={() => { endRef.current = Date.now() + minutes * 60_000; setLeft(minutes * 60); }} />;
  }
  const mm = `${Math.floor(left! / 60)}:${String(left! % 60).padStart(2, '0')}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: accent.purple }}>{mm}</Text>
      <Btn small ghost title="Stop" onPress={() => setLeft(null)} />
    </View>
  );
}