import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

export type Mode = 'dark' | 'light';

export const palettes = {
  dark: {
    bg0: '#0B0914', bg1: '#151226',
    text: '#F8F9FA', muted: '#B8B2CB',
    card: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)',
    glowGreen: 0.25, glowRed: 0.25,
    tabBar: 'rgba(21,18,38,0.85)',
  },
  light: {
    bg0: '#F7F6FB', bg1: '#ECE9F7',
    text: '#1E1B2E', muted: '#6B6584',
    card: 'rgba(255,255,255,0.7)', border: 'rgba(30,27,46,0.08)',
    glowGreen: 0.5, glowRed: 0.5,
    tabBar: 'rgba(255,255,255,0.9)',
  },
};

export const accent = {
  purple: '#8b83f0', deepPurple: '#5b54c9', lavender: '#d9d5fb',
  teal: '#3ecfb2', coral: '#ff7a7a', pink: '#f08bc4', yellow: '#f5c451',
  low: '#4ade80',
};

export const radius = { card: 24, pill: 999, sm: 12 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const motion = { duration: 400, bezier: [0.16, 1, 0.3, 1] as const };

type Ctx = { mode: Mode; c: typeof palettes.dark; setMode: (m: Mode) => void; toggle: () => void };
const ThemeCtx = createContext<Ctx | null>(null);
const KEY = 'mindease.theme';

export function MindEaseThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>(system === 'light' ? 'light' : 'dark');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'dark' || v === 'light') setModeState(v);
    });
  }, []);

  const setMode = (m: Mode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  };

  const value = useMemo(
    () => ({ mode, c: palettes[mode], setMode, toggle: () => setMode(mode === 'dark' ? 'light' : 'dark') }),
    [mode]
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useMindEase() {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error('Wrap the app in <MindEaseThemeProvider>');
  return v;
}

export const riskColor = (cat?: string) =>
  cat === 'High' ? accent.coral : cat === 'Medium' ? accent.yellow : accent.low;
export const riskLabel = (cat?: string) =>
  cat === 'High' ? 'Elevated' : cat === 'Medium' ? 'Moderate' : 'Balanced';

// Display rule from the web app: never show absurd percentages
export function formatDelta(pct?: number | null) {
  if (pct == null) return '—';
  if (Math.abs(pct) > 200) return pct > 0 ? 'Far above usual' : 'Far below usual';
  return `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;
}
export function formatTrend(pct?: number | null) {
  if (pct == null) return '—';
  return Math.abs(pct) > 200 ? 'Large swing' : `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;
}