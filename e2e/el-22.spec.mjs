import {test, expect} from "./support/test.mjs";

const start = page => page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
async function rate(page, rating = 3) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(`.rating-${rating}`).click();
}

test("EL-22 selected time gives one next step and resumes the same saved round", async ({app, page}) => {
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`, meaning: `词义${i}`})));
  await page.goto(app.baseURL);
  await page.getByLabel("今天可用时间").selectOption("3");
  const next = page.getByRole("region", {name: "今天下一步", exact: true});
  await expect(next.getByTestId("next-step-reason")).toHaveText("先学本轮的 2 个新词，再用少量练习巩固。");
  await expect(next.getByRole("button", {name: "开始今天的学习", exact: true})).toHaveCount(1);
  await expect(next).not.toContainText("word0");
  await start(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await expect(page.getByTestId("daily-closure")).toHaveCount(0);
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await page.reload();
  await expect(next.getByTestId("next-step-reason")).toHaveText("上轮还有 1 张未完成，先从保存的位置继续。");
  await expect(next.getByLabel("今天可用时间")).toBeDisabled();
  await next.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await expect(page.locator(".front-main")).toHaveText("word1");
  await page.screenshot({path: test.info().outputPath("resume.png")});
});

test("EL-22 home keeps its action above the fold and exposes estimates only on demand", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  const next = page.getByRole("region", {name: "今天下一步", exact: true});
  await expect(next.getByTestId("time-budget-plan")).toBeVisible();
  await expect(next.getByTestId("estimate-basis")).not.toBeVisible({timeout: 3000});
  await expect(next.getByLabel("每日最低完成目标")).not.toBeVisible();
  await expect(next.getByTestId("time-budget-plan")).toBeVisible();
  const action = next.getByRole("button", {name: "开始今天的学习", exact: true});
  await expect(action).toBeInViewport({ratio: 1});
  await expect(next.getByRole("heading", {name: "今天的学习", exact: true})).toBeInViewport({ratio: 1});
  await page.screenshot({path: test.info().outputPath("home-focused.png")});
  await next.getByText("计划详情与目标设置", {exact: true}).click();
  await expect(next.getByTestId("estimate-basis")).toBeVisible();
  await next.getByLabel("每日最低完成目标").selectOption("15");
  await expect(next.getByTestId("round-target")).toContainText("1 张");
  await page.reload();
  await next.getByText("计划详情与目标设置", {exact: true}).click();
  await expect(next.getByRole("progressbar", {name: "今日最低目标进度"})).toHaveAttribute("aria-valuemax", "15");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("EL-22 saved completion closes the day while weak words and optional details remain honest", async ({app, page}) => {
  const ids = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await page.goto(app.baseURL);
  await start(page);
  await rate(page, 1);
  await rate(page);
  await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.getByTestId("daily-closure")).toHaveText("本轮已完成，今天可以结束了。");
  await expect(page.locator(".done-detail")).toContainText("2 张卡已保存并排期");
  await expect(page.getByText("仍需复习：apple", {exact: true})).toBeVisible();
  await expect(page.getByText("自评：1 / 2", {exact: true})).not.toBeVisible();
  const before = await (await app.request.get("/api/export/backup")).json();
  await page.getByText("查看详细学习记录与自选练习", {exact: true}).click();
  await expect(page.getByText("自评：1 / 2", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "去做测验", exact: true})).toBeVisible();
  const after = await (await app.request.get("/api/export/backup")).json();
  expect(after.learning_events).toEqual(before.learning_events);
  expect(after.learning_events.map(event => event.card_id)).toEqual(ids);
  await page.getByText("查看详细学习记录与自选练习", {exact: true}).click();
  await page.screenshot({path: test.info().outputPath("daily-closure.png")});
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await expect(page.getByTestId("next-step-reason")).toContainText("今天可以结束了");
});
