import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export function RobotAvatar({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Circle cx="32" cy="32" r="32" fill="#fff" />
      <Line x1="32" y1="9" x2="32" y2="15" stroke="#4f7cff" strokeWidth="2.5" />
      <Circle cx="32" cy="8" r="3" fill="#22d3ee" />
      <Rect x="14" y="15" width="36" height="30" rx="14" fill="#4f7cff" />
      <Rect x="19" y="22" width="26" height="14" rx="7" fill="#1e2a5a" />
      <Circle cx="27" cy="29" r="2.6" fill="#22d3ee" />
      <Circle cx="37" cy="29" r="2.6" fill="#22d3ee" />
      <Path d="M28 33 Q32 36 36 33" stroke="#22d3ee" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <Rect x="9" y="25" width="6" height="12" rx="3" fill="#22d3ee" />
      <Rect x="49" y="25" width="6" height="12" rx="3" fill="#22d3ee" />
    </Svg>
  );
}

export default RobotAvatar;