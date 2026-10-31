import { test, expect } from "./support/test.mjs";

const words = [
  { word: "apple", meaning: "苹果" },
  { word: "book", meaning: "书" },
  { word: "cat", meaning: "猫" },
  { word: "dog", meaning: "狗" },
];
async function open(app, page) {
  await page.addInitScript(() => {
    Math.random = () => 0.999;
  });
  await page.goto(app.baseURL);
  await page.getByRole("button", { name: /混合练习/ }).click();
}
async function events(app, ids) {
  return (
    await Promise.all(
      ids.map(
        async (id) =>
          (await (await app.request.get(`/api/cards/${id}`)).json())
            .learning_events,
      ),
    )
  ).flat();
}
test("EC-07 listening-single-saved-event", async ({ app, page }) => {
  const ids = await app.seedCards(words);
  await open(app, page);
  await page.locator(".listening-option").first().click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const saved = await events(app, ids);
  expect(saved).toHaveLength(1);
  expect(saved[0].source).toBe("mixed");
  expect(saved[0].scheduled).toBe(false);
});

test("EC-07 listening-source-parity", async ({ app }) => {
  const ids = await app.seedCards(words);
  const q = (await (await app.request.get("/api/listening?limit=1")).json())
    .questions[0];
  const results = [];
  for (const source of ["listening", "mixed"]) {
    const response = await app.request.post("/api/listening/score", {
      data: {
        card_id: q.card_id,
        answer: q.word,
        question_token: q.question_token,
        source,
        kind: "choice",
        submission_id: crypto.randomUUID(),
      },
    });
    expect(response.status()).toBe(200);
    results.push(await response.json());
  }
  expect(results.map((r) => [r.correct, r.scheduled])).toEqual([
    [true, false],
    [true, false],
  ]);
  expect(await events(app, ids)).toHaveLength(2);
});

