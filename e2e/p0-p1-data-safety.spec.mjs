import {createRequire} from "node:module";
import {startSourceUI} from "./support/source-ui.mjs";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const {test, expect} = require("@playwright/test");
let ui;
test.beforeAll(async () => {ui = await startSourceUI();});
test.afterAll(async () => {await ui?.close();});

test("confirmed restore is not offered again when the refresh callback fails", async ({page}) => {
  let restores = 0;
  await page.route("**/api/import/preview", route => route.fulfill({json: {mode: "full_replace", expected_revision: "r1", counts: {cards: 1, learning_events: 0}, impact: {replaced: {cards: 1, learning_events: 0}}, missing_collections: []}}));
  await page.route("**/api/import/cards", route => {restores++; return route.fulfill({json: {mode: "full_replace", counts: {}}});});
  await ui.mount(page, "/src/views/BackupPage.jsx", "{onRestoringChange: () => {}, onRestored: async () => {throw new Error('refresh unavailable');}}");
  await page.getByLabel("选择备份文件").setInputFiles({name: "backup.json", mimeType: "application/json", buffer: Buffer.from("{}")});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByTestId("release-journey")).toBeVisible();
  await expect(page.getByRole("button", {name: "确认替换学习数据", exact: true})).toHaveCount(0);
  await expect(page.getByText(/恢复尚未确认/)).toHaveCount(0);
  expect(restores).toBe(1);
});

test("restoring through the app clears old pending records and their recovery action", async ({page}) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/import/preview" ? {mode: "full_replace", expected_revision: "r1", counts: {cards: 1, learning_events: 0}, impact: {replaced: {cards: 1, learning_events: 0}}}
      : path === "/api/import/cards" ? {mode: "full_replace", imported_words: 1}
      : path === "/api/today" ? {new_cards: [], due_cards: [], error_cards: []}
      : path === "/api/ai-config" ? {base_url: "http://example.test", model: "test", has_key: false}
      : path === "/api/stats" ? {total_cards: 0}
      : null;
    return route.fulfill(data ? {json: data} : {status: 503, json: {detail: "unavailable fixture"}});
  });
  await page.addInitScript(() => {
    localStorage.setItem("ec.pending.old-db", JSON.stringify({path: "/api/reviews", payload: {card_id: 1, rating: 3, submission_id: "old"}}));
    localStorage.setItem("ec.contact.lookup:scene-feedback:old:item", JSON.stringify({awaiting_targets: true, source: "scene", text: "An apple."}));
  });
  await ui.mount(page, "/src/App.jsx");
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "继续确认反馈接触", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "backup.json", mimeType: "application/json", buffer: Buffer.from("{}")});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByTestId("release-journey")).toBeVisible();
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ec.pending.old-db"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("ec.contact.lookup:scene-feedback:old:item"))).toBeNull();
  await expect(page.getByRole("button", {name: "继续确认反馈接触", exact: true})).toHaveCount(0);
});

test("word list displays ampersands and angle brackets as plain text", async ({page}) => {
  await page.route("**/api/cards", route => route.fulfill({json: {cards: [{id: 1, kind: "word", word: "tea & coffee", meaning: "A & B < C", phonetic: "<sound>", review_count: 0}]}}));
  await page.route("**/api/tts/**", route => route.fulfill({body: ""}));
  await ui.mount(page, "/src/views/WordsPage.jsx");
  await expect(page.locator(".word-item-meaning")).toContainText("A & B < C");
  await expect(page.locator(".word-item-phonetic")).toHaveText("<sound>");
});

test("word search accepts mobile auto-capitalized queries", async ({page}) => {
  await page.route("**/api/cards", route => route.fulfill({json: {cards: [{id: 1, kind: "word", word: "apple", meaning: "苹果", review_count: 0}]}}));
  await page.route("**/api/tts/**", route => route.fulfill({body: ""}));
  await ui.mount(page, "/src/views/WordsPage.jsx");
  await expect(page.locator(".word-item")).toHaveCount(1);
  await page.getByPlaceholder(/搜索/).fill("Apple");
  await expect(page.locator(".word-item")).toHaveCount(1);
});

