import { useMindEase } from '@/lib/mindease-theme';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Background } from './Background';
import { RobotAvatar } from './RobotAvatar';

export function IntroSplash() {
  const { c } = useMindEase();
  const [show, setShow] = useState(true);
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withDelay(1500, withTiming(0, { duration: 600, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
    const t = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(t);
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  if (!show) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 999, backgroundColor: c.bg0 }, style]} pointerEvents="none">
      <Background />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <RobotAvatar size={96} />
        <Text style={{ color: c.text, fontSize: 34, fontWeight: '800' }}>MindEase</Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>A gentler day starts here.</Text>
      </View>
    </Animated.View>
  );
}