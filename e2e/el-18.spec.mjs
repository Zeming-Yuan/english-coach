import {test, expect} from "./support/test.mjs";

async function rate(page) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(".rating-3").click();
}
const backup = async app => (await (await app.request.get("/api/export/backup")).json());

test("EL-18 five real answers switch future preview to personal and freeze current round", async ({app, page}) => {
  await page.clock.install();
  await app.seedCards(Array.from({length: 10}, (_, i) => ({word: `word${i}`})));
  await page.goto(app.baseURL);
  await expect(page.getByTestId("estimate-basis")).toContainText("默认估算");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  for (let i = 0; i < 5; i++) {
    await page.clock.runFor(10000);
    await rate(page);
    await expect(page.locator(".study-count")).toHaveText(`${i + 2} / 10`);
  }
  await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(5);
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await expect(page.getByTestId("round-target")).toContainText("10 张");
  await expect(page.getByTestId("estimate-basis")).toContainText("默认估算");
  await page.screenshot({path: test.info().outputPath("frozen-estimate.png")});
  const future = await (await app.request.get("/api/today?budget_minutes=3")).json();
  expect(future.plan.estimates.new.basis).toBe("personal");
  expect(future.plan.estimates.new.seconds).toBeGreaterThanOrEqual(10);
  expect(future.plan.estimates.new.seconds).toBeLessThan(12);
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  for (let i = 5; i < 10; i++) {
    await page.clock.runFor(10000);
    await rate(page);
    if (i < 9) await expect(page.locator(".study-count")).toHaveText(`${i + 2} / 10`);
  }
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await expect(page.getByTestId("estimate-basis")).toContainText("个人估算");
  await page.screenshot({path: test.info().outputPath("personal-estimate.png")});
});

test("EL-18 due review is timed as review rather than new word", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec13-backlog.json"});
  await page.clock.install();
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.clock.runFor(5000);
  await rate(page);
  await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(1);
  expect((await backup(app)).extensions.practice_durations[0].kind).toBe("review");
});

