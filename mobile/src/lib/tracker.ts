import { AppState, AppStateStatus } from 'react-native';
import { api } from './api';

// Confirmed from data/raw/burnout_dataset.csv:
// typing_mean 40-80, typing_variance 5-25, work_duration in HOURS (4-12).
const TYPING_MEAN_DEFAULT = 60;
const TYPING_VAR_DEFAULT = 15;
const MIN_KEYSTROKE_SAMPLES = 5;

class MobileTracker {
  private switches = 0;
  private intervals: number[] = [];
  private lastKey = 0;
  private activeMs = 0;
  private activeSince: number | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private seedTimer?: ReturnType<typeof setTimeout>;
  private sub?: { remove(): void };
  private running = false;

  startTracking(flushMs = 5 * 60_000) {
    if (this.running) return;
    this.running = true;
    this.reset();
    this.activeSince = Date.now();
    this.sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        if (this.activeSince === null) this.activeSince = Date.now();
      } else {
        if (this.activeSince !== null) this.activeMs += Date.now() - this.activeSince;
        this.activeSince = null;
        if (s === 'background') this.switches += 1;
      }
    });
    this.timer = setInterval(() => { this.flush(); }, flushMs);
    this.seedTimer = setTimeout(() => { this.flush(true); }, 15_000);
  }

  stopTracking() {
    this.sub?.remove();
    if (this.timer) clearInterval(this.timer);
    if (this.seedTimer) clearTimeout(this.seedTimer);
    this.running = false;
  }

  recordKeystroke() {
    const now = Date.now();
    if (this.lastKey && now - this.lastKey < 5000) this.intervals.push(now - this.lastKey);
    this.lastKey = now;
  }

  private reset() {
    this.switches = 0; this.intervals = []; this.lastKey = 0; this.activeMs = 0;
    this.activeSince = AppState.currentState === 'active' ? Date.now() : null;
  }

  private minutes() {
    const live = this.activeSince !== null ? Date.now() - this.activeSince : 0;
    return (this.activeMs + live) / 60000;
  }

  async flush(force = false): Promise<{ ok: boolean; error?: string }> {
    const mins = this.minutes();
    if (!force && mins < 0.5) return { ok: false, error: 'not enough activity yet' };

    const n = this.intervals.length;
    let typing_mean = TYPING_MEAN_DEFAULT;
    let typing_variance = TYPING_VAR_DEFAULT;
    if (n >= MIN_KEYSTROKE_SAMPLES) {
      const avgMs = this.intervals.reduce((a, b) => a + b, 0) / n;
      // heuristic mapping of keystroke cadence onto the dataset's 40-80 scale
      typing_mean = Math.max(40, Math.min(80, 12000 / avgMs));
      const varMs = this.intervals.reduce((a, b) => a + (b - avgMs) ** 2, 0) / n;
      typing_variance = Math.max(5, Math.min(25, varMs / 50));
    }

    const hour = new Date().getHours();
    const payload = {
      typing_mean,
      typing_variance,
      task_switching: this.switches,
      work_duration: Number((mins / 60).toFixed(3)), // minutes → HOURS to match dataset
      late_night: hour >= 23 || hour < 5 ? 1 : 0,
      timestamp_utc: new Date().toISOString(),
      device_source: 'mobile',
    };
    try {
      await api('/sessions', { method: 'POST', body: JSON.stringify(payload) });
      this.reset();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }
}

export const tracker = new MobileTracker();