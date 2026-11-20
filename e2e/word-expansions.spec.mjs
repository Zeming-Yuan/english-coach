import {createRequire} from "node:module";
import {startSourceUI} from "./support/source-ui.mjs";
const {test, expect} = createRequire(new URL("../frontend/package.json", import.meta.url))("@playwright/test");
test.setTimeout(20000);
let ui;
test.beforeAll(async () => { ui = await startSourceUI(); });
test.afterAll(async () => { await ui?.close(); });

const card = (id = 1, extra = {}) => ({id, word: id === 1 ? "unhappy" : "happy", kind: "word", meaning: "不高兴的", example: "He is unhappy.", example_cn: "他不高兴。", content_revision: {identity: `revision-${id}`, version: 1}, related_words: [], ...extra});
async function mount(page, cards, expansion) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/expansions")) return expansion(route);
    if (path === "/api/cards") return route.fulfill({json: {cards}});
    const found = cards.find(c => path === `/api/cards/${c.id}`);
    if (found) return route.fulfill({json: found});
    if (path === "/api/learning-observations/contacts") return route.fulfill({json: {committed: true}});
    return route.fulfill({json: {}});
  });
  await ui.mount(page, "/src/views/WordsPage.jsx");
  if (cards[0].kind === "sentence") await page.getByRole("button", {name: "句子", exact: true}).click();
  await page.locator(".word-item").filter({hasText: "unhappy"}).click();
}

test("word expansions show formation and grouped Chinese meanings before examples", async ({page}) => {
  await mount(page, [card(1, {related_words: [
    {kind: "formation", text: "un-（不） + happy（高兴的）"},
    {kind: "family", word: "happiness", meaning: "幸福"},
    {kind: "affix", word: "unfair", meaning: "不公平的"},
    {kind: "compound", word: "happy-hour", meaning: "欢乐时光"},
    {kind: "synonym", word: "sad", meaning: "难过的"},
    {kind: "lookalike", word: "happen", meaning: "发生"},
    {word: "glad", meaning: "高兴的"},
  ]})]);
  const section = page.getByRole("region", {name: "构词与扩展"});
  await expect(section).toContainText("构词拆解");
  await expect(section).toContainText("un-（不） + happy（高兴的）");
  for (const label of ["同词族", "同词缀", "复合词", "近义词", "形近词", "相关词"]) await expect(section).toContainText(label);
  await expect(section).toContainText("happiness幸福");
  await expect(page.getByRole("button", {name: "补全扩展词", exact: true})).toHaveCount(0);
  expect(await section.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector(".word-detail-example")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

test("legacy words remain visible while expansion generation can fail and retry without changing revision", async ({page}) => {
  let requests = 0;
  await mount(page, [card(1, {related_words: [{word: "glad", meaning: "高兴的"}]})], route => {
    expect(route.request().method()).toBe("POST");
    requests++;
    return requests === 1 ? route.fulfill({status: 503, json: {detail: "暂时不可用"}}) : route.fulfill({json: {related_words: [{kind: "family", word: "happiness", meaning: "幸福"}]}});
  });
  await expect(page.getByRole("region", {name: "构词与扩展"})).toContainText("glad");
  await page.getByRole("button", {name: "补全扩展词", exact: true}).click();
  await expect(page.getByRole("alert").filter({hasText: "暂时不可用"})).toBeVisible();
  await page.getByRole("button", {name: "重试补全扩展词", exact: true}).click();
  await expect(page.getByRole("region", {name: "构词与扩展"})).toContainText("happiness");
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");
});

test("late expansion response cannot replace the next card", async ({page}) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await mount(page, [card(), card(2)], async route => {
    await pending;
    await route.fulfill({json: {related_words: [{kind: "family", word: "stale-word", meaning: "旧内容"}]}});
  });
  await page.getByRole("button", {name: "补全扩展词", exact: true}).click();
  await expect(page.getByRole("button", {name: "补全中…", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "← 上一个", exact: true}).click();
  await expect(page.locator(".word-detail-word")).toHaveText("happy");
  const responded = page.waitForResponse(response => response.url().endsWith("/api/cards/1/expansions"));
  release();
  await responded;
  await expect(page.getByRole("region", {name: "构词与扩展"})).not.toContainText("stale-word");
  await expect(page.getByRole("button", {name: "补全扩展词", exact: true})).toBeEnabled();
});

test("sentence details have no expansion section", async ({page}) => {
  await mount(page, [card(1, {kind: "sentence"})]);
  await expect(page.locator(".word-detail-word")).toBeVisible();
  await expect(page.getByRole("region", {name: "构词与扩展"})).toHaveCount(0);
});

test("expansion conflict reloads current content and sends the displayed revision", async ({page}) => {
  const cards = [card()];
  await mount(page, cards, route => {
    expect(route.request().postDataJSON()).toEqual({identity: "revision-1", version: 1});
    cards[0] = card(1, {meaning: "最新释义", content_revision: {identity: "revision-1", version: 2}});
    return route.fulfill({status: 409, json: {detail: "conflict"}});
  });
  await page.getByRole("button", {name: "补全扩展词", exact: true}).click();
  await expect(page.locator(".word-detail-meaning")).toHaveText("最新释义");
  await expect(page.getByTestId("revision-panel")).toContainText("第 2 版");
  await expect(page.getByRole("button", {name: "补全扩展词", exact: true})).toBeEnabled();
});

test("formation-only cards remain eligible and empty generated material offers retry", async ({page}) => {
  await mount(page, [card(1, {related_words: [{kind: "formation", text: "un- + happy"}]})], route => route.fulfill({json: {related_words: []}}));
  await expect(page.getByRole("region", {name: "构词与扩展"})).toContainText("un- + happy");
  await page.getByRole("button", {name: "补全扩展词", exact: true}).click();
  await expect(page.getByRole("alert").filter({hasText: "返回内容不完整"})).toBeVisible();
  await expect(page.getByRole("button", {name: "重试补全扩展词", exact: true})).toBeEnabled();
});
