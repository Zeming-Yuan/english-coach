/**
 * 通用工具函数（复用原 app.js）。
 */

/**
 * HTML 转义。
 */
export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 例句中高亮目标词。
 */
export function highlightWord(text, word) {
  if (!text || !word) return escapeHtml(text);
  // 转义正则特殊字符（can't, e-mail 等）
  const escapedForRegex = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedForRegex})`, "gi");
  return String(text).split(regex).map((part, index) =>
    index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)
  ).join("");
}

/**
 * 清洗点选的词：去掉标点/whitespace 并小写（点词查义共享）。
 */
export function cleanToken(tok) {
  return (tok || "").replace(/[^a-zA-Z'-]/g, "").toLowerCase();
}

/**
 * 意群角色中文标签（悬浮提示）。
 */
export const ROLE_LABELS = { subject: "主语", predicate: "谓宾", adverbial: "状语" };
export const roleLabel = (role) => (role && ROLE_LABELS[role]) || "意群";

/**
 * 本地日期 YYYY-MM-DD。
 */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * localStorage 读写封装。
 */
export function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** UUID v4 also works on HTTP origins where randomUUID is not exposed. */
export function randomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error("浏览器无法创建提交标识，请使用支持安全随机数的浏览器");
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
