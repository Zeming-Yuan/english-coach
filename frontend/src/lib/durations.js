import { accountStorage, accountFetch } from "./accountSession.js";
/** Separate recoverable observations: an error here never resubmits an answer. */
const prefix = "ec.duration.";
const memory = new Map();
const busy = new Map();
const notify = () => {
  try { window.dispatchEvent(new Event("durations-changed")); } catch {}
};

export function pendingDurations() {
  const rows = new Map(memory);
  try {
    for (let i = 0; i < accountStorage.length; i++) {
      const key = accountStorage.key(i);
      if (key?.startsWith(prefix)) {
        try {
          const row = JSON.parse(accountStorage.getItem(key));
          if (row?.sample_id) rows.set(row.sample_id, row);
        } catch { /* One damaged sample must not hide the remaining observations. */ }
      }
    }
  } catch {}
  return [...rows.values()];
}

export async function saveDuration(payload) {
  const id = payload.sample_id;
  if (busy.has(id)) return;
  const controller = new AbortController();
  busy.set(id, controller); memory.set(id, payload);
  try { accountStorage.setItem(prefix + id, JSON.stringify(payload)); } catch {}
  notify();
  try {
    const response = await accountFetch("/api/learning/durations", {
      signal: controller.signal,
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || result.committed !== true) throw new Error("时长尚未确认");
    if (busy.get(id) !== controller) return;
    memory.delete(id);
    try { accountStorage.removeItem(prefix + id); } catch {}
  } catch {
    // Keep the exact sample; the global recovery UI offers explicit confirmation.
  } finally {
    if (busy.get(id) === controller) busy.delete(id);
    notify();
  }
}

export function discardDuration(id) {
  busy.get(id)?.abort();
  busy.delete(id);
  memory.delete(id);
  try { accountStorage.removeItem(prefix + id); } catch {}
  notify();
}
