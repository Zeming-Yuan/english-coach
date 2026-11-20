import {test, expect} from "./support/test.mjs";

test("S95-01 exploration returns to flipped apple", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  const trigger = page.getByRole("button", {name: "多学一个", exact: true});
  await trigger.click({timeout: 4000});
  const region = page.getByRole("region", {name: "构词与扩展"});
  await expect(region).toContainText("复合词");
  await expect(region).toContainText("applesauce");
  await expect(region).toContainText("形近词");
  await region.getByRole("button", {name: /^apply/}).click();
  const preview = page.getByRole("dialog");
  await expect(preview).toContainText("申请");
  await expect(preview).toContainText("She will apply for a job.");
  await page.getByRole("button", {name: "返回原词卡", exact: true}).click();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".card.flipped .back-meaning")).toContainText("苹果");
  const {cards} = await (await app.request.get("/api/cards")).json();
  expect(cards.filter(card => card.kind === "word")).toHaveLength(10);
  expect(cards.every(card => card.review_count === 0)).toBe(true);
});

test("S95-01 rating the same starter apple advances once", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.getByRole("button", {name: /太简单/}).click();
  await expect(page.locator(".card-front")).toContainText("banana");
  await expect(page.locator(".study-count")).toHaveText("2 / 10");
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events).toHaveLength(1);
  expect(backup.learning_events[0].self_rating).toBe(4);
});

test("S95-01 keyboard return focus and failed audio in the daily queue", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec16-tts-error.json"});
  await app.request.post("/api/cards/starter");
  const [apply] = await app.seedCards([{word: "apply", meaning: "申请；应用"}]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {getVoices: () => [], cancel() {}, speak() {}},
    });
  });
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习"}).click();
  await page.locator(".card").press("Enter");
  const trigger = page.getByRole("button", {name: "多学一个", exact: true});
  await trigger.press("Enter");
  const region = page.getByRole("region", {name: "构词与扩展"});
  await region.getByRole("button", {name: /^apply/}).press("Enter");
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible();
  await expect.poll(async () => {
    const card = await (await app.request.get(`/api/cards/${apply}`)).json();
    return card.last_contact?.kind;
  }).toBe("answer_visible");
  await preview.getByRole("button", {name: "试听"}).press("Enter");
  await expect(preview.getByRole("status")).toContainText("朗读暂不可用");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".card.flipped .back-meaning")).toContainText("苹果");
  await expect(page.locator(".study-count")).toHaveText("1 / 10");
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events).toHaveLength(0);
  expect(backup.extensions.learning_contacts.filter(row => row.card_id === apply)
    .map(row => row.kind)).toEqual(["answer_visible"]);

  await page.getByRole("button", {name: /退出/}).click();
  await page.getByRole("button", {name: "单词本", exact: true}).click();
  await page.locator(".word-item").filter({hasText: /^apple/}).first().click();
  await page.getByRole("region", {name: "构词与扩展"}).getByRole("button", {name: /^apply/}).click();
  await expect(page.getByRole("dialog")).toContainText("She will apply for a job.");
});

test("S95-01 legacy rows and late completion do not block the next card", async ({app, page}) => {
  const [cardId] = await app.seedCards([
    {word: "apple", meaning: "苹果", related_words: [{word: "pome", meaning: "梨果"}]},
    {word: "banana", meaning: "香蕉"},
  ]);
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  let requested;
  const sent = new Promise(resolve => { requested = resolve; });
  await page.route(`**/api/cards/${cardId}/expansions`, async route => {
    const response = await route.fetch();
    requested(response.ok());
    await delayed;
    await route.fulfill({response});
  });
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习"}).click();
  await page.locator(".card").press("Enter");
  await page.getByRole("button", {name: "多学一个"}).click();
  const region = page.getByRole("region", {name: "构词与扩展"});
  await expect(region).toContainText("相关词");
  await expect(region).toContainText("pome");
  await region.getByRole("button", {name: "补全扩展词"}).click();
  try {
    expect(await sent).toBe(true);
    await page.getByRole("button", {name: /太简单/}).click();
    await expect(page.locator(".card-front")).toContainText("banana");
    const received = page.waitForResponse(response => response.url().endsWith(`/${cardId}/expansions`));
    release();
    await received;
  } finally {
    release();
  }
  await page.locator(".card").press("Enter");
  await page.getByRole("button", {name: "多学一个"}).click();
  await expect(region).not.toContainText("applesauce");
  await expect(region.getByRole("button", {name: "补全扩展词"})).toBeVisible();
  await page.getByRole("button", {name: "收起扩展"}).click();
  await page.getByRole("button", {name: /太简单/}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果"})).toBeVisible();
});
