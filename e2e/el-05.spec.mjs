import {test, expect} from "./support/test.mjs";

async function backup(app) {
  return (await app.request.get("/api/export/backup")).json();
}

async function contacts(app) {
  return (await backup(app)).extensions?.learning_contacts || [];
}

async function openSpecialist(page, label) {
  const summary = page.getByText("专项练习", {exact: true});
  if ((await summary.locator("..").getAttribute("open")) === null) {
    await summary.click();
  }
  await page.getByRole("button", {name: label}).click();
}

test("EL-05 flashcard exposure reaches confirmed contact", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter((row) => row.card_id === id && row.source === "study")
        .length;
    })
    .toBeGreaterThan(0);
  expect((await backup(app)).learning_events).toEqual([]);
});

test("EL-05 spelling hint stays assisted after closing and records answer contact", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await openSpecialist(page, /拼写练习/);
  await page.getByRole("button", {name: "提示首字母"}).click();
  // 关闭提示（切回独立档）不能把本题转回独立记录。
  await page.getByRole("button", {name: "独立回忆"}).click();
  await expect(page.getByText("本题已使用提示，仍按辅助记录")).toBeVisible();

  // 答错才显示正确拼写，也才构成一次答案展示接触。
  await page.locator(".spelling-input").fill("wrong");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.locator(".spelling-feedback").filter({hasText: "已保存"})).toBeVisible();

  const payload = await backup(app);
  const events = payload.learning_events.filter((event) => event.card_id === id);
  expect(events).toHaveLength(1);
  expect(events[0].source).toBe("spelling");
  expect(events[0].correct).toBe(false);
  expect(events[0].assistance).toEqual(
    expect.arrayContaining(["first_letter", "length", "live_feedback"]),
  );
  expect(events[0].scheduled).toBe(false);
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === id &&
          row.source === "spelling" &&
          row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);
});

test("EL-05 practice response loss retries with one assisted event", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await openSpecialist(page, /拼写练习/);
  await page.getByRole("button", {name: "提示首字母"}).click();

  const lost = {};
  await page.route(
    "**/api/typing/check",
    async (route) => {
      lost.submissionId = route.request().postDataJSON().submission_id;
      await route.fetch();
      await route.abort("failed");
    },
    {times: 1},
  );
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("alert")).toContainText("保存未确认");
  await page.getByRole("button", {name: "重试保存"}).click();
  await expect(page.locator(".spelling-feedback").filter({hasText: "已保存"})).toBeVisible();

  const events = (await backup(app)).learning_events.filter(
    (event) => event.submission_id === lost.submissionId,
  );
  expect(events).toHaveLength(1);
  expect(events[0].card_id).toBe(id);
  expect(events[0].assistance).toEqual(
    expect.arrayContaining(["first_letter", "length", "live_feedback"]),
  );
});

test("EL-05 listening options and audio record contact", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([
    {word: "apple", meaning: "苹果"},
    {word: "book", meaning: "书"},
    {word: "cat", meaning: "猫"},
    {word: "dog", meaning: "狗"},
  ]);
  await page.goto(app.baseURL);
  await openSpecialist(page, /听写练习/);
  await expect(page.locator(".listening-option").first()).toBeVisible();

  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) => row.source === "listening" && row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);

  await page.locator(".btn-speak-large").click();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) => row.source === "listening" && row.kind === "answer_audio",
      ).length;
    })
    .toBeGreaterThan(0);
});

test("EL-05 quiz choice options record contact", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([
    {word: "apple", meaning: "苹果"},
    {word: "book", meaning: "书"},
    {word: "cat", meaning: "猫"},
    {word: "dog", meaning: "狗"},
  ]);
  const quizContacts = async () =>
    (await contacts(app)).filter(
      (row) => row.source === "quiz" && row.kind === "answer_visible",
    ).length;
  await page.goto(app.baseURL);
  await openSpecialist(page, "直接做测验");
  // 前三题是独立输入题；跳过会显示答案并产生接触。
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", {name: "跳过这题 →"}).click();
    await expect(page.getByText(/已跳过/)).toBeVisible();
    await expect.poll(quizContacts).toBe(index + 1);
    if (index < 2) {
      await page.getByRole("button", {name: "下一题 →"}).click();
    }
  }
  const beforeChoice = await quizContacts(app);
  await page.getByRole("button", {name: "下一题 →"}).click();
  await expect(page.locator(".quiz-options .quiz-option").first()).toBeVisible();
  await expect.poll(quizContacts).toBe(beforeChoice + 1);
});

test("EL-05 mixed practice records answer contact", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await openSpecialist(page, /混合练习/);
  // 只有一张卡时无法组成选择题，混合练习只剩拼写题。
  await expect(page.locator(".spelling-input")).toBeVisible();
  await page.getByRole("button", {name: "提示首字母"}).click();
  await expect(page.locator(".spelling-word-display")).toBeVisible();

  // 切换页面再回来，同一题的提示仍保持辅助。
  await page.getByRole("button", {name: "← 返回"}).click();
  await openSpecialist(page, /混合练习/);
  await expect(page.locator(".spelling-word-display")).toBeVisible();

  await page.locator(".spelling-input").fill("wrong");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.locator(".quiz-feedback").filter({hasText: "已保存"})).toBeVisible();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === id &&
          row.source === "mixed" &&
          row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);

  // 成功保存后重新抽取同一张卡：新题从独立开始。
  await page.getByRole("button", {name: "再来一轮"}).click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  await expect(page.locator(".spelling-word-display")).toHaveCount(0);
});

test("EL-05 reinforcement answer display records contact", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(page.locator(".spelling-input")).toBeVisible();
  await page.locator(".spelling-input").fill("wrong");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存：答错");
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === id &&
          row.source === "reinforcement" &&
          row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);
});
