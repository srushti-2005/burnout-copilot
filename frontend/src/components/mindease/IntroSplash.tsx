import { useEffect, useState, type CSSProperties } from "react";

import { StarField } from "./StarField";

export const SPLASH_KEY = "me_splash";
type Phase = "show" | "out" | "off";

/**
 * Cosmic intro that plays once right after login: the MindEase name appears letter by letter,
 * glitches once, then the screen fades into the dashboard. Click or press any key to skip.
 * login.tsx sets sessionStorage "me_splash" before navigating to "/".
 */
export function IntroSplash() {
  const [phase, setPhase] = useState<Phase>(() => {
    try {
      return sessionStorage.getItem(SPLASH_KEY) ? "show" : "off";
    } catch {
      return "off";
    }
  });

  // Consume the flag so a refresh does not replay the intro.
  useEffect(() => {
    try {
      sessionStorage.removeItem(SPLASH_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (phase === "show") {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      const skip = () => setPhase("out");
      const timer = window.setTimeout(skip, reduce ? 1000 : 3000);
      window.addEventListener("keydown", skip);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", skip);
      };
    }
    if (phase === "out") {
      const timer = window.setTimeout(() => setPhase("off"), 750);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  if (phase === "off") return null;

  return (
    <div
      role="status"
      aria-label="MindEase"
      className={`me-splash${phase === "out" ? " me-splash--out" : ""}`}
      onClick={() => setPhase("out")}
    >
      <StarField className="me-splash__stars" />
      <div className="me-splash__halo" aria-hidden="true" />
      <div className="me-splash__center">
        <div className="me-splash__word" aria-hidden="true">
          {"MindEase".split("").map((ch, i) => (
            <span key={i} className="me-splash__letter" style={{ "--i": i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </div>
        <p className="me-splash__tag">Your calm co-pilot</p>
      </div>
      <p className="me-splash__skip">Tap to skip</p>
    </div>
  );
}