import {test, expect} from "./support/test.mjs";

async function cards(app) {
  return (await (await app.request.get("/api/cards")).json()).cards;
}

function addNav(page) {
  return page.getByRole("navigation").getByRole("button", {name: /加词/});
}

test("EC-02 first-learning without ai", async ({app, page}) => {
  // RF4：没有 AI 密钥时本地入门与学习照常，AI 生成明确未配置
  const aiResponse = await app.request.post("/api/cards/generate", {
    data: {words: ["pear"]},
  });
  expect(aiResponse.status()).toBe(503);

  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.locator(".study-count")).toContainText("1");
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect
    .poll(async () => (await cards(app)).filter((card) => card.review_count > 0).length)
    .toBe(1);
  expect(await cards(app)).toHaveLength(10);
});

test("EC-02 retry-after-failure", async ({app, page}) => {
  // RF5：添加失败不显示成功、不进入学习，重试后正常加入
  await page.route("**/api/cards/starter", (route) => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".study-count")).toHaveCount(0);
  expect(await cards(app)).toHaveLength(0);

  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.locator(".study-count")).toBeVisible();
  await expect.poll(async () => (await cards(app)).length).toBe(10);
});

test("EC-02 keeps custom card content", async ({app, page}) => {
  // RF2：同名自定义单词不被覆盖（老用户从「加词」页显式添加）
  await app.seedCards([{word: "apple", kind: "word", meaning: "我的自定义内容"}]);
  await page.goto(app.baseURL);
  await addNav(page).click();
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.locator(".study-count")).toBeVisible();
  await page.getByRole("button", {name: /退出/}).click();
  await page.getByRole("navigation").getByRole("button", {name: /单词本/}).click();
  await expect(page.getByText("我的自定义内容")).toBeVisible();

  const all = await cards(app);
  const appleWords = all.filter((card) => card.word === "apple" && card.kind === "word");
  expect(appleWords).toHaveLength(1);
  expect(appleWords[0].meaning).toBe("我的自定义内容");
  expect(all.filter((card) => card.kind === "word")).toHaveLength(10);
});

test("EC-02 sentence-card-does-not-block-word", async ({app, page}) => {
  // RF3：同词句子卡不阻止新增单词卡，两者各自独立
  await app.seedCards([
    {word: "apple", kind: "sentence", meaning: "我的句子卡", example: "An apple a day.", example_cn: "一天一苹果。"},
  ]);
  await page.goto(app.baseURL);
  await addNav(page).click();
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.locator(".study-count")).toBeVisible();

  await expect.poll(async () => (await cards(app)).length).toBe(11);
  const all = await cards(app);
  const appleWords = all.filter((card) => card.word === "apple" && card.kind === "word");
  const appleSentences = all.filter((card) => card.word === "apple" && card.kind === "sentence");
  expect(appleWords).toHaveLength(1);
  expect(appleSentences).toHaveLength(1);
  expect(appleSentences[0].meaning).toBe("我的句子卡");
});

test("EC-02 repeat-add-does-not-duplicate", async ({app, page}) => {
  // RF1：从首页加载后，再从「加词」页重复操作，不重复创建且说明已存在
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.locator(".study-count")).toBeVisible();
  await page.getByRole("button", {name: /退出/}).click();

  await addNav(page).click();
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await expect(page.getByText("入门词卡已存在")).toBeVisible();
  await expect(page.getByRole("heading", {name: "单词本"})).toBeVisible();
  expect(await cards(app)).toHaveLength(10);

  const repeated = await app.request.post("/api/cards/starter");
  expect((await repeated.json()).generated).toBe(0);
});
