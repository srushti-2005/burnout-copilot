import { riskColor, riskLabel, useMindEase } from '@/lib/mindease-theme';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AC = Animated.createAnimatedComponent(Circle);

export function RiskRing({ cli, category, size = 150 }: { cli: number; category?: string; size?: number }) {
  const { c } = useMindEase();
  const stroke = 12, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(Math.min(Math.max(cli, 0), 1), { duration: 1000, easing: Easing.bezier(0.16, 1, 0.3, 1) }); }, [cli]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - p.value) }));
  const col = riskColor(category);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
        <AC cx={size / 2} cy={size / 2} r={r} stroke={col} strokeWidth={stroke} fill="none"
            strokeLinecap="round" strokeDasharray={circ} animatedProps={props} />
      </Svg>
      <Text style={{ color: c.text, fontSize: 30, fontWeight: '800' }}>{Math.round(cli * 100)}%</Text>
      <Text style={{ color: col, fontSize: 12, fontWeight: '600' }}>{riskLabel(category)}</Text>
    </View>
  );
}