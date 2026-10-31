import fs from "node:fs";
import path from "node:path";
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
  await openSpecialistPractice(page);
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
  await openSpecialistPractice(page);
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
  await openSpecialistPractice(page);
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
  await openSpecialistPractice(page);
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
  await openSpecialistPractice(page);
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
  // EC-05 起输入题跳过也会记录一次 correct=null 的事件；这里只要求选择题恰好一次。
  expect(events.filter((event) => event.kind === "typed" && event.skipped)).toHaveLength(3);
  const choiceEvents = events.filter((event) => event.kind === "choice");
  expect(choiceEvents).toHaveLength(1);
  expect(choiceEvents[0].source).toBe("quiz");
  expect(choiceEvents[0].scheduled).toBe(false);
});

async function openSpecialistPractice(page) {
  const summary = page.getByText("专项练习", {exact: true});
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
}

// EC-16 release qualification: real route/cache with controlled external provider.
async function ttsSnapshot(app) {
  const response = await app.request.get("/api/export/backup");
  expect(response.ok()).toBe(true);
  const data = await response.json(); delete data.exported_at; return data;
}

test("EC-16 TTS uses controlled external adapter", async ({app, page}) => {
  await page.unroute("**/api/tts/**");
  expect((await app.request.get("/api/tts/audio/release/preload")).ok()).toBe(true);
  expect(await app.externalCalls()).toContain("tts");
});

for (const failure of ["timeout", "error"]) {
  test(`EC-16 TTS provider ${failure} preserves saved learning`, async ({appFactory, page}) => {
    await page.unroute("**/api/tts/**");
    const app = await appFactory({fixture: `ec16-tts-${failure}.json`});
    const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book"}, {word: "cat"}, {word: "dog"}]);
    const saved = await app.request.post("/api/reviews", {data: {card_id: id, rating: 3, source: "study", submission_id: crypto.randomUUID()}});
    expect(saved.status()).toBe(200);
    const before = await ttsSnapshot(app);
    const preload = await app.request.get("/api/tts/audio/release/preload");
    expect(preload.ok()).toBe(true);
    expect(await preload.json()).toEqual({cached: false});
    await page.goto(app.baseURL);
    await page.locator("summary").click();
    await page.getByRole("button", {name: /听写练习/}).click();
    await expect(page.locator(".listening-option").first()).toBeVisible();
    await page.locator(".btn-speak-large").click();
    expect(await ttsSnapshot(app)).toEqual(before);
    await expect(page.getByText(/发音不可用|本地语音/)).toBeVisible();
    expect(await app.externalCalls()).toContain(`tts:${failure}`);
    expect(await ttsSnapshot(app)).toEqual(before);
    await page.locator(".listening-option").first().click();
    await expect(page.getByRole("status")).toContainText("已保存");
    expect((await ttsSnapshot(app)).learning_events).toHaveLength(2);
  });
}


test("EC-16 TTS retries the same word after provider recovery", async ({appFactory, page}) => {
  await page.unroute("**/api/tts/**");
  const app = await appFactory({fixture: "ec16-tts-error.json"});
  await seedWords(app);
  const before = await ttsSnapshot(app);
  const first = page.waitForRequest(request => request.url().includes("/api/tts/audio/") && !request.url().endsWith("/preload"));
  await openListening(app, page);
  const audioPath = new URL((await first).url()).pathname;
  await page.locator(".btn-speak-large").click();
  await expect(page.getByText(/发音不可用|本地语音/)).toBeVisible();
  // Test-only external provider control, never a product API or learning-data write.
  const controlFile = path.join(path.dirname(app.databasePath), "control.json");
  const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
  fs.writeFileSync(controlFile, JSON.stringify({...control, tts_mode: "success", tts_delay_ms: 0}));
  const retry = page.waitForRequest(request => new URL(request.url()).pathname === audioPath, {timeout: 5000});
  await page.locator(".btn-speak-large").click();
  await retry;
  await expect(page.getByText(/发音不可用|本地语音/)).toHaveCount(0);
  expect(await app.externalCalls()).toContain("tts");
  expect(await ttsSnapshot(app)).toEqual(before);
});
