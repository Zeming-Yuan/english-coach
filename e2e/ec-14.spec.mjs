import {test, expect} from "./support/test.mjs";

async function continueAfterSaved(page) {
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", {name: /^(下一题 →|查看本轮结果)$/}).click();
}

test("EC-14 optional reinforcement and saved summary", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.getByRole("heading", {name: "本轮巩固", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.getByText(/仍需复习：apple/)).toBeVisible();
  expect((await (await app.request.get(`/api/cards/${id}`)).json()).learning_events).toHaveLength(1);
});

test("EC-14 main low rating and explicit skip both become reinforcement", async ({app, page}) => {
  const ids = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await page.getByRole("button", {name: "跳过这张卡", exact: true}).click({timeout: 5000});
  await expect(page.getByRole("heading", {name: "本轮巩固", exact: true})).toBeVisible();
  const skipped = (await (await app.request.get(`/api/cards/${ids[1]}`)).json()).learning_events;
  expect(skipped).toHaveLength(1);
  expect(skipped[0]).toMatchObject({skipped: true, correct: null, scheduled: false, self_rating: null, stage: "main"});
  const session = skipped[0].session_id;
  expect((await (await app.request.get(`/api/sessions/${session}/reinforcement`)).json()).questions.map(q => q.card_id)).toEqual(ids);
});

test("EC-14 reinforcement uses independent typed save and real summary", async ({app, page}) => {
  await page.route("**/api/tts/**", route => route.abort("failed"));
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".spelling-input")).toBeVisible({timeout: 5000});
  await expect(page.locator(".spelling-word-display")).toHaveCount(0);
  await expect(page.locator(".spelling-input")).not.toHaveAttribute("maxlength");
  await page.screenshot({path: `/tmp/english-coach-followup-2026-10-31/ec14-reinforcement-${test.info().project.name}.png`});
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").press("Enter");
  await continueAfterSaved(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.getByText("独立提取：1 / 1", {exact: true})).toBeVisible();
  await page.screenshot({path: `/tmp/english-coach-followup-2026-10-31/ec14-summary-${test.info().project.name}.png`});
  await expect(page.getByText("仍需复习：本轮暂无薄弱词", {exact: true})).toBeVisible();
  const events = (await (await app.request.get(`/api/cards/${id}`)).json()).learning_events;
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({source: "reinforcement", kind: "typed", stage: "reinforcement", correct: true, assistance: [], scheduled: true, session_id: events[0].session_id});
});

test("EC-14 assisted reinforcement stays weak without another schedule", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await page.getByRole("button", {name: "提示首字母", exact: true}).click({timeout: 5000});
  await expect(page.locator(".spelling-word-display")).toBeVisible();
  await page.locator(".spelling-input").fill("apple");
  await continueAfterSaved(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.getByText("辅助练习：1 / 1", {exact: true})).toBeVisible();
  await expect(page.getByText("仍需复习：apple", {exact: true})).toBeVisible();
  const events = (await (await app.request.get(`/api/cards/${id}`)).json()).learning_events;
  expect(events[1]).toMatchObject({correct: true, assistance: ["first_letter", "length", "live_feedback"], scheduled: false});
});

test("EC-14 failed reinforcement retains pending UUID across refresh", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  await app.failCommitOnce();
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("alert")).toContainText("保存");
  await expect(page.locator(".spelling-input")).toHaveValue("apple");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("ec.pending.reinforcement")));
  expect((await (await app.request.get(`/api/cards/${id}`)).json()).learning_events).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await continueAfterSaved(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events.filter(e => e.submission_id === pending.payload.submission_id)).toHaveLength(1);
});

test("EC-14 no weak items reads summary and a summary failure remains retryable", async ({app, page}) => {
  await app.seedCards([{word: "apple"}]);
  await page.route("**/api/sessions/*/summary", route => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("结果加载失败");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "重试加载", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.getByText("自评：1 / 1", {exact: true})).toBeVisible();
});

test("EC-14 deleted reinforcement can leave failed pending without claiming completion", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBe(true);
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("alert")).toContainText("Card not found");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "退出本轮并重新加载", exact: true}).click({timeout: 5000});
  await expect(page.getByText("欢迎来到 EnglishCoach", {exact: true})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ec.pending.reinforcement"))).toBeNull();
});

test("EC-14 skipped phase retries failed summary without restarting questions", async ({app, page}) => {
  await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  await page.route("**/api/sessions/*/summary", route => route.abort("failed"), {times: 1});
  await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("结果加载失败");
  await page.getByRole("button", {name: "重试加载", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible({timeout: 5000});
});

test("EC-14 late home confirmation clears reinforcement pending and finishes once", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  await page.route("**/api/typing/check", async route => { await route.fetch(); await route.abort("failed"); }, {times: 1});
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("alert")).toContainText("保存");
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/api/typing/check", async route => {
    const response = await route.fetch(); await held; await route.fulfill({response});
  }, {times: 1});
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮巩固", exact: true})).toBeVisible();
  release();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible({timeout: 5000});
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await (await app.request.get(`/api/cards/${id}`)).json()).learning_events).toHaveLength(2);
});

