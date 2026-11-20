import {test, expect} from "./support/test.mjs";

const dog = {word: "dog", meaning: "狗"};
const book = {word: "book", meaning: "书"};
const difference = "第 2 个字母：i → o";
const input = page => page.getByRole("textbox", {name: "英文拼写"});
const next = page => page.getByRole("button", {name: "下一题 →", exact: true});
const details = async (app, id) => (await app.request.get(`/api/cards/${id}`)).json();
const backup = async app => (await app.request.get("/api/export/backup")).json();

async function openSpelling(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "拼写练习", exact: true}).click();
  await expect(input(page)).toBeVisible();
}

async function enter(page, answer) {
  await input(page).fill(answer);
  await input(page).press("Enter");
}

test("S95-06 spelling feedback waits for confirmation and identifies the changed letter", async ({app, page}) => {
  const [id] = await app.seedCards([dog]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {getVoices: () => [], cancel() {}, speak() {}},
    });
  });
  await page.route("**/api/tts/audio/dog*", route => route.abort("failed"));
  const submissions = [];
  let release;
  const responseBarrier = new Promise(resolve => { release = resolve; });
  await page.route("**/api/typing/check", async route => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      const saved = await route.fetch();
      expect(saved.ok()).toBe(true);
      await responseBarrier;
      return route.abort("failed");
    }
    return route.continue();
  });
  await openSpelling(page, app);
  await expect(page.getByText("dog", {exact: true})).toHaveCount(0);
  await enter(page, "dig");
  try {
    await expect.poll(async () => (await details(app, id)).learning_events.length).toBe(1);
    await expect(page.getByText(difference, {exact: true})).toHaveCount(0);
    await expect(input(page)).toHaveValue("dig");
  } finally {
    release();
  }
  await expect(page.getByRole("alert")).toContainText("保存未确认");
  await expect(input(page)).toHaveValue("dig");
  await page.getByRole("button", {name: "重试保存", exact: true}).click();
  await expect(page.getByRole("status").filter({hasText: "已保存"})).toBeVisible();
  await expect(page.getByText(difference, {exact: true})).toBeVisible();
  await expect(page.getByText("你的拼写：", {exact: false})).toContainText("dig");
  await expect(page.getByText("正确拼写：", {exact: false})).toContainText("dog");
  expect(submissions[1]).toEqual(submissions[0]);
  expect((await details(app, id)).learning_events).toEqual([expect.objectContaining({correct: false})]);

  await page.getByRole("button", {name: "听正确发音", exact: true}).press("Enter");
  await expect(page.getByRole("status").filter({hasText: "朗读暂不可用"})).toBeVisible();
  expect((await backup(app)).extensions.learning_contacts.filter(row => row.kind === "answer_audio")).toHaveLength(0);
  await next(page).click();
  await expect(page.getByRole("heading", {name: "拼写完成！"})).toBeVisible();
});

test("S95-06 retries only a miss after the other questions and retains both attempts", async ({app, page}) => {
  const [id] = await app.seedCards([dog, book]);
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function () {
      if (!this.src.includes("/api/tts/audio/dog")) return play.call(this);
      const playback = {canceled: false};
      this.spellingPlayback = playback;
      return new Promise(resolve => {
        window.startSpellingAudio = () => {
          if (playback.canceled) return false;
          resolve();
          return true;
        };
      });
    };
    HTMLMediaElement.prototype.pause = function () {
      if (this.spellingPlayback) this.spellingPlayback.canceled = true;
      return pause.call(this);
    };
  });
  await openSpelling(page, app);
  await expect(page.getByText("狗", {exact: true})).toBeVisible();
  await enter(page, "dig");
  await expect(page.getByText(difference, {exact: true})).toBeVisible();
  const listen = page.getByRole("button", {name: "听正确发音", exact: true});
  await listen.click();
  expect(await page.evaluate(() => window.startSpellingAudio())).toBe(true);
  const soundContacts = async () => (await backup(app)).extensions.learning_contacts
    .filter(row => row.card_id === id && row.kind === "answer_audio");
  await expect.poll(async () => (await soundContacts()).length).toBe(1);

  await listen.click();
  await next(page).click();
  await expect(page.getByText("书", {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.startSpellingAudio())).toBe(false);
  await expect(page.getByText("dog", {exact: true})).toHaveCount(0);
  await expect(input(page)).toHaveValue("");
  await enter(page, "book");
  await expect(page.getByText(/拼写正确/)).toBeVisible();
  await next(page).click();
  await expect(page.getByRole("heading", {name: "拼写完成！"})).toBeVisible();
  await expect(input(page)).toHaveCount(0);

  await page.getByRole("button", {name: "重练错词", exact: true}).click();
  await expect(page.getByText("狗", {exact: true})).toBeVisible();
  await expect(input(page)).toHaveValue("");
  await expect(page.getByText("dog", {exact: true})).toHaveCount(0);
  await enter(page, "dog");
  await expect(page.getByText(/拼写正确/)).toBeVisible();
  await next(page).click();
  await expect(page.getByText(/拼对 1\/1 词/)).toBeVisible();

  const card = await details(app, id);
  expect(card.learning_events.map(({answer, correct, assistance, scheduled}) =>
    ({answer, correct, assistance, scheduled}))).toEqual([
    {answer: "dig", correct: false, assistance: [], scheduled: true},
    {answer: "dog", correct: true, assistance: ["answer_visible"], scheduled: false},
  ]);
  expect(card.learning_evidence.recall).toMatchObject({status: "weak", count: 1});
  expect(new Set(card.learning_events.map(event => event.event_id)).size).toBe(2);
  expect(await soundContacts()).toHaveLength(1);

  await page.getByRole("button", {name: "回到队列", exact: true}).click();
  await page.getByRole("button", {name: "单词本", exact: true}).click();
  await page.locator(".word-item").filter({hasText: /^dog/}).click();
  await expect(page.getByRole("heading", {name: "学习记录", exact: true})).toBeVisible();
  const history = page.getByTestId("learning-event");
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText("答对");
  await expect(history.nth(0)).toContainText("未更新排期");
  await expect(history.nth(1)).toContainText("答错");
});

