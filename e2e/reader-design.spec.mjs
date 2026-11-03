import {test, expect} from "./support/test.mjs";

async function openReader(appFactory, page) {
  const app = await appFactory({fixture: "ec04-story.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await page.locator(".story-item-main").first().click();
  return app;
}

test("reader translation and type controls preserve the story", async ({appFactory, page}) => {
  await openReader(appFactory, page);
  await expect(page.locator(".story-sentence-cn")).toBeVisible();
  await page.getByRole("switch", {name: "显示译文"}).click();
  await expect(page.locator(".story-sentence-cn")).toHaveCount(0);
  await expect(page.locator(".story-sentence-en")).toContainText("An apple a day.");
  await page.getByRole("switch", {name: "显示译文"}).click();
  await expect(page.locator(".story-sentence-cn")).toContainText("一天一苹果");
  const before = await page.locator(".story-sentence-en").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole("button", {name: "阅读设置", exact: true}).click();
  await page.getByRole("button", {name: "增大字号", exact: true}).click();
  await expect.poll(() => page.locator(".story-sentence-en").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(before);
});

test("reader word lookup is keyboard accessible and preserves context", async ({appFactory, page}) => {
  await openReader(appFactory, page);
  const word = page.getByRole("button", {name: "查词 apple", exact: true}).first();
  await word.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator(".story-word-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".story-word-panel-meaning")).toContainText("苹果");
  await expect(panel.locator(".reader-context")).toContainText("An apple a day.");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(word).toBeFocused();
});

test("reader lookup fits the viewport and can close without losing reading position", async ({appFactory, page}, testInfo) => {
  await openReader(appFactory, page);
  await page.locator(".sw").first().click();
  const panel = page.locator(".story-word-panel");
  await expect(panel).toBeVisible();
  const viewport = page.viewportSize();
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  if (testInfo.project.name === "desktop") {
    const text = await page.locator(".story-sentence-en").boundingBox();
    expect(box.x).toBeGreaterThan(text.x + text.width);
  }
  await page.getByRole("button", {name: "关闭词语释义", exact: true}).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".story-sentence-en")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("reader lookup isolates the selected word's sentence", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "reader-design.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await page.locator(".story-item-main").click();
  await page.getByRole("button", {name: "查词 bookshop", exact: true}).click();
  await expect(page.locator(".reader-context blockquote")).toHaveText("Lily walked into a small bookshop near the park.");
  await expect(page.locator(".story-word-panel-meaning")).toContainText("书店");
});
