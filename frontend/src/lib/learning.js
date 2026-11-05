import {randomUUID} from "./utils.js";
/**
 * 浏览器学习提交基础工具（EC-03）。
 * 只保存单个待确认请求；不提供离线队列或后台自动重放。
 */

import {saveDuration} from "./durations.js";

export function makePending(path, payload) {
  return {
    path,
    payload: {
      ...payload,
      submission_id: payload.submission_id ?? randomUUID(),
    },
  };
}

export async function sendPending(pending) {
  const response = await fetch(pending.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pending.payload),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body && body.detail !== undefined) detail = body.detail;
    } catch {}
    const error = new Error(
      typeof detail === "string" ? detail : "保存失败，请重试",
    );
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("尚未确认保存：服务器响应不是有效的 JSON，请继续确认同一提交");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("尚未确认保存：服务器响应无效，请继续确认同一提交");
  }
  if (result.committed === true && pending.duration) void saveDuration(pending.duration).catch(() => {});
  return result;
}

const DEFAULT_PREFIX = "ec.pending.";
const memoryPending = new Map();

const pendingKey = (scope, prefix) => prefix + scope;

export function savePending(scope, pending, prefix = DEFAULT_PREFIX) {
  memoryPending.set(pendingKey(scope, prefix), pending);
  try {
    localStorage.setItem(pendingKey(scope, prefix), JSON.stringify(pending));
    return true;
  } catch {
    // storage 不可写：内存中的待确认请求仍然保留，不换提交标识
    return false;
  }
}

export function loadPending(scope, prefix = DEFAULT_PREFIX) {
  const key = pendingKey(scope, prefix);
  if (memoryPending.has(key)) return memoryPending.get(key);
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function clearPending(scope, prefix = DEFAULT_PREFIX) {
  const key = pendingKey(scope, prefix);
  memoryPending.delete(key);
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    // Keep a tombstone so readable-but-not-removable storage cannot revive it.
    memoryPending.set(key, null);
    return false;
  }
}

/** A restored database cannot accept submissions prepared for the previous one. */
export function clearAllPending() {
  for (const key of memoryPending.keys()) {
    if (key.startsWith(DEFAULT_PREFIX)) memoryPending.set(key, null);
  }
  let durable = true;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(DEFAULT_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      memoryPending.set(key, null);
      try { localStorage.removeItem(key); } catch { durable = false; }
    }
  } catch { durable = false; }
  return durable;
}
