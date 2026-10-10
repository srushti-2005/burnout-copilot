import { accent, useMindEase } from '@/lib/mindease-theme';
import { Switch, Text, View } from 'react-native';

export function ThemeToggle() {
  const { mode, toggle, c } = useMindEase();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>Light</Text>
      <Switch value={mode === 'dark'} onValueChange={toggle}
        trackColor={{ true: accent.purple, false: '#cfcbe0' }} thumbColor="#fff" />
      <Text style={{ color: c.muted, fontSize: 12 }}>Dark</Text>
    </View>
  );
}