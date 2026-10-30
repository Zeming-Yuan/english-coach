import {test, expect} from "./support/test.mjs";

test("EC-03 appended-history", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.request.post("/api/reviews", {data: {card_id: id, rating: 1}});
  await app.request.post("/api/reviews", {data: {card_id: id, rating: 3}});

  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).first().click();

  await expect(page.getByTestId("learning-event")).toHaveCount(2);
  await expect(page.getByText(/历史记录不完整/)).toBeVisible();
});

test("EC-03 upgraded-history-notice", async ({appFactory, page}) => {
  const instance = await appFactory({fixture: "ec03-baseline.json"});
  const today = await instance.request.get("/api/today");
  expect(today.status()).toBe(200);

  await page.goto(instance.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).first().click();

  await expect(page.getByText(/历史记录不完整/)).toBeVisible();
  await expect(page.getByTestId("learning-event")).toHaveCount(0);
});

test("EC-03 unknown-is-not-objective-success", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.request.post("/api/reviews", {data: {card_id: id, rating: 2}});

  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).first().click();

  await expect(page.getByTestId("learning-event")).toContainText("未分类");
  await expect(page.getByTestId("learning-event")).not.toContainText("答错");
});
