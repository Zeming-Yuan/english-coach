import {test, expect} from "./support/test.mjs";

async function failed(app) {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  return id;
}

async function stats(page, app) {
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("learning-advice")).toBeVisible();
}

async function observeReportText(page) {
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    window.reportText = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.reportText.push(text);
      return fillText.call(this, text, ...args);
    };
  });
}

async function downloadReport(page, inventory, filename) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "成绩单", exact: true}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("englishcoach_report.png");
  expect(await download.failure()).toBeNull();
  if (filename) await download.saveAs(test.info().outputPath(filename));
  await expect(page.getByTestId("export-summary")).toContainText(inventory);
  expect(await page.evaluate(() => window.reportText)).toContain(inventory);
}

async function backup(app) {
  const response = await app.request.get("/api/export/backup");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("S95-12 three inventories agree and the first screen opens dog practice", async ({appFactory, page}) => {
  const app = await appFactory();
  const [dog] = await app.seedCards([
    {word: "dog", meaning: "狗", example: "I have a dog.", example_cn: "我有一只狗。"},
    ...["apple", "book", "cat", "door", "egg", "fish", "glass", "house", "ice"].map(word => ({word, meaning: word})),
  ]);
  for (let i = 0; i < 3; i += 1) {
    expect((await app.request.post("/api/reviews", {data: {
      card_id: dog, rating: 3, source: "study", submission_id: crypto.randomUUID(),
    }})).ok()).toBeTruthy();
  }
  const detail = await (await app.request.get(`/api/cards/${dog}`)).json();
  expect(detail.sentence_card_id).not.toBeNull();
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: dog, user_input: "dig", source: "spelling", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  expect(await (await app.request.get("/api/stats")).json()).toMatchObject({
    word_cards: 10, sentence_cards: 1, total_cards: 11, graduated: 1,
  });
  const before = await backup(app);
  const inventory = "10 个词 · 1 张句子卡";
  await observeReportText(page);
  await page.goto(app.baseURL);
  await expect(page.locator(".home-record-total")).toContainText(inventory);
  await page.getByRole("button", {name: "查看学习记录", exact: true}).click();
  await expect(page.locator(".stats-grid")).toContainText(inventory);

  const advice = page.getByTestId("learning-advice");
  const startDog = advice.getByRole("button", {name: "开始建议练习", exact: true});
  await expect(startDog).toBeInViewport({ratio: 1});
  await expect(advice).toContainText("独立首答未答对");
  await expect(advice).toContainText("狗");
  await expect(advice).not.toContainText(/\bdog\b/i);
  await page.screenshot({path: test.info().outputPath("records-first-screen.png")});
  await downloadReport(page, inventory, "englishcoach_report.png");
  const afterReading = await backup(app);
  expect(afterReading.learning_events).toEqual(before.learning_events);
  expect(afterReading.extensions.learning_contacts).toEqual(before.extensions.learning_contacts);
  expect(afterReading.extensions.practice_sessions).toEqual(before.extensions.practice_sessions);

  await startDog.click();
  const practice = page.getByTestId("practice-session");
  await expect(practice).toContainText("狗");
  await expect(practice).not.toContainText(/\bdog\b/i);
  await page.getByRole("textbox", {name: "英文答案"}).fill("dog");
  await page.getByRole("button", {name: "提交", exact: true}).click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const afterPractice = await backup(app);
  const targeted = afterPractice.extensions.practice_sessions.filter(row => row.purpose === "targeted");
  expect(targeted).toHaveLength(1);
  expect(afterPractice.extensions.practice_items
    .filter(row => row.session_id === targeted[0].session_id).map(row => row.card_id)).toEqual([dog]);
  expect(afterPractice.learning_events.filter(row => row.card_id === dog && row.kind === "typed")
    .map(row => row.correct)).toEqual([false, true]);
  await page.screenshot({path: test.info().outputPath("dog-practice.png")});
});

test("S95-12 empty and sentence-only inventories use the current export data", async ({app, page}) => {
  const empty = "0 个词 · 0 张句子卡";
  const sentenceOnly = "0 个词 · 1 张句子卡";
  await observeReportText(page);
  await page.goto(app.baseURL);
  await expect(page.locator(".home-record-total")).toContainText(empty);
  await page.getByRole("button", {name: "查看学习记录", exact: true}).click();
  await expect(page.locator(".stats-grid")).toContainText(empty);
  const advice = page.getByTestId("learning-advice");
  await expect(advice).toContainText("暂无数据不代表能力不足");
  await expect(advice.getByRole("button", {name: "开始建议练习", exact: true})).toHaveCount(0);
  await downloadReport(page, empty, "empty-report.png");

  // Another writer adds a sentence after this page loaded.
  await app.seedCards([{word: "dog", kind: "sentence", meaning: "我有一只狗。", example: "I have a dog."}]);
  await expect(page.locator(".stats-grid")).toContainText(empty);
  await downloadReport(page, sentenceOnly, "sentence-only-report.png");
  await expect(page.locator(".stats-grid")).toContainText(sentenceOnly);
  await page.goto(app.baseURL);
  await expect(page.locator(".home-record-total")).toContainText(sentenceOnly);
  await page.getByRole("button", {name: "查看学习记录", exact: true}).click();
  await expect(advice).toContainText("暂无数据不代表能力不足");
  await expect(advice.getByRole("button", {name: "开始建议练习", exact: true})).toHaveCount(0);
  expect((await backup(app)).learning_events).toEqual([]);
});

test("S95-12 unavailable export statistics do not produce a stale report", async ({app, page}) => {
  await observeReportText(page);
  await stats(page, app);
  await downloadReport(page, "0 个词 · 0 张句子卡");
  await app.seedCards([{word: "dog", meaning: "狗"}]);
  await page.route("**/api/stats", route => route.fulfill({status: 503, json: {detail: "unavailable"}}), {times: 1});
  const downloads = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", {name: "成绩单", exact: true}).click();
  await expect(page.getByText("无法读取最新统计，请重试导出", {exact: true})).toBeVisible();
  await expect(page.getByTestId("export-summary")).toHaveCount(0);
  expect(downloads).toEqual([]);
  await downloadReport(page, "1 个词 · 0 张句子卡");
});

test("EL-10 failed advice starts the exact independent practice", async ({appFactory, page}) => {
  const app = await appFactory();
  const id = await failed(app);
  await stats(page, app);
  const advice = page.getByTestId("learning-advice");
  await expect(advice).toContainText("独立首答未答对");
  await expect(advice).toContainText("苹果");
  await expect(advice).not.toContainText("apple");
  await advice.getByRole("button", {name: "开始建议练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("专项练习");
  await page.getByRole("textbox", {name: "英文答案"}).fill("apple");
  await page.getByRole("button", {name: "提交", exact: true}).click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  const run = backup.extensions.practice_sessions.find(row => row.purpose === "targeted");
  expect(backup.extensions.practice_items.filter(row => row.session_id === run.session_id).map(row => row.card_id)).toEqual([id]);
  await page.screenshot({path: test.info().outputPath("targeted-result.png"), fullPage: true});
});

async function delayed(app, {id = null, word = "apple"} = {}) {
  if (!id) [id] = await app.seedCards([{word, meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: word, source: "spelling", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect((await app.request.post("/api/learning/contacts", {data: {
    card_id: id, revision: detail.content_revision, source: "card_detail", kind: "answer_visible", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  await app.setTime("2026-10-08T01:00:00Z");
  return id;
}

async function start(page) {
  await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toBeVisible();
}

async function submit(page) {
  await page.getByRole("textbox", {name: "英文答案"}).fill("apple");
  await page.getByRole("button", {name: "提交", exact: true}).click();
}

test("EL-10 assisted-only advice remains separate from independent recall", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: "apple", source: "spelling", assistance: ["first_letter"], submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  await stats(page, app);
  await expect(page.getByTestId("learning-advice")).toContainText("已有辅助成功");
  await expect(page.getByTestId("learning-advice")).toContainText("依据 0 个样本");
  await start(page);
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
});

test("EL-10 no evidence explains uncertainty without diagnosing weakness", async ({appFactory, page}) => {
  const app = await appFactory();
  const [apple] = await app.seedCards([
    {word: "apple", meaning: "苹果"}, {word: "dog", meaning: "狗"},
    {word: "cat", meaning: "猫"}, {word: "book", meaning: "书"},
  ]);
  for (const review of [{rating: 1}, {skipped: true}]) {
    expect((await app.request.post("/api/reviews", {data: {
      card_id: apple, source: "study", kind: "self_rating", submission_id: crypto.randomUUID(), ...review,
    }})).ok()).toBeTruthy();
  }
  const {questions: [question]} = await (await app.request.get("/api/listening?limit=1")).json();
  expect((await app.request.post("/api/listening/score", {data: {
    card_id: question.card_id, answer: question.options.find(option => option !== question.word),
    question_token: question.question_token, source: "listening", kind: "choice", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  await stats(page, app);
  await expect(page.getByTestId("learning-advice")).toContainText("暂无数据不代表能力不足");
  await expect(page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true})).toHaveCount(0);
});

for (const change of ["revision", "deletion"]) {
  test(`EL-10 ${change} before entry explains original target unavailable`, async ({appFactory, page}) => {
    const app = await appFactory();
    const id = await failed(app);
    await stats(page, app);
    if (change === "revision") expect((await app.request.put(`/api/cards/${id}`, {data: {meaning: "新释义"}})).ok()).toBeTruthy();
    else expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
    await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText(change === "revision" ? "已修订" : "已删除");
    await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveCount(0);
    await page.getByRole("button", {name: "返回建议", exact: true}).click();
    await expect(page.getByTestId("learning-advice")).toContainText("暂无数据");
  });
}

test("EL-10 delayed advice hides answers and reveal recalculates eligibility", async ({appFactory, page}) => {
  const app = await appFactory();
  const id = await delayed(app);
  await stats(page, app);
  const advice = page.getByTestId("learning-advice");
  await expect(advice).toContainText("一周回测");
  await expect(advice).not.toContainText("apple");
  const before = (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length;
  await advice.getByRole("button", {name: "展开英文答案（会重算回测资格）", exact: true}).click();
  await expect.poll(async () => (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length).toBe(before + 1);
  await expect(advice).toContainText("暂无数据");
  expect((await (await app.request.get(`/api/cards/${id}`)).json()).learning_events).toHaveLength(1);
});

test("EL-10 delayed suggestion starts its exact window and records retention", async ({appFactory, page}) => {
  const app = await appFactory();
  await delayed(app);
  await stats(page, app);
  await start(page);
  await expect(page.getByTestId("practice-session")).toContainText("168 小时");
  await expect(page.getByTestId("practice-session")).not.toContainText("apple");
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  expect((await (await app.request.get("/api/stats")).json()).retention.week.count).toBe(1);
});

for (const mode of ["lost-response", "commit-failure"]) {
  test(`EL-10 ${mode} keeps answer and confirms one targeted event`, async ({appFactory, page}) => {
    const app = await appFactory();
    const id = await failed(app);
    await stats(page, app);
    await start(page);
    let submissionId;
    await page.route("**/api/practice-sessions/*/items/*/attempts", async route => {
      submissionId = route.request().postDataJSON().submission_id;
      if (mode === "lost-response") {await route.fetch(); await route.abort("failed");}
      else await route.continue();
    }, {times: 1});
    if (mode === "commit-failure") await app.failCommitOnce();
    await submit(page);
    await expect(page.locator(".practice-item").getByRole("alert")).toBeVisible();
    await page.goto(`${app.baseURL}/#/stats`);
    await page.reload();
    await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
    if (mode === "commit-failure") {
      await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveValue("apple");
      await page.locator(".practice-item").getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.getByText("✅ 正确！")).toBeVisible();
    } else {
      await expect(page.getByTestId("practice-session")).toContainText("通过 1");
      // 已保存但丢失的响应仍能使用原 pending 身份确认。
      await page.getByRole("button", {name: "← 返回建议", exact: true}).click();
      await page.locator(".pending-recovery").getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.locator(".pending-recovery")).toHaveCount(0);
    }
    const backup = await (await app.request.get("/api/export/backup")).json();
    expect(backup.learning_events.filter(row => row.submission_id === submissionId)).toHaveLength(1);
    expect(backup.learning_events.filter(row => row.card_id === id)).toHaveLength(2);
  });
}

test("EL-10 lost creation response continues the same frozen round", async ({appFactory, page}) => {
  const app = await appFactory();
  await failed(app);
  await stats(page, app);
  let identity;
  await page.route("**/api/practice-sessions", async route => {
    identity = route.request().postDataJSON().id;
    await route.fetch();
    await route.abort("failed");
  }, {times: 1});
  await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto(`${app.baseURL}/#/stats`);
  await page.reload();
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.extensions.practice_sessions.filter(row => row.session_id === identity)).toHaveLength(1);
});

test("EL-10 course shows its own short check and delayed samples", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el06-lesson-dialogue.json"});
  await delayed(app, {id: 1});
  await stats(page, app);
  await expect(page.getByTestId("learning-advice")).toContainText("第 1 课");
  await start(page);
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await page.goto(app.baseURL);
  if (await page.getByText("专项练习", {exact: true}).locator("..").getAttribute("open") === null) await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  const lesson = page.locator(".lesson-list-item").first();
  await expect(lesson).toContainText("短测：尚无");
  await expect(lesson.getByTestId("lesson-retention")).toContainText("本课一周回测：独立成功/样本 1/1");
  await lesson.click();
  await expect(page.getByTestId("lesson-progress")).toContainText("尚无（待检查）");
  await expect(page.getByTestId("lesson-retention")).toContainText("独立成功/样本 1/1");
  await page.screenshot({path: test.info().outputPath("course-retention.png"), fullPage: true});
});

test("EL-10 deleted frozen pool offers a return without a fake pass", async ({appFactory, page}) => {
  const app = await appFactory();
  const id = await failed(app);
  await stats(page, app);
  await start(page);
  expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
  await page.goto(`${app.baseURL}/#/stats`);
  await page.reload();
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("原目标已不可用");
  await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveCount(0);
  await expect(page.getByTestId("practice-session")).not.toContainText("专项练习：通过");
  await page.getByRole("button", {name: "返回建议", exact: true}).click();
  await expect(page.getByTestId("learning-advice")).toBeVisible();
});

test("EL-10 V3 restore resumes the original targeted round", async ({appFactory, page}) => {
  const source = await appFactory();
  await failed(source);
  await stats(page, source);
  await start(page);
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await target.seedCards([
    {id: 900, word: "reserved", meaning: "保留"},
    {word: "reserved", kind: "sentence", meaning: "已被预订", example: "It is reserved."},
  ]);
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "targeted-v3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.goto(target.baseURL);
  await expect(page.locator(".home-record-total")).toContainText("1 个词 · 0 张句子卡");
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  expect((await (await target.request.get("/api/export/backup")).json()).extensions.practice_sessions).toHaveLength(1);
});

test("EL-10 functional rollback keeps evidence and hides advice", async ({appFactory, page}) => {
  const source = await appFactory();
  await failed(source);
  await stats(page, source);
  await start(page);
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory({fixture: "el10-rollback.json"});
  const preview = await (await target.request.post("/api/import/preview", {data: backup})).json();
  expect((await target.request.post("/api/import/cards", {data: {backup, expected_revision: preview.expected_revision}})).ok()).toBeTruthy();
  await page.goto(target.baseURL);
  await expect(page.getByTestId("learning-advice")).toHaveCount(0);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("learning-advice")).toHaveCount(0);
  await expect(page.getByTestId("evidence-overview")).toContainText("独立样本");
  const current = await (await target.request.get("/api/export/backup")).json();
  expect(current.learning_events).toHaveLength(backup.learning_events.length);
  expect(current.extensions.practice_sessions[0].purpose).toBe("targeted");
});

test("EL-10 unavailable browser storage explains creation recovery limits", async ({appFactory, page}) => {
  const app = await appFactory();
  await failed(app);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "ec.advice.request") throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  await stats(page, app);
  await start(page);
  await expect(page.getByRole("note")).toContainText("浏览器未保存轮次标识");
});

test("EL-10 same-browser restore replaces stale advice entry with imported round", async ({appFactory, page}) => {
  const source = await appFactory();
  const sourceId = await failed(source);
  const advice = (await (await source.request.get("/api/learning/recommendations")).json()).suggestions[0];
  const imported = await (await source.request.post("/api/practice-sessions", {data: {
    id: crypto.randomUUID(), purpose: advice.purpose, targets: advice.targets, card_ids: advice.card_ids,
  }})).json();
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await failed(target);
  await stats(page, target);
  await start(page);
  const oldId = await page.evaluate(() => JSON.parse(localStorage.getItem("ec.advice.request")).id);
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.goto(target.baseURL);
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toBeVisible();
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const restored = await (await target.request.get("/api/export/backup")).json();
  expect(restored.extensions.practice_sessions.map(row => row.session_id)).toEqual([imported.id]);
  expect(restored.extensions.practice_sessions.some(row => row.session_id === oldId)).toBe(false);
  expect(restored.learning_events.filter(row => row.card_id === restored.cards.find(card => card.word === "apple").id)).toHaveLength(2);
});

test("EL-10 partial deletion invalidates the frozen multiword round", async ({appFactory, page}) => {
  const app = await appFactory();
  const ids = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "banana", meaning: "香蕉"}]);
  for (const id of ids) expect((await app.request.post("/api/typing/check", {data: {card_id: id, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID()}})).ok()).toBeTruthy();
  await stats(page, app);
  await start(page);
  expect((await app.request.delete(`/api/cards/${ids[1]}`)).ok()).toBeTruthy();
  await page.goto(`${app.baseURL}/#/stats`);
  await page.reload();
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("原目标已删除");
  await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveCount(0);
  await expect(page.getByTestId("practice-session")).not.toContainText("专项练习：通过");
});
