import { C } from '@/lib/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextStyle, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

export function Screen({ children, onRefresh, refreshing = false }: {
  children: ReactNode; onRefresh?: () => void; refreshing?: boolean;
}) {
  return (
    <LinearGradient colors={[C.bg1, C.bg2]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
          {children}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => (
  <View style={[{
    backgroundColor: C.card, borderRadius: 20, padding: 16, gap: 8,
    shadowColor: '#6D28D9', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  }, style]}>{children}</View>
);

export const H1 = ({ children }: { children: ReactNode }) => (
  <Text style={{ fontSize: 24, fontWeight: '700', color: C.text }}>{children}</Text>
);
export const H2 = ({ children }: { children: ReactNode }) => (
  <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{children}</Text>
);
export const P = ({ children, style }: { children: ReactNode; style?: TextStyle }) => (
  <Text style={[{ fontSize: 13, color: C.muted }, style]}>{children}</Text>
);

export function Btn({ title, onPress, ghost, disabled }: {
  title: string; onPress: () => void; ghost?: boolean; disabled?: boolean;
}) {
  if (ghost) {
    return (
      <Pressable onPress={onPress} disabled={disabled}
        style={{ borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 999,
                 paddingVertical: 14, alignItems: 'center', opacity: disabled ? 0.5 : 1 }}>
        <Text style={{ color: C.text, fontWeight: '600' }}>{title}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
      <LinearGradient colors={[C.primary, C.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress}
    style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1,
             borderColor: active ? C.primary : C.border, backgroundColor: active ? C.soft : '#fff' }}>
    <Text style={{ color: active ? C.primary : C.text, fontWeight: '600' }}>{label}</Text>
  </Pressable>
);

export const inputStyle: TextStyle = {
  backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: C.border,
  paddingVertical: 12, paddingHorizontal: 18, color: C.text,
};

export function Ring({ value, label, color = C.primary, size = 120 }: {
  value: number; label?: string; color?: string; size?: number;
}) {
  const stroke = 10, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.soft} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - v / 100)} strokeLinecap="round" />
      </Svg>
      <Text style={{ fontSize: 24, fontWeight: '700', color: C.text }}>{Math.round(v)}%</Text>
      {label ? <Text style={{ fontSize: 10, color: color, fontWeight: '700' }}>{label}</Text> : null}
    </View>
  );
}

export const Bar = ({ pct, color = C.primary }: { pct: number; color?: string }) => (
  <View style={{ height: 8, borderRadius: 4, backgroundColor: C.soft, overflow: 'hidden' }}>
    <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 8, backgroundColor: color }} />
  </View>
);

export const Err = ({ msg }: { msg: string }) => (
  <Card style={{ backgroundColor: '#FEF2F2' }}>
    <Text style={{ color: C.bad }}>{msg}</Text>
  </Card>
);