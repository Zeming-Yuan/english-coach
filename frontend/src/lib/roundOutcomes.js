import {storageGet} from "./utils.js";

// Workload observations only; never a second source of learning progress.
const key = "ec.round-outcomes.v1";
const changed = "round-outcomes-changed";
const emptyCheckpoint = () => ({cap: 15, streak: 0, lastInterruptions: [], through: null});

function checkpointFrom(value) {
  if (value && [3, 8, 15].includes(value.cap) && Number.isInteger(value.streak) && value.streak >= 0 && value.streak < 3 &&
      Array.isArray(value.lastInterruptions) && value.lastInterruptions.length <= 2 && value.lastInterruptions.every(flag => typeof flag === "boolean") &&
      (value.through === null || Number.isFinite(value.through))) return value;
  return emptyCheckpoint();
}

function advanceAdvice(state, round) {
  let {cap, streak} = state;
  if (round.interrupted) {
    streak = 0;
    if (state.lastInterruptions.some(Boolean)) cap = 3;
  } else if (round.completed && cap < 15) {
    streak += 1;
    if (streak === 3) {
      cap = cap === 3 ? 8 : 15;
      streak = 0;
    }
  } else streak = 0;
  return {...state, cap, streak, lastInterruptions: [...state.lastInterruptions, round.interrupted].slice(-2)};
}

function retainRecent(generation, checkpoint, rounds) {
  const dropped = Math.max(0, rounds.length - 30);
  for (const round of rounds.slice(0, dropped)) {
    checkpoint = {...advanceAdvice(checkpoint, round), through: round.startedAt};
  }
  return {generation, checkpoint, rounds: rounds.slice(dropped)};
}

function stored() {
  const value = storageGet(key, null);
  if (!value || typeof value.generation !== "string" || !Array.isArray(value.rounds)) {
    return {generation: "initial", checkpoint: emptyCheckpoint(), rounds: []};
  }
  const unique = new Map();
  for (const round of value.rounds) {
    if (round && typeof round.id === "string" && Number.isFinite(round.startedAt) &&
        typeof round.interrupted === "boolean" && typeof round.completed === "boolean") {
      unique.set(round.id, {id: round.id, startedAt: round.startedAt, interrupted: round.interrupted, completed: round.completed});
    }
  }
  return retainRecent(value.generation, checkpointFrom(value.checkpoint), [...unique.values()].sort((a, b) => a.startedAt - b.startedAt));
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

export function roundObservationGeneration() {
  return stored().generation;
}

export function recordRoundOutcome(session, outcome) {
  if (!session?.id || !Number.isFinite(session.startedAt) || session.target <= 0 ||
      !["interrupted", "completed", "ended"].includes(outcome) ||
      (outcome !== "interrupted" && !session.complete) ||
      (outcome === "interrupted" && session.complete)) return Promise.resolve(false);
  const generation = session.observationGeneration;
  if (typeof generation !== "string") return Promise.resolve(false);
  return exclusive(() => {
    const current = stored();
    if (current.generation !== generation) return false;
    const prior = current.rounds.find(round => round.id === session.id);
    // Retired rounds cannot be folded into the checkpoint a second time.
    if (!prior && current.checkpoint.through !== null && session.startedAt <= current.checkpoint.through) return false;
    // A stale tab cannot turn an already observed completion into an interruption.
    if (outcome === "interrupted" && prior?.completed) return true;
    const round = {
      id: session.id, startedAt: prior?.startedAt ?? session.startedAt,
      interrupted: prior?.interrupted === true || outcome === "interrupted",
      completed: prior?.completed === true || outcome === "completed",
    };
    const rounds = [...current.rounds.filter(value => value.id !== session.id), round].sort((a, b) => a.startedAt - b.startedAt);
    persist(retainRecent(generation, current.checkpoint, rounds));
    return true;
  });
}

export function resetRoundOutcomes() {
  return exclusive(() => {
    persist({generation: crypto.randomUUID(), checkpoint: emptyCheckpoint(), rounds: []});
    return true;
  });
}

export function roundBudgetCap() {
  const current = stored();
  return current.rounds.reduce(advanceAdvice, current.checkpoint).cap;
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
