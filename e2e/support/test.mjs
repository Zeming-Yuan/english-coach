/**
 * Playwright 夹具：每个测试启动独立的真实 FastAPI + 迁移 SQLite。
 * 仅测试支持代码；生产应用没有时钟/故障调试端点。
 */
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requireFromFrontend = createRequire(path.join(root, "frontend", "package.json"));
const {test: base, expect, request: apiRequest} = requireFromFrontend("@playwright/test");

function pythonBin() {
  if (process.env.EC_PYTHON) return process.env.EC_PYTHON;
  const venv =
    process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return process.env.PYTHON || "python";
}

function runSeed(databasePath, {fixture = null, cardsFile = null, migrate = false} = {}) {
  const args = [path.join(root, "e2e", "support", "seed.py"), "--database", databasePath];
  if (fixture) args.push("--fixture", fixture);
  if (cardsFile) args.push("--cards-file", cardsFile);
  if (migrate) args.push("--migrate");
  const result = spawnSync(pythonBin(), args, {
    cwd: root,
    encoding: "utf8",
    env: {...process.env, PYTHONPATH: root},
  });
  if (result.status !== 0) {
    throw new Error(`seed.py failed (${result.status})\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function waitForHealth(baseURL, child, getStderr) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app server exited early (${child.exitCode})\n${getStderr()}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // 尚未就绪，继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`app server not healthy in time\n${getStderr()}`);
}

function readPort(child, getStderr) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error(`app server did not report a port\n${getStderr()}`)),
      30000,
    );
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const payload = JSON.parse(line);
          if (payload.port) {
            clearTimeout(timer);
            resolve(payload);
          }
        } catch {
          // 非 JSON 行忽略
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`app server exited before ready (${code})\n${getStderr()}`));
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!stopped && process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  }
}

async function removeTempDir(dir) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      fs.rmSync(dir, {recursive: true, force: true});
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error.code)) {
        console.warn(`cleanup warning: could not remove ${dir}: ${error.message}`);
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.warn(`cleanup warning: could not remove ${dir} after retries`);
}

function writeControl(controlFile, patch) {
  let control = {now: "2026-10-30T12:00:00Z"};
  try {
    control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
  } catch {
    // 首次写入使用默认值
  }
  Object.assign(control, patch);
  fs.writeFileSync(controlFile, JSON.stringify(control));
}

async function startApp({fixture = null} = {}) {
  const staticDir = process.env.EC_STATIC_DIR;
  if (!staticDir || !fs.existsSync(staticDir)) {
    throw new Error("EC_STATIC_DIR missing: run through `npm --prefix frontend run test:e2e`");
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-e2e-"));
  const databasePath = path.join(workDir, "app.db");
  const controlFile = path.join(workDir, "control.json");
  fs.writeFileSync(controlFile, JSON.stringify({now: "2026-10-30T12:00:00Z"}));

  const fixturePath = fixture ? path.join(root, "e2e", "fixtures", fixture) : null;
  runSeed(databasePath, {fixture: fixturePath, migrate: true});

  const args = [
    path.join(root, "e2e", "support", "server.py"),
    "--database", databasePath,
    "--static-dir", staticDir,
    "--control-file", controlFile,
  ];
  if (fixturePath) args.push("--fixture", fixturePath);

  const child = spawn(pythonBin(), args, {
    cwd: root,
    env: {...process.env, PYTHONPATH: root},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const {port} = await readPort(child, () => stderr);
    const baseURL = `http://127.0.0.1:${port}`;
    await waitForHealth(baseURL, child, () => stderr);
    const request = await apiRequest.newContext({baseURL});
    return {
      baseURL,
      request,
      databasePath,
      seedCards: async (cards) => {
        const cardsFile = path.join(workDir, "cards.json");
        fs.writeFileSync(cardsFile, JSON.stringify(cards));
        try {
          const result = runSeed(databasePath, {cardsFile});
          const lines = result.stdout.trim().split(/\r?\n/);
          return JSON.parse(lines[lines.length - 1] || "{}").ids || [];
        } finally {
          fs.rmSync(cardsFile, {force: true});
        }
      },
      setTime: async (iso) => writeControl(controlFile, {now: iso}),
      failCommitOnce: async () => writeControl(controlFile, {fail_commit_once: true}),
      externalCalls: async () => {
        const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
        return control.external_calls || [];
      },
      close: async () => {
        await request.dispose();
        await stopChild(child);
        await removeTempDir(workDir);
      },
    };
  } catch (error) {
    await stopChild(child);
    await removeTempDir(workDir);
    throw error;
  }
}

export const test = base.extend({
  app: async ({}, use) => {
    const instance = await startApp();
    try {
      await use(instance);
    } finally {
      await instance.close();
    }
  },
  appFactory: async ({}, use) => {
    const instances = [];
    const factory = async (options = {}) => {
      const instance = await startApp(options);
      instances.push(instance);
      return instance;
    };
    try {
      await use(factory);
    } finally {
      for (const instance of instances.reverse()) {
        await instance.close();
      }
    }
  },
});

export {expect};
