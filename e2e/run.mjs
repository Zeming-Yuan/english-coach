/** Fresh build + isolated real applications + actual-result release coverage. */
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertSpecCoverage} from "./spec-coverage.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--ticket" && /^EC-\d{2}$/.test(args[1]))) {
  console.error("Invalid arguments. Usage: test:e2e [--ticket EC-NN]; release runs must be unfiltered");
  process.exit(2);
}
const ticket = args[1] || null;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-e2e-static-"));
const staticDir = path.join(workDir, "static");
const frontendDir = path.join(root, "frontend");
const diagnostics = path.join(root, "e2e", "release-results", path.basename(workDir));
fs.mkdirSync(diagnostics, {recursive: true});
const reportPath = path.join(diagnostics, "playwright.json");
let activeChild;
let interrupted;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = signal;
  activeChild?.kill(signal);
});
function run(command, parameters, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    activeChild = spawn(command, parameters, {cwd, stdio: "inherit", env});
    activeChild.once("error", reject);
    activeChild.once("exit", (code, signal) => { activeChild = null; resolve({code, signal}); });
  });
}
function git(...parameters) {
  const result = spawnSync("git", parameters, {cwd: root, encoding: "utf8"});
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
// Includes uncommitted/untracked source bytes; HEAD alone cannot identify a dirty build.
function sourceFingerprint() {
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    if (file.startsWith("app/static/assets/") || file === "app/static/index.html") continue;
    hash.update(file + "\0");
    hash.update(fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : "<deleted>");
  }
  return hash.digest("hex");
}
const provenance = {head: git("rev-parse", "HEAD"), started_at: new Date().toISOString(), source_sha256: sourceFingerprint(), working_tree: git("status", "--short"), ticket, static_dir: staticDir};
const statusPath = path.join(diagnostics, "run.json");
function record(status, detail = "") { fs.writeFileSync(statusPath, JSON.stringify({...provenance, status, detail}, null, 2)); }
record("started");
console.log(`Release diagnostics: ${diagnostics}`);
let exitCode = 1;
try {
  const build = await run(process.execPath, [path.join(frontendDir, "node_modules/vite/bin/vite.js"), "build", "--outDir", staticDir, "--emptyOutDir"], frontendDir);
  if (interrupted || build.code !== 0) throw new Error(`Fresh frontend build failed/interrupted: ${build.code}/${build.signal}`);
  provenance.built_at = new Date().toISOString();
  provenance.assets = Object.fromEntries(fs.readdirSync(path.join(staticDir, "assets")).map(name => [name, createHash("sha256").update(fs.readFileSync(path.join(staticDir, "assets", name))).digest("hex")]));
  for (const name of ["style.css", "favicon.svg"]) fs.copyFileSync(path.join(root, "app/static", name), path.join(staticDir, name));
  provenance.static_files = Object.fromEntries(["index.html", "style.css", "favicon.svg"].map(name => [name, createHash("sha256").update(fs.readFileSync(path.join(staticDir, name))).digest("hex")]));
  const runnerArgs = [path.join(frontendDir, "node_modules/@playwright/test/cli.js"), "test", "--config", path.join(root, "e2e/playwright.config.mjs")];
  if (ticket) runnerArgs.push("--grep", `${ticket}(?:\\s|$)`);
  const result = await run(process.execPath, runnerArgs, root, {...process.env, EC_STATIC_DIR: staticDir, EC_REPORT_PATH: reportPath, EC_OUTPUT_DIR: path.join(diagnostics, "artifacts")});
  if (interrupted || result.code !== 0) throw new Error(`Playwright failed/interrupted: ${result.code}/${result.signal}`);
  if (sourceFingerprint() !== provenance.source_sha256 || git("rev-parse", "HEAD") !== provenance.head) throw new Error("Source/HEAD changed during acceptance; rerun against frozen source");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (!ticket) {
    const coverage = assertSpecCoverage(report);
    fs.writeFileSync(path.join(diagnostics, "coverage.txt"), coverage + "\n");
    console.log(coverage);
  } else {
    // Narrow runs still reject skips, expected failures, retries and empty samples.
    const tests = [];
    const visit = suites => { for (const suite of suites) { visit(suite.suites || []); for (const spec of suite.specs || []) tests.push(...(spec.tests || [])); } };
    visit(report.suites || []);
    if (report.errors?.length || !tests.length || tests.some(t => t.status !== "expected" || t.expectedStatus !== "passed" || t.results?.length !== 1 || t.results[0].status !== "passed")) throw new Error("Narrow run has missing/non-passing executions");
  }
  record("passed"); exitCode = 0;
} catch (error) {
  console.error(error.stack || error.message); record(interrupted ? "interrupted" : "failed", error.stack || error.message);
} finally {
  fs.rmSync(workDir, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
  console.log(`Release diagnostics retained: ${diagnostics}; exit=${exitCode}`);
}
process.exitCode = exitCode;
