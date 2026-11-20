import {test, expect} from "./support/test.mjs";

const cards = [
  {word: "apple", meaning: "苹果", example: "I ate an apple."},
  {word: "banana", meaning: "香蕉", example: "I ate a banana."},
  {word: "cherry", meaning: "樱桃", example: "I ate a cherry."},
  {word: "date", meaning: "枣子", example: "I ate a date."},
  {word: "egg", meaning: "鸡蛋", example: "I ate an egg."},
];

async function openQuiz(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "直接做测验", exact: true}).click();
}

test("S95-05 related choice occupies one slot in the ordinary five-question quiz", async ({app, page}) => {
  const [apple] = await app.seedCards([
    {...cards[0], related_words: [
      {word: "applesauce", meaning: "苹果酱", kind: "compound"},
      {word: "apply", meaning: "申请", kind: "lookalike"},
    ]},
    ...cards.slice(1),
  ]);
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (/\/api\/tts\/audio\/(apply|applesauce)(\?|$)/.test(this.src)) {
        document.body.dataset.relatedAudioStarted = "true";
        return Promise.resolve();
      }
      return play.call(this);
    };
  });
  await openQuiz(page, app);
  for (let number = 1; number <= 5; number += 1) {
    await expect(page.getByText(`第 ${number} / 5 题`, {exact: true})).toBeVisible();
    if (number === 4) {
      const prompt = page.getByText(/^「apple」的哪个相关词意思是/);
      await expect(prompt).toBeVisible();
      const answer = (await prompt.textContent()).includes("苹果酱") ? "applesauce" : "apply";
      const option = page.getByRole("button", {name: new RegExp(`^${answer}`)});
      await expect(option).toHaveCount(1);
      await option.focus();
      await option.press("Enter");
      await page.getByRole("button", {name: "确认", exact: true}).click();
      await expect(page.getByText("✅ 正确！", {exact: true})).toBeVisible();
      await expect(page.locator("body")).toHaveAttribute("data-related-audio-started", "true");
    } else {
      await page.getByRole("button", {name: "跳过这题 →", exact: true}).click();
    }
    await expect(page.getByRole("status").filter({hasText: "已保存"})).toBeVisible();
    await page.getByRole("button", {name: number === 5 ? "查看结果" : "下一题 →", exact: true}).click();
  }

  await expect(page.getByRole("button", {name: "回到队列", exact: true})).toBeVisible();
  const detail = await (await app.request.get(`/api/cards/${apple}`)).json();
  expect(detail.learning_events).toEqual([expect.objectContaining({
    kind: "related", correct: true, scheduled: false,
  })]);
  expect(detail.memory_state).toBeNull();
  const backup = await (await app.request.get("/api/export/backup")).json();
  const appleContacts = backup.extensions.learning_contacts.filter(row => row.card_id === apple);
  expect(appleContacts.map(row => row.kind)).toEqual(["answer_visible"]);
  await expect(page.getByText(/明天的复习队列/)).toHaveCount(0);
});

test("S95-05 missing related materials fall back to ordinary questions and allow returning", async ({app, page}) => {
  await app.seedCards(cards);
  await openQuiz(page, app);
  for (let number = 1; number <= 4; number += 1) {
    await expect(page.getByText(`第 ${number} / 5 题`, {exact: true})).toBeVisible();
    if (number === 4) break;
    await page.getByRole("button", {name: "跳过这题 →", exact: true}).click();
    await page.getByRole("button", {name: "下一题 →", exact: true}).click();
  }
  await expect(page.getByText(/是哪个单词？$/)).toBeVisible();
  expect(await page.locator("body").evaluate(body => body.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await expect(page.getByRole("button", {name: "直接做测验", exact: true})).toBeVisible();
});