test("AI settings loading failure is visible and retryable before saving", async ({page}) => {
  let loads = 0;
  await page.route("**/api/ai-config", route => {
    loads++;
    return route.fulfill(loads === 1 ? {status: 503, json: {detail: "config offline"}} : {json: {base_url: "http://example.test", model: "restored-model", has_key: true}});
  });
  await ui.mount(page, "/src/views/SettingsPage.jsx");
  await expect(page.getByRole("alert")).toContainText("AI 配置加载失败");
  await expect(page.getByRole("button", {name: "保存配置", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "重试加载配置", exact: true}).click();
  await expect(page.getByLabel("模型", {exact: true})).toHaveValue("restored-model");
  await expect(page.getByRole("button", {name: "保存配置", exact: true})).toBeEnabled();
});

test("late word lookup cannot replace a newer word or reopen a closed panel", async ({page}) => {
  const held = [];
  await page.route("**/api/lookup/**", route => {held.push(route);});
  await ui.mountSource(page, `import {useWordLookup} from '/src/lib/wordLookup.js';
    function Component() {
      const lookup = useWordLookup();
      const [completed, setCompleted] = React.useState(0);
      const open = async value => {await lookup.open(value); setCompleted(n => n + 1);};
      return React.createElement('div', {},
        React.createElement('button', {onClick: () => open('alpha')}, 'alpha'),
        React.createElement('button', {onClick: () => open('bravo')}, 'bravo'),
        React.createElement('button', {onClick: lookup.close}, 'close'),
        React.createElement('output', {'data-testid': 'word'}, lookup.word?.word || 'closed'),
        React.createElement('output', {'data-testid': 'completed'}, completed));
    }`);
  await page.getByRole("button", {name: "alpha", exact: true}).click();
  await expect.poll(() => held.length).toBe(1);
  await page.getByRole("button", {name: "bravo", exact: true}).click();
  await expect.poll(() => held.length).toBe(2);
  await held[1].fulfill({json: {found: true, meaning: "B"}});
  await expect(page.getByTestId("completed")).toHaveText("1");
  await held[0].fulfill({json: {found: true, meaning: "A"}});
  await expect(page.getByTestId("completed")).toHaveText("2");
  await expect(page.getByTestId("word")).toHaveText("bravo");
  await page.getByRole("button", {name: "alpha", exact: true}).click();
  await expect.poll(() => held.length).toBe(3);
  await page.getByRole("button", {name: "close", exact: true}).click();
  await held[2].fulfill({json: {found: true, meaning: "A"}});
  await expect(page.getByTestId("completed")).toHaveText("3");
  await expect(page.getByTestId("word")).toHaveText("closed");
});

test("failed statistics exports report an error without downloading the response", async ({page}) => {
  const downloads = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/stats") return route.fulfill({json: {total_cards: 0}});
    if (path === "/api/stats/history") return route.fulfill({json: {days: []}});
    return route.fulfill({status: 503, json: {detail: "export offline"}});
  });
  await ui.mount(page, "/src/views/StatsPage.jsx");
  await page.getByRole("button", {name: "导出 Anki", exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__toastData?.msg || "")).toContain("导出失败");
  expect(downloads).toEqual([]);
});

test("quiz feedback and completion show plain text without entity artifacts", async ({page}) => {
  await page.route("**/api/quiz?limit=5", route => route.fulfill({json: {questions: [{id: 1, card_id: 1, type: "choice", prompt: "P & Q", question_token: "token", options: ["A & B", "C < D"]}]}}));
  await page.route("**/api/quiz/score", route => route.fulfill({json: {committed: true, details: [{correct: false, expected: "C < D"}]}}));
  await page.route("**/api/tts/**", route => route.fulfill({status: 503, body: "unavailable"}));
  await ui.mount(page, "/src/views/QuizPage.jsx");
  await page.locator(".quiz-option").filter({hasText: "A & B"}).click();
  await page.getByRole("button", {name: "确认", exact: true}).click();
  await expect(page.locator(".quiz-feedback.err")).toContainText("A & B");
  await expect(page.locator(".quiz-feedback.err")).toContainText("C < D");
  await page.getByRole("button", {name: "查看结果", exact: true}).click();
  await expect(page.locator(".quiz-wrong-meaning")).toHaveText("P & Q");
  await expect(page.locator(".quiz-wrong-expected")).toContainText("C < D");
});

