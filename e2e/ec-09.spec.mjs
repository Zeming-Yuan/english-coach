import {test, expect} from "./support/test.mjs";

test("EC-09 no-samples", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("retrieval-metric")).toContainText("暂无数据");
  await expect(page.getByTestId("self-report-metric")).toContainText("暂无数据");
});

test("EC-09 target-does-not-override-new-limit", async ({app, page}) => {
  const cards = [
    {word: "apple", meaning: "苹果"},
    ...Array.from({length: 6}, (_, i) => ({word: `word${i}`, meaning: "测试词"})),
  ];
  const [id] = await app.seedCards(cards);
  await app.request.post("/api/reviews", {
    data: {
      card_id: id,
      rating: 1,
      source: "study",
      kind: "self_rating",
      submission_id: crypto.randomUUID(),
    },
  });

  await page.goto(app.baseURL);
  await page.locator(".goal-daily-set").selectOption("20");
  await expect(page.getByTestId("new-word-limit")).toContainText("5");
  await expect(page.locator("body")).not.toContainText("${");
});

test("EC-09 metrics-separate-categories", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.request.post("/api/reviews", {
    data: {
      card_id: id,
      rating: 4,
      source: "study",
      kind: "self_rating",
      submission_id: crypto.randomUUID(),
    },
  });
  const typed = await app.request.post("/api/typing/check", {
    data: {
      card_id: id,
      user_input: "apple",
      source: "spelling",
      kind: "typed",
      submission_id: crypto.randomUUID(),
    },
  });
  expect(typed.status()).toBe(200);

  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("self-report-metric")).toContainText("100%");
  await expect(page.getByTestId("retrieval-metric")).toContainText("100%");
});
