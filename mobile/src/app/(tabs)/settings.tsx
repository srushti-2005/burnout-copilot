import { Btn, Card, Chip, Err, H1, H2, P, Screen, inputStyle } from '@/components/ui';
import { api } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { disableReminders, enableReminders, remindersSupported } from '@/lib/reminders';
import { C } from '@/lib/theme';
import { useLoad } from '@/lib/useLoad';
import { useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';

const INTERVALS = [15, 30, 60];

export default function Profile() {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [on, setOn] = useState(false);
  const [minutes, setMinutes] = useState(30);

  const { data, error, loading, reload } = useLoad(async () => {
    const p = await api<any>('/auth/profile');
    setName(p.display_name ?? '');
    setAge(p.age ? String(p.age) : '');
    return p;
  });

  async function save() {
    const a = Number(age);
    if (age && (!Number.isInteger(a) || a < 13 || a > 100)) return Alert.alert('Age', 'Age must be 13–100.');
    try {
      await api('/auth/profile', { method: 'PATCH', body: JSON.stringify({ display_name: name || null, age: age ? a : null }) });
      Alert.alert('Saved', 'Profile updated.');
      reload();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  async function apply(nextOn: boolean, nextMin: number) {
    try {
      if (nextOn) {
        if (!(await enableReminders(nextMin))) {
          Alert.alert('Permission needed', 'Allow notifications in phone settings.');
          setOn(false);
          return;
        }
      } else await disableReminders();
      setOn(nextOn); setMinutes(nextMin);
    } catch (e: any) {
      Alert.alert('Reminder error', e.message);
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <H1>Profile</H1>
      {error ? <Err msg={error} /> : null}

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.primary }}>{(data?.display_name ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', color: C.text }}>{data?.display_name}</Text>
          <P>{data?.email}</P>
        </View>
      </Card>

      <Card>
        <H2>Account</H2>
        <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor="#9CA3AF" style={inputStyle} />
        <TextInput value={age} onChangeText={setAge} placeholder="Age" keyboardType="number-pad" placeholderTextColor="#9CA3AF" style={inputStyle} />
        <Btn title="Save changes" onPress={save} />
      </Card>

      <Card>
        <H2>Notification preferences</H2>
        {!remindersSupported && <P style={{ color: '#B45309' }}>Reminders need a development build. They are off in Expo Go.</P>}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: C.text }}>Check-in reminders</Text>
          <Switch value={on} disabled={!remindersSupported} onValueChange={(v) => apply(v, minutes)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {INTERVALS.map((m) => <Chip key={m} label={`${m} min`} active={minutes === m} onPress={() => apply(on, m)} />)}
        </View>
      </Card>

      <Btn ghost title="Sign out" onPress={() => signOut()} />
    </Screen>
  );
}