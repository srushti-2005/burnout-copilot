// ui/src/components/dashboard/CopilotWidget.tsx  (FULL REPLACEMENT)
// Floating co-pilot. Rule-based on the user's REAL data (not an LLM). Every message gets a useful answer.
// The panel and star render through a portal on <body> and use plain CSS (.me-chat*) so their layout
// can never be affected by a parent card.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send, X } from "lucide-react";

import type { DashboardPayload, TwinPayload } from "@/lib/dashboard.types";
import {
  ACTIVITY_LABELS, FEATURE_LABELS, activityMix, ageBand, buildPlan, exhaustionProfile, forecastDays,
  rankedDeviations, resetsFor, runPlanAction, type PlanAction, type ResetIdea, type ViewId,
} from "@/lib/copilotPlan";
import { useCopilotData } from "@/lib/useCopilotData";
import { CopilotStar } from "@/components/mindease/CopilotStar";

interface Props {
  token: string;
  dashboard: DashboardPayload;
  twin: TwinPayload | null;
  onStartFocus: (minutes: number) => void;
  onNavigate: (view: ViewId) => void;
}

type Act = { label: string; act: PlanAction };
interface Msg { role: "bot" | "user"; text: string; actions?: Act[] }

const QUICK = ["How am I doing?", "What should I do now?", "I'm tired, what can I do?", "What should I avoid?", "Why is my load like this?", "My forecast"];

const friendly = (c: string) =>
  ({ high: "Elevated", medium: "Moderate", low: "Balanced" } as Record<string, string>)[c.toLowerCase()] ?? (c || "—");

const RESET_ACT: Act = { label: "Open reset menu", act: { kind: "view", view: "recommendations" } };
const TWIN_ACT: Act = { label: "Open Digital Twin", act: { kind: "view", view: "digital-twin" } };
const FORECAST_ACT: Act = { label: "See forecast", act: { kind: "view", view: "analytics" } };

// Each intent = keyword pattern. Highest number of matches wins; ties go to the earlier entry.
const INTENTS: [string, RegExp][] = [
  ["crisis", /suicid|kill myself|end my life|self.?harm|hurt myself|want to die|no reason to live/g],
  ["greet", /\b(hi|hello|hey|hii|namaste)\b|good (morning|afternoon|evening)/g],
  ["thanks", /thank|thx|appreciate/g],
  ["about", /who are you|what can you do|what do you do|how do you work|your features|what is this/g],
  ["focus", /focus|distract|concentrat|deep work|pomodoro|productiv|procrastinat/g],
  ["avoid", /avoid|don'?t|do not|stop doing|shouldn'?t|bad for/g],
  ["forecast", /forecast|predict|tomorrow|future|coming|ahead|outlook|next week|upcoming|heavy day/g],
  ["why", /\bwhy\b|cause|reason|driver|baseline|normal|deviat|explain|fingerprint|kind of|type of/g],
  ["week", /week|activity|hobby|check-?in|engag|balance|time spent/g],
  ["twin", /twin|profile|my age|\bage\b/g],
  ["plan", /what should|what to do|what can i|do now|next|plan|steps|tips|advice|suggest|recommend|help|lower|reduce|manage|improve|prevent|fix|better|action|guide|handle|cope|overcome/g],
  ["reset", /break|rest|nap|sleep|puzzle|brainstorm|game|play|relax|refresh|reset|bored|walk|stretch|breath|music|calm|idea|recharge|unwind|fun|eyes|water|meditat|sleepy|tired|exhaust|drain|fatigue|burn|overwhelm|stress|anxi|frustrat|low energy|mentally/g],
  ["status", /how am i|status|score|risk|\bload\b|\bcli\b|doing|feeling|level|today|summary|update|going/g],
];

const EMOTIONAL = /stress|overwhelm|anxi|tired|exhaust|drain|fatigue|burn|frustrat|sleepy|low energy/;

