import { IntroSplash } from '@/components/mindease/IntroSplash';
import { api } from '@/lib/api';
import { AuthState, getAuthState, onAuthChange } from '@/lib/auth';
import { MindEaseThemeProvider } from '@/lib/mindease-theme';
import { flushTracker, tracker } from '@/lib/tracker';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

// Only these accounts see the small sync badge. Real users never do.
const DEBUG_EMAILS = ['divya98desai@gmail.com'];
const isDebugUser = (s: AuthState) =>
  !!s && DEBUG_EMAILS.includes((s.user.email || '').toLowerCase());

function DebugBadge() {
  const [st, setSt] = useState(tracker.status());
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const t = setInterval(() => setSt(tracker.status()), 2000);
    return () => clearInterval(t);
  }, []);

  const p: any = st.lastPayload;
  const line = st.lastError
    ? `Error: ${st.lastError.slice(0, 140)}`
    : st.lastOkAt
      ? `OK ${new Date(st.lastOkAt).toLocaleTimeString()}` +
        (p ? ` · tm ${p.typing_mean} tv ${p.typing_variance} sw ${p.task_switching} h ${p.work_duration}` : '')
      : 'No upload yet';

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 8, right: 8, bottom: 96, zIndex: 999 }}>
      <Pressable
        onPress={async () => {
          setMsg('sending...');
          const r = await flushTracker();
          setMsg(r.ok ? 'sent OK' : `failed: ${(r.error ?? '').slice(0, 140)}`);
        }}
        style={{ backgroundColor: 'rgba(0,0,0,0.75)', padding: 8, borderRadius: 10 }}
      >
        <Text style={{ color: '#fff', fontSize: 11 }}>
          Sync {st.running ? 'running' : 'stopped'} · {line}
        </Text>
        <Text style={{ color: '#9fe', fontSize: 11 }}>Tap to send a test row {msg ? `· ${msg}` : ''}</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [debug, setDebug] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const s = await getAuthState();
      setAuthed(!!s);
      setDebug(isDebugUser(s));
      if (s) {
        api('/auth/profile').catch(() => {});
      }
    })();
    return onAuthChange((s) => {
      setAuthed(!!s);
      setDebug(isDebugUser(s));
    });
  }, []);

  useEffect(() => {
    if (authed) {
      tracker.startTracking();
    } else {
      tracker.stopTracking();
    }
    return () => {
      tracker.stopTracking();
    };
  }, [authed]);

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
      {/* Counts every touch in the app as activity; returns false so it never blocks taps or scrolling. */}
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => {
          tracker.recordTouch();
          return false;
        }}
      >
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="copilot" options={{ presentation: 'modal' }} />
        </Stack>
        <IntroSplash />
        {authed && debug ? <DebugBadge /> : null}
      </View>
    </MindEaseThemeProvider>
  );
}