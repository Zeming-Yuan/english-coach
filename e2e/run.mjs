/**
 * 逐票 E2E 入口：
 *   npm --prefix frontend run test:e2e -- --ticket EC-01
 * 每次运行构建本次前端产物到临时目录，并启动隔离应用/数据库/端口。
 * 未知票号或无匹配用例必须非零退出。
 */
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf("--ticket");
const ticket = at < 0 ? null : args[at + 1];
if (ticket !== null && !/^EC-\d{2}$/.test(ticket)) {
  console.error(`Invalid --ticket selector: ${ticket ?? "(missing)"}`);
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-e2e-static-"));
const staticDir = path.join(workDir, "static");
const frontendDir = path.join(root, "frontend");
let exitCode = 1;

try {
  const vite = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
  const build = spawnSync(
    process.execPath,
    [vite, "build", "--outDir", staticDir, "--emptyOutDir"],
    {cwd: frontendDir, stdio: "inherit", env: process.env},
  );
  if (build.status !== 0) {
    console.error("frontend build failed; refusing to run E2E against stale assets");
    exitCode = build.status ?? 1;
  } else {
    const appStatic = path.join(root, "app", "static");
    for (const name of ["style.css", "favicon.svg"]) {
      fs.copyFileSync(path.join(appStatic, name), path.join(staticDir, name));
    }

    const runnerArgs = [
      "test",
      "--config",
      path.join(root, "e2e", "playwright.config.mjs"),
    ];
    if (ticket) runnerArgs.push("--grep", `${ticket}(?:\\s|$)`);

    const result = spawnSync(
      process.execPath,
      [path.join(frontendDir, "node_modules", "@playwright/test", "cli.js"), ...runnerArgs],
      {
        cwd: root,
        stdio: "inherit",
        env: {...process.env, EC_STATIC_DIR: staticDir},
      },
    );
    exitCode = result.status ?? 1;
  }
} finally {
  try {
    fs.rmSync(workDir, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
  } catch (error) {
    console.warn(`cleanup warning: could not remove ${workDir}: ${error.message}`);
  }
}

process.exit(exitCode);
