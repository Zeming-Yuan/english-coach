/**
 * 练习提示状态（EL-05）。
 *
 * 同一题一旦使用提示就保持辅助：关闭提示、切换页面或恢复待确认题都不能转回独立。
 * 调用方用稳定的题身份（卡 + 题型）区分新旧题；成功提交后清除。
 */
const PREFIX = "ec.assistance.";
const ALLOWED = new Set([
  "first_letter",
  "length",
  "live_feedback",
  "answer_audio",
  "answer_visible",
]);
const memory = new Map();

const keyFor = (scope, itemId) => `${PREFIX}${scope}:${itemId}`;

export function assistanceFor(scope, itemId) {
  if (!itemId) return [];
  const key = keyFor(scope, itemId);
  if (memory.has(key)) return [...memory.get(key)];
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    const clean = Array.isArray(saved) ? [...new Set(saved.filter(kind => ALLOWED.has(kind)))].sort() : [];
    if (JSON.stringify(saved) !== JSON.stringify(clean)) {
      try {
        if (clean.length) localStorage.setItem(key, JSON.stringify(clean));
        else localStorage.removeItem(key);
      } catch {}
    }
    return clean;
  } catch {
    try { localStorage.removeItem(key); } catch {}
    return [];
  }
}

export function markAssistance(scope, itemId, kind) {
  if (!itemId || !ALLOWED.has(kind)) return assistanceFor(scope, itemId);
  const next = Array.from(
    new Set([...assistanceFor(scope, itemId), kind]),
  ).sort();
  const key = keyFor(scope, itemId);
  memory.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // 存储不可用时保留内存状态；本次提交仍按辅助记录。
  }
  return [...next];
}

export function clearAssistance(scope, itemId) {
  if (!itemId) return;
  const key = keyFor(scope, itemId);
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // 仅清理内存
  }
}