test("S95-06 the single error waits for an explicit retry and a skip stays unanswered", async ({app, page}) => {
  const [id] = await app.seedCards([dog]);
  await openSpelling(page, app);
  await enter(page, "dig");
  await expect(page.getByText(difference, {exact: true})).toBeVisible();
  await next(page).click();
  await expect(page.getByRole("heading", {name: "拼写完成！"})).toBeVisible();
  await expect(input(page)).toHaveCount(0);

  await page.getByRole("button", {name: "重练错词", exact: true}).click();
  await expect(input(page)).toHaveValue("");
  await page.getByRole("button", {name: "跳过这题 →", exact: true}).click();
  await expect(page.getByText(/未作答/)).toBeVisible();
  await expect(page.getByText(difference, {exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "听正确发音", exact: true})).toHaveCount(0);
  await next(page).click();
  await expect(page.getByRole("heading", {name: "拼写完成！"})).toBeVisible();
  await expect(page.getByRole("button", {name: "重练错词", exact: true})).toHaveCount(0);
  const {learning_events: events} = await details(app, id);
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({answer: null, correct: null, skipped: true, scheduled: false});
});

test("S95-06 ordinary quiz explains a saved input mistake", async ({app, page}) => {
  await app.seedCards([dog]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "直接做测验", exact: true}).click();
  await expect(input(page)).toBeVisible();
  await expect(page.getByText("dog", {exact: true})).toHaveCount(0);
  await enter(page, "dig");
  await expect(page.getByRole("status").filter({hasText: "已保存"})).toBeVisible();
  await expect(page.getByText(difference, {exact: true})).toBeVisible({timeout: 4000});
});

test("S95-06 daily reinforcement explains a saved input mistake before the summary", async ({app, page}) => {
  await app.seedCards([dog]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(input(page)).toBeVisible();
  await enter(page, "dig");
  await expect(page.getByRole("status").filter({hasText: "已保存：答错"})).toBeVisible();
  await expect(page.getByText(difference, {exact: true})).toBeVisible({timeout: 4000});
  await page.getByRole("button", {name: "查看本轮结果", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
});

test("S95-06 a changed word card rejects the old spelling question before showing feedback", async ({app, page}) => {
  const [id] = await app.seedCards([dog]);
  await openSpelling(page, app);
  const revised = await app.request.put(`/api/cards/${id}`, {data: {meaning: "犬"}});
  expect(revised.ok()).toBe(true);
  await enter(page, "dig");
  await expect(page.getByRole("alert")).toContainText("词卡内容已修改", {timeout: 4000});
  await expect(page.getByText(difference, {exact: true})).toHaveCount(0);
  await expect(input(page)).toHaveValue("dig");
  expect((await details(app, id)).learning_events).toEqual([]);

  await page.getByRole("button", {name: "重新加载题目", exact: true}).click();
  await expect(page.getByText("犬", {exact: true})).toBeVisible();
  await expect(input(page)).toHaveValue("");
  await enter(page, "dog");
  await expect(page.getByText(/拼写正确/)).toBeVisible();
});
