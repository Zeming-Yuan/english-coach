import {randomUUID} from "node:crypto";
import {test, expect} from "./support/test.mjs";

const WORDS = ["apple", "book", "cat", "dog"];

async function seedWords(app) {
  return app.seedCards(WORDS.map((word) => ({word, meaning: word})));
}

async function cardEvents(app, ids) {
  const details = await Promise.all(
    ids.map(async (id) => (await app.request.get(`/api/cards/${id}`)).json()),
  );
  return details.flatMap((detail) => detail.learning_events);
}

async function openListening(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /听写练习/}).click();
  await expect(page.locator(".listening-option").first()).toBeVisible();
}

test.beforeEach(async ({page}) => {
  // 不调用真实 TTS：发音失败只影响提示，不影响作答与保存断言。
  await page.route("**/api/tts/**", (route) => route.abort("failed"));
});

test("EC-06 failed-choice-stays", async ({app, page}) => {
  await seedWords(app);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /听写练习/}).click();
  await page.route("**/api/listening/score", (route) => route.abort("failed"), {times: 1});
  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.locator(".study-count")).toContainText("1");
});

test("EC-06 choosing-does-not-change-due", async ({app, page}) => {
  const ids = await seedWords(app);
  await openListening(app, page);
  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const events = await cardEvents(app, ids);
  expect(events).toHaveLength(1);
  expect(events[0].scheduled).toBe(false);
  expect(events[0].source).toBe("listening");
  expect(events[0].kind).toBe("choice");
});

test("EC-06 wrong-index-cannot-forge-correct", async ({app}) => {
  await seedWords(app);
  const question = (await (await app.request.get("/api/listening?limit=1")).json())
    .questions[0];
  const wrong = question.options.find((option) => option !== question.word);
  const forgedIndex = question.options.indexOf(question.word);

  const forged = await app.request.post("/api/listening/score", {
    data: {
      card_id: question.card_id,
      answer: wrong,
      question_token: question.question_token,
      source: "listening",
      kind: "choice",
      correct: true,
      correct_index: forgedIndex,
      selected_index: forgedIndex,
      submission_id: randomUUID(),
    },
  });
  expect(forged.status()).toBe(200);
  expect((await forged.json()).correct).toBe(false);

  const honest = await app.request.post("/api/listening/score", {
    data: {
      card_id: question.card_id,
      answer: question.word,
      question_token: question.question_token,
      source: "listening",
      kind: "choice",
      correct_index: (forgedIndex + 1) % question.options.length,
      submission_id: randomUUID(),
    },
  });
  expect(honest.status()).toBe(200);
  expect((await honest.json()).correct).toBe(true);
  expect((await honest.json()).scheduled).toBe(false);
});

test("EC-06 quiz-batch-is-atomic-and-once", async ({app}) => {
  const ids = await seedWords(app);
  const questions = (
    await (await app.request.get("/api/quiz/choice?limit=2")).json()
  ).questions;
  const [first, second] = questions;
  const tampered = second.question_token.slice(0, -1) +
    (second.question_token.endsWith("0") ? "1" : "0");

  const broken = await app.request.post("/api/quiz/score", {
    data: {
      answers: [
        {
          card_id: first.card_id,
          answer: first.options[0],
          question_token: first.question_token,
          source: "quiz",
          kind: "choice",
          submission_id: randomUUID(),
        },
        {
          card_id: second.card_id,
          answer: second.options[0],
          question_token: tampered,
          source: "quiz",
          kind: "choice",
          submission_id: randomUUID(),
        },
      ],
    },
  });
  expect(broken.status()).toBe(422);
  expect(await cardEvents(app, ids)).toHaveLength(0);

  const submissionId = randomUUID();
  const answer = {
    card_id: first.card_id,
    answer: first.options[0],
    question_token: first.question_token,
    source: "quiz",
    kind: "choice",
    submission_id: submissionId,
  };
  const saved = await app.request.post("/api/quiz/score", {data: {answers: [answer]}});
  expect(saved.status()).toBe(200);
  expect((await saved.json()).total).toBe(1);

  const replay = await app.request.post("/api/quiz/score", {data: {answers: [answer]}});
  expect(replay.status()).toBe(200);
  const events = await cardEvents(app, ids);
  expect(events).toHaveLength(1);
  expect(events[0].scheduled).toBe(false);
});

test("EC-06 load-error-is-not-empty", async ({app, page}) => {
  await seedWords(app);
  await page.route(
    "**/api/listening",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({detail: "boom"}),
      }),
    {times: 1},
  );
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /听写练习/}).click();
  await expect(page.getByRole("alert")).toContainText("题目加载失败");
  await expect(page.getByText("今天没有需要听写的词")).toHaveCount(0);

  await page.getByRole("button", {name: "重新加载"}).click();
  await expect(page.locator(".listening-option").first()).toBeVisible();
});

test("EC-06 quiz-load-error-is-not-empty", async ({app, page}) => {
  await seedWords(app);
  await page.route(
    /\/api\/quiz\?limit=5$/,
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({detail: "boom"}),
      }),
    {times: 1},
  );
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "直接做测验"}).click();
  await expect(page.getByRole("alert")).toContainText("题目加载失败");
  await expect(page.getByText("题库是空的")).toHaveCount(0);

  await page.getByRole("button", {name: "重新加载"}).click();
  await expect(page.locator(".quiz-prompt")).toBeVisible();
});

test("EC-06 expired-question-reloads", async ({app, page}) => {
  await seedWords(app);
  await openListening(app, page);
  await app.setTime("2026-11-02T12:00:00Z");
  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("alert")).toContainText("本题尚未保存");
  await page.getByRole("button", {name: "重新加载题目"}).click();

  await expect(page.locator(".listening-option").first()).toBeVisible();
  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("status")).toContainText("已保存");
});

test("EC-06 skip-records-null-correct", async ({app, page}) => {
  const ids = await seedWords(app);
  await openListening(app, page);
  await page.getByRole("button", {name: /跳过这题/}).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const events = await cardEvents(app, ids);
  expect(events).toHaveLength(1);
  expect(events[0].skipped).toBe(true);
  expect(events[0].correct).toBeNull();
  expect(events[0].scheduled).toBe(false);
});

test("EC-06 tts-failure-options-usable", async ({app, page}) => {
  const ids = await seedWords(app);
  await openListening(app, page);
  await page.locator(".btn-speak-large").click();
  await expect(page.getByText(/发音不可用|本地语音/)).toBeVisible();

  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(await cardEvents(app, ids)).toHaveLength(1);
});

test("EC-06 quiz-choice-save-then-feedback", async ({app, page}) => {
  const ids = await seedWords(app);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "直接做测验"}).click();

  // 4 张卡 → 3 道 cn2en + 1 道 choice；先跳过输入题到选择题。
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", {name: /跳过这题/}).click();
    await page.getByRole("button", {name: /下一题|查看结果/}).click();
  }
  await expect(page.locator(".quiz-option").first()).toBeVisible();
  await page.route("**/api/quiz/score", (route) => route.abort("failed"), {times: 1});
  await page.locator(".quiz-option").first().click();
  await page.getByRole("button", {name: "确认", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await expect(page.locator(".study-count")).toContainText("4 / 4");

  await page.getByRole("button", {name: "重试保存"}).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const events = await cardEvents(app, ids);
  expect(events).toHaveLength(1);
  expect(events[0].source).toBe("quiz");
  expect(events[0].scheduled).toBe(false);
});
