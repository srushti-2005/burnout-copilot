import { AppState, AppStateStatus } from 'react-native';
import { api } from './api';

// WHAT IS MEASURED (in-app only; a phone app cannot see other apps without native OS access):
//   typing_mean     = words/min while typing, from keystrokes recorded in this app's text inputs
//                     (5 characters = 1 word), capped at 80. 0 when there were no keystrokes.
//   typing_variance = standard deviation of words/min across 10 s buckets that contained typing,
//                     capped at 25. Needs >= 2 typing buckets, otherwise 0.
//   task_switching  = times the user left the app for >= MIN_AWAY_MS and came back.
//   work_duration   = hours the app was in the foreground in this window.
//
// USE_TOUCH_PROXY = false: no keystrokes means typing 0 (honest, matches "typing = keystrokes").
// USE_TOUCH_PROXY = true : with fewer than MIN_KEYSTROKES keystrokes, touch cadence is sent instead.
const USE_TOUCH_PROXY = false;

const MIN_KEYSTROKES = 8;
const MAX_EVENTS = 5000;
const BUCKET_MS = 10_000;
const MIN_AWAY_MS = 1_500;       // leaving the app for at least this long counts as a switch
const MIN_BG_FLUSH_MS = 30_000;  // on leaving the app, upload only if the window is at least this long
const FLUSH_STUCK_MS = 30_000;   // a flush older than this is treated as dead

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sampleVar = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
};

type Snapshot = {
  switches: number;
  keys: number[];
  touches: number[];
  activeMs: number;
  windowStart: number;
};

class MobileTracker {
  private switches = 0;
  private keys: number[] = [];
  private touches: number[] = [];
  private activeMs = 0;
  private activeSince: number | null = null;
  private windowStart = Date.now();
  private leftAt: number | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private seedTimer?: ReturnType<typeof setTimeout>;
  private sub?: { remove(): void };
  private running = false;
  private flushing = false;
  private flushStartedAt = 0;

  // Exposed for the debug badge.
  lastOkAt: string | null = null;
  lastError: string | null = null;
  lastPayload: Record<string, unknown> | null = null;

