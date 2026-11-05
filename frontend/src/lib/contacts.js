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
const matchesRevision = (pending, revision) => pending?.payload?.revision?.identity === revision?.identity &&
  pending?.payload?.revision?.version === revision?.version;
// 本页会话内被拒绝的存储范围；重试失败时仍要保留“依据不完整”的提示。
const deniedScopes = new Set();

const visibleLookups = new Map();
const lookupRequests = new Map();
export const CONTACT_LOOKUPS_CHANGED = "ec:contact-lookups-changed";
const notifyLookups = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONTACT_LOOKUPS_CHANGED));
};
const completeVisibleLookup = (scope) => {
  const durable = clearPending(scope, PREFIX);
  visibleLookups.delete(scope);
  deniedScopes.delete(scope);
  notifyLookups();
  return durable;
};
const persistVisibleLookup = (scope, record) => {
  visibleLookups.set(scope, record);
  const durable = savePending(scope, record, PREFIX);
  if (durable) deniedScopes.delete(scope);
  else deniedScopes.add(scope);
  notifyLookups();
  return durable;
};

/** A real display whose card identities are still loading is unconfirmed contact. */
export function beginVisibleContactLookup(identity, feedback = null) {
  const scope = `lookup:${identity}`;
  const previous = visibleLookups.get(scope) || loadPending(scope, PREFIX);
  const record = previous && previous.source === feedback?.source && previous.text === feedback?.text
    ? previous : {awaiting_targets: true};
  if (feedback?.source === "scene" && typeof feedback.text === "string") {
    record.source = "scene";
    record.text = feedback.text;
    record.confirmed = [...new Set([...(record.confirmed || []), ...(feedback.confirmed || [])])];
  }
  persistVisibleLookup(scope, record);
  return scope;
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
  return [...scopes].flatMap(scope => {
    const record = visibleLookups.get(scope) || loadPending(scope, PREFIX);
    return record?.awaiting_targets === true ? [{scope, ...record}] : [];
  });
}

/** Unresolved feedback from the replaced database cannot contact new cards. */
export function clearVisibleContactLookups() {
  let durable = true;
  for (const {scope} of pendingVisibleContactLookups()) {
    if (!completeVisibleLookup(scope)) durable = false;
  }
  return durable;
}

export function retryVisibleContactLookup(scope) {
  if (lookupRequests.has(scope)) return lookupRequests.get(scope);
  const request = resolveVisibleContactLookup(scope).finally(() => {
    if (lookupRequests.get(scope) === request) lookupRequests.delete(scope);
  });
  lookupRequests.set(scope, request);
  return request;
}

async function resolveVisibleContactLookup(scope) {
  const record = visibleLookups.get(scope) || loadPending(scope, PREFIX);
  if (record?.source !== "scene" || typeof record.text !== "string") {
    throw new Error("旧接触记录缺少反馈内容，接触依据仍不完整，请回到原反馈继续确认。");
  }
  visibleLookups.set(scope, record);
  const stillOwned = () => visibleLookups.get(scope) === record;
  if (!Array.isArray(record.targets)) {
    const {cards} = await api("/api/cards");
    if (!stillOwned()) throw new Error("反馈所属数据已变化，请重新查看反馈。");
    const words = new Set(record.text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []);
    record.targets = cards.filter(card => card.kind === "word" && words.has(card.word.toLowerCase())).map(card => {
      const targetScope = scopeFor({source: "scene", kind: "answer_visible", cardId: card.id});
      const existing = loadPending(targetScope, PREFIX);
      return {card, pending: matchesRevision(existing, card.content_revision) ? existing : makePending("/api/learning/contacts", {
        card_id: card.id, revision: card.content_revision, source: "scene", kind: "answer_visible",
      })};
    });
    persistVisibleLookup(scope, record);
  }
  record.confirmed ||= [];
  record.unrecorded ||= [];
  const targets = record.targets.filter(({card}) =>
    !record.confirmed.includes(card.content_revision.identity) && !record.unrecorded.includes(card.content_revision.identity));
  const outcomes = await Promise.allSettled(targets.map(async ({card, pending}) => {
    if (!stillOwned()) throw new Error("反馈所属数据已变化，请重新查看反馈。");
    const targetScope = scopeFor({source: "scene", kind: "answer_visible", cardId: card.id});
    savePending(targetScope, pending, PREFIX);
    try {
      await send(targetScope, pending);
    } catch (error) {
      if (error.retryable !== false) throw error;
      // A deleted/revised target cannot accept this exposure. Retire the
      // request honestly; it is neither confirmed nor useful to retry.
      if (stillOwned()) {
        record.unrecorded.push(card.content_revision.identity);
        persistVisibleLookup(scope, record);
      }
      return;
    }
    if (stillOwned()) {
      record.confirmed.push(card.content_revision.identity);
      persistVisibleLookup(scope, record);
    }
  }));
  if (!stillOwned()) throw new Error("反馈所属数据已变化，请重新查看反馈。");
  const result = {
    failed: targets.filter((_, index) => outcomes[index].status === "rejected").map(({card}) => card),
    unrecorded: record.targets.filter(({card}) => record.unrecorded.includes(card.content_revision.identity)).map(({card}) => card),
  };
  if (!transferVisibleLookup(scope, result.failed)) {
    throw new Error("部分反馈接触尚未确认，浏览器未能保存待确认目标，请重试。");
  }
  return {...result, targets: targets.map(({card}) => card)};
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
      if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length));
    }
  } catch { ids.push("storage-unavailable"); }
  return [...new Set(ids)].slice(0, 1000);
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
    if (loadPending(scope, PREFIX)?.payload?.submission_id === pending.payload.submission_id) {
      clearPending(scope, PREFIX);
      deniedScopes.delete(scope);
    }
    return result;
  } catch (error) {
    // 删除/修订/非法组合不可能靠重试通过；网络与服务器故障保留同一提交。
    error.retryable = !FINAL_STATUS.has(error?.status);
    if (!error.retryable && loadPending(scope, PREFIX)?.payload?.submission_id === pending.payload.submission_id) {
      clearPending(scope, PREFIX);
      deniedScopes.delete(scope);
    }
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
  if (matchesRevision(existing, revision)) {
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
