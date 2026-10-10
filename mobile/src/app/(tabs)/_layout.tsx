import { accent, useMindEase } from '@/lib/mindease-theme';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

export default function TabLayout() {
  const { c, mode } = useMindEase();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent.purple,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarStyle: {
          position: 'absolute',
          borderTopColor: c.border,
          backgroundColor: c.tabBar,
          height: 72,
          paddingTop: 6,
        },
        tabBarBackground: () => (
          <BlurView intensity={30} tint={mode} style={StyleSheet.absoluteFill} />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="twin"
        options={{
          title: 'Twin',
          tabBarIcon: ({ color, size }) => <Ionicons name="globe-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="recommendations"
        options={{
          title: 'Tips',
          tabBarIcon: ({ color, size }) => <Ionicons name="bulb-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
        }}
      />

      {/* Still routes, hidden from the tab bar */}
      <Tabs.Screen name="focus" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="checkin" options={{ href: null }} />
    </Tabs>
  );
}