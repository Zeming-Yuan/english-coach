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
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果", phonetic: "/ˈæpəl/"}]);
  await openSpelling(page, app);
  await page.getByRole("button", {name: "提示长度", exact: true}).click();
  await expect(page.locator(".spelling-phonetic")).toBeVisible();
  const input = page.getByRole("textbox", {name: "英文拼写"});
  await input.fill("apx");
  await expect(page.locator(".qwerty-letter.is-incorrect")).toHaveText("x");
  await expect(page.locator(".qwerty-letter.is-correct")).toHaveText(["a", "p"]);
  await page.getByRole("button", {name: "独立回忆", exact: true}).click();
  await expect(page.locator(".spelling-box")).toHaveCount(0);
  await expect(page.locator(".spelling-phonetic")).toHaveCount(0);
  await expect(page.getByText("本题已使用提示，仍按辅助记录", {exact: true})).toBeVisible();
  await input.fill("apple");
  await input.press("Enter");
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

test("Qwerty difficulty switcher stays compactly centered, handles mid-round transitions, and renders flagship correction card", async ({app, page}) => {
  const [bananaId, appleId, orangeId] = await app.seedCards([
    {word: "banana", meaning: "香蕉", phonetic: "/bəˈnɑːnə/"},
    {word: "apple", meaning: "苹果"},
    {word: "orange", meaning: "橙子"},
  ]);
  await openSpelling(page, app);

  // 1. Segmented switcher wraps its 3 buttons tightly and is centered inside .qwerty-spelling
  const layout = await page.evaluate(() => {
    const seg = document.querySelector(".qwerty-spelling .spelling-difficulty");
    const host = document.querySelector(".qwerty-spelling");
    const btns = Array.from(seg.querySelectorAll(".diff-btn")).map((b) => b.getBoundingClientRect());
    const segRect = seg.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const sumWidths = btns.reduce((acc, r) => acc + r.width, 0);
    return {
      segWidth: segRect.width,
      sumWidths,
      leftGap: segRect.left - hostRect.left,
      rightGap: hostRect.right - segRect.right,
      sameRow: Math.max(...btns.map((b) => b.top)) - Math.min(...btns.map((b) => b.top)) < 2,
    };
  });
  expect(layout.sameRow).toBe(true);
  expect(layout.segWidth).toBeLessThan(layout.sumWidths + 32);
  expect(Math.abs(layout.leftGap - layout.rightGap)).toBeLessThan(2);

  // 2. Switching 提示首字母 -> 提示长度 -> 独立回忆 updates visual UI immediately while preserving recorded assistance
  const firstBtn = page.getByRole("button", {name: "提示首字母", exact: true});
  const lengthBtn = page.getByRole("button", {name: "提示长度", exact: true});
  const indepBtn = page.getByRole("button", {name: "独立回忆", exact: true});
  const input = page.getByRole("textbox", {name: "英文拼写"});

  await firstBtn.click();
  await expect(input).toHaveAccessibleDescription("首字母提示：b");
  await expect(page.locator(".spelling-phonetic")).toBeVisible();
  await lengthBtn.click();
  await expect(input).not.toHaveAccessibleDescription("首字母提示：b");
  await expect(page.locator(".spelling-box")).toHaveCount(6);
  await indepBtn.click();
  await expect(page.locator(".spelling-box")).toHaveCount(0);
  await expect(page.locator(".spelling-phonetic")).toHaveCount(0);
  await expect(page.getByText("本题已使用提示，仍按辅助记录", {exact: true})).toBeVisible();

  await input.fill("baa");
  await input.press("Enter");
  await expect(page.locator(".spelling-feedback")).toContainText("已保存");

  // 3. Flagship correction card highlights missing span, stays unclipped, and avoids legacy 800 bold weight
  await expect(page.locator(".spelling-correction .sc-hl-expected")).toHaveText("nan");
  await expect(page.getByText("第 3 处缺少：nan", {exact: true})).toBeVisible();
  const cardBounds = await page.locator(".spelling-feedback").boundingBox();
  const footerBounds = await page.locator(".spelling-correction .sc-footer").boundingBox();
  const audioBounds = await page.getByRole("button", {name: "听正确发音", exact: true}).boundingBox();
  expect(footerBounds.y + footerBounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
  expect(audioBounds.y + audioBounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
  const feedbackWeight = await page.locator(".spelling-feedback").evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(feedbackWeight).toBeLessThan(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const firstCardDetail = await (await app.request.get(`/api/cards/${bananaId}`)).json();
  expect(firstCardDetail.learning_events[0].assistance).toEqual(["first_letter", "length", "live_feedback"]);

  // Switch back to 独立回忆 before advancing so next card starts independent
  await indepBtn.click();
  await page.getByRole("button", {name: "下一题 →", exact: true}).click();
  await expect(page.locator(".spelling-meaning")).toHaveText("苹果");

  // 4. Switching 独立回忆 -> 提示长度 clamps over-long draft without triggering premature auto-submit
  await input.fill("applepie");
  await lengthBtn.click();
  await expect(input).toHaveValue("apple");
  await page.waitForTimeout(450);
  await expect(page.locator(".spelling-feedback")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.locator(".spelling-feedback")).toContainText("拼写正确");

  const secondCardDetail = await (await app.request.get(`/api/cards/${appleId}`)).json();
  expect(secondCardDetail.learning_events[0].assistance).toEqual(["length", "live_feedback"]);

  // 5. Switching difficulty after feedback is shown does not mark completed independent card as assisted
  await indepBtn.click();
  await page.getByRole("button", {name: "下一题 →", exact: true}).click();
  await expect(page.locator(".spelling-meaning")).toHaveText("橙子");
  await input.fill("orange");
  await input.press("Enter");
  await expect(page.locator(".spelling-feedback")).toContainText("拼写正确");
  await firstBtn.click();
  await expect(page.getByText("本题已使用提示，仍按辅助记录")).toHaveCount(0);
  await expect(page.getByText("下一题将切换为「提示首字母」")).toBeVisible();

  const thirdCardDetail = await (await app.request.get(`/api/cards/${orangeId}`)).json();
  expect(thirdCardDetail.learning_events[0].assistance).toEqual([]);
});
