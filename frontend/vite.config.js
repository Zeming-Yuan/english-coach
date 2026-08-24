import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
      "/static": "http://localhost:8001",
    },
  },
});
