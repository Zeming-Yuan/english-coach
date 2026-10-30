/**
 * 浏览器学习提交基础工具（EC-03）。
 * 只保存单个待确认请求；不提供离线队列或后台自动重放。
 */

export function makePending(path, payload) {
  return {
    path,
    payload: {
      ...payload,
      submission_id: payload.submission_id ?? crypto.randomUUID(),
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
  return response.json();
}

const pendingKey = (scope) => "ec.pending." + scope;
const memoryPending = new Map();

export function savePending(scope, pending) {
  memoryPending.set(scope, pending);
  try {
    localStorage.setItem(pendingKey(scope), JSON.stringify(pending));
    return true;
  } catch {
    // storage 不可写：内存中的待确认请求仍然保留，不换提交标识
    return false;
  }
}

export function loadPending(scope) {
  if (memoryPending.has(scope)) return memoryPending.get(scope);
  try {
    const saved = localStorage.getItem(pendingKey(scope));
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function clearPending(scope) {
  memoryPending.delete(scope);
  try {
    localStorage.removeItem(pendingKey(scope));
  } catch {
    // storage 不可用时只清理内存
  }
}
