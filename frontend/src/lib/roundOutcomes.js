import {storageGet} from "./utils.js";

// Workload observations only; never a second source of learning progress.
const key = "ec.round-outcomes.v1";
const changed = "round-outcomes-changed";

function stored() {
  const value = storageGet(key, null);
  if (!value || typeof value.generation !== "string" || !Array.isArray(value.rounds)) {
    return {generation: "initial", rounds: []};
  }
  const unique = new Map();
  for (const round of value.rounds) {
    if (round && typeof round.id === "string" && Number.isFinite(round.startedAt) &&
        typeof round.interrupted === "boolean" && typeof round.completed === "boolean") unique.set(round.id, round);
  }
  return {generation: value.generation, rounds: [...unique.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-30)};
}

function persist(value) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(changed));
}

async function exclusive(action) {
  try {
    if (navigator.locks?.request) return await navigator.locks.request(key, action);
    return action();
  } catch {
    // Unavailable storage must never block a saved answer or invent observations.
    return false;
  }
}

export function recordRoundOutcome(session, outcome) {
  if (!session?.id || !Number.isFinite(session.startedAt) || session.target <= 0 ||
      !["interrupted", "completed", "ended"].includes(outcome) ||
      (outcome !== "interrupted" && !session.complete) ||
      (outcome === "interrupted" && session.complete)) return Promise.resolve(false);
  const generation = stored().generation;
  return exclusive(() => {
    const current = stored();
    if (current.generation !== generation) return false;
    const prior = current.rounds.find(round => round.id === session.id);
    // A stale tab cannot turn an already observed completion into an interruption.
    if (outcome === "interrupted" && prior?.completed) return true;
    const round = {
      id: session.id, startedAt: session.startedAt,
      interrupted: prior?.interrupted === true || outcome === "interrupted",
      completed: prior?.completed === true || outcome === "completed",
    };
    const rounds = [...current.rounds.filter(value => value.id !== session.id), round]
      .sort((a, b) => a.startedAt - b.startedAt).slice(-30);
    persist({generation, rounds});
    return true;
  });
}

export function resetRoundOutcomes() {
  return exclusive(() => {
    persist({generation: crypto.randomUUID(), rounds: []});
    return true;
  });
}

export function roundBudgetCap() {
  const rounds = stored().rounds;
  let cap = 15;
  let streak = 0;
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index];
    if (round.interrupted) {
      streak = 0;
      if (rounds.slice(Math.max(0, index - 2), index).some(value => value.interrupted)) cap = 3;
    } else if (round.completed && cap < 15) {
      streak += 1;
      if (streak === 3) {
        cap = cap === 3 ? 8 : 15;
        streak = 0;
      }
    } else {
      streak = 0;
    }
  }
  return cap;
}

export function subscribeRoundAdvice(listener) {
  const update = () => listener(roundBudgetCap());
  const external = event => { if (event.key === key || event.key === null) update(); };
  window.addEventListener(changed, update);
  window.addEventListener("storage", external);
  return () => {
    window.removeEventListener(changed, update);
    window.removeEventListener("storage", external);
  };
}