export function CopilotWidget({ token, dashboard, twin, onStartFocus, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { activity, intervention } = useCopilotData(token);

  const act = activity.data ?? null;
  const plan = buildPlan(dashboard, twin, act, intervention.data ?? null);
  const age = twin?.profile.age ?? null;
  const band = ageBand(age);
  const prof = exhaustionProfile(dashboard, twin, act);
  const ideas = resetsFor(prof.type, age, 3);
  const pct = Math.round(Math.max(0, Math.min(dashboard.cli, 1)) * 100);

  const planActions = (n: number): Act[] => plan.filter((p) => p.action && p.id !== "reset").slice(0, n).map((p) => p.action!);
  const ideaLine = (i: ResetIdea) => `• ${i.title} (${i.minutes} min): ${i.how}`;
  const planLines = (n: number) => plan.filter((p) => p.tone !== "good").slice(0, n).map((p, i) => `${i + 1}. ${p.title}: ${p.doThis}`);

  const status = () =>
    `Your load is ${pct}% (${friendly(dashboard.cli_category)}). Your exhaustion type right now: ${prof.label.toLowerCase()}. ${prof.summary}`;

  const personalised = (lead: string): Msg => {
    const lines = planLines(2);
    return {
      role: "bot",
      text: `${lead}${lines.length ? `Here's what matters most for you right now:\n${lines.join("\n")}\n\n` : ""}Reset ideas that suit you (${band.label.toLowerCase()}):\n${ideas.slice(0, 2).map(ideaLine).join("\n")}`,
      actions: [...planActions(1), RESET_ACT],
    };
  };

  const answer = (q: string): Msg => {
    const s = q.toLowerCase();
    const scored = INTENTS.map(([name, re], idx) => ({ name, idx, n: (s.match(re) ?? []).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.idx - b.idx);
    const intent = scored[0]?.name ?? "default";
    const lead = EMOTIONAL.test(s) ? "That sounds heavy, and it's a signal worth listening to. " : "";

    switch (intent) {
      case "crisis":
        return { role: "bot", text: "I'm really sorry you're feeling this way. I'm not able to help with this, but you deserve support right now. Please talk to someone you trust, or contact a local crisis line (findahelpline.com lists free helplines by country). If you might act on these thoughts, call your local emergency number now." };
      case "greet":
        return { role: "bot", text: `Hello! ${status()}`, actions: planActions(1) };
      case "thanks":
        return { role: "bot", text: "Happy to help. Ask me anytime you feel your energy dipping." };
      case "about":
        return { role: "bot", text: "I'm your wellbeing co-pilot. I use your own tracked data to tell you how you're doing, what to avoid, what to do next, which kind of break suits you, and what your week looks like. I'm not a medical tool." };
      case "focus": {
        const f = plan.find((p) => p.action?.act.kind === "focus")?.action?.act;
        const a: PlanAction = f ?? { kind: "focus", minutes: band.focusMin };
        return { role: "bot", text: `A focus session gives you one timed stretch for one task, then compares your load before and after. For you I suggest ${a.kind === "focus" ? a.minutes : band.focusMin} minutes.`, actions: [{ label: a.kind === "focus" ? `Start ${a.minutes}-min focus` : "Start focus", act: a }] };
      }
      case "avoid": {
        const lines = plan.filter((p) => p.avoid).slice(0, 3).map((p) => `• ${p.avoid}`);
        return lines.length
          ? { role: "bot", text: `Right now I'd avoid:\n${lines.join("\n")}`, actions: planActions(2) }
          : { role: "bot", text: "Nothing specific to avoid right now. Your signals are close to your normal. Just keep taking short breaks." };
      }
      case "forecast": {
        const days = forecastDays(dashboard);
        if (!days.length) return { role: "bot", text: "I need a few more sessions before I can forecast your week." };
        const heavy = days.reduce((a, b) => (b.pct > a.pct ? b : a));
        const light = days.reduce((a, b) => (b.pct < a.pct ? b : a));
        return { role: "bot", text: `Your heaviest day looks like ${heavy.day} (${heavy.pct}%), and your lightest is ${light.day} (${light.pct}%). Put demanding work on the lighter day and protect the heavy one with a real break.`, actions: [FORECAST_ACT] };
      }
      case "why": {
        if (!twin?.baseline.is_established)
          return { role: "bot", text: `I'm still learning your normal (${twin?.baseline.session_count ?? 0}/5 sessions). Once it's set, I can show what's driving your load.`, actions: [TWIN_ACT] };
        const top = rankedDeviations(twin).filter(([, d]) => d.status !== "normal").slice(0, 2)
          .map(([f, d]) => `${FEATURE_LABELS[f]} is ${d.status === "above_normal" ? "above" : "below"} your usual${d.difference_pct !== null && Math.abs(d.difference_pct) <= 200 ? ` (${d.difference_pct > 0 ? "+" : ""}${d.difference_pct}%)` : ""}`);
        return { role: "bot", text: `${status()}${top.length ? `\n\nWhat's driving it: ${top.join(". ")}.` : ""}\n\nI compare you with your own normal, not with other people.`, actions: [TWIN_ACT] };
      }
      case "week": {
        const mix = activityMix(act);
        return mix.length
          ? { role: "bot", text: `This week you logged: ${mix.map((m) => `${ACTIVITY_LABELS[m.type]} ${m.pct}%`).join(", ")}. Time you enjoy counts less toward burnout than draining work.`, actions: [{ label: "See fair-load view", act: { kind: "view", view: "ai-insights" } }] }
          : { role: "bot", text: "No check-ins yet. Answer the next popup and I'll show how your time splits between draining and enjoyable activity." };
      }
      case "twin":
        return { role: "bot", text: `Your digital twin is a live model of you. ${band.note}`, actions: [TWIN_ACT] };
      case "reset":
        return { role: "bot", text: `${lead}Based on your type (${prof.label.toLowerCase()}) and ${band.label.toLowerCase()}, I'd try one of these:\n${ideas.map(ideaLine).join("\n")}`, actions: [RESET_ACT] };
      case "plan":
        return personalised(lead);
      case "status":
        return { role: "bot", text: `${status()} This is a wellbeing estimate, not a medical assessment.`, actions: planActions(1) };
      default:
        return personalised("I'm not sure I understood that exactly, but I can still help. ");
    }
  };

  const send = (q: string) => {
    const text = q.trim();
    if (!text) return;
    let reply: Msg;
    try {
      reply = answer(text);
    } catch {
      reply = { role: "bot", text: "Something went wrong reading your data, but try the buttons below and I'll do my best." };
    }
    setMsgs((p) => [...p, { role: "user", text }, reply]);
    setInput("");
  };

  // Portal target only exists in the browser.
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open && msgs.length === 0) {
      const name = dashboard.user.display_name;
      setMsgs([{ role: "bot", text: `Hi${name ? `, ${name}` : ""}! ${status()}\n\nAsk me anything, or tap a suggestion below.`, actions: planActions(1) }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);

  const run = (a: PlanAction) => {
    setOpen(false);
    runPlanAction(a, { onStartFocus, onNavigate });
  };

  const needsAttention = plan[0]?.tone === "alert";

  if (!mounted) return null;

  return createPortal(
    <>
      {open && (
        <div role="dialog" aria-label="MindEase Co-pilot" className="me-chat me-modal-in">
          <div className="me-chat__head">
            <div>
              <p className="me-chat__title">MindEase Co-pilot</p>
              <p className="me-chat__sub">Wellbeing guide, not a medical tool</p>
            </div>
            <button type="button" aria-label="Close co-pilot" className="me-chat__close" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </button>
          </div>

          <div className="me-chat__msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`me-chat__msg me-chat__msg--${m.role}`}>
                <div className="me-chat__bubble">{m.text}</div>
                {m.actions && m.actions.length > 0 && (
                  <div className="me-chat__acts">
                    {m.actions.map((a) => (
                      <button key={a.label} type="button" className="me-chip" onClick={() => run(a.act)}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="me-chat__quick">
            {QUICK.map((q) => (
              <button key={q} type="button" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>

          <div className="me-chat__input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
              placeholder="Ask your co-pilot anything…"
              aria-label="Message your co-pilot"
            />
            <button type="button" aria-label="Send" className="me-chat__send" onClick={() => send(input)}>
              <Send className="size-4" />
            </button>
          </div>
        </div>
      )}

      <CopilotStar open={open} attention={needsAttention} onClick={() => setOpen((o) => !o)} />
    </>,
    document.body,
  );
}