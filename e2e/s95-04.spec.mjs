import {test, expect} from "./support/test.mjs";

for (const [mode, expected] of [
  ["phrase", ["apple juice"]],
  ["batch", ["apple", "juice"]],
]) {
  test(`S95-04 preview and save as ${mode}`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: "s95-04-words.json"});
    await page.goto(`${app.baseURL}/#/add`);
    const input = page.getByRole("textbox", {name: "要添加的英文单词"});
    const inputMode = page.getByRole("combobox", {name: "输入方式"});
    const preview = page.getByRole("list", {name: "将添加的条目"}).getByRole("listitem");
    const submit = page.getByRole("button", {name: "AI 生成词卡", exact: true});
    await input.fill("   ");
    await expect(submit).toBeDisabled({timeout: 3000});
    await input.fill(" apple juice ");
    await expect(preview).toHaveText(["apple", "juice"]);
    await inputMode.focus();
    await page.keyboard.press("ArrowDown");
    await expect(preview).toHaveText(["apple juice"]);
    await inputMode.selectOption(mode);
    await expect(preview).toHaveText(expected);
    expect((await (await app.request.get("/api/cards")).json()).cards).toEqual([]);

    const sent = page.waitForRequest(request => request.url().endsWith("/api/cards/generate"));
    await submit.click();
    expect((await sent).postDataJSON().words).toEqual(expected);
    await expect(page.getByText(new RegExp(`生成 ${expected.length} 张卡`))).toBeVisible();

    await page.goto(`${app.baseURL}/#/words`);
    await page.reload();
    await expect(page.locator(".word-item-word")).toHaveText(expected.map(word => new RegExp(`^${word}词?$`)));
  });
}

test("S95-04 partial batch reports saved and missing entries before retry", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "s95-04-words.json"});
  await page.goto(`${app.baseURL}/#/add`);
  const input = page.getByRole("textbox", {name: "要添加的英文单词"});
  const preview = page.getByRole("list", {name: "将添加的条目"}).getByRole("listitem");
  const extraWords = Array.from({length: 20}, (_, index) => `word${index}`);
  await input.fill(`apple，APPLE, pear\n${extraWords.join("\n")}`);
  await expect(preview).toHaveText(["apple", "pear", ...extraWords.slice(0, 18)]);
  await expect(page.getByText(/本次仅提交前 20 项/)).toBeVisible();
  await input.fill("apple，APPLE, pear\n");
  await page.getByRole("button", {name: "AI 生成词卡", exact: true}).click();
  await expect(page.getByText(/生成 1 张卡：apple/)).toBeVisible({timeout: 3000});
  await expect(page.getByText("未保存：pear", {exact: true})).toBeVisible();
  await expect(input).toHaveValue("apple，APPLE, pear\n");

  await page.getByRole("button", {name: /重试/}).click();
  await expect(page.getByText("已存在：apple", {exact: true})).toBeVisible();
  await expect(page.getByText(/生成 1 张卡：pear/)).toBeVisible();
  const saved = (await (await app.request.get("/api/cards")).json()).cards;
  expect(saved.map(card => card.word).sort()).toEqual(["apple", "pear"]);
});

test("S95-04 retry after a lost save response preserves phrase mode and sentence identity", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "s95-04-words.json"});
  await app.seedCards([{word: "apple juice", kind: "sentence", example: "I ordered apple juice.", example_cn: "我点了苹果汁。"}]);
  await page.route("**/api/cards/generate", async route => {
    const saved = await route.fetch();
    expect(saved.status()).toBe(200);
    await route.abort("failed");
  }, {times: 1});

  await page.goto(`${app.baseURL}/#/add`);
  const input = page.getByRole("textbox", {name: "要添加的英文单词"});
  const mode = page.getByRole("combobox", {name: "输入方式"});
  await mode.selectOption("phrase");
  await input.fill(" apple juice ");
  await page.getByRole("button", {name: "AI 生成词卡", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("未能确认保存状态：apple juice", {timeout: 3000});
  await expect(mode).toHaveValue("phrase");
  await expect(input).toHaveValue(" apple juice ");
  await page.getByRole("button", {name: /重试/}).click();
  await expect(page.getByText("已存在：apple juice", {exact: true})).toBeVisible();

  await page.goto(`${app.baseURL}/#/words`);
  await page.reload();
  await expect(page.locator(".word-item-word")).toHaveText(["apple juice词"]);
  await page.getByRole("button", {name: "句子", exact: true}).click();
  await expect(page.locator(".word-item-word")).toHaveText(["I ordered apple juice.句子"]);
});
