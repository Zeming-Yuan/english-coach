import {test, expect} from "./support/test.mjs";

async function detail(app, id) {
  return (await app.request.get(`/api/cards/${id}`)).json();
}

async function contacts(app) {
  const payload = await (await app.request.get("/api/export/backup")).json();
  return payload.extensions?.learning_contacts || [];
}

// 控制文件由测试服务器并发写入；轮询时容忍读到半写的瞬间。
async function externalCalls(app) {
  try {
    return await app.externalCalls();
  } catch {
    return [];
  }
}

function cardsForTest() {
  const rows = [{word: "apple", meaning: "苹果"}];
  for (let index = 1; index <= 18; index += 1) {
    rows.push({word: `word${String(index).padStart(2, "0")}`, meaning: "词"});
  }
  rows.push({word: "zulu", meaning: "祖鲁语"});
  return rows;
}

test("EL-04 visible list and detail display record an in-app contact", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();

  // 词表实际显示后才写入接触；此时还未打开详情。
  await expect.poll(async () => (await detail(app, id)).last_contact?.source).toBe("words_list");

  await page.locator(".word-item", {hasText: "apple"}).click();
  await expect(page.getByTestId("last-contact")).toContainText("词卡详情");
  await expect(page.getByTestId("last-contact")).toContainText("看到答案");
  const saved = await detail(app, id);
  expect(saved.learning_events).toEqual([]);
  expect(saved.review_count).toBe(0);

  // 只有实际播放开始后才算音频接触。
  await page.locator(".word-detail-header .speak-btn").click();
  await expect(page.getByTestId("last-contact")).toContainText("播放答案");
});

test("EL-04 prefetch and offscreen cards are not contacts", async ({appFactory, page}) => {
  const app = await appFactory();
  const ids = await app.seedCards(cardsForTest());
  const first = ids[0];
  const bottom = ids[ids.length - 1];

  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await expect(page.locator(".word-item").first()).toBeVisible();

  // 列表加载会预热全部词卡音频，但未进入视口的卡片不算接触。
  await expect.poll(async () => (await externalCalls(app)).length).toBeGreaterThan(0);
  await expect.poll(async () => (await detail(app, first)).last_contact?.source).toBe("words_list");
  expect((await detail(app, bottom)).last_contact).toBeNull();

  // 滚动到视口后才是真正的展示接触。
  await page.locator(".word-item", {hasText: "zulu"}).scrollIntoViewIfNeeded();
  await expect.poll(async () => (await detail(app, bottom)).last_contact?.source).toBe("words_list");
});

test("EL-04 failed audio playback is not a contact", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec16-tts-error.json"});
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  // 同时禁用本地语音兜底，确保失败播放保持失败。
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {getVoices: () => [], cancel() {}, speak() {}},
    });
  });

  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).click();
  await expect(page.getByTestId("last-contact")).toContainText("看到答案");

  const errors = async () =>
    (await externalCalls(app)).filter((call) => call === "tts:error").length;
  // 等列表预热自己的失败请求落定，再单独观察本次播放。
  await expect.poll(errors).toBeGreaterThan(0);
  const before = await errors();
  await page.locator(".word-detail-header .speak-btn").click();
  await expect.poll(errors).toBeGreaterThan(before);
  await expect(page.getByTestId("last-contact")).toContainText("看到答案");

  const rows = (await contacts(app)).filter((row) => row.card_id === id);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.kind === "answer_visible")).toBe(true);
});

test("EL-04 unavailable local storage marks the basis incomplete", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new Error("storage denied");
    };
  });

  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await expect.poll(async () => (await detail(app, id)).last_contact?.source).toBe("words_list");

  await page.route("**/api/learning/contacts", (route) => route.abort("failed"), {times: 2});
  await page.locator(".word-item", {hasText: "apple"}).click();
  await expect(page.getByRole("alert")).toContainText("接触依据不完整");
  await expect(page.getByRole("alert")).toContainText("本地存储不可用");

  // 重试仍失败时，存储不可用的依据不完整提示不能丢失。
  await page.getByRole("button", {name: "继续确认保存"}).click();
  await expect(page.getByRole("alert")).toContainText("本地存储不可用");
});

test("EL-04 lost confirmation retries with one record", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await expect.poll(async () => (await detail(app, id)).last_contact?.source).toBe("words_list");

  const lost = {};
  await page.route(
    "**/api/learning/contacts",
    async (route) => {
      lost.submissionId = route.request().postDataJSON().submission_id;
      await route.fetch();
      await route.abort("failed");
    },
    {times: 1},
  );

  await page.locator(".word-item", {hasText: "apple"}).click();
  await expect(page.getByRole("alert")).toContainText("接触依据不完整");
  await expect(page.getByRole("button", {name: "继续确认保存"})).toBeVisible();
  await expect
    .poll(
      async () =>
        (await contacts(app)).filter(
          (row) => row.submission_id === lost.submissionId,
        ).length,
    )
    .toBe(1);

  const pendingKeys = () =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("ec.contact.")),
    );
  expect(await pendingKeys()).toHaveLength(1);

  // 刷新后重新展示同一张卡：待确认标记自动沿用原提交标识确认并清理。
  await page.reload();
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).click();
  await expect.poll(pendingKeys).toEqual([]);
  const rows = (await contacts(app)).filter(
    (row) => row.submission_id === lost.submissionId,
  );
  expect(rows).toHaveLength(1);
});
