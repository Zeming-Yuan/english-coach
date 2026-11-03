import {test, expect} from "./support/test.mjs";

test("full design provides a working desktop learning navigation", async ({appFactory, page}, testInfo) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await page.goto(app.baseURL);
  if (testInfo.project.name === "desktop") {
    const nav = page.getByRole("navigation", {name: "主导航", exact: true});
    await nav.getByRole("button", {name: "课程", exact: true}).click();
    await expect(page.locator(".lesson-list-item")).toBeVisible();
    await nav.getByRole("button", {name: "单词本", exact: true}).click();
    await expect(page.locator(".word-search-input")).toBeVisible();
    await nav.getByRole("button", {name: "学习记录", exact: true}).click();
    await expect(page.locator(".stats-grid")).toBeVisible();
  } else {
    await page.getByRole("button", {name: "打开课程", exact: true}).click();
    await expect(page.locator(".lesson-list-item")).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("full design keeps settings and backup readable across viewports", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await expect(page.getByRole("button", {name: "下载完整备份", exact: true})).toBeInViewport();
  const panel = await page.locator(".settings-panel").boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await expect(page.getByText("发音速度", {exact: true})).toBeVisible();
});
