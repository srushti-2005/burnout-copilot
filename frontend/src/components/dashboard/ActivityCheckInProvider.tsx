import { useEffect, useRef, useState } from "react";
import { ActivityCheckIn } from "./ActivityCheckIn";
import type { ActivityCheckInResult } from "@/lib/dashboard.types";

// TESTING: fires ~30-60s after mount. Set back to 40 before you submit.
const CHECKIN_INTERVAL_MIN = 5;
const POLL_MS = 15_000; // check every 15s so a 1-min interval isn't stuck waiting a full 60s tick

interface Props {
  /** Same token value you already pass into <FocusProtection token={...} />. */
  token: string;
  onSessionExpired?: () => void;
  /** Pass true while any other full-screen modal (e.g. the break alert)
   *  is open. The timer keeps running underneath -- elapsed time isn't
   *  lost -- but the popup won't actually show until this goes false,
   *  and will close itself immediately if it turns true mid check-in. */
  paused?: boolean;
}

/**
 * Drop this ONE component once, near the top of your authenticated app
 * shell. It owns its own timer and its own visibility state, so it
 * doesn't depend on any other component remembering to render it.
 */
export function ActivityCheckInProvider({ token, onSessionExpired, paused = false }: Props) {
  const [visible, setVisible] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const segmentStartRef = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      if (paused) return; // don't pop up over another modal
      const minutes = (Date.now() - segmentStartRef.current) / 60000;
      if (minutes >= CHECKIN_INTERVAL_MIN) {
        setElapsedMinutes(minutes);
        setVisible(true);
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  // If another modal opens while this one is already showing, close this
  // one immediately rather than letting them overlap.
  useEffect(() => {
    if (paused) setVisible(false);
  }, [paused]);

  const handleSubmitted = (_result: ActivityCheckInResult) => {
    segmentStartRef.current = Date.now();
  };

  return (
    <ActivityCheckIn
      token={token}
      visible={visible && !paused}
      elapsedMinutes={elapsedMinutes}
      onClose={() => setVisible(false)}
      onSubmitted={handleSubmitted}
      onSessionExpired={onSessionExpired ?? (() => {})}
    />
  );
}