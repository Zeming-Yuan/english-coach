import {test, expect} from "./support/test.mjs";
import {contrastRatio} from "./support/color.mjs";

const starterButton = page => page.getByRole("button", {name: "体验入门词卡", exact: true});
const studyCount = page => page.locator(".study-count");
const libraryCards = async app => (await (await app.request.get("/api/cards")).json()).cards;

test("S95-07 no-ai keyboard start", async ({app, page}) => {
  await page.goto(app.baseURL);
  const starter = starterButton(page);
  await expect(starter).toBeVisible();
  await expect(page.getByText(/预计约\s*0\s*分钟/)).toHaveCount(0, {timeout: 3000});
  await expect(starter).toBeInViewport();
  const colors = await starter.evaluate(button => {
    const style = getComputedStyle(button);
    return {text: style.color, background: style.backgroundColor};
  });
  expect(colors.background).toMatch(/^rgb\(/);
  expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  await page.getByRole("combobox", {name: "今天可用时间"}).focus();
  await page.keyboard.press("Tab");
  await expect(starter).toBeFocused();
  const focus = await starter.evaluate(button => getComputedStyle(button).outlineStyle);
  expect(focus).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(studyCount(page)).toHaveText("1 / 10");
  await expect(page.locator(".front-main")).toHaveText("apple");
  expect(await libraryCards(app)).toHaveLength(10);
  expect(await app.externalCalls()).toEqual([]);
});

test("S95-07 repeated activation saves once and the homepage resumes the same round", async ({app, page}, testInfo) => {
  await page.goto(app.baseURL);
  const starter = starterButton(page);
  await expect(starter).toBeInViewport();
  let releaseSave;
  const pendingSave = new Promise(resolve => { releaseSave = resolve; });
  let submissions = 0;
  await page.route("**/api/cards/starter", async route => {
    submissions += 1;
    await pendingSave;
    await route.continue();
  });
  try {
    if (testInfo.project.use.hasTouch) {
      const {x, y, width, height} = await starter.boundingBox();
      await page.touchscreen.tap(x + width / 2, y + height / 2);
      await page.touchscreen.tap(x + width / 2, y + height / 2);
    } else {
      await starter.dblclick();
    }
  } finally {
    releaseSave();
  }
  await expect(studyCount(page)).toHaveText("1 / 10");
  await page.locator(".card").press("Enter");
  await page.locator(".rating-3").click();
  await expect(studyCount(page)).toHaveText("2 / 10");
  await page.goto(app.baseURL);
  await expect(page.getByTestId("round-target")).toHaveText("本轮目标 10 张", {timeout: 3000});
  await expect(starter).toHaveCount(0);
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(studyCount(page)).toHaveText("2 / 10");
  await expect(page.locator(".front-main")).toHaveText("banana");
  expect(await libraryCards(app)).toHaveLength(10);
  expect(submissions).toBe(1);
});

test("S95-07 configuration can be checked again and reached without generating cards", async ({app, page}) => {
  const generated = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/cards/generate") generated.push(request.method());
  });
  await page.route("**/api/ai-config", route => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  await expect(page.getByRole("alert").filter({hasText: "暂时无法确认 AI 配置"})).toBeVisible({timeout: 3000});
  await expect(starterButton(page)).toBeEnabled();
  await page.getByRole("button", {name: "重试读取 AI 配置", exact: true}).click();
  await expect(page.getByText("自定义加词需要配置 AI 服务。", {exact: true})).toBeVisible();
  await expect(page.getByText(/保存状态未知/)).toHaveCount(0);

  await page.route("**/api/ai-config", route => route.abort("failed"), {times: 1});
  await page.getByRole("button", {name: "去设置", exact: true}).click();
  await expect(page.getByRole("alert").filter({hasText: "AI 配置加载失败"})).toBeVisible();
  await expect(page.getByRole("button", {name: "保存配置", exact: true})).toBeDisabled();
  await page.getByRole("button", {name: "重试加载配置", exact: true}).click();
  await expect(page.getByText("密钥未配置", {exact: true})).toBeVisible();
  expect(generated).toEqual([]);
  expect(await libraryCards(app)).toEqual([]);
});

test("S95-07 missing config and lost settings save response are distinct", async ({app, page}) => {
  await page.goto(`${app.baseURL}/#/settings`);
  const missing = page.getByText("密钥未配置", {exact: true});
  await expect(missing).toBeVisible();
  await page.route("**/api/ai-config", async route => {
    expect(route.request().method()).toBe("PUT");
    const saved = await route.fetch();
    expect(saved.status()).toBe(200);
    await route.abort("failed");
  }, {times: 1});

  const model = page.getByLabel("模型", {exact: true});
  await model.fill("s95-test-model");
  const save = page.getByRole("button", {name: "保存配置", exact: true});
  await save.click();
  await expect(page.getByRole("alert")).toContainText("AI 配置保存状态未知", {timeout: 3000});
  await expect(missing).toHaveCount(0);
  await expect(save).toBeDisabled();
  await page.getByRole("button", {name: "重试加载配置", exact: true}).click();
  await expect(missing).toBeVisible();
  await expect(model).toHaveValue("s95-test-model");
  await expect(save).toBeEnabled();
});

test("S95-07 navigation to settings survives a late starter response", async ({app, page}) => {
  let releaseResponse;
  const pendingResponse = new Promise(resolve => { releaseResponse = resolve; });
  await page.route("**/api/cards/starter", async route => {
    const response = await route.fetch();
    await pendingResponse;
    await route.fulfill({response});
  });

  await page.goto(app.baseURL);
  try {
    await starterButton(page).click();
    await page.getByRole("button", {name: "去设置", exact: true}).click();
    await expect(page.getByRole("heading", {name: "AI 服务"})).toBeVisible();
  } finally {
    releaseResponse();
  }
  await expect(page.waitForURL("**/#/study", {timeout: 1000})).rejects.toThrow();
  await expect(page.getByRole("heading", {name: "AI 服务"})).toBeVisible();
  expect(await libraryCards(app)).toHaveLength(10);
});
