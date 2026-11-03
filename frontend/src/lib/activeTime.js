/** Monotonic, visible interaction intervals; a gap over 30s contributes zero. */
export function activeTimer({now = () => performance.now(), visible = () => document.visibilityState === "visible"} = {}) {
  let last = now(), total = 0, running = true, wasVisible = visible();
  function tick() {
    const time = now();
    const isVisible = visible();
    const elapsed = time - last;
    if (running && wasVisible && isVisible && elapsed >= 0 && elapsed <= 30000) total += elapsed;
    last = time; wasVisible = isVisible;
  }
  function visibility() {
    // Count the visible interval ending at hide, never the hidden interval at show.
    const time = now(), elapsed = time - last;
    if (running && wasVisible && elapsed >= 0 && elapsed <= 30000) total += elapsed;
    last = time; wasVisible = visible();
  }
  return {
    tick, visibility,
    stop() { tick(); running = false; return Math.round(total); },
  };
}
