/** Separate recoverable observations: an error here never resubmits an answer. */
const prefix = "ec.duration.";
const memory = new Map();
const busy = new Set();
const notify = () => window.dispatchEvent(new Event("durations-changed"));

export function pendingDurations() {
  const rows = new Map(memory);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const row = JSON.parse(localStorage.getItem(key));
        if (row?.sample_id) rows.set(row.sample_id, row);
      }
    }
  } catch {}
  return [...rows.values()];
}

export async function saveDuration(payload) {
  const id = payload.sample_id;
  if (busy.has(id)) return;
  busy.add(id); memory.set(id, payload);
  try { localStorage.setItem(prefix + id, JSON.stringify(payload)); } catch {}
  notify();
  try {
    const response = await fetch("/api/learning/durations", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || result.committed !== true) throw new Error("时长尚未确认");
    memory.delete(id);
    try { localStorage.removeItem(prefix + id); } catch {}
  } catch {
    // Keep the exact sample; the global recovery UI offers explicit confirmation.
  } finally { busy.delete(id); notify(); }
}

export function discardDuration(id) {
  memory.delete(id);
  try { localStorage.removeItem(prefix + id); } catch {}
  notify();
}
