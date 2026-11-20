import {test, expect} from "./support/test.mjs";

async function openExpansion(page, word) {
  await page.locator(".card").press("Enter");
  await page.getByRole("button", {name: "多学一个", exact: true}).click();
  await page.getByRole("region", {name: "构词与扩展"})
    .getByRole("button", {name: new RegExp(`^${word} `)}).click();
  return page.getByRole("dialog");
}

const wordCards = async app => (await (await app.request.get("/api/cards")).json()).cards
  .filter(card => card.kind === "word");

test("S95-02 explicit add and return to the original ten", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  const preview = await openExpansion(page, "apply");
  expect(await wordCards(app)).toHaveLength(10);
  await preview.getByRole("button", {name: "加入学习", exact: true}).click({timeout: 4000});
  await expect(preview.getByText("已加入学习", {exact: true})).toBeVisible();
  await preview.getByRole("button", {name: "返回原词卡"}).click();
  await expect(page.locator(".card.flipped .back-meaning")).toHaveText("苹果");
  await expect(page.locator(".study-count")).toHaveText("1 / 10");
  expect((await wordCards(app)).filter(card => card.word === "apply")).toHaveLength(1);
  await page.getByRole("button", {name: /太简单/}).click();
  await expect(page.locator(".card-front")).toContainText("banana");
  await expect(page.locator(".study-count")).toHaveText("2 / 10");
});

test("S95-02 response lost and refresh keeps the operation and source round", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  const preview = await openExpansion(page, "apply");
  const operations = [];
  await page.route("**/api/cards/*/expansion-additions", async route => {
    operations.push(route.request().postDataJSON().operation_id);
    if (operations.length !== 1) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await preview.getByRole("button", {name: "加入学习", exact: true}).click();
  await expect(preview.getByRole("alert")).toContainText("待确认");
  await page.reload();
  await page.getByRole("button", {name: "继续确认加入", exact: true}).click();
  await expect(page.getByText("已确认加入", {exact: true})).toBeVisible();
  expect(operations).toHaveLength(2);
  expect(operations[0]).toBe(operations[1]);
  await page.getByRole("button", {name: "打开词卡", exact: true}).click();
  await expect(page.locator(".word-detail-word")).toHaveText("apply");
  await page.getByRole("button", {name: "返回原词卡", exact: true}).click();
  await expect(page.locator(".card.flipped .back-meaning")).toHaveText("苹果");
  await expect(page.locator(".study-count")).toHaveText("1 / 10");
  expect((await wordCards(app)).filter(card => card.word === "apply")).toHaveLength(1);
});

test("S95-02 opens a custom card and preserves a selected phrase", async ({app, page}) => {
  const [existing] = await app.seedCards([{word: " Apply ", meaning: "我自己的释义"}]);
  await app.request.post("/api/cards/starter");
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习"}).click();
  await page.locator(".card").press("Enter");
  await page.getByRole("button", {name: /太简单/}).click();
  await expect(page.locator(".card-front")).toContainText("apple");
  const preview = await openExpansion(page, "apply");
  await preview.getByRole("button", {name: "加入学习", exact: true}).click();
  await preview.getByRole("button", {name: "打开已有词卡"}).click();
  await expect(page.locator(".word-detail-meaning")).toHaveText("我自己的释义");
  await page.getByRole("button", {name: "返回原词卡", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("2 / 10");
  await expect(page.locator(".card.flipped .back-meaning")).toHaveText("苹果");
  await page.getByRole("button", {name: "多学一个", exact: true}).click();
  await page.getByRole("region", {name: "构词与扩展"}).getByRole("button", {name: /^apple juice /}).click();
  await preview.getByRole("button", {name: "加入学习", exact: true}).click();
  await expect(preview.getByText("已加入学习", {exact: true})).toBeVisible();
  expect((await wordCards(app)).some(card => card.word === "apple juice")).toBe(true);
  expect((await app.request.get(`/api/cards/${existing}`)).ok()).toBe(true);
});

test("S95-02 late confirmation does not switch the current card", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  const preview = await openExpansion(page, "apply");
  let release;
  let accepted;
  const delayed = new Promise(resolve => { release = resolve; });
  const committed = new Promise(resolve => { accepted = resolve; });
  await page.route("**/api/cards/*/expansion-additions", async route => {
    const response = await route.fetch();
    accepted(response.ok());
    await delayed;
    await route.fulfill({response});
  });
  try {
    await preview.getByRole("button", {name: "加入学习", exact: true}).click();
    expect(await committed).toBe(true);
    await preview.getByRole("button", {name: "返回原词卡"}).click();
    await page.getByRole("button", {name: /太简单/}).click();
    await expect(page.locator(".card-front")).toContainText("banana");
    const response = page.waitForResponse(row => row.url().endsWith("/expansion-additions") &&
      row.request().method() === "POST");
    release();
    await response;
  } finally {
    release();
  }
  await expect(page.locator(".study-count")).toHaveText("2 / 10");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await wordCards(app)).filter(card => card.word === "apply")).toHaveLength(1);
});
