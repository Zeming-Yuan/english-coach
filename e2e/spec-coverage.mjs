/** Branch-specific requirements. Titles identify assertions, never proof of execution. */
import fs from "node:fs";
import {fileURLToPath} from "node:url";

export const requirements = {
  T01: ["EC-01 no-key-home", "EC-01 external-missing"],
  T02: ["EC-16 installation configuration contracts"],
  T03: ["EC-16 old database upgrade contracts", "EC-16 upgraded old database continues through UI"],
  T04: ["EC-02 first-learning without ai", "EC-02 repeat-add-does-not-duplicate", "EC-02 keeps custom card content", "EC-02 sentence-card-does-not-block-word"],
  T05: ["EC-04 transport-failure-retry", "EC-04 commit-failure-retry", "EC-16 server error retains unsaved answer"],
  T06: ["EC-04 response-loss-reload", "EC-05 lost-response-retry-saves-once", "EC-07 choice-unknown-refresh-retry-once"],
  T07: ["EC-06 quiz-batch-is-atomic-and-once", "EC-16 concurrent submission contracts"],
  T08: ["EC-16 three days retain ratings and two-thirds pass rate"],
  T09: ["EC-08 same-day-two-attempts-one-word"],
  T10: ["EC-07 listening-source-parity", "EC-07 typed-and-choice-source-policy-parity", "EC-07 listening-single-saved-event"],
  T11: ["EC-05 independent-input", "EC-05 feedback-is-assistance", "EC-05 explicit-skip-is-not-wrong", "EC-05 leaving-page-creates-no-event", "EC-06 skip-records-null-correct", "EC-06 choosing-does-not-change-due"],
  T12: ["EC-16 Shanghai midnight preserves both learning days"],
  T13: ["EC-08 legacy-baseline-does-not-fake-days", "EC-09 no-samples", "EC-09 target-does-not-override-new-limit"],
  T14: ["EC-10 download-complete-backup", "EC-12 restore-other-instance-and-continue", "EC-16 complete install learn restore journey", "EC-16 legacy readonly preserves new events and forward learning", "EC-16 legacy implicit GET write is visibly blocked"],
  T15: ["EC-11 invalid-file-keeps-data", "EC-12 invalid-graph-rollback-and-preview-conflict", "EC-16 invalid backup contracts"],
  T16: ["EC-12 invalid-graph-rollback-and-preview-conflict", "EC-16 safety backup and insertion fault contracts"],
  T17: ["EC-11 import-legacy-twice-keeps-story", "EC-16 ambiguous legacy contracts"],
  T18: ["EC-13 daily round is due-first with fixed target and visible backlog", "EC-13 a completed full round leaves the backlog for a fresh next round"],
  T19: ["EC-14 main low rating and explicit skip both become reinforcement", "EC-14 three question lifetime cap survives refresh without refilling", "EC-14 no weak items reads summary and a summary failure remains retryable", "EC-14 assisted reinforcement stays weak without another schedule"],
  T20: ["EC-16 TTS retries the same word after provider recovery", "EC-16 a newer replay owns its playback deadline", "EC-16 speech prewarming cannot block detail or saving", "EC-16 TTS uses controlled external adapter", "EC-16 TTS provider timeout preserves saved learning", "EC-16 TTS provider error preserves saved learning", "EC-01 external-missing", "EC-01 external-timeout", "EC-01 external-unavailable", "EC-04 ai-upgrade-failure-does-not-block", "EC-06 tts-failure-options-usable", "EC-13 load error is distinct from empty library and offers retry"],
  T21: ["EC-13 small library completes with keyboard and keeps specialist practice", "EC-16 complete install learn restore journey"],
};
export const projects = ["mobile", "desktop"];

export function assertSpecCoverage(report) {
  if (!report || report.errors?.length || !Array.isArray(report.suites)) throw new Error("Blocked/invalid Playwright report");
  const actual = new Map();
  function visit(suites) {
    for (const suite of suites) {
      visit(suite.suites || []);
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const key = `${test.projectName}: ${spec.title}`;
          if (actual.has(key)) throw new Error(`Duplicate result: ${key}`);
          if (test.expectedStatus !== "passed" || test.status !== "expected" || test.results?.length !== 1 || test.results[0].status !== "passed") {
            throw new Error(`Non-passing required execution: ${key} (${test.status}/${test.results?.map(r => r.status).join(",") || "missing"})`);
          }
          actual.set(key, test);
        }
      }
    }
  }
  visit(report.suites);
  const missing = [];
  for (const [id, titles] of Object.entries(requirements)) {
    for (const project of projects) for (const title of titles) {
      if (!actual.has(`${project}: ${title}`)) missing.push(`${id}/${project}: ${title}`);
    }
  }
  if (missing.length) throw new Error(`Missing spec coverage:\n${missing.join("\n")}`);
  return Object.keys(requirements).map(id => `${id}: passed (${projects.join(", ")}; ${requirements[id].length} required branches)`).join("\n");
}

function selfTest() {
  const titles = [...new Set(Object.values(requirements).flat())];
  const good = () => ({errors: [], suites: [{specs: titles.map(title => ({title, tests: projects.map(projectName => ({projectName, expectedStatus: "passed", status: "expected", results: [{status: "passed"}]}))}))}]});
  assertSpecCoverage(good());
  function rejected(name, change) {
    const report = good(); change(report);
    try { assertSpecCoverage(report); } catch { console.log(`${name}-rejected`); return; }
    throw new Error(`${name} incorrectly accepted`);
  }
  rejected("missing-case", r => r.suites[0].specs.pop());
  rejected("missing-project", r => r.suites[0].specs[0].tests.pop());
  for (const status of ["skipped", "failed", "timedOut", "interrupted"]) {
    rejected(status === "skipped" ? "skipped-case" : status, r => r.suites[0].specs[0].tests[0].results[0].status = status);
  }
  rejected("blocked", r => r.errors.push({message: "fixture unavailable"}));
  rejected("flaky", r => r.suites[0].specs[0].tests[0].results.unshift({status: "failed"}));
  rejected("partial-branch", r => r.suites[0].specs = r.suites[0].specs.filter(s => s.title !== "EC-04 commit-failure-retry"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--self-test" && process.argv.length === 3) selfTest();
    else if (process.argv.length === 3) console.log(assertSpecCoverage(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))));
    else throw new Error("Usage: node e2e/spec-coverage.mjs REPORT.json | --self-test");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
