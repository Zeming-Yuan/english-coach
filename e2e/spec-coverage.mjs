/** Branch-specific requirements. Titles identify assertions, never proof of execution. */
import fs from "node:fs";
import {fileURLToPath} from "node:url";

export const requirements = {
  EL18: [
    "EL-18 new tab continuation discards the unanswered card partial timing",
    "EL-18 resumed unanswered card discards incomplete timing rather than calibrating",
    "EL-18 five real answers switch future preview to personal and freeze current round",
    "EL-18 due review is timed as review rather than new word",
    "EL-18 idle gaps and answer save waiting never inflate active time",
    "EL-18 duration response-loss retries after refresh without repeating answer",
    "EL-18 duration commit-failure retries after refresh without repeating answer",
    "EL-18 hidden document intervals do not count as active work",
    "EL-18 lost answer response retains frozen timing through confirmation",
    "EL-18 reinforcement records its own kind without changing objective result",
    "EL-18 V3 UI restore continues calibration and older backups explain defaults",
    "EL-18 functional rollback retains observations and uses labelled defaults",
  ],
  EL17: [
    "EL-17 functional rollback hides selector and keeps default finite quota",
    "EL-17 three budgets keep due backlog ahead of fresh cards",
    "EL-17 empty library explains zero work for every budget",
    "EL-17 exhausted daily quota remains visible without a fresh refill",
    "EL-17 same-browser V3 restore clears stale round and preserves saved quota",
    "EL-17 pausing saved reinforcement resumes next item without stale answer contact",
    "EL-17 late pause summary cannot finish a resumed incomplete round",
    "EL-17 budget preview pauses saved work and refresh resumes frozen round",
    "EL-17 response-loss at budget expiry keeps pending identity and confirms once",
    "EL-17 commit-failure at budget expiry keeps pending identity and confirms once",
    "EL-17 frozen revision keeps target and offers explicit reload",
    "EL-17 frozen deletion keeps target and offers explicit reload",
  ],
  EL16: [
    "EL-16 leaving after visible feedback still confirms its delayed contact lookup",
    "EL-16 feedback title visibility does not count offscreen response words",
    "EL-16 saved rule result shows bounded model feedback and visible contact",
    "EL-16 empty output falls back without changing the saved rule result",
    "EL-16 vocabulary output falls back without changing the saved rule result",
    "EL-16 leak output falls back without changing the saved rule result",
    "EL-16 context output falls back without changing the saved rule result",
    "EL-16 correction output falls back without changing the saved rule result",
    "EL-16 missing AI keeps the three-turn template path usable",
    "EL-16 timeout AI keeps the three-turn template path usable",
    "EL-16 unavailable AI keeps the three-turn template path usable",
    "EL-16 model grading instructions keep unknown answers unknown",
    "EL-16 feedback commit refresh confirms the original operation once",
    "EL-16 feedback response-loss refresh confirms the original operation once",
    "EL-16 late feedback stays with its original item after next-turn",
    "EL-16 late feedback stays with its original item after another-scene",
    "EL-16 visible feedback contact response loss retries the same contact",
    "EL-16 V3 browser restore preserves feedback origin and continues saved tasks",
    "EL-16 enhancement rollback keeps saved model replies and new template feedback",
  ],
  EL15: [
    "EL-15 introduction independent three-turn result stays in its context",
    "EL-15 directions independent three-turn result stays in its context",
    "EL-15 application outcomes remain separate across scene contexts",
    "EL-15 expansion rollback keeps drinks and original history available",
    "EL-15 introduction commit creation and answer resume with original identities",
    "EL-15 introduction response-loss creation and answer resume with original identities",
    "EL-15 introduction unknown help retry and skip preserve first results",
    "EL-15 introduction V3 browser restore continues original tasks",
    "EL-15 introduction revision stops stale answers and keeps history",
    "EL-15 introduction deletion stops stale answers and keeps history",
    "EL-15 directions commit creation and answer resume with original identities",
    "EL-15 directions response-loss creation and answer resume with original identities",
    "EL-15 directions unknown help retry and skip preserve first results",
    "EL-15 directions V3 browser restore continues original tasks",
    "EL-15 directions revision stops stale answers and keeps history",
    "EL-15 directions deletion stops stale answers and keeps history",
    "EL-15 switching scenes resumes each saved task without crossing contexts",
    "EL-15 preparation hides English answers separately for all three scenes",
    "EL-15 standard expression and failed speech preserve assisted evidence",
  ],
  EL14: [
    "EL-14 preparation keeps English answers hidden before starting",
    "EL-14 successful standard audio records its actual contact time",
    "EL-14 rollback hides new entry and preserves restored historical evidence",
    "EL-14 independent three-turn drink task shows separate application evidence",
    "EL-14 commit answer refresh confirms the same response once",
    "EL-14 response-loss answer refresh confirms the same response once",
    "EL-14 commit creation refresh confirms the same scene once",
    "EL-14 response-loss creation refresh confirms the same scene once",
    "EL-14 unknown rejected retry and skip never become independent",
    "EL-14 assistance survives refresh and TTS failure keeps the saved result",
    "EL-14 V3 browser restore resumes the original tasks and help",
    "EL-14 revision rejects stale input and preserves historical answers",
    "EL-14 deletion rejects stale input and preserves historical answers",
  ],
  EL13: [
    "EL-13 simpler version checks stay separate when switching versions",
    "EL-13 abandoning recovered choice selects the saved next state",
    "EL-13 abandoning recovered typed selects the saved next state",
    "EL-13 stale creation after restore can be abandoned for the imported round",
    "EL-13 recognition and independent input show separate results",
    "EL-13 commit refresh confirms the original answer once",
    "EL-13 response-loss refresh confirms the original answer once",
    "EL-13 reopening the story keeps typed answer assisted",
    "EL-13 commit creation refresh confirms the same round",
    "EL-13 response-loss creation refresh confirms the same round",
    "EL-13 V3 another instance resumes assistance and original version",
    "EL-13 choice-only version reports actual question count",
    "EL-13 typed-only version reports actual question count",
    "EL-13 empty version reports actual question count",
    "EL-13 legacy story stays readable without invented checks",
    "EL-13 revision rejects a stale answer and returns to the story",
    "EL-13 deletion rejects a stale answer and returns to the story",
    "EL-13 failed help confirmation keeps the original text hidden",
    "EL-13 functional rollback hides entry and keeps restored records",
  ],
  EL12: [
    "EL-12 simpler story preserves original and separate unchecked versions",
    "EL-12 commit refresh confirms the same simplification once",
    "EL-12 response-loss refresh confirms the same simplification once",
    "EL-12 a late simplification cannot replace selected original",
    "EL-12 invalid simpler content keeps original readable",
    "EL-12 deleted source during generation offers explicit failure",
    "EL-12 V3 restore keeps versions materials and replay identity",
    "EL-12 functional rollback hides simplify and retains saved versions",
    "EL-12 pending confirmation after restore uses mapped original identity",
  ],
  EL11: [
    "EL-11 evidence based story shows checked coverage",
    "EL-11 empty library offers checked starter without fake mastery",
    "EL-11 self-rating library offers checked starter without fake mastery",
    "EL-11 new target requires explicit consent without adding cards",
    "EL-11 commit retains operation through refresh and confirms once",
    "EL-11 response-loss retains operation through refresh and confirms once",
    "EL-11 invalid generation keeps saved story and offers starter",
    "EL-11 missing AI explains failure and keeps legacy reading",
    "EL-11 timeout AI explains failure and keeps legacy reading",
    "EL-11 V3 restore preserves version materials and operation replay",
    "EL-11 late detail cannot replace current selection",
    "EL-11 functional rollback hides generation and preserves compatibility",
    "EL-11 deletion failure is visible and replay cannot resurrect deleted story",
    "EL-11 old backup explicitly has no story versions or checks",
    "EL-11 early V3 missing versions does not claim revisions are missing",
    "EL-11 deleted selection rejects an already fetched late detail",
    "EL-11 starter read transport failure is visible and retryable",
    "EL-11 deletion confirmation clears detail that arrived during saving",
    "EL-11 deleting a previous selection preserves a different current story"
],
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
  EL01: [
    "EL-01 visible revision panel tracks semantic edits",
    "EL-01 v3 roundtrip preserves revision and keeps working",
    "EL-01 v2 preview announces missing revisions and regenerates identity",
    "EL-01 unknown v3 feature is rejected without touching data",
    "EL-01 lost edit response replays without double revision",
  ],
  EL02: [
    "EL-02 visible evidence panel states insufficient evidence",
    "EL-02 independent cross-day answers show verified recall",
    "EL-02 new failure changes verified recall to weak",
    "EL-02 assisted answers never become independent evidence",
    "EL-02 meaning edit moves old evidence to history",
    "EL-02 weak evidence never reads as mastery",
  ],
  EL03: [
    "EL-03 visible evidence overview from today stats",
    "EL-03 verified evidence reads the same on home, stats and list",
    "EL-03 weak evidence reads the same on home, stats and list",
    "EL-03 share report downloads with the exported state",
  ],
  EL04: [
    "EL-04 visible list and detail display record an in-app contact",
    "EL-04 prefetch and offscreen cards are not contacts",
    "EL-04 failed audio playback is not a contact",
    "EL-04 unavailable local storage marks the basis incomplete",
    "EL-04 lost confirmation retries with one record",
  ],
  EL05: [
    "EL-05 flashcard exposure reaches confirmed contact",
    "EL-05 spelling hint stays assisted after closing and records answer contact",
    "EL-05 practice response loss retries with one assisted event",
    "EL-05 listening options and audio record contact",
    "EL-05 quiz choice options record contact",
    "EL-05 mixed practice records answer contact",
    "EL-05 reinforcement answer display records contact",
  ],
  EL06: [
    "EL-06 story reading records visible target contacts",
    "EL-06 story sentence playback records answer audio",
    "EL-06 lesson reading records word contacts",
    "EL-06 lesson dialogue playback records answer audio",
    "EL-06 story point-word records contact after meaning",
    "EL-06 offscreen story target is not a contact until visible",
    "EL-06 contact failure does not block reading",
  ],
  EL07: [
    "EL-07 generated lesson shows goal and pending check",
    "EL-07 opening is separate from browse completion",
    "EL-07 explicit viewed confirmation changes status",
    "EL-07 viewed confirmation response loss retries once",
    "EL-07 generation records pending check and counts",
    "EL-07 continue next lesson resets lesson state",
    "EL-07 next lesson response loss replays without skipping",
    "EL-07 twenty generated lessons never read as completed",
    "EL-07 invalid generation leaves no half lesson",
  ],
  EL08: [
    "EL-08 lesson check hides unshown answers",
    "EL-08 correct first answer passes the course check",
    "EL-08 assisted answer stays weak",
    "EL-08 skip can retry without replacing first result",
    "EL-08 assistance survives returning to the course",
    "EL-08 lost attempt response retries once",
    "EL-08 refresh continues the same session",
    "EL-08 zero words is explained without a fake pass",
  ],
  EL10: [
    "EL-10 partial deletion invalidates the frozen multiword round",
    "EL-10 same-browser restore replaces stale advice entry with imported round",
    "EL-10 failed advice starts the exact independent practice",
    "EL-10 assisted-only advice remains separate from independent recall",
    "EL-10 no evidence explains uncertainty without diagnosing weakness",
    "EL-10 revision before entry explains original target unavailable",
    "EL-10 deletion before entry explains original target unavailable",
    "EL-10 delayed advice hides answers and reveal recalculates eligibility",
    "EL-10 delayed suggestion starts its exact window and records retention",
    "EL-10 lost-response keeps answer and confirms one targeted event",
    "EL-10 commit-failure keeps answer and confirms one targeted event",
    "EL-10 lost creation response continues the same frozen round",
    "EL-10 course shows its own short check and delayed samples",
    "EL-10 deleted frozen pool offers a return without a fake pass",
    "EL-10 V3 restore resumes the original targeted round",
    "EL-10 functional rollback keeps evidence and hides advice",
    "EL-10 unavailable browser storage explains creation recovery limits",
  ],
  EL09: [
    "EL-09 reopened results record contact before another delayed answer",
    "EL-09 pending contact refresh on form confirmation",
    "EL-09 pending contact refresh on global confirmation",
    "EL-09 pending contact refresh on accepted-replay confirmation",
    "EL-09 week check hides answers and displays real retention",
    "EL-09 another tab seeing the answer reclassifies the result",
    "EL-09 assisted first result survives refresh and retry",
    "EL-09 skip then retry never replaces first sample",
    "EL-09 lost response confirms once and preserves retention",
    "EL-09 commit failure retains answer across refresh",
    "EL-09 missing history offers ordinary practice without fake evidence",
    "EL-09 V3 restore continues the frozen delayed session",
    "EL-09 functional rollback hides entries and keeps saved evidence",
  ],
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
