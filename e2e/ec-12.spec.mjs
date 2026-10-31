import {test, expect} from "./support/test.mjs";

async function openBackup(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
}

async function upload(page, backup) {
  await page.getByLabel("选择备份文件").setInputFiles({name: "full.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
}

async function snapshot(app) {
  const payload = await (await app.request.get("/api/export/backup")).json();
  delete payload.exported_at;
  return payload;
}

test("EC-12 restore-other-instance-and-continue", async ({appFactory, page}, testInfo) => {
  const a = await appFactory({fixture: "ec12-full.json"});
  await openBackup(a, page);
  const original = await snapshot(a);
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "下载完整备份", exact: true}).click();
  const file = await (await download).path();
  const b = await appFactory();
  await b.seedCards([{id: 900, word: "target-only"}]);
  await openBackup(b, page);
  await page.getByLabel("选择备份文件").setInputFiles(file);
  await expect(page.getByText("全量恢复", {exact: true})).toBeVisible();
  await expect(page.getByText(/现有数据库学习内容将被备份替换/)).toBeVisible();
  expect((await snapshot(b)).cards[0].word).toBe("target-only");
  const confirm = page.getByRole("button", {name: "确认替换学习数据", exact: true});
  await confirm.focus();
  await page.screenshot({path: testInfo.outputPath("full-preview.png"), fullPage: true});
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await expect(page.getByRole("status")).toContainText("before-restore-");
  let restored = await snapshot(b);
  expect(restored.cards.filter(c => c.word === "apple")).toHaveLength(2);
  for (const name of ["reviews", "learning_events", "review_baselines", "memos", "errors", "hard_cards", "lessons", "stories", "story_words"]) {
    expect(restored[name]).toHaveLength(original[name].length);
  }
  const word = restored.cards.find(c => c.kind === "word");
  const sentence = restored.cards.find(c => c.kind === "sentence");
  expect(word.id).not.toBe(101);
  expect(restored.story_words.map(row => row.card_id).sort()).toEqual([word.id, sentence.id].sort());
  expect(restored.learning_events[0].response.sentence_card_id).toBe(sentence.id);
  const event = original.learning_events[0];
  const replay = await b.request.post("/api/reviews", {data: {...event.command_json, card_id: word.id}});
  expect(replay.status()).toBe(200);
  expect((await snapshot(b)).learning_events).toHaveLength(1);
  // A second replacement is equivalent after ID remapping, then UI saves one new rating.
  await page.getByLabel("选择备份文件").setInputFiles(file);
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  restored = await snapshot(b);
  expect(restored.learning_events).toHaveLength(1);
  const currentWord = restored.cards.find(c => c.kind === "word");
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).first().click();
  await page.getByTestId("rate-good").click();
  await expect.poll(async () => (await (await b.request.get(`/api/cards/${currentWord.id}`)).json()).learning_events.length).toBe(2);
});


test("EC-12 lost-restore-response-requires-fresh-preview", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "ec12-full.json"});
  const backup = await snapshot(source);
  backup.exported_at = "2026-10-30T12:00:00+00:00";
  const target = await appFactory();
  await openBackup(target, page);
  await upload(page, backup);
  await page.route("**/api/import/cards", async route => { await route.fetch(); await route.abort("failed"); }, {times: 1});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("恢复尚未确认");
  await expect(page.getByRole("status")).toHaveCount(0);
  expect((await snapshot(target)).cards).toHaveLength(2);
  await page.getByRole("button", {name: "取消", exact: true}).click();
  expect((await snapshot(target)).learning_events).toHaveLength(1);
});

test("EC-12 cancel-empty-replace-and-confirm-empty", async ({appFactory, page}) => {
  const empty = await appFactory();
  const backup = await snapshot(empty);
  backup.exported_at = "2026-10-30T12:00:00+00:00";
  const target = await appFactory({fixture: "ec12-full.json"});
  const before = await snapshot(target);
  await openBackup(target, page);
  await upload(page, backup);
  await expect(page.getByText(/这是空备份/)).toBeVisible();
  const cancel = page.getByRole("button", {name: "取消", exact: true});
  await cancel.focus();
  await page.keyboard.press("Enter");
  expect(await snapshot(target)).toEqual(before);
  await upload(page, backup);
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  expect((await snapshot(target)).cards).toHaveLength(0);
  expect((await snapshot(target)).stories).toHaveLength(0);
});

test("EC-12 invalid-graph-rollback-and-preview-conflict", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "ec12-full.json"});
  const backup = await snapshot(source);
  backup.exported_at = "2026-10-30T12:00:00+00:00";
  const target = await appFactory();
  const [id] = await target.seedCards([{word: "keep"}]);
  const before = await snapshot(target);
  await openBackup(target, page);
  await upload(page, {...backup, story_words: [{id: 1, card_id: 999, story_id: 999}]});
  await expect(page.getByRole("alert")).toContainText("不存在");
  expect(await snapshot(target)).toEqual(before);
  await upload(page, backup);
  await target.failCommitOnce();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("原数据未改变");
  expect(await snapshot(target)).toEqual(before);
  const attempt = await target.request.post("/api/reviews", {data: {card_id: id, rating: 3, source: "study"}});
  expect(attempt.status()).toBe(200);
  const progressed = await snapshot(target);
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("数据已有新变化");
  expect(await snapshot(target)).toEqual(progressed);
  await page.getByRole("button", {name: "取消", exact: true}).click();
  expect(await snapshot(target)).toEqual(progressed);
});
