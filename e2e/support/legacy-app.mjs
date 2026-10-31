/** Actual archived legacy code, isolated from the working checkout. */
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const root = fileURLToPath(new URL("../../", import.meta.url));
const {request} = createRequire(path.join(root, "frontend/package.json"))("@playwright/test");

export async function startLegacy({gitRef, databasePath}, {pythonBin, readPort, stopChild}) {
  const ref = spawnSync("git", ["rev-parse", "--verify", `${gitRef}^{commit}`], {cwd: root, encoding: "utf8"});
  if (ref.status !== 0) throw new Error(`BLOCKED: legacy ref unavailable: ${gitRef}\n${ref.stderr}`);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-legacy-"));
  let child;
  try {
    const archive = path.join(workDir, "source.tar");
    const archived = spawnSync("git", ["archive", "--format=tar", "--output", archive, ref.stdout.trim()], {cwd: root, encoding: "utf8"});
    if (archived.status !== 0) throw new Error(`BLOCKED: git archive: ${archived.stderr}`);
    const unpacked = spawnSync("tar", ["-xf", archive, "-C", workDir], {encoding: "utf8"});
    if (unpacked.status !== 0) throw new Error(`BLOCKED: unpack archive: ${unpacked.stderr}`);
    child = spawn(pythonBin(), [path.join(root, "e2e/support/readonly_server.py"), "--archive", workDir, "--database", databasePath], {cwd: workDir, env: {...process.env, PYTHONPATH: workDir}, stdio: ["ignore", "pipe", "pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    const {port} = await readPort(child, () => stderr);
    const baseURL = `http://127.0.0.1:${port}`;
    const api = await request.newContext({baseURL});
    await expectHealthy(api, child, () => stderr);
    let closed = false;
    return {baseURL, request: api, gitRef: ref.stdout.trim(), close: async () => {
      if (closed) return; closed = true;
      await api.dispose(); await stopChild(child); fs.rmSync(workDir, {recursive: true, force: true});
    }};
  } catch (error) {
    if (child) await stopChild(child);
    fs.rmSync(workDir, {recursive: true, force: true}); throw error;
  }
}
async function expectHealthy(api, child, stderr) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`BLOCKED: legacy exited\n${stderr()}`);
    try { if ((await api.get("/api/health")).ok()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`BLOCKED: archived legacy did not become healthy\n${stderr()}`);
}
