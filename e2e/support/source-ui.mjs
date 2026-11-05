/** Scoped source-level UI acceptance without a whole-application build. */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {createServer} from "../../frontend/node_modules/vite/dist/node/index.js";
import react from "../../frontend/node_modules/@vitejs/plugin-react/dist/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function startSourceUI() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-source-ui-"));
  const entries = new Map();
  const server = await createServer({
    configFile: false,
    root: path.join(root, "frontend"),
    base: "/",
    cacheDir,
    plugins: [react(), {
      name: "source-ui-entry",
      resolveId(id) { if (id.startsWith("\0source-ui-")) return id; },
      load(id) { return entries.get(id); },
    }],
    server: {host: "127.0.0.1", port: 0, fs: {allow: [root, fs.realpathSync(path.join(root, "frontend/node_modules"))]}},
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  return {
    origin,
    async close() {
      await server.close();
      fs.rmSync(cacheDir, {recursive: true, force: true});
    },
    async mount(page, modulePath, props = "{}") {
      return this.mountSource(page, `import Component from '${modulePath}';`, props);
    },
    async mountSource(page, source, props = "{}") {
      const id = `source-ui-${entries.size}`;
      entries.set("\0" + id, `import React from 'react';
        import {createRoot} from 'react-dom/client';
        ${source}
        createRoot(document.getElementById('root')).render(React.createElement(Component, ${props}));`);
      const html = await server.transformIndexHtml("/", `<!doctype html>
        <html><body><div id="root"></div><script type="module" src="/@id/__x00__${id}"></script></body></html>`);
      await page.route(origin + "/", route => route.fulfill({contentType: "text/html", body: html}));
      await page.goto(origin + "/");
    },
  };
}
