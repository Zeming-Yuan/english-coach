import {useCallback, useEffect, useRef} from "react";
import {activeTimer} from "../lib/activeTime.js";

/** A sample is frozen into the existing pending answer before its first request. */
export function useActiveTime(identity, kind, enabled = true) {
  const timer = useRef(null);
  useEffect(() => {
    if (!identity || !enabled) { timer.current = null; return; }
    // A remounted unanswered item has an unknown earlier portion. Keep a marker
    // for this browser tab so pause/refresh never turns a partial sample reliable.
    const key = `ec.active-time.${identity}`;
    try {
      if (sessionStorage.getItem(key)) { timer.current = null; return; }
      sessionStorage.setItem(key, "started");
    } catch { timer.current = null; return; }
    const current = activeTimer();
    timer.current = current;
    const events = ["pointerdown", "keydown", "input"];
    for (const event of events) document.addEventListener(event, current.tick, true);
    document.addEventListener("visibilitychange", current.visibility);
    return () => {
      for (const event of events) document.removeEventListener(event, current.tick, true);
      document.removeEventListener("visibilitychange", current.visibility);
      if (timer.current === current) timer.current = null;
    };
  }, [identity, enabled]);
  return useCallback(target => {
    if (target.duration || !timer.current || !enabled) return target;
    return {...target, duration: {
      sample_id: crypto.randomUUID(), submission_id: target.payload.submission_id,
      kind, active_ms: timer.current.stop(),
    }};
  }, [kind, enabled]);
}
