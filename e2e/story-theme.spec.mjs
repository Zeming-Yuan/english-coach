import {test, expect} from "./support/test.mjs";

test("word detail keeps content and evidence readable in the approved story family", async ({appFactory, page}, testInfo) => {
  const app = await appFactory({fixture: "full-design.json"});
  await page.goto(app.baseURL);
  if (testInfo.project.name === "desktop") {
    await page.getByRole("navigation", {name: "主导航", exact: true}).getByRole("button", {name: "单词本", exact: true}).click();
  } else {
    await page.locator(".bottom-nav").getByRole("button", {name: "单词本", exact: true}).click();
  }
  await page.locator(".word-item").filter({hasText: "apple"}).click();
  const content = page.getByRole("region", {name: "词条内容", exact: true});
  const evidence = page.getByRole("complementary", {name: "学习状态与记录", exact: true});
  await expect(content).toBeVisible();
  await expect(evidence).toBeVisible();
  await expect(content).toContainText("I have an apple.");
  const mainBox = await content.boundingBox();
  const evidenceBox = await evidence.boundingBox();
  if (testInfo.project.name === "desktop") {
    expect(evidenceBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width);
  } else {
    expect(evidenceBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height);
  }
  page.once("dialog", dialog => dialog.accept("苹果（水果）"));
  await page.getByRole("button", {name: "编辑内容", exact: true}).click();
  await expect(content).toContainText("苹果（水果）");
  await expect(evidence.getByTestId("learning-evidence")).toContainText("独立证据不足");
  await page.getByRole("button", {name: "测这个词", exact: true}).click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("word detail shows the full long word at narrow desktop and mobile widths", async ({appFactory, page}, testInfo) => {
  const app = await appFactory();
  await app.seedCards([{word: "extraordinary", meaning: "非凡的"}]);
  await page.setViewportSize(testInfo.project.name === "desktop" ? {width: 1024, height: 800} : {width: 420, height: 880});
  await page.goto(app.baseURL);
  const navigation = testInfo.project.name === "desktop"
    ? page.getByRole("navigation", {name: "主导航", exact: true})
    : page.locator(".bottom-nav");
  await navigation.getByRole("button", {name: "单词本", exact: true}).click();
  await page.locator(".word-item").filter({hasText: "extraordinary"}).click();
  const word = page.locator(".word-detail-word");
  await expect(word).toHaveText("extraordinary");
  await page.evaluate(() => document.fonts.ready);
  const box = await word.evaluate(el => ({visible: el.clientWidth, content: el.scrollWidth}));
  expect(box.content).toBeLessThanOrEqual(box.visible);
});

test("workspace navigation stays available in settings and returns to the word list", async ({appFactory, page}, testInfo) => {
  const app = await appFactory({fixture: "full-design.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await expect(page.getByText("发音速度", {exact: true})).toBeVisible();
  const navigation = testInfo.project.name === "desktop"
    ? page.getByRole("navigation", {name: "主导航", exact: true})
    : page.locator(".bottom-nav");
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", {name: "单词本", exact: true}).click();
  await expect(page.locator(".word-search-input")).toBeVisible();
});

test("the learning workspace loads without external font services", async ({app, page}) => {
  const externalFonts = [];
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
    externalFonts.push(route.request().url());
    return route.abort("failed");
  });
  await page.goto(app.baseURL);
  await expect(page.getByText("今天的学习", {exact: true})).toBeVisible();
  expect(externalFonts).toEqual([]);
});
