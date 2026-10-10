import { IntroSplash } from '@/components/mindease/IntroSplash';
import { api } from '@/lib/api';
import { getAuthState, onAuthChange } from '@/lib/auth';
import { MindEaseThemeProvider } from '@/lib/mindease-theme';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function RootLayout() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const s = await getAuthState();
      setAuthed(!!s);
      if (s) {
        // Confirms the stored token still actually works. If it doesn't,
        // api() above signs the user out automatically, and the listener
        // below immediately sends them back to Login.
        api('/auth/profile').catch(() => {});
      }
    })();
    return onAuthChange((s) => setAuthed(!!s));
  }, []);

  useEffect(() => {
    if (authed === null) return;
    const onLogin = segments[0] === 'login';
    if (!authed && !onLogin) router.replace('/login');
    else if (authed && onLogin) router.replace('/');
  }, [authed, segments]);

  if (authed === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <MindEaseThemeProvider>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="copilot" options={{ presentation: 'modal' }} />
    </Stack>
    <IntroSplash />
  </MindEaseThemeProvider>
);
}