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

test("EC-12 confirmed restore discards frozen daily and single-card practice", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "ec12-full.json"});
  const backup = await snapshot(source);
  backup.exported_at = "2026-10-30T12:00:00+00:00";
  const target = await appFactory();
  const oldIds = await target.seedCards([{word: "obsolete", meaning: "旧词"}, {word: "retired", meaning: "旧队列"}]);
  await target.setTime("2026-11-30T12:00:00Z");
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("obsolete");
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续本轮学习", exact: true})).toBeVisible();
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "obsolete"}).click();
  await page.getByRole("button", {name: /测这个词/}).click();
  await expect(page.locator(".study-count")).toHaveText("1 / 1");
  // Settings detour deliberately keeps App mounted with both old practice states.
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await upload(page, backup);
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await expect(page.locator(".today-stats")).toBeVisible();
  await expect(page.getByRole("button", {name: "继续本轮学习", exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("activeDailySession")))).toBeNull();
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("apple");
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("heading", {name: "本轮主队列已保存", exact: true})).toBeVisible();
  const restored = await snapshot(target);
  expect(restored.cards.every(card => !oldIds.includes(card.id))).toBe(true);
  expect(restored.learning_events.filter(event => event.stage === "main")).toHaveLength(1);
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByRole("button", {name: /拼写练习/}).click();
  await expect(page.getByText("旧词", {exact: true})).toHaveCount(0);
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect.poll(async () => (await snapshot(target)).learning_events.filter(event => event.source === "spelling").length).toBe(1);
});

test("EC-12 pending restore keeps navigation locked until its response arrives", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "ec12-full.json"});
  const backup = await snapshot(source);
  backup.exported_at = "2026-10-30T12:00:00+00:00";
  const target = await appFactory();
  await target.seedCards([{word: "obsolete"}]);
  await target.setTime("2026-11-30T12:00:00Z");
  let release;
  let committed = false;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/api/import/cards", async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed = true;
    await held;
    await route.fulfill({response});
  });
  await openBackup(target, page);
  await upload(page, backup);
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  try {
    await expect.poll(() => committed).toBe(true);
    await expect(page.getByRole("button", {name: "设置", exact: true})).toBeDisabled();
    await expect(page.getByRole("button", {name: "返回设置", exact: true})).toBeDisabled();
    for (const button of await page.locator(".bottom-nav button").all()) await expect(button).toBeDisabled();
    await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await expect(page.getByRole("button", {name: "设置", exact: true})).toBeEnabled();
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("apple");
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("apple");
});

for (const outcome of ["failed", "unknown"]) {
  test(`EC-12 ${outcome} restore unlocks recovery navigation`, async ({appFactory, page}) => {
    const source = await appFactory({fixture: "ec12-full.json"});
    const target = await appFactory();
    await target.seedCards([{word: "keep"}]);
    await openBackup(target, page);
    const backup = await snapshot(source);
    backup.exported_at = "2026-10-30T12:00:00+00:00";
    await upload(page, backup);
    if (outcome === "failed") await target.failCommitOnce();
    else await page.route("**/api/import/cards", async route => { await route.fetch(); await route.abort("failed"); }, {times: 1});
    await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText(outcome === "failed" ? "恢复失败" : "恢复尚未确认");
    await expect(page.getByRole("button", {name: "设置", exact: true})).toBeEnabled();
    await expect(page.getByRole("button", {name: "返回设置", exact: true})).toBeEnabled();
    for (const button of await page.locator(".bottom-nav button").all()) await expect(button).toBeEnabled();
    await page.getByRole("button", {name: "返回设置", exact: true}).click();
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await expect(page.locator(".today-stats")).toBeVisible();
  });
}
