import { Btn, Card, Screen, inputStyle } from '@/components/ui';
import { resetPassword, signIn, signUp } from '@/lib/auth';
import { C } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return Alert.alert('Missing details', 'Enter email and password.');
    setBusy(true);
    try {
      if (mode === 'login') {
        const r = await signIn(email.trim(), password);
        if (!r.ok) Alert.alert('Login failed', r.error ?? 'Please check your email and password.');
        return;
      }
      const a = Number(age);
      if (!name.trim()) return Alert.alert('Missing details', 'Enter your full name.');
      if (!Number.isInteger(a) || a < 13 || a > 100) return Alert.alert('Age', 'Age must be between 13 and 100.');
      if (password !== confirm) return Alert.alert('Passwords', 'Passwords do not match.');

      const r = await signUp(email.trim(), password, name.trim(), a);
      if (r.ok) return; // logged in automatically

      if (r.needsConfirmation) {
        Alert.alert('Confirm your email', 'We\'ve sent a confirmation link to your email. Please verify it, then log in here.');
        setMode('login');
      } else if (/security purposes|too many|rate limit|seconds/i.test(r.error ?? '')) {
        Alert.alert('Almost there', 'Your account may already be created. Please wait a moment, then try logging in instead.');
        setMode('login');
      } else if (/already registered|already exists/i.test(r.error ?? '')) {
        Alert.alert('Account exists', 'This email is already registered. Try logging in instead.');
        setMode('login');
      } else {
        Alert.alert('Sign up failed', r.error ?? 'Please try again.');
      }
    } catch (e: any) {
      Alert.alert('Network error', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) return Alert.alert('Forgot password', 'Enter your email first.');
    const r = await resetPassword(email.trim());
    Alert.alert('Reset', r.ok ? 'Check your email for the reset link.' : (r.error ?? 'Could not send reset email.'));
  }

  const field = (icon: any, props: any) => (
    <View style={{ justifyContent: 'center' }}>
      <Ionicons name={icon} size={18} color={C.muted} style={{ position: 'absolute', left: 16, zIndex: 1 }} />
      <TextInput {...props} placeholderTextColor="#9CA3AF" style={[inputStyle, { paddingLeft: 44 }]} />
    </View>
  );

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 16, gap: 6 }}>
          <Ionicons name="medkit-outline" size={44} color={C.pink} />
          <Text style={{ fontSize: 30, fontWeight: '800', color: C.text }}>Burnout Copilot</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>AI-powered wellness insights • Live & continuous</Text>
        </View>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28, marginBottom: 8 }}>
            {(['login', 'signup'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)}>
                <Text style={{ fontWeight: '700', color: mode === m ? C.primary : C.muted,
                               borderBottomWidth: 2, borderBottomColor: mode === m ? C.primary : 'transparent', paddingBottom: 4 }}>
                  {m === 'login' ? 'Login' : 'Sign Up'}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === 'signup' && field('person-outline', { placeholder: 'Full name', value: name, onChangeText: setName })}
          {mode === 'signup' && field('calendar-outline', { placeholder: 'Age', value: age, onChangeText: setAge, keyboardType: 'number-pad' })}
          {field('mail-outline', { placeholder: 'you@example.com', value: email, onChangeText: setEmail, autoCapitalize: 'none', keyboardType: 'email-address' })}
          {field('lock-closed-outline', { placeholder: 'Password', value: password, onChangeText: setPassword, secureTextEntry: true })}
          {mode === 'signup' && field('lock-closed-outline', { placeholder: 'Confirm password', value: confirm, onChangeText: setConfirm, secureTextEntry: true })}

          <View style={{ height: 6 }} />
          <Btn title={busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create Account'} onPress={submit} disabled={busy} />
          {mode === 'login' && <Btn ghost title="Forgot password?" onPress={forgot} />}
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}