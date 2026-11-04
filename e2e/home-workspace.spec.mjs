import {test, expect} from "./support/test.mjs";

test("Home recommended review distinguishes failure from an empty queue and retries independently", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "full-design.json"});
  await page.route("**/api/recommended?limit=5", route => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  await expect(page.getByRole("alert").filter({hasText: "推荐复习暂时无法读取"})).toBeVisible({timeout: 3000});
  await page.route("**/api/lessons", route => route.abort("failed"));
  await page.getByRole("button", {name: "重新读取推荐词", exact: true}).click();
  await expect(page.getByRole("region", {name: "推荐复习"})).toContainText("目前没有推荐复习词");
  await expect(page.getByRole("region", {name: "当前课程"})).toContainText("苹果");
});

test("Home mixed-language course goals and translated fields cannot reveal target English", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "home-preview-safety.json"});
  await page.goto(app.baseURL);
  await expect(page.getByRole("region", {name: "当前课程"})).toContainText("第 12 课");
  await expect(page.locator(".home-content-grid")).not.toContainText(/\bcan\b|\bwater\b/i, {timeout: 3000});
  await expect(page.getByRole("region", {name: "当前课程"})).toContainText("水");
});

test("Home slow story response does not hold the daily learning action", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/stories", async route => {await gate; await route.continue();});
  try {
    await page.goto(app.baseURL, {waitUntil: "domcontentloaded"});
    await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toBeEnabled({timeout: 3000});
  } finally {release();}
});

test("Home previews real learning content without exposing English answers or marking lessons opened", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "full-design.json"});
  await page.goto(app.baseURL);
  const course = page.getByRole("region", {name: "当前课程"});
  await expect(course).toContainText("苹果");
  await expect(course).not.toContainText("apple");
  await expect(page.getByRole("region", {name: "故事阅读"})).toContainText("雨天的小书店");
  await expect(page.getByRole("region", {name: "故事阅读"})).not.toContainText("It was a rainy afternoon");
  const lessons = await (await app.request.get("/api/lessons")).json();
  expect(lessons.counts.opened).toBe(0);
  await expect(page.getByRole("button", {name: "拼写练习", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "拼写练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文拼写"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Home optional content failure can recover while the daily round remains usable", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "full-design.json"});
  await page.route("**/api/lessons", route => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  const course = page.getByRole("region", {name: "当前课程"});
  await expect(course.getByRole("alert")).toContainText("课程暂时无法读取");
  await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toBeEnabled();
  await expect(page.getByRole("button", {name: "场景练习", exact: true})).toBeEnabled();
  await course.getByRole("button", {name: "重新读取课程"}).click();
  await expect(course).toContainText("苹果");
  await expect(course.getByRole("alert")).toHaveCount(0);
});

test("Home legacy story without Chinese title does not reveal the English title", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec11-seed-story.json"});
  await page.goto(app.baseURL);
  const story = page.getByRole("region", {name: "故事阅读"});
  await expect(story.getByRole("button", {name: "打开故事库", exact: true})).toBeVisible();
  await expect(story).not.toContainText("Old story");
  await expect(story).toContainText("读一个小故事");
});

test("EL-22 Home daily goal changes independently of the bounded round and survives reload", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await page.goto(app.baseURL);
  await page.getByText("计划详情与目标设置", {exact: true}).click();
  await page.getByLabel("每日最低完成目标").selectOption("15");
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 2 张");
  await page.reload();
  await page.getByText("计划详情与目标设置", {exact: true}).click();
  await expect(page.getByRole("progressbar", {name: "今日最低目标进度"})).toHaveAttribute("aria-valuemax", "15");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".view-study")).toBeVisible();
});

test("Home missing content has honest empty states and working course and story navigation", async ({app, page}) => {
  await page.goto(app.baseURL);
  await expect(page.getByRole("button", {name: "先加几个词"})).toBeVisible();
  await expect(page.getByRole("region", {name: "当前课程"})).toContainText("从第一课开始");
  await expect(page.getByRole("region", {name: "故事阅读"})).toContainText("读一个小故事");
  await page.getByRole("region", {name: "当前课程"}).getByRole("button", {name: "打开课程", exact: true}).click();
  await expect(page.locator(".view-lessons")).toBeVisible();
  await page.getByRole("navigation").getByRole("button", {name: /今天|队列/, exact: true}).click();
  await page.getByRole("button", {name: "打开故事库", exact: true}).click();
  await expect(page.locator(".story-library")).toBeVisible();
});