test("EC-14 three question lifetime cap survives refresh without refilling", async ({app, page}) => {
  await app.seedCards(Array.from({length: 5}, (_, i) => ({word: `word${i}`, meaning: `释义${i}`})));
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  for (let i = 0; i < 5; i += 1) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 5`);
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-1").click();
  }
  for (let i = 0; i < 3; i += 1) {
    await expect(page.locator(".spelling-meaning")).toHaveText(`释义${i}`);
    await page.locator(".spelling-input").fill("wrong");
    await page.locator(".spelling-input").press("Enter");
    await continueAfterSaved(page);
    if (i < 2) await expect(page.locator(".spelling-meaning")).toHaveText(`释义${i + 1}`);
    else await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
    await page.reload();
    await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  }
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.locator(".spelling-input")).toHaveCount(0);
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events.filter(e => e.stage === "main")).toHaveLength(5);
  const reinforcement = backup.learning_events.filter(e => e.stage === "reinforcement");
  expect(reinforcement).toHaveLength(3);
  expect(new Set(reinforcement.map(e => e.card_id)).size).toBe(3);
});

test("EC-14 deleting an answered slot cannot introduce a fourth question after refresh", async ({app, page}) => {
  const ids = await app.seedCards(Array.from({length: 5}, (_, i) => ({word: `word${i}`, meaning: `释义${i}`})));
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  for (let i = 0; i < 5; i += 1) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 5`);
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-1").click();
  }
  await expect(page.locator(".spelling-meaning")).toHaveText("释义0");
  await page.locator(".spelling-input").fill("wrong");
  await page.locator(".spelling-input").press("Enter");
  await continueAfterSaved(page);
  await expect(page.locator(".spelling-meaning")).toHaveText("释义1");
  expect((await app.request.delete(`/api/cards/${ids[0]}`)).ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  for (let i = 1; i < 3; i += 1) {
    await expect(page.locator(".spelling-meaning")).toHaveText(`释义${i}`);
    await page.locator(".spelling-input").fill("wrong");
    await page.locator(".spelling-input").press("Enter");
    await continueAfterSaved(page);
  }
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible({timeout: 5000});
});

test("EC-14 saved wrong reinforcement feedback precedes the next question", async ({app, page}) => {
  const ids = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  for (let i = 0; i < 2; i += 1) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 2`);
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-1").click();
  }
  await expect(page.locator(".spelling-meaning")).toHaveText("苹果");
  await page.locator(".spelling-input").fill("wrong");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存：答错，正确拼写：apple", {timeout: 5000});
  expect(await page.evaluate(() => localStorage.getItem("ec.pending.reinforcement"))).toBeNull();
  await expect(page.getByText("书", {exact: true})).toHaveCount(0);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  const first = (await (await app.request.get(`/api/cards/${ids[0]}`)).json()).learning_events;
  expect(first).toHaveLength(2);
  expect(first[1]).toMatchObject({correct: false, source: "reinforcement", stage: "reinforcement"});
  await page.getByRole("button", {name: "下一题 →", exact: true}).click();
  await expect(page.locator(".spelling-meaning")).toHaveText("书");
  await app.failCommitOnce();
  await page.locator(".spelling-input").fill("book");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("alert")).toContainText("保存");
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("ec.pending.reinforcement")));
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("已保存：答对");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "查看本轮结果", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events.filter(e => e.submission_id === pending.payload.submission_id)).toHaveLength(1);
});

test("EC-14 obsolete reinforcement response cannot replace a newer daily round", async ({app, page}) => {
  const [oldCard] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  let release;
  let captured;
  let delivered;
  const held = new Promise(resolve => { release = resolve; });
  const responseCaptured = new Promise(resolve => { captured = resolve; });
  const responseDelivered = new Promise(resolve => { delivered = resolve; });
  await page.route("**/api/sessions/*/reinforcement", async route => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({response});
    delivered();
  }, {times: 1});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await responseCaptured;
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".spelling-meaning")).toHaveText("苹果");
  await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const [newCard] = await app.seedCards([{word: "book", meaning: "书"}]);
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("book");
  const nextSession = await page.evaluate(() => JSON.parse(localStorage.getItem("activeDailySession")));
  release();
  await responseDelivered;
  // Flush browser rendering after the delayed fetch has actually been delivered.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("activeDailySession")).id)).toBe(nextSession.id);
  await expect(page.locator(".front-main")).toHaveText("book");
  await expect(page.locator(".study-count")).toHaveText("1 / 1");
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const oldEvents = (await (await app.request.get(`/api/cards/${oldCard}`)).json()).learning_events;
  const newEvents = (await (await app.request.get(`/api/cards/${newCard}`)).json()).learning_events;
  expect(oldEvents).toHaveLength(1);
  expect(newEvents).toHaveLength(1);
  expect(newEvents[0]).toMatchObject({session_id: nextSession.id, stage: "main"});
});
