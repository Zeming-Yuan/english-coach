import {test, expect} from "./support/test.mjs";

async function openSpelling(page, app) {
  await page.goto(app.baseURL);
  await openSpecialistPractice(page);
  await page.getByRole("button", {name: /拼写练习/}).click();
}

async function events(app, cardId) {
  const detail = await (await app.request.get("/api/cards/" + cardId)).json();
  return detail.learning_events;
}

test("EC-05 independent-input", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await expect(page.locator(".spelling-box")).toHaveCount(0);
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存");

  const saved = await events(app, id);
  expect(saved).toHaveLength(1);
  expect(saved[0].source).toBe("spelling");
  expect(saved[0].kind).toBe("typed");
  expect(saved[0].assistance).toEqual([]);
  expect(saved[0].scheduled).toBe(true);
});

test("EC-05 feedback-is-assistance", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await page.getByRole("button", {name: "提示首字母", exact: true}).click();
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存");

  const saved = await events(app, id);
  expect(saved).toHaveLength(1);
  expect(saved[0].assistance).toContain("first_letter");
  expect(saved[0].scheduled).toBe(false);
});

test("EC-05 lost-response-retry-saves-once", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  let dropped = false;
  await page.route("**/api/typing/check", async (route) => {
    if (dropped) {
      await route.continue();
      return;
    }
    dropped = true;
    // 服务端已提交，但浏览器收不到响应。
    await route.fetch();
    await route.abort("failed");
  });

  await openSpelling(page, app);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");

  await expect(page.getByRole("alert")).toContainText("保存未确认");
  await expect(page.getByRole("textbox")).toHaveValue("apple");
  await expect(page.getByRole("button", {name: "重试保存"})).toBeVisible();

  await page.getByRole("button", {name: "重试保存"}).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const saved = await events(app, id);
  expect(saved).toHaveLength(1);
  expect(saved[0].scheduled).toBe(true);
});

test("EC-05 explicit-skip-is-not-wrong", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await page.getByRole("button", {name: /跳过这题/}).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const saved = await events(app, id);
  expect(saved).toHaveLength(1);
  expect(saved[0].skipped).toBe(true);
  expect(saved[0].correct).toBe(null);
  expect(saved[0].scheduled).toBe(false);
});

test("EC-05 leaving-page-creates-no-event", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await page.getByRole("textbox").fill("app");
  await page.getByRole("button", {name: /返回/}).click();
  await openSpecialistPractice(page);
  await expect(page.getByRole("button", {name: /拼写练习/})).toBeVisible();
  expect(await events(app, id)).toHaveLength(0);
});

test("EC-05 quiz-typed-independent", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await openSpecialistPractice(page);
  await page.getByRole("button", {name: "直接做测验"}).click();
  await expect(page.locator(".spelling-box")).toHaveCount(0);
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存");

  const saved = await events(app, id);
  expect(saved).toHaveLength(1);
  expect(saved[0].source).toBe("quiz");
  expect(saved[0].scheduled).toBe(true);
});

async function openSpecialistPractice(page) {
  const summary = page.getByText("专项练习", {exact: true});
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
}
