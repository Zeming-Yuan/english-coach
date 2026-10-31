import {test, expect} from "./support/test.mjs";

test("EC-04 response-loss-reload", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.route("**/api/reviews", async (route) => {
    await route.fetch();
    await route.abort("failed");
  }, {times: 1});
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await page.reload();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect
    .poll(async () => (await (await app.request.get("/api/cards/" + id)).json()).learning_events.length)
    .toBe(1);
  const card = await (await app.request.get("/api/cards/" + id)).json();
  expect(card.memory_state.review_count).toBe(1);
});

async function openFirstFlashcard(app, page, cards) {
  const ids = await app.seedCards(cards);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  return ids;
}

test("EC-04 transport-failure-retry", async ({app, page}) => {
  const [id] = await openFirstFlashcard(app, page, [{word: "apple", meaning: "苹果"}]);
  await page.route("**/api/reviews", (route) => route.abort("failed"), {times: 1});
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.locator(".study-done")).toHaveCount(0);
  await expect(page.locator(".study-count")).toContainText("1 / 1");

  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.locator(".study-done")).toBeVisible();
  await expect
    .poll(async () => (await (await app.request.get("/api/cards/" + id)).json()).learning_events.length)
    .toBe(1);
});

test("EC-04 commit-failure-retry", async ({app, page}) => {
  const [id] = await openFirstFlashcard(app, page, [{word: "apple", meaning: "苹果"}]);
  await app.failCommitOnce();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.locator(".study-done")).toHaveCount(0);

  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.locator(".study-done")).toBeVisible();
  await expect
    .poll(async () => (await (await app.request.get("/api/cards/" + id)).json()).learning_events.length)
    .toBe(1);
});

test("EC-04 storage-degraded-warning", async ({app, page}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith("ec.pending.")) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });
  const [id] = await openFirstFlashcard(app, page, [{word: "apple", meaning: "苹果"}]);
  await page.route("**/api/reviews", (route) => route.abort("failed"), {times: 1});
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("刷新后可能需要重新核对");

  // storage 不可写时仍保留内存 pending：同一标识重试成功且只记一次。
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.locator(".study-done")).toBeVisible();
  await expect
    .poll(async () => (await (await app.request.get("/api/cards/" + id)).json()).learning_events.length)
    .toBe(1);
});

test("EC-04 deleted-card-can-be-abandoned", async ({app, page}) => {
  const [id] = await openFirstFlashcard(app, page, [{word: "apple", meaning: "苹果"}]);
  await app.request.delete("/api/cards/" + id);
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("Card not found");
  await expect(page.locator(".study-done")).toHaveCount(0);

  await page.getByRole("button", {name: "放弃这条待确认", exact: true}).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".study-done")).toHaveCount(0);
  expect((await (await app.request.get("/api/cards")).json()).cards).toHaveLength(0);
});

test("EC-04 detail-rating-stays-on-failure", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).first().click();
  await page.route("**/api/reviews", (route) => route.abort("failed"), {times: 1});
  await page.getByTestId("rate-good").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.getByTestId("learning-event")).toHaveCount(0);

  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByTestId("learning-event")).toHaveCount(1);
  await expect
    .poll(async () => (await (await app.request.get("/api/cards/" + id)).json()).learning_events.length)
    .toBe(1);
});

test("EC-04 lesson-rating-stays-on-failure", async ({appFactory, page}) => {
  const instance = await appFactory({fixture: "ec04-lesson.json"});
  await page.goto(instance.baseURL);
  await page.locator("summary").click();
  await page.getByRole("button", {name: /继续 →/}).click();
  await page.locator(".lesson-list-item").first().click();
  await page.getByRole("button", {name: "猜不到"}).click();
  await page.route("**/api/reviews", (route) => route.abort("failed"), {times: 1});
  await page.getByTestId("rate-good").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.locator(".word-mastered")).toHaveCount(0);

  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.locator(".word-mastered")).toHaveCount(1);
  await expect
    .poll(async () => (await (await instance.request.get("/api/cards/1")).json()).learning_events.length)
    .toBe(1);
});

test("EC-04 story-rating-stays-on-failure", async ({appFactory, page}) => {
  const instance = await appFactory({fixture: "ec04-story.json"});
  await page.goto(instance.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await page.locator(".story-item-main").first().click();
  await page.locator(".sw", {hasText: "apple"}).first().click();
  await page.route("**/api/reviews", (route) => route.abort("failed"), {times: 1});
  await page.getByTestId("rate-good").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.locator(".story-word-panel")).toBeVisible();

  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.locator(".story-word-panel")).toHaveCount(0);
  await expect
    .poll(async () => (await (await instance.request.get("/api/cards/1")).json()).learning_events.length)
    .toBe(1);
});

test("EC-04 ai-upgrade-failure-does-not-block", async ({appFactory, page}) => {
  const instance = await appFactory({fixture: "ec04-graduating.json"});
  await page.goto(instance.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.locator(".study-done")).toBeVisible();

  const card = await (await instance.request.get("/api/cards/1")).json();
  expect(card.learning_events).toHaveLength(1);
  expect(card.graduated).toBe(true);
  expect(card.sentence_card_id).not.toBeNull();
});
