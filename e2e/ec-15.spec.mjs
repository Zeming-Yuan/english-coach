import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test, expect} from "./support/test.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

async function backup(app) {
  return (await app.request.get("/api/export/backup")).json();
}
async function openBackup(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
}
async function detail(app, id) {
  return (await app.request.get(`/api/cards/${id}`)).json();
}

test.beforeEach(async ({page}) => {
  await page.route("**/api/tts/**", route => route.abort("failed"));
});

test("EC-15 details-stats-story-backup-restore-delete-agree", async ({appFactory, page}, testInfo) => {
  // Replace only the external OpenAI-compatible transport, never application APIs.
  let picked = [];
  const llm = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    picked = JSON.parse(JSON.parse(body).messages[1].content).words;
    const content = JSON.stringify({title: "Contract story", title_cn: "故事", sentences: [{en: picked.join(" "), cn: "故事"}], words: []});
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({choices: [{message: {content}}]}));
  });
  await new Promise(resolve => llm.listen(0, "127.0.0.1", resolve));
  try {
    const config = testInfo.outputPath("llm-fixture.json");
    await fs.mkdir(path.dirname(config), {recursive: true});
    await fs.writeFile(config, JSON.stringify({settings: {llm_api_key: "isolated-test-key", llm_base_url: `http://127.0.0.1:${llm.address().port}/v1`}}));
    const app = await appFactory({fixture: path.relative(fixtures, config)});
    const [id] = await app.seedCards(["apple", "book", "cat", "dog"].map(word => ({word, meaning: word})));
    await page.goto(app.baseURL);
    await page.getByRole("button", {name: /单词本/}).click();
    await page.locator(".word-item", {hasText: "apple"}).first().click();
    await page.getByTestId("rate-good").click();
    await expect.poll(async () => (await detail(app, id)).learning_events.length).toBe(1);
    const d = await detail(app, id);
    const b = await backup(app);
    expect(b.reviews).toHaveLength(1);
    expect(b.learning_events).toHaveLength(1);
    expect(d.memory_state.review_count).toBe(1);
    expect((await (await app.request.get("/api/stats")).json()).reviewed_today).toBe(1);
    for (const url of ["/api/export/cards", "/api/today", "/api/recommended", "/api/stats/history", "/api/stats/weekly"]) {
      expect((await app.request.get(url)).status()).toBe(200);
    }
    const story = await app.request.post("/api/stories/generate");
    expect(story.status()).toBe(200);
    expect(picked).toEqual(["book", "cat", "dog"]);
    expect((await story.json()).words.map(word => word.word)).toEqual(picked);
    await openBackup(app, page);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", {name: "下载完整备份", exact: true}).click();
    const file = await (await downloading).path();
    const target = await appFactory();
    await openBackup(target, page);
    await page.getByLabel("选择备份文件").setInputFiles(file);
    await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
    await expect(page.getByRole("status")).toContainText("恢复成功");
    const restored = await backup(target);
    const apple = restored.cards.find(card => card.word === "apple");
    expect(restored.reviews).toHaveLength(1);
    expect(restored.learning_events).toHaveLength(1);
    expect(restored.stories).toHaveLength(1);
    expect((await detail(target, apple.id)).memory_state).toEqual(d.memory_state);
    expect((await target.request.delete(`/api/cards/${apple.id}`)).status()).toBe(200);
    expect((await target.request.get(`/api/cards/${apple.id}`)).status()).toBe(404);
    const afterDelete = await backup(target);
    for (const name of ["reviews", "learning_events", "review_baselines", "memos", "errors", "hard_cards", "story_words"]) {
      expect(afterDelete[name].some(row => row.card_id === apple.id)).toBe(false);
    }
    expect((await (await target.request.get("/api/stats")).json()).reviewed_today).toBe(0);
    expect((await target.request.get("/api/stories")).status()).toBe(200);
  } finally {
    await new Promise(resolve => llm.close(resolve));
  }
});

test("EC-15 legacy-restore-then-input-and-choice-share-current-state", async ({app, page}) => {
  await openBackup(app, page);
  await page.getByLabel("选择备份文件").setInputFiles(path.join(fixtures, "ec11-legacy.json"));
  await page.getByRole("button", {name: "确认恢复包含的内容"}).click();
  await expect(page.getByText(/恢复完成/)).toBeVisible();
  const imported = await backup(app);
  const apple = imported.cards.find(card => card.kind === "word");
  expect(imported.reviews).toHaveLength(1);
  expect(imported.learning_events).toHaveLength(0);
  expect(imported.review_baselines).toHaveLength(1);
  expect((await detail(app, apple.id)).history_incomplete).toBe(true);
  await page.goto(app.baseURL);
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByRole("button", {name: /拼写练习/}).click();
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存");
  const typed = await detail(app, apple.id);
  expect(typed.memory_state.review_count).toBe(3);
  expect(typed.graduated).toBe(true);
  expect((await (await app.request.get("/api/stats")).json()).graduated).toBe(1);
  await app.seedCards([{word: "book"}, {word: "cat"}, {word: "dog"}]);
  await page.goto(app.baseURL);
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByRole("button", {name: /听写练习/}).click();
  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const end = await backup(app);
  expect(end.reviews).toHaveLength(1);
  expect(end.learning_events).toHaveLength(2);
  expect(end.learning_events.filter(event => !event.scheduled)).toHaveLength(1);
  expect((await detail(app, apple.id)).memory_state).toEqual(typed.memory_state);
});
