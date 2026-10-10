import { accent, useMindEase } from '@/lib/mindease-theme';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Pressable, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GlassCard } from './GlassCard';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function H({ children, size = 17, style }: { children: React.ReactNode; size?: number; style?: TextStyle }) {
  const { c } = useMindEase();
  return <Text style={[{ color: c.text, fontSize: size, fontWeight: '800' }, style]}>{children}</Text>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const { c } = useMindEase();
  return <Text style={[{ color: c.text, fontSize: 14, lineHeight: 20 }, style]}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const { c } = useMindEase();
  return <Text style={[{ color: c.muted, fontSize: 12, lineHeight: 17 }, style]}>{children}</Text>;
}

export function Pill({ label, color = accent.purple }: { label: string; color?: string }) {
  return (
    <View style={{ backgroundColor: color + '26', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Btn({ title, onPress, ghost, disabled, small, style }: {
  title: string; onPress: () => void; ghost?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle;
}) {
  const { c } = useMindEase();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[{
        paddingVertical: small ? 8 : 13, paddingHorizontal: small ? 14 : 18, borderRadius: 999,
        alignItems: 'center', opacity: disabled ? 0.5 : 1,
        backgroundColor: ghost ? 'transparent' : accent.purple,
        borderWidth: ghost ? 1 : 0, borderColor: c.border,
      }, style]}
    >
      <Text style={{ color: ghost ? c.text : '#fff', fontWeight: '700', fontSize: small ? 13 : 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const { c } = useMindEase();
  return (
    <Pressable onPress={onPress} style={{
      paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1,
      borderColor: active ? accent.purple : c.border,
      backgroundColor: active ? accent.purple : 'transparent',
    }}>
      <Text style={{ color: active ? '#fff' : c.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Bar({ value, color = accent.purple, height = 8 }: { value: number; color?: string; height?: number }) {
  const { c } = useMindEase();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.min(1, Math.max(0, value)), { duration: 900, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [value]);
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.border, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, fill]} />
    </View>
  );
}

export function StatTile({ icon, label, value, note, color = accent.purple }: {
  icon: IconName; label: string; value: string; note?: string; color?: string;
}) {
  const { c } = useMindEase();
  return (
    <View style={{ width: '48.5%' }}>
      <GlassCard>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: color + '26', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <Muted>{label}</Muted>
        <Text style={{ color: c.text, fontSize: 24, fontWeight: '800' }}>{value}</Text>
        {note ? <Muted>{note}</Muted> : null}
      </GlassCard>
    </View>
  );
}

export function ErrorNote({ msg }: { msg: string }) {
  return (
    <View style={{ backgroundColor: accent.coral + '22', borderRadius: 16, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: accent.coral, fontSize: 13 }}>{msg}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, style]}>{children}</View>;
}