async function choiceQuestion(page) {
  await page.getByRole("button", { name: /跳过这题/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", { name: /下一题/ }).click();
  await expect(page.getByTestId("mixed-choice")).toBeVisible();
}

test("EC-07 choice-unknown-refresh-retry-once", async ({ app, page }) => {
  const ids = await app.seedCards(words);
  await page.clock.install();
  await open(app, page);
  await choiceQuestion(page);
  const before = await page.locator(".study-count").innerText();
  const submissions = [];
  await page.route(
    "**/api/quiz/score",
    async (route) => {
      submissions.push(route.request().postDataJSON().answers[0].submission_id);
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  const prompt = await page.locator(".quiz-prompt").innerText();
  const expected = words.find((w) => w.meaning === prompt).word;
  const wrong = words.find((w) => w.word !== expected).word;
  await page
    .getByTestId("mixed-choice")
    .getByRole("button", { name: wrong, exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await page.clock.runFor(4000);
  await expect(page.locator(".study-count")).toHaveText(before);
  expect(
    (await events(app, ids)).filter((e) => e.kind === "choice" && !e.skipped),
  ).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: /混合练习/ }).click();
  await expect(page.getByRole("alert")).toContainText("上次提交尚未确认保存");
  await expect(page.locator(".study-count")).toHaveText(before);
  page.on("request", (r) => {
    if (r.url().endsWith("/api/quiz/score"))
      submissions.push(r.postDataJSON().answers[0].submission_id);
  });
  await page.getByRole("button", { name: /重试保存/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(submissions).toHaveLength(2);
  expect(new Set(submissions).size).toBe(1);
  expect((await events(app, ids)).filter((e) => !e.skipped)).toHaveLength(1);
  const errors = (await (await app.request.get("/api/errors")).json()).errors;
  expect(errors).toHaveLength(1);
  expect(errors[0].error_count).toBe(1);
});

test("EC-07 failed-commit-does-not-advance-or-change-errors", async ({
  app,
  page,
}) => {
  const ids = await app.seedCards(words);
  await page.clock.install();
  await open(app, page);
  await choiceQuestion(page);
  await app.failCommitOnce();
  await page.getByTestId("mixed-choice").getByRole("button").first().click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await page.clock.runFor(4000);
  await expect(page.locator(".study-count")).toContainText("2 / 9");
  expect((await events(app, ids)).filter((e) => !e.skipped)).toHaveLength(0);
  expect(
    (await (await app.request.get("/api/errors")).json()).errors,
  ).toHaveLength(0);
  await page.getByRole("button", { name: /重试保存/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect((await events(app, ids)).filter((e) => !e.skipped)).toHaveLength(1);
  // Keyboard and timer both try the same saved question, advancing only one position.
  await page.keyboard.press("Enter");
  await page.clock.runFor(2000);
  await expect(page.locator(".study-count")).toContainText("3 / 9");
});

test("EC-07 single-card-independent-and-assisted-spelling-parity", async ({
  app,
  page,
}) => {
  const [id] = await app.seedCards([words[0]]);
  await page.clock.install();
  await open(app, page);
  await expect(page.locator(".study-count")).toContainText("1 / 1");
  await expect(page.locator(".spelling-box")).toHaveCount(0);
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存");
  const first = (await events(app, [id]))[0];
  expect(first.scheduled).toBe(true);
  expect(first.assistance).toEqual([]);
  await page.clock.runFor(2000);
  await expect(page.getByText("混合练习完成！")).toBeVisible();
  await page.getByRole("button", { name: "再来一轮" }).click();
  await page.getByRole("button", { name: "提示首字母" }).click();
  await page.getByRole("textbox").fill("apple");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存");
  const saved = await events(app, [id]);
  expect(saved).toHaveLength(2);
  const assisted = saved.find((e) => e.assistance.length);
  expect(assisted.assistance).toEqual([
    "first_letter",
    "length",
    "live_feedback",
  ]);
  expect(assisted.scheduled).toBe(false);
});

test("EC-07 empty-and-load-error-are-not-complete", async ({ app, page }) => {
  const [id] = await app.seedCards([words[0]]);
  await page.goto(app.baseURL);
  await expect(page.getByRole("button", { name: /混合练习/ })).toBeVisible();
  expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBe(true);
  await page.getByRole("button", { name: /混合练习/ }).click();
  await expect(page.getByText("没有可练习的题目，先去加词吧")).toBeVisible();
  await expect(page.getByText("混合练习完成！")).toHaveCount(0);
  await app.seedCards([words[0]]);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.route(
    "**/api/quiz/choice?limit=4",
    (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"boom"}',
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: /混合练习/ }).click();
  await expect(page.getByRole("alert")).toContainText("题目加载失败");
  await expect(page.getByText("混合练习完成！")).toHaveCount(0);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
});

test("EC-07 listening-audio-failure-and-skip", async ({ app, page }) => {
  const ids = await app.seedCards(words);
  await page.route("**/api/tts/**", (r) => r.abort());
  await open(app, page);
  await page.locator(".btn-speak-large").click();
  await expect(page.getByText(/发音不可用|本地语音/)).toBeVisible();
  await page.getByRole("button", { name: /跳过这题/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const saved = await events(app, ids);
  expect(saved).toHaveLength(1);
  expect(saved[0].skipped).toBe(true);
  expect(saved[0].correct).toBeNull();
  expect(saved[0].scheduled).toBe(false);
});

test("EC-07 typed-and-choice-source-policy-parity", async ({ appFactory }) => {
  for (const scenario of ["independent", "assisted", "choice"]) {
    const outcomes = [];
    for (const mixed of [false, true]) {
      const app = await appFactory();
      const ids = await app.seedCards(words);
      const assistance = scenario === "assisted" ? ["first_letter"] : [];
      let path = "/api/typing/check";
      let payload = {
        card_id: ids[0],
        source: mixed ? "mixed" : "spelling",
        kind: "typed",
        user_input: "apple",
        assistance,
        submission_id: crypto.randomUUID(),
      };
      if (scenario === "choice") {
        const questions = (
          await (await app.request.get("/api/quiz/choice?limit=4")).json()
        ).questions;
        const q = questions.find((q) => q.card_id === ids[0]);
        path = "/api/quiz/score";
        payload = {
          answers: [
            {
              card_id: ids[0],
              source: mixed ? "mixed" : "quiz",
              kind: "choice",
              answer: "book",
              question_token: q.question_token,
              submission_id: crypto.randomUUID(),
            },
          ],
        };
      }
      const response = await app.request.post(path, { data: payload });
      expect(response.status()).toBe(200);
      const saved = await events(app, ids);
      expect(saved).toHaveLength(1);
      expect(saved[0].scheduled).toBe(scenario === "independent");
      const detail = await (
        await app.request.get(`/api/cards/${ids[0]}`)
      ).json();
      const errors = (await (await app.request.get("/api/errors")).json())
        .errors;
      outcomes.push({
        correct: saved[0].correct,
        assistance: saved[0].assistance,
        scheduled: saved[0].scheduled,
        memory: detail.memory_state,
        errors: errors.map((e) => e.error_count),
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  }
});

test("EC-07 choice-audio-is-not-an-answer", async ({ app, page }) => {
  const ids = await app.seedCards(words);
  await page.route("**/api/tts/**", (r) => r.abort());
  await open(app, page);
  await choiceQuestion(page);
  await expect(
    page.getByRole("button", { name: /听发音：/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /听发音：/ })
    .first()
    .click();
  await expect(page.getByText(/发音不可用|本地语音/)).toBeVisible();
  expect((await events(app, ids)).filter((e) => !e.skipped)).toHaveLength(0);
  await expect(
    page.getByTestId("mixed-choice").locator(".quiz-option").first(),
  ).toBeEnabled();
});

for (const delayedAttempt of [1, 2]) {
  test(`EC-07 late-${delayedAttempt === 1 ? "original" : "retry"}-response-preserves-newer-pending`, async ({
    app,
    page,
  }) => {
    const ids = await app.seedCards(words);
    await page.addInitScript(
      ({ delayedAttempt }) => {
        const fetch = window.fetch.bind(window);
        let attempts = 0;
        window.fetch = async (...args) => {
          const isListening = args[0] === "/api/listening/score";
          if (isListening) {
            attempts += 1;
            if (delayedAttempt === 2 && attempts === 1)
              throw new TypeError("simulated transport failure");
          }
          const response = await fetch(...args);
          if (isListening && attempts === delayedAttempt) {
            // The real application has committed A; delay only its transport response.
            await response.clone().json();
            window.oldMixedResponseReceived = true;
            await new Promise((resolve) => {
              window.releaseOldMixedResponse = resolve;
            });
            const json = response.json.bind(response);
            response.json = async () => {
              const result = await json();
              window.oldMixedResponseDelivered = true;
              return result;
            };
          }
          return response;
        };
      },
      { delayedAttempt },
    );
    await page.clock.install();
    await open(app, page);
    await page.locator(".listening-option").first().click();
    if (delayedAttempt === 2) {
      await expect(page.getByRole("alert")).toContainText("尚未确认保存");
      await page.getByRole("button", { name: /重试保存/ }).click();
    }
    await expect
      .poll(() => page.evaluate(() => window.oldMixedResponseReceived))
      .toBe(true);
    await page.locator(".page-head button").click();
    await page.getByRole("button", { name: /混合练习/ }).click();
    await page.getByRole("button", { name: /重试保存/ }).click();
    await expect(page.getByRole("status")).toContainText("已保存");
    await page.getByRole("button", { name: /下一题/ }).click();
    await expect(page.getByTestId("mixed-choice")).toBeVisible();
    const position = await page.locator(".study-count").innerText();
    const submissions = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/quiz/score"))
        submissions.push(request.postDataJSON().answers[0].submission_id);
    });
    await page.route("**/api/quiz/score", (route) => route.abort(), {
      times: 1,
    });
    await page
      .getByTestId("mixed-choice")
      .locator(".quiz-option")
      .first()
      .click();
    await expect(page.getByRole("alert")).toContainText("尚未确认保存");
    await page.evaluate(() => window.releaseOldMixedResponse());
    await expect
      .poll(() => page.evaluate(() => window.oldMixedResponseDelivered))
      .toBe(true);
    await page.clock.runFor(3000);
    await expect(page.locator(".study-count")).toHaveText(position);
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /混合练习/ }).click();
    await expect(page.getByRole("alert")).toContainText("上次提交尚未确认保存");
    await expect(page.locator(".study-count")).toHaveText(position);
    await page.getByRole("button", { name: /重试保存/ }).click();
    await expect(page.getByRole("status")).toContainText("已保存");
    expect(submissions).toHaveLength(2);
    expect(new Set(submissions).size).toBe(1);
    expect(await events(app, ids)).toHaveLength(2);
  });
}
