import {test, expect} from "./support/test.mjs";

async function openPractice(page, app) {
  await page.goto(app.baseURL);
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  await page.locator(".lesson-list-item").first().click();
  await page.getByRole("button", {name: "开始本课短测", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("本课短测");
}

async function submitAnswer(page, answer) {
  await page.locator('input[name="practice-answer"]').fill(answer);
  await page.getByRole("button", {name: "提交", exact: true}).click();
}

test("EL-08 lesson check hides unshown answers", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  const result = page.getByTestId("practice-session");
  await expect(result).toContainText("未完成");
  await expect(result).not.toContainText("apple");
  await expect(page.locator('input[name="practice-answer"]')).toBeVisible();
});

test("EL-08 correct first answer passes the course check", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  await submitAnswer(page, "apple");
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await page.getByRole("button", {name: "查看结果", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("本课短测：通过");
  await page.getByRole("button", {name: "返回课程", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已通过本轮检查");
});

test("EL-08 assisted answer stays weak", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  await page.getByRole("button", {name: "提示首字母", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：a");
  await submitAnswer(page, "apple");
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await page.getByRole("button", {name: "查看结果", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("本课短测：待巩固");
  await page.getByRole("button", {name: "返回课程", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("待巩固");
});

test("EL-08 skip can retry without replacing first result", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  await page.getByRole("button", {name: "跳过这题", exact: true}).click();
  await expect(
    page.locator(".quiz-feedback").filter({hasText: "已跳过"}),
  ).toBeVisible();
  await page.getByRole("button", {name: "再试一次", exact: true}).click();
  await submitAnswer(page, "apple");
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await page.getByRole("button", {name: "查看结果", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("本课短测：未完成");
  await expect(page.getByTestId("practice-session")).toContainText("待巩固 1");
});

test("EL-08 assistance survives returning to the course", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  await page.getByRole("button", {name: "提示首字母", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：a");
  await page.getByRole("button", {name: "← 返回课程", exact: true}).click();
  await page.getByRole("button", {name: "开始本课短测", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：a");
  await expect(page.getByTestId("practice-session")).toContainText("本课短测");
});

test("EL-08 lost attempt response retries once", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  const lost = {};
  await page.route(
    "**/api/practice-sessions/*/items/*/attempts",
    async (route) => {
      lost.submissionId = route.request().postDataJSON().submission_id;
      await route.fetch();
      await route.abort("failed");
    },
    {times: 1},
  );
  await submitAnswer(page, "apple");
  await expect(page.getByRole("alert")).toContainText("保存");
  await page.locator(".practice-item").getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const payload = await (await app.request.get("/api/export/backup")).json();
  expect(
    payload.learning_events.filter((event) => event.submission_id === lost.submissionId),
  ).toHaveLength(1);
});

test("EL-08 refresh continues the same session", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openPractice(page, app);
  await page.reload();
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  await expect(page.getByTestId("practice-session")).toContainText("本课短测");
  await expect(page.locator('input[name="practice-answer"]')).toBeVisible();
});

test("EL-08 zero words is explained without a fake pass", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el08-empty-lesson.json"});
  await page.goto(app.baseURL);
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  await page.locator(".lesson-list-item").first().click();
  await page.getByRole("button", {name: "开始本课短测", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("本课没有可测试的词");
  await expect(page.getByTestId("practice-session")).not.toContainText("通过");
});
