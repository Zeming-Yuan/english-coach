import { test, expect } from "./support/test.mjs";
import { relativeLuminance } from "./support/color.mjs";

test("Tier 1.1: login brand renders terracotta book icon and Tinos serif wordmark matching workspace sidebar", async ({
  app,
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: true, username: null }),
    }),
  );

  await page.goto(app.baseURL);
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();

  const brand = page.locator(".login-brand");
  await expect(brand.locator("img")).toHaveCount(0);
  await expect(brand.locator("svg")).toBeVisible();
  await expect(brand.locator("svg")).toHaveCSS("color", "rgb(162, 98, 67)");

  const font = await brand
    .locator("span")
    .evaluate((el) => ({
      family: getComputedStyle(el).fontFamily,
      weight: getComputedStyle(el).fontWeight,
    }));
  expect(font.family).toMatch(/Tinos/);
  expect(font.weight).toBe("700");
});

function nonTouchingGap(a, b) {
  const sameRow = a.y < b.y + b.height - 2 && b.y < a.y + a.height - 2;
  if (sameRow) {
    return a.x <= b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
  }
  return a.y <= b.y ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
}

test("Tier 1.2: story library generation controls maintain clean spacing between checkbox and action buttons", async ({
  app,
  page,
}) => {
  await page.goto(`${app.baseURL}/#/stories`);
  const checkbox = page.getByRole("checkbox");
  const genBtn = page.getByRole("button", { name: "生成新故事", exact: true });
  const starterBtn = page.getByRole("button", {
    name: "阅读入门材料",
    exact: true,
  });

  await expect(genBtn).toBeVisible();
  await expect(starterBtn).toBeVisible();

  const labelGap = await checkbox.evaluate((input) => {
    const label = input.closest("label");
    const style = label ? getComputedStyle(label) : null;
    return style ? parseFloat(style.columnGap || style.gap || "0") : 0;
  });
  expect(labelGap).toBeGreaterThanOrEqual(8);

  const genBox = await genBtn.boundingBox();
  const starterBox = await starterBtn.boundingBox();
  expect(nonTouchingGap(genBox, starterBox)).toBeGreaterThanOrEqual(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Tier 1.3: lesson list and detail deduplicate headings, space progress items, hide empty dialogue, and keep single primary CTA", async ({
  appFactory,
  page,
}, testInfo) => {
  const emptyDialogueApp = await appFactory({ fixture: "full-design.json" });
  await page.goto(`${emptyDialogueApp.baseURL}/#/lessons`);

  await expect(page.locator(".lesson-entry-title")).toHaveText("第 1 课");
  await expect(page.locator(".lesson-list-item-title").first()).toHaveText(
    "第 1 课",
  );

  await page.locator(".lesson-list-item").first().click();
  await expect(page.locator("h2.page-title")).toHaveText("第 1 课");
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  await expect(page.getByText("对话 · 点句子听发音")).toHaveCount(0);

  const progressSpans = page.getByTestId("lesson-progress").locator("span");
  await expect(progressSpans).toHaveCount(2);
  const firstSpan = await progressSpans.nth(0).boundingBox();
  const secondSpan = await progressSpans.nth(1).boundingBox();
  expect(nonTouchingGap(firstSpan, secondSpan)).toBeGreaterThanOrEqual(8);

  const actions = page.locator(".lesson-actions");
  await expect(actions.locator(".btn-primary")).toHaveCount(1);
  await expect(
    actions.getByRole("button", { name: "开始本课短测", exact: true }),
  ).toHaveClass(/\bbtn-primary\b/);
  const viewedBtn = actions.getByRole("button", {
    name: "内容已看完",
    exact: true,
  });
  await expect(viewedBtn).toHaveClass(/\bbtn-ghost\b/);

  if (testInfo.project.name === "desktop") {
    const checkBox = await actions
      .getByRole("button", { name: "开始本课短测", exact: true })
      .boundingBox();
    const nextBox = await actions
      .getByRole("button", { name: "稍后检查，继续下一课", exact: true })
      .boundingBox();
    expect(Math.abs(checkBox.y - nextBox.y)).toBeLessThanOrEqual(2);
  }

  await viewedBtn.click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已浏览");
  await expect(viewedBtn).toHaveClass(/\blesson-viewed-done\b/);
  await viewedBtn.hover();
  await expect(viewedBtn).toHaveCSS("color", "rgb(75, 113, 88)");
  await expect(viewedBtn).toHaveCSS("background-color", "rgb(234, 240, 232)");

  const dialogueApp = await appFactory({ fixture: "el06-lesson-dialogue.json" });
  await page.goto(`${dialogueApp.baseURL}/#/lessons`);
  await expect(page.locator(".lesson-list-item-title").first()).toHaveText(
    "第 1 课 · 对话课",
  );
  await page.locator(".lesson-list-item").first().click();
  await expect(page.locator(".eyebrow")).toHaveText("第 1 课");
  await expect(page.locator("h2.page-title")).toHaveText("对话课");
  await expect(page.getByText("对话 · 点句子听发音")).toBeVisible();
});

