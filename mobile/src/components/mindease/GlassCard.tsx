import { motion, radius, useMindEase } from '@/lib/mindease-theme';
import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export function GlassCard({ children, style, delay = 0, ...rest }: ViewProps & { delay?: number }) {
  const { c, mode } = useMindEase();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: motion.duration, easing: Easing.bezier(...motion.bezier) });
  }, []);
  const anim = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 0.98 + 0.02 * p.value }],
  }));
  return (
    <Animated.View style={[anim, { marginBottom: 14 }]}>
      <View
        {...rest}
        style={[
          { borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
          style,
        ]}
      >
        <BlurView intensity={16} tint={mode} style={StyleSheet.absoluteFill} />
        <View style={{ padding: 18 }}>{children}</View>
      </View>
    </Animated.View>
  );
}