import { accent, useMindEase } from '@/lib/mindease-theme';
import React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Background } from './Background';
import { CopilotFab } from './CopilotFab';
import { ThemeToggle } from './ThemeToggle';

export function Screen({
  title, subtitle, children, fab = true, onRefresh, refreshing,
}: {
  title: string; subtitle?: string; children: React.ReactNode; fab?: boolean;
  onRefresh?: () => void; refreshing?: boolean;
}) {
  const { c } = useMindEase();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg0 }}>
      <Background />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            {subtitle ? <Text style={{ color: c.muted, fontSize: 12 }}>{subtitle}</Text> : null}
            <Text style={{ color: c.text, fontSize: 24, fontWeight: '800' }} numberOfLines={1}>{title}</Text>
          </View>
          <ThemeToggle />
        </View>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 150 }}
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={accent.purple} /> : undefined}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
      {fab && <CopilotFab />}
    </View>
  );
}