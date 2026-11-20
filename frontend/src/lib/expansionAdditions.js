import {accountStorage} from "./accountSession.js";
import {api} from "./api.js";
import {randomUUID, storageGet} from "./utils.js";

const PREFIX = "ec.expansion-addition.";
const PENDING_CHANGED = "ec:expansion-additions-changed";
const memory = new Map();
const inFlight = new Map();
const selectionPrefix = id => `expansion-selections:${id}:`;

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PENDING_CHANGED));
}

export function watchExpansionAdditions(refresh) {
  window.addEventListener(PENDING_CHANGED, refresh);
  window.addEventListener("storage", refresh);
  return () => {
    window.removeEventListener(PENDING_CHANGED, refresh);
    window.removeEventListener("storage", refresh);
  };
}

export function loadAdditionPending() {
  const records = new Map(memory);
  try {
    for (let index = 0; index < accountStorage.length; index += 1) {
      const key = accountStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const row = storageGet(key, null);
      if (row?.command?.operation_id && row.source_id) records.set(row.command.operation_id, row);
    }
  } catch {}
  return [...records.values()];
}

const canonicalWord = word => word.trim().toLowerCase();

export function createAdditionPending(sourceCard, row, studySessionId) {
  const revision = sourceCard.content_revision;
  const previous = loadAdditionPending().find(({source_id, command}) =>
    source_id === sourceCard.id &&
    command.source_revision.identity === revision.identity &&
    command.source_revision.version === revision.version &&
    canonicalWord(command.target.word) === canonicalWord(row.word) &&
    command.target.meaning.trim() === row.meaning.trim());
  return previous || {
    source_id: sourceCard.id,
    study_session_id: studySessionId,
    command: {
      operation_id: randomUUID(),
      source_revision: revision,
      target: {word: row.word, meaning: row.meaning},
    },
  };
}

export function saveAdditionPending(pending) {
  const id = pending.command.operation_id;
  let durable = true;
  try {
    accountStorage.setItem(PREFIX + id, JSON.stringify(pending));
    memory.delete(id);
  } catch {
    durable = false;
    memory.set(id, pending);
  }
  notify();
  return durable;
}

export function clearAdditionPending(id) {
  memory.delete(id);
  try { accountStorage.removeItem(PREFIX + id); } catch {}
  notify();
}

export function selectedExpansionOperations(studySessionId) {
  const prefix = selectionPrefix(studySessionId);
  const operations = [];
  try {
    for (let index = 0; index < accountStorage.length; index += 1) {
      const key = accountStorage.key(index);
      if (key?.startsWith(prefix)) operations.push(key.slice(prefix.length));
    }
  } catch {}
  return operations;
}

export function confirmAddition(pending) {
  const id = pending.command.operation_id;
  if (inFlight.has(id)) return inFlight.get(id);
  const request = api(`/api/cards/${pending.source_id}/expansion-additions`, {
    method: "POST",
    body: JSON.stringify(pending.command),
  }).then(result => {
    if (result?.committed !== true || result.operation_id !== id) {
      throw new Error("尚未收到本次加入的确认");
    }
    if (result.available && pending.study_session_id) {
      const roundId = pending.study_session_id;
      try {
        accountStorage.setItem(selectionPrefix(roundId) + id, "1");
      } catch {
        result = {...result, linkStored: false};
      }
    }
    clearAdditionPending(id);
    return result;
  }).finally(() => inFlight.delete(id));
  inFlight.set(id, request);
  return request;
}

export function expiredAddition(error) {
  return [404, 409, 422].includes(error?.status);
}
