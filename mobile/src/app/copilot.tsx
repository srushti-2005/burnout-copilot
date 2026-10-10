import { Background } from '@/components/mindease/Background';
import { RobotAvatar } from '@/components/mindease/RobotAvatar';
import { fetchCopilotData } from '@/lib/copilotData';
import { buildPlan, dayName, exhaustionProfile, forecastDays, resetsFor } from '@/lib/copilotPlan';
import { accent, useMindEase } from '@/lib/mindease-theme';
import { runAction } from '@/lib/nav';
import { buildCtx, rankRecommendations } from '@/lib/recoCatalog';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Msg = { id: string; from: 'bot' | 'user'; text: string };
const uid = () => Math.random().toString(36).slice(2);

export default function Copilot() {
  const router = useRouter();
  const { c } = useMindEase();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [ctx, setCtx] = useState<any>(null);
  const scrollRef = useRef<ScrollView>(null);

  const scroll = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  const say = (text: string) => { setMsgs((m) => [...m, { id: uid(), from: 'bot', text }]); scroll(); };
  const userSay = (text: string) => { setMsgs((m) => [...m, { id: uid(), from: 'user', text }]); scroll(); };
  const close = () => (router.canGoBack() ? router.back() : router.replace('/' as Href));

  useEffect(() => {
    let mounted = true;
    (async () => {
      const cp = await fetchCopilotData();
      const prof = exhaustionProfile(cp.dashboard, cp.twin, cp.activity);
      if (!mounted) return;
      setCtx({ ...cp, prof });
      say(cp.twin
        ? `Hi. Your pattern today looks like: ${prof.label}. Ask me anything, or tap a suggestion below.`
        : `Hi. I'm still learning your pattern. Check back after a few sessions.`);
    })();
    return () => { mounted = false; };
  }, []);

  function reply(topic: string) {
    if (!ctx) return say('Still loading your data. One moment.');
    const { prof } = ctx;
    const age = ctx.twin?.profile.age ?? null;
    if (topic === 'status') return say(`Your pattern right now: ${prof.label}. ${prof.summary}`);
    if (topic === 'why') return say(prof.summary);
    if (topic === 'action') {
      const it = buildPlan(ctx.dashboard, ctx.twin, ctx.activity, ctx.intervention)[0];
      if (!it) return say("Nothing urgent. You're doing well.");
      say(`${it.title}. ${it.doThis}`);
      if (it.action) setTimeout(() => runAction(router, it.action!.act), 600);
      return;
    }
    if (topic === 'reset') {
      const top = rankRecommendations(buildCtx(ctx.dashboard, ctx.twin, prof.type))[0];
      if (!top) return say('Nothing to suggest yet.');
      return say(`Try: ${top.item.title}${top.item.minutes ? ` (${top.item.minutes} min)` : ''}. ${top.item.how}${top.reason ? ` Because: ${top.reason}.` : ''}`);
    }
    if (topic === 'forecast') {
      const fc = forecastDays(ctx.dashboard);
      if (!fc.length) return say('I need a few more sessions before I can forecast your week.');
      const peak = fc.reduce((a, b) => (b.pct > a.pct ? b : a));
      return say(`Your heaviest day looks like ${dayName(peak.date)} at about ${peak.pct}%.`);
    }
    if (topic === 'focus') {
      const top = resetsFor(prof.type, age)[0];
      say(top ? `Try: ${top.title} (${top.minutes} min). ${top.how} Opening Focus mode.` : 'Opening Focus mode.');
      return router.push('/focus' as Href);
    }
    if (topic === 'checkin') { say("Let's log it. Opening check-in."); return router.push('/checkin' as Href); }
    say("Ask me about your load, why you're flagged, or what to do next.");
  }

  function onSend() {
    const text = input.trim();
    if (!text) return;
    userSay(text);
    setInput('');
    const t = text.toLowerCase();
    if (/(risk|load|doing|status|how am i)/.test(t)) return reply('status');
    if (/(why|flag|cause|reason)/.test(t)) return reply('why');
    if (/(forecast|week|tomorrow)/.test(t)) return reply('forecast');
    if (/(reset|break idea|recommend)/.test(t)) return reply('reset');
    if (/(should i|action|do next|help|suggest)/.test(t)) return reply('action');
    if (/(focus|concentrat)/.test(t)) return reply('focus');
    if (/(feel|log|check.?in|mood)/.test(t)) return reply('checkin');
    if (/(tired|sleep|late|exhaust)/.test(t)) return say('Late nights and tiredness are a strong burnout signal. Tap "Why am I flagged?" to see your pattern.');
    if (/(stress|overwhelm)/.test(t)) return say('If you feel stressed, a short focus session or a real break both help. Want me to suggest one?');
    reply('fallback');
  }

  const QUICK = [
    { label: 'How am I doing?', t: 'status', icon: 'pulse-outline' },
    { label: 'Why am I flagged?', t: 'why', icon: 'help-circle-outline' },
    { label: 'What should I do?', t: 'action', icon: 'bulb-outline' },
    { label: 'Best reset for me', t: 'reset', icon: 'sparkles-outline' },
    { label: 'My week ahead', t: 'forecast', icon: 'calendar-outline' },
    { label: 'Start a focus session', t: 'focus', icon: 'timer-outline' },
    { label: "Log how I'm feeling", t: 'checkin', icon: 'create-outline' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg0 }}>
      <Background />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <RobotAvatar size={36} />
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>Co-pilot</Text>
          </View>
          <Pressable onPress={close} hitSlop={12}><Ionicons name="close" size={26} color={c.text} /></Pressable>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 16, gap: 10 }}>
          <ScrollView ref={scrollRef} contentContainerStyle={{ gap: 10, paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
            {msgs.map((m) => (
              <View key={m.id} style={{
                alignSelf: m.from === 'bot' ? 'flex-start' : 'flex-end',
                backgroundColor: m.from === 'bot' ? c.card : accent.purple,
                borderWidth: m.from === 'bot' ? 1 : 0, borderColor: c.border,
                borderRadius: 18, padding: 12, maxWidth: '85%',
              }}>
                <Text style={{ color: m.from === 'bot' ? c.text : '#fff', lineHeight: 20 }}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
            {QUICK.map((q) => (
              <Pressable key={q.label} onPress={() => { userSay(q.label); reply(q.t); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                <Ionicons name={q.icon as any} size={15} color={accent.purple} />
                <Text style={{ color: c.text, fontSize: 13 }}>{q.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={input} onChangeText={setInput} onSubmitEditing={onSend}
                placeholder="Ask me anything…" placeholderTextColor={c.muted}
                style={{ flex: 1, backgroundColor: c.card, borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 16, paddingVertical: 10, color: c.text }}
              />
              <Pressable onPress={onSend} style={{ backgroundColor: accent.purple, borderRadius: 999, width: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="send" size={18} color="#fff" />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </View>
  );
}