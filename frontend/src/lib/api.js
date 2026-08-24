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
      detail = (await resp.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return resp.json();
}