test("EL-18 idle gaps and answer save waiting never inflate active time", async ({app, page}) => {
  await page.clock.install();
  await app.seedCards([{word: "apple"}, {word: "pear"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.clock.runFor(5000);
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.clock.runFor(40000); // Entire interval over 30s is idle.
  let release, reached;
  const hold = new Promise(resolve => {release = resolve;});
  const fetched = new Promise(resolve => {reached = resolve;});
  await page.route("**/api/reviews", async route => {
    const response = await route.fetch(); reached(); await hold;
    await route.fulfill({response});
  }, {times: 1});
  try {
    await page.locator(".rating-3").click();
    await fetched;
    await page.clock.runFor(60000);
    await expect(page.getByText("正在确认保存…", {exact: true})).toBeVisible();
    release();
    await expect(page.locator(".study-count")).toHaveText("2 / 2");
    await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(1);
    const rows = (await backup(app)).extensions.practice_durations;
    expect(rows[0].active_ms).toBeGreaterThanOrEqual(5000);
    expect(rows[0].active_ms).toBeLessThan(6000);
  } finally {release();}
});

for (const fault of ["response-loss", "commit-failure"]) {
  test(`EL-18 duration ${fault} retries after refresh without repeating answer`, async ({app, page}) => {
    await page.clock.install();
    await app.seedCards([{word: "apple"}, {word: "pear"}]);
    await page.goto(app.baseURL);
    await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
    const commands = [];
    page.on("request", request => {
      if (request.url().endsWith("/api/learning/durations")) commands.push(request.postDataJSON());
    });
    await page.route("**/api/learning/durations", async route => {
      if (fault === "commit-failure") await app.failCommitOnce();
      const response = await route.fetch();
      if (fault === "response-loss") await route.abort("failed");
      else await route.fulfill({response});
    }, {times: 1});
    await page.clock.runFor(6000);
    await rate(page);
    await expect(page.locator(".study-count")).toHaveText("2 / 2");
    await expect(page.getByTestId("duration-recovery")).toBeVisible();
    await page.reload();
    await page.getByRole("button", {name: "继续确认时长", exact: true}).click();
    await expect(page.getByTestId("duration-recovery")).toHaveCount(0);
    const saved = await backup(app);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(saved.learning_events).toHaveLength(1);
    expect(saved.extensions.practice_durations).toHaveLength(1);
    expect(saved.reviews[0].review_count).toBe(1);
    expect(saved.extensions.practice_durations[0].submission_id).toBe(saved.learning_events[0].submission_id);
  });
}

test("EL-18 hidden document intervals do not count as active work", async ({app, page}) => {
  await page.clock.install();
  // Headless tabs stay visible; inject the browser visibility signal, not an app API.
  await page.addInitScript(() => {
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", {get: () => visibility});
    window.setTestVisibility = value => {visibility = value; document.dispatchEvent(new Event("visibilitychange"));};
  });
  await app.seedCards([{word: "apple"}, {word: "pear"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.clock.runFor(5000);
  await page.evaluate(() => window.setTestVisibility("hidden"));
  await page.clock.runFor(20000); // Below idle threshold: visibility alone must exclude it.
  await page.evaluate(() => window.setTestVisibility("visible"));
  await page.clock.runFor(5000);
  await rate(page);
  await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(1);
  const sample = (await backup(app)).extensions.practice_durations[0];
  expect(sample.active_ms).toBeGreaterThanOrEqual(10000);
  expect(sample.active_ms).toBeLessThan(11000);
});

test("EL-18 lost answer response retains frozen timing through confirmation", async ({app, page}) => {
  await page.clock.install();
  await app.seedCards([{word: "apple"}, {word: "pear"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.route("**/api/reviews", async route => {await route.fetch(); await route.abort("failed");}, {times: 1});
  await page.clock.runFor(7000);
  await rate(page);
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await page.clock.runFor(60000);
  await page.reload();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
  await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(1);
  const saved = await backup(app);
  expect(saved.learning_events).toHaveLength(1);
  expect(saved.extensions.practice_durations[0].active_ms).toBeGreaterThanOrEqual(7000);
  expect(saved.extensions.practice_durations[0].active_ms).toBeLessThan(8000);
});

test("EL-18 reinforcement records its own kind without changing objective result", async ({app, page}) => {
  await page.clock.install();
  await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(".rating-1").click();
  await expect(page.getByRole("heading", {name: "本轮巩固", exact: true})).toBeVisible();
  await page.clock.runFor(8000);
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status").filter({hasText: "已保存：答对"})).toBeVisible();
  await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(2);
  const saved = await backup(app);
  expect(saved.extensions.practice_durations.map(row => row.kind)).toEqual(["new", "reinforcement"]);
  expect(saved.learning_events[1].correct).toBe(true);
  expect(saved.learning_events[1].fsrs_rating).toBe(3);
});

async function prepareHistory(app) {
  const ids = await app.seedCards(Array.from({length: 6}, (_, i) => ({word: `history${i}`})));
  for (let i = 0; i < 5; i++) {
    const submission_id = crypto.randomUUID();
    expect((await app.request.post("/api/reviews", {data: {
      card_id: ids[i], rating: 3, source: "study", kind: "self_rating", submission_id,
    }})).status()).toBe(200);
    expect((await app.request.post("/api/learning/durations", {data: {
      sample_id: crypto.randomUUID(), submission_id, kind: "new", active_ms: 10000,
    }})).status()).toBe(200);
  }
}

test("EL-18 V3 UI restore continues calibration and older backups explain defaults", async ({appFactory, page}) => {
  const source = await appFactory();
  await prepareHistory(source);
  const saved = await backup(source);
  const app = await appFactory();
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "durations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await expect(page.getByTestId("estimate-basis")).toContainText("个人估算");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await rate(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect.poll(async () => (await backup(app)).extensions.practice_durations.length).toBe(6);
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  const old = await backup(app);
  old.features = old.features.filter(value => value !== "practice_durations");
  delete old.extensions.practice_durations;
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "older-v3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old))});
  await expect(page.getByRole("note").filter({hasText: "此备份没有主动时长记录"})).toBeVisible();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await expect(page.getByTestId("estimate-basis")).toContainText("默认估算");
  expect((await backup(app)).learning_events).toHaveLength(6);
});

test("EL-18 functional rollback retains observations and uses labelled defaults", async ({appFactory, page}) => {
  const source = await appFactory();
  await prepareHistory(source);
  const app = await appFactory({snapshotOf: source.databasePath, fixture: "el18-rollback.json"});
  await page.goto(app.baseURL);
  await expect(page.getByTestId("estimate-basis")).toContainText("默认估算");
  const saved = await backup(app);
  expect(saved.extensions.practice_durations).toHaveLength(5);
  expect(saved.learning_events).toHaveLength(5);
  const future = await (await app.request.get("/api/today")).json();
  expect(future.plan.estimates.new.seconds).toBe(40);
  await page.screenshot({path: test.info().outputPath("rollback-default.png")});
});

test("EL-18 resumed unanswered card discards incomplete timing rather than calibrating", async ({app, page}) => {
  await page.clock.install();
  await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.clock.runFor(5000);
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await page.reload();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await page.clock.runFor(5000);
  await rate(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const saved = await backup(app);
  expect(saved.learning_events).toHaveLength(1);
  expect(saved.extensions.practice_durations).toHaveLength(0);
});

test("EL-18 new tab continuation discards the unanswered card partial timing", async ({app, page}) => {
  await page.clock.install();
  await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.clock.runFor(10000);
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.clock.install();
  const durationRequests = [];
  reopened.on("request", request => {
    if (request.url().endsWith("/api/learning/durations")) durationRequests.push(request.postDataJSON());
  });
  await reopened.goto(app.baseURL);
  await reopened.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await reopened.clock.runFor(5000);
  await rate(reopened);
  await expect(reopened.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  expect(durationRequests).toHaveLength(0);
  const saved = await backup(app);
  expect(saved.learning_events).toHaveLength(1);
  expect(saved.extensions.practice_durations).toHaveLength(0);
});
