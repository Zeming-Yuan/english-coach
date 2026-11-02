import {test, expect} from "./support/test.mjs";

async function prepare(app) {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: "apple", source: "spelling", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect((await app.request.post("/api/learning/contacts", {data: {
    card_id: id, revision: detail.content_revision, source: "card_detail",
    kind: "answer_visible", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  await app.setTime("2026-10-08T01:00:00Z");
  return {id, revision: detail.content_revision};
}

async function open(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "一周回测", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("一周回测");
}

async function answer(page) {
  await page.getByRole("textbox", {name: "英文答案"}).fill("apple");
  await page.getByRole("button", {name: "提交", exact: true}).click();
}

test("EL-09 reopened results record contact before another delayed answer", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await expect.poll(async () => (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length).toBeGreaterThan(1);
  await app.setTime("2026-10-15T01:00:00Z");
  const challenge = await page.context().browser().newPage({viewport: page.viewportSize()});
  await open(challenge, app);
  await expect(challenge.getByRole("textbox", {name: "英文答案"})).toBeVisible();
  const before = (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length;
  await page.reload();
  await page.getByRole("button", {name: "一周回测", exact: true}).click();
  await expect(page.locator(".practice-results")).toContainText("apple");
  await expect.poll(async () => (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length).toBeGreaterThan(before);
  await answer(challenge);
  await expect(challenge.getByText("✅ 正确！")).toBeVisible();
  await expect(challenge.getByTestId("practice-session")).toContainText("其他间隔");
  expect((await (await app.request.get("/api/stats")).json()).retention.week.count).toBe(1);
  await challenge.close();
});

for (const mode of ["form", "global", "accepted-replay"]) {
  test(`EL-09 pending contact refresh on ${mode} confirmation`, async ({appFactory, page}) => {
    const app = await appFactory();
    await prepare(app);
    await open(page, app);
    let submissionId;
    await page.route("**/api/practice-sessions/*/items/*/attempts", async route => {
      submissionId = route.request().postDataJSON().submission_id;
      if (mode === "accepted-replay") await route.fetch();
      await route.abort("failed");
    }, {times: 1});
    await answer(page);
    await expect(page.locator(".practice-item").getByRole("alert")).toBeVisible();
    const other = await page.context().newPage();
    await other.route("**/api/learning/contacts", route => route.abort("failed"));
    await other.goto(app.baseURL);
    await other.getByText("单词本", {exact: true}).click();
    await expect(other.locator(".word-item").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("ec.contact.") && key !== "ec.contact.probe").length)).toBeGreaterThan(0);
    if (mode === "global") {
      await page.reload();
      await page.locator(".pending-recovery").getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.locator(".pending-recovery")).toHaveCount(0);
    } else {
      await page.locator(".practice-item").getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.getByText("✅ 正确！")).toBeVisible();
    }
    const stats = (await (await app.request.get("/api/stats")).json()).retention;
    expect(stats.week.count).toBe(mode === "accepted-replay" ? 1 : 0);
    if (mode !== "accepted-replay") expect(stats.other.incomplete).toBe(1);
    const backup = await (await app.request.get("/api/export/backup")).json();
    expect(backup.learning_events.filter(row => row.submission_id === submissionId)).toHaveLength(1);
    await other.close();
  });
}

test("EL-09 week check hides answers and displays real retention", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  await expect(page.getByTestId("practice-session")).not.toContainText("apple");
  await expect(page.getByTestId("practice-session")).toContainText("168 小时");
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await page.getByRole("button", {name: "查看结果", exact: true}).click();
  await page.getByRole("button", {name: "返回统计", exact: true}).click();
  const overview = page.getByTestId("retention-overview");
  await expect(overview).toContainText("独立成功/样本 1/1");
  await expect(overview).toContainText("样本较少");
  await page.screenshot({path: test.info().outputPath("retention-overview.png"), fullPage: true});
});

test("EL-09 another tab seeing the answer reclassifies the result", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  const other = await page.context().newPage();
  await other.goto(app.baseURL);
  await other.getByText("单词本", {exact: true}).click();
  await expect(other.locator(".word-item").first()).toBeVisible();
  await expect.poll(async () => (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length).toBeGreaterThan(1);
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await expect(page.getByTestId("practice-session")).toContainText("其他间隔");
  await expect(page.getByTestId("practice-session")).not.toContainText("一周回测：通过");
  expect((await (await app.request.get("/api/stats")).json()).retention.week.count).toBe(0);
  await other.close();
});

test("EL-09 assisted first result survives refresh and retry", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  await page.getByRole("button", {name: "提示首字母", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：a");
  await page.reload();
  await page.getByRole("button", {name: "一周回测", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：a");
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const stats = (await (await app.request.get("/api/stats")).json()).retention;
  expect(stats.week.count).toBe(0);
  expect(stats.other.assisted).toBe(1);
});

test("EL-09 skip then retry never replaces first sample", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  await page.getByRole("button", {name: "跳过这题", exact: true}).click();
  await page.getByRole("button", {name: "再试一次", exact: true}).click();
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const stats = (await (await app.request.get("/api/stats")).json()).retention.week;
  expect(stats.skipped).toBe(1);
  expect(stats.count).toBe(0);
});

test("EL-09 lost response confirms once and preserves retention", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  let submissionId;
  await page.route("**/api/practice-sessions/*/items/*/attempts", async route => {
    submissionId = route.request().postDataJSON().submission_id;
    await route.fetch();
    await route.abort("failed");
  }, {times: 1});
  await answer(page);
  await expect(page.locator(".practice-item").getByRole("alert")).toContainText("保存");
  await page.locator(".practice-item").getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events.filter(row => row.submission_id === submissionId)).toHaveLength(1);
  expect((await (await app.request.get("/api/stats")).json()).retention.week.count).toBe(1);
});

test("EL-09 commit failure retains answer across refresh", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepare(app);
  await open(page, app);
  await app.failCommitOnce();
  await answer(page);
  await expect(page.locator(".practice-item").getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", {name: "一周回测", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveValue("apple");
  await page.locator(".practice-item").getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
});

test("EL-09 missing history offers ordinary practice without fake evidence", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await open(page, app);
  await expect(page.getByTestId("practice-session")).toContainText("旧记录不足");
  await page.getByRole("button", {name: "重新查找候选", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("旧记录不足");
  await page.getByRole("button", {name: "普通练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toHaveCount(0);
});

test("EL-09 V3 restore continues the frozen delayed session", async ({appFactory, page}) => {
  const source = await appFactory();
  await prepare(source);
  await open(page, source);
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await target.seedCards([{id: 900, word: "reserved", meaning: "保留"}]);
  await target.setTime("2026-10-08T01:00:00Z");
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "delayed-v3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await open(page, target);
  await expect(page.getByTestId("practice-session")).toContainText("168 小时");
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  expect((await (await target.request.get("/api/stats")).json()).retention.week.count).toBe(1);
});

test("EL-09 functional rollback hides entries and keeps saved evidence", async ({appFactory, page}) => {
  const source = await appFactory();
  await prepare(source);
  await open(page, source);
  await answer(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory({fixture: "el09-rollback.json"});
  await target.setTime("2026-10-08T01:00:00Z");
  const preview = await (await target.request.post("/api/import/preview", {data: backup})).json();
  expect((await target.request.post("/api/import/cards", {data: {backup, expected_revision: preview.expected_revision}})).ok()).toBeTruthy();
  await page.goto(target.baseURL);
  await expect(page.getByRole("button", {name: "一周回测", exact: true})).toHaveCount(0);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("retention-overview")).toContainText("独立成功/样本 1/1");
  await expect(page.getByRole("button", {name: "一周回测", exact: true})).toHaveCount(0);
  expect((await (await target.request.get("/api/export/backup")).json()).learning_events).toHaveLength(backup.learning_events.length);
});
