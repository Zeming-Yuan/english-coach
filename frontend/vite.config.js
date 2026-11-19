import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function collectSourceFiles(dir, baseDir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, baseDir, acc);
    } else if (!/\.test\.[cm]?js$/.test(entry.name)) {
      acc.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
  return acc;
}

function computeFrontendSourceSha256(frontendRoot) {
  const files = [
    "index.html",
    "vite.config.js",
    ...collectSourceFiles(path.join(frontendRoot, "src"), frontendRoot),
  ].sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel + "\0");
    hash.update(fs.readFileSync(path.join(frontendRoot, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sourceStampPlugin() {
  return {
    name: "ec-source-stamp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            name: "ec-source-sha256",
            content: computeFrontendSourceSha256(__dirname),
          },
          injectTo: "head",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), sourceStampPlugin()],
  base: "/static/",  // FastAPI 挂载在 /static/
  build: {
    outDir: path.resolve(__dirname, "../app/static"),
    emptyOutDir: false, // 不清空——保留 favicon.svg 等
    rollupOptions: {
      output: {
        // 稳定文件名，index.html 里引用版本号
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8001",
      "/auth": "http://localhost:8001",
      // Keep backend assets; Vite owns its index, source, internal modules and deps.
      "^/static/(?!$|\\?|index\\.html(?:$|\\?)|src/|@|node_modules/)": "http://localhost:8001",
    },
  },
});
