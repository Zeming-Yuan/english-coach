import {test, expect} from "./support/test.mjs";

async function openSpelling(page, app) {
  await page.goto(app.baseURL);
  const specialist = page.getByText("专项练习", {exact: true});
  if (await specialist.locator("..").getAttribute("open") === null) await specialist.click();
  await page.getByRole("button", {name: "拼写练习", exact: true}).click();
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
}

test("Qwerty independent input hides pronunciation and waits for saved feedback", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果", phonetic: "/ˈæpəl/"}]);
  await openSpelling(page, app);
  await expect(page.locator(".spelling-phonetic")).toHaveCount(0);
  await expect(page.locator(".spelling-box")).toHaveCount(0);
  const input = page.getByRole("textbox", {name: "英文拼写"});
  await input.fill("apx");
  await expect(input).toHaveValue("apx");
  await expect(page.locator(".qwerty-letter.is-incorrect")).toHaveCount(0);
  await input.press("Backspace");
  await input.pressSequentially("ple");
  await expect(input).toHaveValue("apple");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/typing/check", async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({response});
  });
  try {
    await input.press("Enter");
    await expect(input).toBeDisabled();
    await expect(page.locator(".spelling-feedback").filter({hasText: "已保存"})).toHaveCount(0);
    await expect(page.locator(".qwerty-typing-line")).not.toHaveAttribute("data-feedback", "correct");
  } finally { release(); }
  await expect(page.locator(".spelling-feedback")).toContainText("已保存");
  await expect(page.locator(".qwerty-typing-line")).toHaveAttribute("data-feedback", "correct");
  await expect(page.getByText("已保存 1 / 1", {exact: true})).toBeVisible();
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect(detail.learning_events).toHaveLength(1);
  expect(detail.learning_events[0].assistance).toEqual([]);
  expect(detail.learning_events[0].scheduled).toBe(true);
});

test("Qwerty character feedback is confined to explicitly assisted spelling", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "提示长度", exact: true}).click();
  const input = page.getByRole("textbox", {name: "英文拼写"});
  await input.fill("apx");
  await expect(page.locator(".qwerty-letter.is-incorrect")).toHaveText("x");
  await expect(page.locator(".qwerty-letter.is-correct")).toHaveText(["a", "p"]);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await expect(page.getByText("本题已使用提示，仍按辅助记录", {exact: true})).toBeVisible();
  await input.fill("apple");
  await expect(page.locator(".spelling-feedback")).toContainText("已保存");
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect(detail.learning_events).toHaveLength(1);
  expect(detail.learning_events[0].assistance).toEqual(["length", "live_feedback"]);
  expect(detail.learning_events[0].scheduled).toBe(false);
});

test("Qwerty failed save preserves text and reduced motion removes feedback movement", async ({app, page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  const [id] = await app.seedCards([{word: "internationalization", meaning: "国际化"}]);
  await openSpelling(page, app);
  const input = page.getByRole("textbox", {name: "英文拼写"});
  await page.route("**/api/typing/check", route => route.abort("failed"), {times: 1});
  await input.fill("a-long-answer-that-must-not-be-truncated");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("保存未确认");
  await expect(input).toHaveValue("a-long-answer-that-must-not-be-truncated");
  await page.getByRole("button", {name: "重试保存", exact: true}).click();
  await expect(page.locator(".spelling-feedback")).toContainText("已保存");
  await expect(page.locator(".qwerty-typing-line")).toHaveAttribute("data-feedback", "incorrect");
  expect(await page.locator(".qwerty-typing-line").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect(detail.learning_events).toHaveLength(1);
  expect(detail.learning_events[0].correct).toBe(false);
});

test("Qwerty composition Enter does not prematurely submit", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  const input = page.getByRole("textbox", {name: "英文拼写"});
  await input.fill("app");
  await input.dispatchEvent("keydown", {key: "Enter", code: "Enter", isComposing: true});
  const keyboard = await page.context().newCDPSession(page);
  await keyboard.send("Input.dispatchKeyEvent", {type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, text: "\r", unmodifiedText: "\r"});
  await keyboard.send("Input.dispatchKeyEvent", {type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229});
  await keyboard.detach();
  await expect(input).toBeEnabled();
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect(detail.learning_events).toHaveLength(0);
  await input.fill("apple");
  await page.getByRole("button", {name: "提交答案", exact: true}).click();
  await expect(page.locator(".spelling-feedback")).toContainText("已保存");
});

test("Qwerty Enter continues after a confirmed answer", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await openSpelling(page, app);
  await expect(page.locator(".spelling-meaning")).toHaveText("苹果");
  await page.getByRole("textbox", {name: "英文拼写"}).fill("apple");
  await page.getByRole("textbox", {name: "英文拼写"}).press("Enter");
  await expect(page.locator(".spelling-feedback")).toContainText("已保存");
  await page.keyboard.press("Enter");
  await expect(page.locator(".spelling-meaning")).toHaveText("书");
  await expect(page.getByRole("textbox", {name: "英文拼写"})).toHaveValue("");
});

test("Qwerty requested first-letter help is available through the accessible input description", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "提示首字母", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文拼写"})).toHaveAccessibleDescription("首字母提示：a");
});