async function assertQwertyBottomLineInput(page) {
  const line = page.locator(".qwerty-typing-line");
  const input = page.locator(".qwerty-typing .spelling-input");
  await expect(line).toBeVisible({ timeout: 2000 });
  await expect(input).toBeVisible();
  const styles = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    const lineCs = getComputedStyle(el.closest(".qwerty-typing-line"));
    return {
      inputBorderTop: cs.borderTopWidth,
      inputBg: cs.backgroundColor,
      lineBorderBottom: lineCs.borderBottomWidth,
    };
  });
  expect(styles).toEqual({
    inputBorderTop: "0px",
    inputBg: "rgba(0, 0, 0, 0)",
    lineBorderBottom: "1px",
  });
}

test("Tier 1.4: DailySession reinforcement, Quiz typed items, and Mixed spell items share the borderless Qwerty bottom-line input surface", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();
  await app.seedCards([{ word: "apple", meaning: "苹果" }]);

  // 1. DailySession reinforcement (independent + assisted caret hiding)
  await page.goto(app.baseURL);
  await page.getByRole("button", { name: "开始今天的学习", exact: true }).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(
    page.getByRole("heading", { name: "本轮巩固", exact: true }),
  ).toBeVisible();
  await assertQwertyBottomLineInput(page);

  await page.getByRole("button", { name: "提示首字母", exact: true }).click();
  await expect(page.locator(".qwerty-typing .spelling-input")).toHaveCSS(
    "caret-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.getByRole("button", { name: "← 退出", exact: true }).click();

  // 2. Quiz typed question (cn2en)
  await page.goto(`${app.baseURL}/#/quiz`);
  await expect(page.locator(".quiz-prompt")).toContainText("苹果");
  await assertQwertyBottomLineInput(page);

  // 3. Mixed spell question (independent + assisted)
  await page.goto(`${app.baseURL}/#/mixed`);
  await expect(page.locator(".study-count")).toContainText("拼写");
  await assertQwertyBottomLineInput(page);
  await page.getByRole("button", { name: "提示首字母", exact: true }).click();
  await expect(page.locator(".qwerty-typing .spelling-input")).toHaveCSS(
    "-webkit-text-fill-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("Tier 1.5: dark mode heatmap increases luminance monotonically from l0 to l3 and SessionRoot honors dark preference on login", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("ec.seeded")) {
      sessionStorage.setItem("ec.seeded", "1");
      localStorage.setItem("darkMode", "true");
    }
  });

  await page.goto(`${app.baseURL}/#/stats`);
  await expect(page.locator(".cal-legend")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);

  const legendColors = await page
    .locator(".cal-legend .cal-cell")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(legendColors).toHaveLength(4);
  const [l0, l1, l2, l3] = legendColors.map(relativeLuminance);
  expect(l0).toBeLessThan(l1);
  expect(l1).toBeLessThan(l2);
  expect(l2).toBeLessThan(l3);

  // Pre-auth loading & LoginPage honor dark preference immediately and prime account dark mode on login
  let releaseSession;
  await page.route("**/auth/session", async (route) => {
    await new Promise((resolve) => {
      releaseSession = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: true, username: null }),
    });
  });
  const pendingGoto = page.goto(app.baseURL, { waitUntil: "commit" });
  await expect(page.locator(".session-loading")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  releaseSession();
  await pendingGoto;
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  const loginBg = await page
    .locator(".login-page")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(relativeLuminance(loginBg)).toBeLessThan(0.05);

  // Multi-account shared browser: after a light user logged out (ec.ui.dark=false),
  // logging in as a dark-mode account primes ec.ui.dark=true before reload.
  await page.evaluate(() => {
    localStorage.removeItem("darkMode");
    localStorage.setItem("ec.ui.dark", "false");
    localStorage.setItem("ec.account.owner:darkMode", "true");
  });
  await page.unroute("**/auth/session");
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: true, username: null }),
    }),
  );
  await page.route("**/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ username: "owner" }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);

  await page.getByLabel("用户名", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("secret");
  let releasePostLoginSession;
  await page.unroute("**/auth/session");
  await page.route("**/auth/session", async (route) => {
    await new Promise((resolve) => {
      releasePostLoginSession = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: true, username: "owner" }),
    });
  });
  await page.getByRole("button", { name: "登录并开始学习", exact: true }).click();
  await expect(page.locator(".session-loading")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  releasePostLoginSession();
  await expect(page.getByLabel("当前账号")).toHaveText("owner");
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
});