test("listening prompt renders ordinary punctuation as text", async ({page}) => {
  await page.route("**/api/listening", route => route.fulfill({json: {questions: [{card_id: 1, word: "apple", meaning: "A & B < C", options: ["apple", "pear"]}]}}));
  await page.route("**/api/tts/**", route => route.fulfill({status: 503, body: "unavailable"}));
  await ui.mount(page, "/src/views/ListeningPage.jsx");
  await expect(page.locator(".listening-meaning")).toHaveText("A & B < C");
});

test("partially confirmed feedback keeps its target identities after a reload", async ({page}) => {
  await page.addInitScript(() => {
    const key = "ec.contact.lookup:partial-reload";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({awaiting_targets: true, source: "scene", text: "apple pear"}));
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "ec.contact.scene:answer_visible:2") throw new DOMException("quota", "QuotaExceededError");
      return nativeSet.call(this, key, value);
    };
  });
  const posts = [];
  let failedPear = false;
  await page.route("**/api/**", route => {
    if (new URL(route.request().url()).pathname === "/api/cards") return route.fulfill({json: {cards: [1, 2].map(id => ({id, kind: "word", word: id === 1 ? "apple" : "pear", content_revision: {identity: `target-${id}`, version: 1}}))}});
    const body = route.request().postDataJSON(); posts.push(body);
    if (body.card_id === 2 && !failedPear) {failedPear = true; return route.fulfill({status: 503, json: {detail: "offline"}});}
    return route.fulfill({json: {committed: true}});
  });
  await ui.mount(page, "/src/components/ContactRecovery.jsx");
  await page.getByRole("button", {name: "继续确认反馈接触", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("浏览器未能保存");
  await page.reload();
  await page.getByRole("button", {name: "继续确认反馈接触", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续确认反馈接触", exact: true})).toHaveCount(0);
  expect(posts.filter(row => row.card_id === 1)).toHaveLength(1);
  const pear = posts.filter(row => row.card_id === 2);
  expect(pear).toHaveLength(2);
  expect(pear[0].submission_id).toBe(pear[1].submission_id);
});

for (const screen of ["recovery", "feedback"]) {
  test(`outdated feedback contact settles honestly in ${screen}`, async ({page}) => {
    if (screen === "recovery") await page.addInitScript(() => localStorage.setItem("ec.contact.lookup:terminal-ui", JSON.stringify({awaiting_targets: true, source: "scene", text: "apple"})));
    let posts = 0;
    await page.route("**/api/**", route => {
      if (new URL(route.request().url()).pathname === "/api/cards") return route.fulfill({json: {cards: [{id: 1, kind: "word", word: "apple", content_revision: {identity: "old", version: 1}}]}});
      posts++; return route.fulfill({status: 409, json: {detail: "content changed"}});
    });
    if (screen === "recovery") {
      await ui.mount(page, "/src/components/ContactRecovery.jsx");
      await page.getByRole("button", {name: "继续确认反馈接触", exact: true}).click();
    } else {
      await ui.mount(page, "/src/components/SceneFeedback.jsx", JSON.stringify({session: {id: "scene", content_hash: "hash"}, item: {id: "item", attempt_id: "attempt", feedback: {text: "apple", origin: "template"}}}));
    }
    await expect(page.getByText("部分反馈目标已删除或修订，该次接触未记录；请重新查看当前内容。", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: /继续确认.*接触/})).toHaveCount(0);
    expect(posts).toBe(1);
  });
}
