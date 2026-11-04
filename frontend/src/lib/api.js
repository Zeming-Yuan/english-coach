/**
 * API 请求封装（复用原 app.js 逻辑）。
 */

export async function api(path, opts = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI 校验错误：detail 是数组，提取可读的 msg。
        detail =
          body.detail
            .map((item) => item?.msg?.replace(/^Value error, /, ""))
            .filter(Boolean)
            .join("；") || detail;
      }
    } catch {}
    const error = new Error(detail);
    error.status = resp.status;
    throw error;
  }
  return resp.json();
}
