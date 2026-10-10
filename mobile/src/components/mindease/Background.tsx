import { useMindEase } from '@/lib/mindease-theme';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

export function Background() {
  const { c, mode } = useMindEase();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[c.bg0, c.bg1]} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', top: -80, left: -100, width: 320, height: 320, borderRadius: 160, backgroundColor: '#3ecfb2', opacity: c.glowGreen }} />
      <View style={{ position: 'absolute', bottom: 40, right: -120, width: 360, height: 360, borderRadius: 180, backgroundColor: '#ff7a7a', opacity: c.glowRed }} />
      <BlurView intensity={80} tint={mode} style={StyleSheet.absoluteFill} />
    </View>
  );
}