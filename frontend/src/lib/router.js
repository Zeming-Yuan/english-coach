/**
 * 全站与二级详情 Hash 路由解析、格式化与状态判等。
 *
 * 采用 Hash（#/...）配合 History API（pushState / replaceState / popstate）：
 * 无需修改 FastAPI、公网试用网关或反代路由，刷新零 404，同时完整支持手机侧滑返回、
 * 浏览器前进/后退与二级详情（词卡详情、课程详情及短测、故事阅读及入门预览、单词自测）深链留驻。
 */

export const ROUTE_VIEWS = new Set([
  "queue",
  "lessons",
  "words",
  "stories",
  "add",
  "stats",
  "settings",
  "backup",
  "study",
  "spelling",
  "listening",
  "quiz",
  "mixed",
  "advice",
  "delayed",
  "scene",
]);

export const DETAIL_VIEWS = new Set(["words", "lessons", "stories", "spelling"]);
const VALID_ORIGINS = new Set(["queue", "stats", "settings", "study"]);
const DELAYED_WINDOWS = new Set(["day", "week"]);

function parsePositiveInt(segment) {
  if (typeof segment !== "string" || !/^[1-9]\d*$/.test(segment)) return null;
  const value = Number(segment);
  return Number.isSafeInteger(value) ? value : null;
}

export function normalizeRoute(input = {}) {
  const view = ROUTE_VIEWS.has(input?.view) ? input.view : "queue";
  const detailId =
    DETAIL_VIEWS.has(view) &&
    Number.isInteger(input?.detailId) &&
    input.detailId > 0
      ? input.detailId
      : null;
  const subView =
    view === "lessons" && detailId !== null && input?.subView === "check"
      ? "check"
      : view === "stories" && detailId === null && input?.subView === "starter"
        ? "starter"
        : null;
  const window = DELAYED_WINDOWS.has(input?.window) ? input.window : "week";
  const origin = VALID_ORIGINS.has(input?.origin) ? input.origin : null;
  return { view, detailId, subView, window, origin };
}

export function parseRoute(rawHash = "", historyState = null) {
  const origin = VALID_ORIGINS.has(historyState?.origin)
    ? historyState.origin
    : null;
  const cleaned = String(rawHash ?? "").replace(/^#/, "");
  if (cleaned === "" || cleaned === "/") {
    return normalizeRoute({ view: "queue", origin });
  }
  const withoutLeadingSlash = cleaned.startsWith("/")
    ? cleaned.slice(1)
    : cleaned;
  const parts = withoutLeadingSlash.split("/");
  const head = parts[0];

  if (!ROUTE_VIEWS.has(head)) {
    return normalizeRoute({ view: "queue" });
  }
  if (head === "queue") {
    return parts.length === 1
      ? normalizeRoute({ view: "queue", origin })
      : normalizeRoute({ view: "queue" });
  }
  if (head === "lessons" && parts.length === 3 && parts[2] === "check") {
    const level = parsePositiveInt(parts[1]);
    if (level !== null) {
      return normalizeRoute({
        view: "lessons",
        detailId: level,
        subView: "check",
        origin,
      });
    }
    return normalizeRoute({ view: "lessons", origin });
  }
  if (head === "stories" && parts.length === 2 && parts[1] === "starter") {
    return normalizeRoute({
      view: "stories",
      detailId: null,
      subView: "starter",
      origin,
    });
  }
  if (DETAIL_VIEWS.has(head)) {
    if (parts.length === 1) {
      return normalizeRoute({ view: head, detailId: null, origin });
    }
    if (parts.length === 2) {
      return normalizeRoute({
        view: head,
        detailId: parsePositiveInt(parts[1]),
        origin,
      });
    }
    return normalizeRoute({ view: "queue" });
  }
  if (head === "delayed") {
    if (parts.length === 1) {
      return normalizeRoute({ view: "delayed", window: "week", origin });
    }
    if (parts.length === 2) {
      return normalizeRoute({
        view: "delayed",
        window: DELAYED_WINDOWS.has(parts[1]) ? parts[1] : "week",
        origin,
      });
    }
    return normalizeRoute({ view: "queue" });
  }
  if (parts.length === 1) {
    return normalizeRoute({ view: head, origin });
  }
  return normalizeRoute({ view: "queue" });
}

export function formatRouteHash(route) {
  const normalized = normalizeRoute(route);
  if (normalized.view === "queue") return "#/";
  if (
    normalized.view === "lessons" &&
    normalized.detailId !== null &&
    normalized.subView === "check"
  ) {
    return `#/lessons/${normalized.detailId}/check`;
  }
  if (
    normalized.view === "stories" &&
    normalized.detailId === null &&
    normalized.subView === "starter"
  ) {
    return "#/stories/starter";
  }
  if (DETAIL_VIEWS.has(normalized.view) && normalized.detailId !== null) {
    return `#/${normalized.view}/${normalized.detailId}`;
  }
  if (normalized.view === "delayed") {
    return `#/delayed/${normalized.window}`;
  }
  return `#/${normalized.view}`;
}

export function routesEqual(left, right) {
  const a = normalizeRoute(left);
  const b = normalizeRoute(right);
  return (
    a.view === b.view &&
    a.detailId === b.detailId &&
    a.subView === b.subView &&
    a.window === b.window &&
    a.origin === b.origin
  );
}
