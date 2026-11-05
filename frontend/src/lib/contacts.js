/**
 * 应用内接触记录（EL-04）。
 *
 * 只在内容真正展示或答案真正播放后调用；预取、缓存预热和未展示内容不调用。
 * 待确认标记使用独立存储前缀，避免被评分恢复界面当成学习提交。
 */
import {api} from "./api.js";
import {
  makePending,
  sendPending,
  savePending,
  loadPending,
  clearPending,
} from "./learning.js";

const PREFIX = "ec.contact.";
const FINAL_STATUS = new Set([404, 409, 422]);
// 本页会话内被拒绝的存储范围；重试失败时仍要保留“依据不完整”的提示。
const deniedScopes = new Set();

const visibleLookups = new Map();
export const CONTACT_LOOKUPS_CHANGED = "ec:contact-lookups-changed";
const notifyLookups = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONTACT_LOOKUPS_CHANGED));
};
const completeVisibleLookup = (scope) => {
  clearPending(scope, PREFIX);
  visibleLookups.delete(scope);
  deniedScopes.delete(scope);
  notifyLookups();
};

/** A real display whose card identities are still loading is unconfirmed contact. */
export function beginVisibleContactLookup(identity, feedback = null) {
  const scope = `lookup:${identity}`;
  const record = {awaiting_targets: true};
  if (feedback?.source === "scene" && typeof feedback.text === "string") {
    record.source = "scene";
    record.text = feedback.text;
  }
  visibleLookups.set(scope, record);
  if (savePending(scope, record, PREFIX)) deniedScopes.delete(scope);
  else deniedScopes.add(scope);
  notifyLookups();
  return (failed = []) => transferVisibleLookup(scope, failed);
}

/** Only feedback lookup ownership is recoverable here; old unknown exposures stay incomplete. */
export function pendingVisibleContactLookups() {
  const scopes = new Set(visibleLookups.keys());
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX + "lookup:")) scopes.add(key.slice(PREFIX.length));
    }
  } catch {}
  return [...scopes].map(scope => ({scope, ...(visibleLookups.get(scope) || loadPending(scope, PREFIX))}));
}

export async function retryVisibleContactLookup(scope) {
  const record = visibleLookups.get(scope) || loadPending(scope, PREFIX);
  if (record?.source !== "scene" || typeof record.text !== "string") {
    throw new Error("旧接触记录缺少反馈内容，接触依据仍不完整，请回到原反馈继续确认。");
  }
  const {cards} = await api("/api/cards");
  const words = new Set(record.text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []);
  const targets = cards.filter(card => card.kind === "word" && words.has(card.word.toLowerCase()));
  const result = await recordVisibleCards(targets, "scene");
  if (!transferVisibleLookup(scope, result.failed)) {
    throw new Error("部分反馈接触尚未确认，浏览器未能保存待确认目标，请重试。");
  }
  return result;
}

function transferVisibleLookup(scope, failed) {
  const owned = failed.every(card => {
    const targetScope = scopeFor({source: "scene", kind: "answer_visible", cardId: card.id});
    const pending = loadPending(targetScope, PREFIX);
    if (!pending || !savePending(targetScope, pending, PREFIX)) return false;
    deniedScopes.delete(targetScope);
    return true;
  });
  if (owned) completeVisibleLookup(scope);
  return owned;
}

// 请求不提供可信日期；任何未确认/不可持久化标记只会降低回测完整性。
export function pendingContactIds() {
  const ids = [...deniedScopes];
  try {
    localStorage.setItem("ec.contact.probe", "1");
    localStorage.removeItem("ec.contact.probe");
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) ids.push(key);
    }
  } catch { ids.push("storage-unavailable"); }
  return ids.slice(0, 1000);
}

export function refreshPendingContacts(pending) {
  if (!Array.isArray(pending?.payload?.pending_contact_ids)) return pending;
  return {...pending, payload: {...pending.payload,
    pending_contact_ids: [...new Set([...pending.payload.pending_contact_ids, ...pendingContactIds()])].slice(0, 1000),
  }};
}

const scopeFor = ({source, kind, cardId}) => `${source}:${kind}:${cardId}`;

async function send(scope, pending) {
  try {
    const result = await sendPending(pending);
    if (result.committed !== true) throw new Error("尚未确认保存接触记录");
    clearPending(scope, PREFIX);
    return result;
  } catch (error) {
    // 删除/修订/非法组合不可能靠重试通过；网络与服务器故障保留同一提交。
    error.retryable = !FINAL_STATUS.has(error?.status);
    if (!error.retryable) clearPending(scope, PREFIX);
    throw error;
  }
}

/**
 * 确认一次实际展示或播放。
 * 有同范围待确认请求时沿用原提交标识，服务端据此去重。
 */
export function recordContact({cardId, revision, source, kind}) {
  if (!revision?.identity || !revision?.version) {
    const error = new Error("缺少内容修订，接触依据未知");
    error.status = 422;
    error.retryable = false;
    return Promise.reject(error);
  }
  const scope = scopeFor({source, kind, cardId});
  const existing = loadPending(scope, PREFIX);
  if (existing) {
    return send(scope, existing).catch((error) => {
      if (deniedScopes.has(scope)) error.durable = false;
      throw error;
    });
  }
  const pending = makePending("/api/learning/contacts", {
    card_id: cardId,
    revision,
    source,
    kind,
  });
  const durable = savePending(scope, pending, PREFIX);
  if (durable) deniedScopes.delete(scope);
  else deniedScopes.add(scope);
  return send(scope, pending).catch((error) => {
    if (!durable) error.durable = false;
    throw error;
  });
}

/**
 * 展示一批卡片：只有调用方确认已真正可见时才调用。
 * 返回失败卡与其中仍可重试的卡；删除/修订/非法组合不再用新提交无限重试。
 */
export async function recordVisibleCards(cards, source) {
  const results = await Promise.allSettled(
    cards.map((card) =>
      recordContact({
        cardId: card.id,
        revision: card.content_revision,
        source,
        kind: "answer_visible",
      }),
    ),
  );
  const failed = [];
  const retryable = [];
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    failed.push(cards[index]);
    if (result.reason?.retryable !== false) retryable.push(cards[index]);
  });
  return {failed, retryable};
}
