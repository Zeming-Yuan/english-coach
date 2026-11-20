import { test, expect } from "./support/test.mjs";

function relativeLuminance(rgbString) {
  const [r, g, b] = rgbString
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map((v) => Number(v) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("Tier 2.1: flashcard and choice cards have distinct layered paper surface and tactile elevation over canvas", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();
  await app.seedCards([
    { word: "apple", meaning: "苹果" },
    { word: "banana", meaning: "香蕉" },
    { word: "orange", meaning: "橙子" },
    { word: "grape", meaning: "葡萄" },
  ]);

  await page.goto(app.baseURL);
  await page.getByRole("button", { name: "开始今天的学习", exact: true }).click();
  const cardFront = page.locator(".card-face.card-front");
  await expect(cardFront).toBeVisible();

  const lightSurface = await cardFront.evaluate((el) => {
    const cs = getComputedStyle(el);
    const appCs = getComputedStyle(el.closest(".app.product-app"));
    return {
      cardBg: cs.backgroundColor,
      paperBg: appCs.backgroundColor,
      shadow: cs.boxShadow,
    };
  });
  expect(lightSurface.cardBg).not.toBe(lightSurface.paperBg);
  expect(relativeLuminance(lightSurface.cardBg)).toBeGreaterThan(
    relativeLuminance(lightSurface.paperBg),
  );
  expect(lightSurface.shadow).not.toBe("none");

  await page.evaluate(() => document.body.classList.add("dark"));
  const darkSurface = await cardFront.evaluate((el) => {
    const cs = getComputedStyle(el);
    const appCs = getComputedStyle(el.closest(".app.product-app"));
    return {
      cardBg: cs.backgroundColor,
      paperBg: appCs.backgroundColor,
      shadow: cs.boxShadow,
    };
  });
  expect(darkSurface.cardBg).not.toBe(darkSurface.paperBg);
  expect(relativeLuminance(darkSurface.cardBg)).toBeGreaterThan(
    relativeLuminance(darkSurface.paperBg),
  );
  expect(darkSurface.shadow).not.toBe("none");
  await page.evaluate(() => document.body.classList.remove("dark"));

  await page.goto(`${app.baseURL}/#/listening`);
  const option = page.locator(".listening-option").first();
  await expect(option).toBeVisible();
  const optionSurface = await option.evaluate((el) => {
    const cs = getComputedStyle(el);
    const appCs = getComputedStyle(el.closest(".app.product-app"));
    return {
      optionBg: cs.backgroundColor,
      paperBg: appCs.backgroundColor,
      shadow: cs.boxShadow,
    };
  });
  expect(optionSurface.optionBg).not.toBe(optionSurface.paperBg);
  expect(optionSurface.shadow).not.toBe("none");
});

test("Tier 2.2: StatsPage aligns evidence and metrics as key-value panels, grids retention windows, and gives weekly chart axis and neutral empty state", async ({
  appFactory,
  page,
}, testInfo) => {
  const app = await appFactory();
  await app.seedCards([{ word: "apple", meaning: "苹果" }]);

  await page.goto(`${app.baseURL}/#/stats`);
  const evidence = page.getByTestId("evidence-overview");
  const metrics = page.getByTestId("metrics-overview");
  const retention = page.getByTestId("retention-overview");

  await expect(evidence.locator("dl dt")).toHaveCount(5);
  await expect(metrics.locator("dl dt")).toHaveCount(4);
  await expect(retention.locator(".retention-window")).toHaveCount(3);

  if (testInfo.project.name === "desktop") {
    const evBox = await evidence.boundingBox();
    const metBox = await metrics.boundingBox();
    expect(Math.abs(evBox.y - metBox.y)).toBeLessThanOrEqual(2);
    expect(metBox.x).toBeGreaterThanOrEqual(evBox.x + evBox.width);

    const win0 = await retention.locator(".retention-window").nth(0).boundingBox();
    const win1 = await retention.locator(".retention-window").nth(1).boundingBox();
    const win2 = await retention.locator(".retention-window").nth(2).boundingBox();
    expect(Math.abs(win0.y - win1.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(win1.y - win2.y)).toBeLessThanOrEqual(2);
  }

  const weekAcc = page.locator(".weekly-accuracy .week-acc");
  await expect(weekAcc).toHaveText("（暂无）");
  const weekAccColor = await weekAcc.evaluate((el) => getComputedStyle(el).color);
  expect(weekAccColor).not.toBe("rgb(161, 76, 61)");

  await expect(page.locator(".weekly-accuracy .week-axis-label")).toHaveCount(8);
  await expect(page.locator(".weekly-accuracy")).toContainText("暂无排期复习记录");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("Tier 2.3: AddPage separates primary AI generation and secondary starter pack into structured cards with a single primary CTA", async ({
  app,
  page,
}, testInfo) => {
  await page.goto(`${app.baseURL}/#/add`);
  const primaryPanel = page.locator(".add-primary-panel");
  const starterPanel = page.locator(".add-starter-panel");
  await expect(primaryPanel).toBeVisible();
  await expect(starterPanel).toBeVisible();

  await expect(page.locator(".add-workspace-grid .btn-primary")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "AI 生成词卡", exact: true }),
  ).toHaveClass(/\bbtn-primary\b/);
  await expect(
    page.getByRole("button", { name: "体验入门词卡", exact: true }),
  ).toHaveClass(/\bbtn-ghost\b/);

  const pBox = await primaryPanel.boundingBox();
  const sBox = await starterPanel.boundingBox();
  if (testInfo.project.name === "desktop") {
    expect(sBox.x).toBeGreaterThanOrEqual(pBox.x + pBox.width);
    expect(Math.abs(pBox.y - sBox.y)).toBeLessThanOrEqual(2);
  } else {
    expect(sBox.y).toBeGreaterThanOrEqual(pBox.y + pBox.height);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("Tier 2.4: WordDetail edits meaning and memo inline on the page without native browser prompt dialogs", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();
  await app.seedCards([{ word: "apple", meaning: "苹果" }]);

  let dialogCount = 0;
  page.on("dialog", async (dialog) => {
    dialogCount += 1;
    await dialog.dismiss();
  });

  await page.goto(`${app.baseURL}/#/words`);
  await page.locator(".word-item", { hasText: "apple" }).first().click();
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");

  await page.getByRole("button", { name: "编辑内容", exact: true }).click();
  expect(dialogCount).toBe(0);
  const meaningInput = page.getByRole("textbox", { name: "编辑词义", exact: true });
  await expect(meaningInput).toBeVisible();
  await expect(meaningInput).toHaveValue("苹果");

  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(meaningInput).toHaveCount(0);
  await expect(page.locator(".word-detail-meaning")).toHaveText("苹果");
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");

  await page.getByRole("button", { name: "编辑内容", exact: true }).click();
  await meaningInput.fill("脆甜苹果");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(meaningInput).toHaveCount(0);
  await expect(page.locator(".word-detail-meaning")).toHaveText("脆甜苹果");
  await expect(page.getByTestId("revision-panel")).toContainText("第 2 版");
  expect(dialogCount).toBe(0);

  await page.getByRole("button", { name: "写个记忆法", exact: true }).click();
  expect(dialogCount).toBe(0);
  const memoInput = page.getByRole("textbox", { name: "编辑记忆法", exact: true });
  await expect(memoInput).toBeVisible();
  await memoInput.fill("A-P-P-L-E 红彤彤的苹果");
  await page.getByRole("button", { name: "保存记忆法", exact: true }).click();
  await expect(memoInput).toHaveCount(0);
  await expect(page.locator(".word-detail-memo")).toContainText(
    "A-P-P-L-E 红彤彤的苹果",
  );

  await page.locator(".word-detail-memo").getByRole("button", { name: "编辑记忆法", exact: true }).click();
  await expect(memoInput).toHaveValue("A-P-P-L-E 红彤彤的苹果");
  await memoInput.fill("一天一苹果，医生远离我");
  await page.getByRole("button", { name: "保存记忆法", exact: true }).click();
  await expect(page.locator(".word-detail-memo")).toContainText(
    "一天一苹果，医生远离我",
  );
  expect(dialogCount).toBe(0);
});
