import {test, expect} from "./support/test.mjs";

const openDemo = page => page.getByRole("button", {name: "体验示范课", exact: true});
const exitDemo = page => page.getByRole("button", {name: "返回课程", exact: true});
const configure = page => page.getByRole("button", {name: "配置 AI 服务", exact: true});
const answer = (page, name) => page.getByRole("button", {name, exact: true});

async function openCourses(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "打开课程", exact: true}).first().click();
}

test("S95-08 demo lesson completes without formal progress", async ({app, page}) => {
  const before = await (await app.request.get("/api/export/backup")).json();
  await openCourses(page, app);
  await openDemo(page).press("Enter", {timeout: 5000});
  await expect(page.getByRole("heading", {name: "问候示范课", exact: true})).toBeVisible();
  await expect(page.getByText("你好！", {exact: true})).toHaveCount(2);
  await answer(page, "Goodbye!").click();
  await expect(page.getByRole("status")).toContainText("再试一次");
  await answer(page, "Hello!").click();
  await expect(page.getByRole("status")).toContainText("示例任务已完成");
  await exitDemo(page).press("Enter");
  await expect(openDemo(page)).toBeFocused();
  await openDemo(page).click();
  await expect(answer(page, "Hello!")).toBeVisible();
  await expect(page.getByText("示例任务已完成", {exact: true})).toHaveCount(0);
  await exitDemo(page).click();

  const after = await (await app.request.get("/api/export/backup")).json();
  for (const field of ["lessons", "cards", "learning_events", "extensions"]) {
    expect(after[field]).toEqual(before[field]);
  }
  await expect(page.getByText("已生成 0/20 课", {exact: true})).toBeVisible();
  await expect(page.getByText(/已浏览 0 课/)).toBeVisible();
  await configure(page).click();
  await expect(page.getByRole("heading", {name: "AI 服务", exact: true})).toBeVisible();
});

test("S95-08 missing configuration never creates pending generation", async ({app, page}) => {
  const posts = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/lessons/next") posts.push(request.method());
  });
  await openCourses(page, app);
  await expect(page.getByText("正式课程生成需要配置 AI 服务。", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "开始", exact: true})).toHaveCount(0);
  await expect(page.getByText(/生成尚未确认/)).toHaveCount(0);
  await configure(page).click();
  await expect(page.getByRole("heading", {name: "AI 服务", exact: true})).toBeVisible();
  expect(posts).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("ec.lessongen.next"))).toBeNull();
});

test("S95-08 demo preserves existing pending generation", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el07-valid-lesson.json"});
  const requests = [];
  await page.route("**/api/lessons/next", async route => {
    requests.push(route.request().postDataJSON().operation_id);
    if (requests.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({status: 502, json: {detail: "upstream response lost"}});
  });
  await openCourses(page, app);
  await page.getByRole("button", {name: "开始", exact: true}).click();
  const resume = page.getByRole("button", {name: "继续确认生成", exact: true});
  await expect(resume).toBeVisible({timeout: 5000});
  await openDemo(page).click();
  await answer(page, "Hello!").click();
  await exitDemo(page).click();
  await page.reload();
  await resume.click();
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBe(requests[0]);
  const result = await (await app.request.get("/api/lessons")).json();
  expect(result.counts.generated).toBe(1);
});

test("S95-08 failed audio leaves demo usable", async ({app, page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {value: {getVoices: () => [], cancel() {}}});
  });
  await page.route("**/api/tts/audio/**", route => route.abort("failed"));
  await openCourses(page, app);
  await openDemo(page).click();
  await page.getByRole("button", {name: "朗读 hello", exact: true}).click();
  await expect(page.getByText("暂时无法朗读，仍可继续示例任务。", {exact: true})).toBeVisible();
  await answer(page, "Hello!").click();
  await expect(page.getByText("示例任务已完成", {exact: true})).toBeVisible();
  await exitDemo(page).click();
  await expect(openDemo(page)).toBeFocused();
});

test("S95-08 configuration read failure is retryable", async ({app, page}) => {
  await openCourses(page, app);
  await expect(configure(page)).toBeVisible();
  await page.route("**/api/ai-config", route => route.abort("failed"), {times: 1});
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("无法读取 AI 配置");
  await expect(openDemo(page)).toBeEnabled();
  await expect(page.getByText(/生成尚未确认/)).toHaveCount(0);
  await page.getByRole("button", {name: "重试读取 AI 配置", exact: true}).click();
  await expect(configure(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ec.lessongen.next"))).toBeNull();
});
