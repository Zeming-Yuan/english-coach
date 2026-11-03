import {test, expect} from "./support/test.mjs";

async function openLessonsFromHome(page, app) {
  await page.goto(app.baseURL);
  if (await page.getByText("专项练习", {exact: true}).locator("..").getAttribute("open") === null) await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
}

async function openFirstLesson(page) {
  await page.locator(".lesson-list-item").first().click();
}

async function progressRows(app) {
  const payload = await (await app.request.get("/api/export/backup")).json();
  return payload.extensions?.lesson_progress || [];
}

test("EL-07 generated lesson shows goal and pending check", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openLessonsFromHome(page, app);
  await openFirstLesson(page);
  await expect(page.getByTestId("lesson-goal")).toContainText("本课目标");
  await expect(page.getByTestId("lesson-progress")).toContainText("已打开");
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
  await expect(page.getByTestId("lesson-progress")).toContainText("尚无");
});

test("EL-07 opening is separate from browse completion", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openLessonsFromHome(page, app);
  await openFirstLesson(page);
  await expect(page.getByTestId("lesson-progress")).toContainText("已打开");
  await expect(page.getByTestId("lesson-progress")).not.toContainText("已浏览");
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await expect(page.locator(".lesson-list-item").first()).toContainText("已打开");
  await expect(page.locator(".lesson-list-item").first()).not.toContainText("已浏览");
});

test("EL-07 explicit viewed confirmation changes status", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openLessonsFromHome(page, app);
  await openFirstLesson(page);
  await page.getByRole("button", {name: "内容已看完", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已浏览");
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await openFirstLesson(page);
  await expect(page.getByTestId("lesson-progress")).toContainText("已浏览");
});

test("EL-07 viewed confirmation response loss retries once", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await openLessonsFromHome(page, app);
  await openFirstLesson(page);
  const lost = {};
  await page.route(
    "**/api/lessons/1/viewed",
    async (route) => {
      lost.submissionId = route.request().postDataJSON().submission_id;
      await route.fetch();
      await route.abort("failed");
    },
    {times: 1},
  );
  await page.getByRole("button", {name: "内容已看完", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("保存");
  // 浏览确认是独立待确认类型，不进入全局学习恢复条。
  await expect(page.locator(".pending-recovery")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await progressRows(app)).filter(
          (row) => row.view_submission_id === lost.submissionId,
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await expect(page.getByText(/有课程浏览尚未确认/)).toBeVisible();
  await page.getByRole("button", {name: "继续确认", exact: true}).click();
  await page.locator(".lesson-actions").getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已浏览");
  const rows = (await progressRows(app)).filter(
    (row) => row.view_submission_id === lost.submissionId,
  );
  expect(rows).toHaveLength(1);
});

test("EL-07 generation records pending check and counts", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el07-valid-lesson.json"});
  await openLessonsFromHome(page, app);
  await page.getByRole("button", {name: "开始", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
  await expect(page.getByTestId("lesson-goal")).toBeVisible();
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await expect(page.locator(".lesson-entry-label")).toContainText("已生成 1/20 课");
  await expect(page.getByText(/已完成|学完/)).toHaveCount(0);
});

test("EL-07 next lesson response loss replays without skipping", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el07-valid-lesson.json"});
  await openLessonsFromHome(page, app);
  const lost = {};
  await page.route(
    "**/api/lessons/next",
    async (route) => {
      lost.operationId = route.request().postDataJSON().operation_id;
      await route.fetch();
      await route.abort("failed");
    },
    {times: 1},
  );
  await page.getByRole("button", {name: "开始", exact: true}).click();
  await expect(page.getByText(/生成尚未确认/)).toBeVisible();
  await expect
    .poll(async () => {
      const payload = await (await app.request.get("/api/export/backup")).json();
      return (payload.extensions?.lesson_progress || []).filter(
        (row) => row.generation_id === lost.operationId,
      ).length;
    })
    .toBe(1);
  await page.getByRole("button", {name: "继续确认生成", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
  const lessons = await (await app.request.get("/api/lessons")).json();
  expect(lessons.lessons).toHaveLength(1);
  expect(lessons.lessons[0].level).toBe(1);
});

test("EL-07 continue next lesson resets lesson state", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el07-valid-lesson.json"});
  await openLessonsFromHome(page, app);
  await page.getByRole("button", {name: "开始", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
  await page.getByRole("button", {name: "内容已看完", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已浏览");
  await page.getByRole("button", {name: "稍后检查，继续下一课", exact: true}).click();
  await expect(page.getByTestId("lesson-progress")).not.toContainText("已浏览");
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
});

test("EL-07 twenty generated lessons never read as completed", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el07-20-lessons.json"});
  await page.goto(app.baseURL);
  if (await page.getByText("专项练习", {exact: true}).locator("..").getAttribute("open") === null) await page.getByText("专项练习", {exact: true}).click();
  await expect(page.getByRole("region", {name: "复习与学习依据"})).toContainText("旧内容 20 课 · 状态未记录 20 课");
  await expect(page.getByText(/已学完|已完成/)).toHaveCount(0);
  await page.getByTestId("open-lessons").click();
  await expect(page.locator(".lesson-entry-label")).toContainText("20 课已全部生成");
});

test("EL-07 invalid generation leaves no half lesson", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el07-invalid-lesson.json"});
  await openLessonsFromHome(page, app);
  await page.getByRole("button", {name: "开始", exact: true}).click();
  await expect(
    page.locator(".toast").filter({hasText: "生成尚未确认"}),
  ).toBeVisible();
  await expect(page.locator(".lesson-list-item")).toHaveCount(0);
  const lessons = await (await app.request.get("/api/lessons")).json();
  expect(lessons.lessons).toHaveLength(0);
});
