/**
 * API 请求封装（复用原 app.js 逻辑）。
 */

export async function api(path, opts = {}) {
  let resp;
  try {
    resp = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("网络连接失败，请检查网络后重试", {cause: error});
  }
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
  const text = await resp.text();
  return text.trim() ? JSON.parse(text) : null;
}
