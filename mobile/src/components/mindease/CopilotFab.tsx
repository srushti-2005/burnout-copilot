import { accent } from '@/lib/mindease-theme';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { RobotAvatar } from './RobotAvatar';

export function CopilotFab({ attention = true }: { attention?: boolean }) {
  const router = useRouter();
  const pulse = useSharedValue(0);
  useEffect(() => { pulse.value = withRepeat(withTiming(1, { duration: 1800 }), -1, true); }, []);
  const aura = useAnimatedStyle(() => ({ opacity: 0.35 - 0.25 * pulse.value, transform: [{ scale: 1 + 0.35 * pulse.value }] }));
  return (
    <View style={{ position: 'absolute', right: 18, bottom: 96 }} pointerEvents="box-none">
      <Animated.View style={[{ position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: accent.purple }, aura]} />
      <Pressable onPress={() => router.push('/copilot')} accessibilityLabel="Open co-pilot">
        <RobotAvatar size={56} />
        {attention && <View style={{ position: 'absolute', top: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: accent.coral, borderWidth: 2, borderColor: '#fff' }} />}
      </Pressable>
    </View>
  );
}