  startTracking(flushMs = 60_000) {
    if (this.running) return;
    this.running = true;
    this.leftAt = null;
    this.reset();
    this.sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      const now = Date.now();
      if (s === 'active') {
        if (this.activeSince === null) this.activeSince = now;
        if (this.leftAt !== null && now - this.leftAt >= MIN_AWAY_MS) this.switches += 1;
        this.leftAt = null;
      } else {
        if (this.activeSince !== null) {
          this.activeMs += now - this.activeSince;
          this.activeSince = null;
        }
        if (s === 'background' && this.leftAt === null) {
          this.leftAt = now;
          // Only upload on exit when the window is long enough to be meaningful;
          // otherwise keep accumulating so we never create tiny fragment rows.
          if (this.activeMs >= MIN_BG_FLUSH_MS) void this.flush(true);
        }
      }
    });
    this.timer = setInterval(() => { void this.flush(); }, flushMs);
    this.seedTimer = setTimeout(() => { void this.flush(true); }, 10_000);
  }

  stopTracking() {
    this.sub?.remove();
    if (this.timer) clearInterval(this.timer);
    if (this.seedTimer) clearTimeout(this.seedTimer);
    this.running = false;
  }

  status() {
    return {
      running: this.running,
      lastOkAt: this.lastOkAt,
      lastError: this.lastError,
      lastPayload: this.lastPayload,
    };
  }

  /** Any touch inside the app (wired in app/_layout.tsx). Only used when USE_TOUCH_PROXY is true. */
  recordTouch() {
    if (this.touches.length < MAX_EVENTS) this.touches.push(Date.now());
  }

  /** Call from onChangeText of every in-app TextInput. */
  recordKeystroke() {
    if (this.keys.length < MAX_EVENTS) this.keys.push(Date.now());
  }

  private reset() {
    this.switches = 0;
    this.keys = [];
    this.touches = [];
    this.activeMs = 0;
    this.windowStart = Date.now();
    this.activeSince = AppState.currentState === 'active' ? Date.now() : null;
    // leftAt is deliberately NOT cleared: a flush on exit must not forget that we left.
  }

  private minutes() {
    const live = this.activeSince !== null ? Date.now() - this.activeSince : 0;
    return (this.activeMs + live) / 60000;
  }

  private restore(s: Snapshot) {
    this.switches += s.switches;
    this.keys = [...s.keys, ...this.keys].slice(-MAX_EVENTS);
    this.touches = [...s.touches, ...this.touches].slice(-MAX_EVENTS);
    this.activeMs += s.activeMs;
    this.windowStart = Math.min(s.windowStart, this.windowStart);
  }

  private bucketCounts(ts: number[], now: number): number[] {
    const nb = Math.max(1, Math.ceil((now - this.windowStart) / BUCKET_MS));
    const counts = new Array(nb).fill(0);
    for (const t of ts) {
      const i = Math.min(nb - 1, Math.floor((t - this.windowStart) / BUCKET_MS));
      if (i >= 0) counts[i] += 1;
    }
    return counts;
  }

  private keyStats(now: number) {
    const counts = this.bucketCounts(this.keys, now).filter((c) => c > 0);
    if (!counts.length) return { mean: 0, variance: 0 };
    // c keystrokes in 10 s = 6c keys/min = 1.2c words/min
    const wpm = counts.map((c) => c * 1.2);
    return {
      mean: Math.min(80, avg(wpm)),
      variance: Math.min(25, Math.sqrt(sampleVar(wpm))),
    };
  }

  private touchStats(now: number, mins: number) {
    if (!this.touches.length) return { mean: 0, variance: 0 };
    const mean = Math.min(80, this.touches.length / Math.max(mins, 1 / 6));
    const counts = this.bucketCounts(this.touches, now);
    const variance = counts.length >= 3 ? Math.min(25, sampleVar(counts)) : 0;
    return { mean, variance };
  }

  async flush(force = false): Promise<{ ok: boolean; error?: string }> {
    const now = Date.now();
    if (this.flushing && now - this.flushStartedAt < FLUSH_STUCK_MS) {
      return { ok: false, error: 'flush already in progress' };
    }
    const mins = this.minutes();
    if (!force && mins < 0.05 && this.switches === 0 && this.keys.length === 0 && this.touches.length === 0) {
      return { ok: false, error: 'not enough activity yet' };
    }

    let typing_mean = 0;
    let typing_variance = 0;
    if (this.keys.length >= MIN_KEYSTROKES) {
      const s = this.keyStats(now);
      typing_mean = s.mean;
      typing_variance = s.variance;
    } else if (USE_TOUCH_PROXY) {
      const s = this.touchStats(now, mins);
      typing_mean = s.mean;
      typing_variance = s.variance;
    }

    const hour = new Date().getHours(); // phone's local time
    const payload = {
      typing_mean: Number(typing_mean.toFixed(3)),
      typing_variance: Number(typing_variance.toFixed(3)),
      task_switching: this.switches,
      work_duration: Number(Math.max(0.01, mins / 60).toFixed(3)),
      late_night: hour >= 23 || hour < 5 ? 1 : 0,
      timestamp_utc: new Date().toISOString(),
      device_source: 'mobile',
    };

    const snap: Snapshot = {
      switches: this.switches,
      keys: this.keys,
      touches: this.touches,
      activeMs: mins * 60000,
      windowStart: this.windowStart,
    };
    this.flushing = true;
    this.flushStartedAt = now;
    this.reset();
    try {
      await api('/sessions', { method: 'POST', body: JSON.stringify(payload) });
      this.lastOkAt = new Date().toISOString();
      this.lastError = null;
      this.lastPayload = payload;
      return { ok: true };
    } catch (e: any) {
      this.restore(snap);
      this.lastError = e?.message ?? 'upload failed';
      return { ok: false, error: this.lastError ?? undefined };
    } finally {
      this.flushing = false;
    }
  }
}

export const tracker = new MobileTracker();

export async function flushTracker(): Promise<{ ok: boolean; error?: string }> {
  return tracker.flush(true);
}