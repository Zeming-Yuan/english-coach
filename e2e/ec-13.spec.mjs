import {test, expect} from "./support/test.mjs";

test("EC-13 daily round is due-first with fixed target and visible backlog", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec13-backlog.json"});
  await page.goto(app.baseURL);
  await expect(page.getByTestId("remaining-due")).toContainText("5");
  await expect(page.locator(".today-stats")).toBeVisible({timeout: 5000});
  await page.screenshot({path: `/tmp/english-coach-followup-2026-10-31/ec13-home-${test.info().project.name}.png`});
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("1 / 22");
  await expect(page.locator(".front-main")).toHaveText("due25");
  await page.screenshot({path: `/tmp/english-coach-followup-2026-10-31/ec13-study-${test.info().project.name}.png`});
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.locator(".study-count")).toHaveText("2 / 22");
  const detail = await (await app.request.get("/api/cards/25")).json();
  expect(detail.learning_events).toHaveLength(1);
  expect(detail.learning_events[0].stage).toBe("main");
  expect(detail.learning_events[0].session_id).toBeTruthy();
});

test("EC-13 refresh resumes the frozen round after confirmed saves", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec13-backlog.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.locator(".study-count")).toHaveText("2 / 22");
  await page.reload();
  await expect(page.getByTestId("remaining-due")).toContainText("5", {timeout: 5000});
  await expect(page.getByTestId("round-target")).toContainText("22");
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click({timeout: 5000});
  await expect(page.locator(".study-count")).toHaveText("2 / 22");
  await expect(page.locator(".front-main")).toHaveText("due1");
});

test("EC-13 failed save stays put and refresh confirmation advances exactly once", async ({app, page}) => {
  const ids = await app.seedCards([{word: "first"}, {word: "second"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await app.failCommitOnce();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("保存");
  await expect(page.locator(".study-count")).toHaveText("1 / 2");
  expect((await (await app.request.get(`/api/cards/${ids[0]}`)).json()).learning_events).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click({timeout: 5000});
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  expect((await (await app.request.get(`/api/cards/${ids[0]}`)).json()).learning_events).toHaveLength(1);
});

test("EC-13 load error is distinct from empty library and offers retry", async ({app, page}) => {
  await page.route("**/api/today", route => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  await expect(page.getByRole("alert")).toContainText("加载");
  await expect(page.getByText("今日复习已完成", {exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "重试", exact: true}).click();
  await expect(page.getByText("欢迎来到 EnglishCoach", {exact: true})).toBeVisible();
});

test("EC-13 small library completes with keyboard and keeps specialist practice", async ({app, page}) => {
  await app.seedCards([{word: "only"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".study-count")).toHaveText("1 / 1");
  await page.getByRole("button", {name: "点击翻面", exact: true}).focus();
  await page.keyboard.press("Space");
  await page.locator(".rating-3").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.locator(".done-detail")).toContainText("1 张卡已保存");
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await expect(page.getByText("今日复习已完成", {exact: true})).toBeVisible();
  await expect(page.getByText("欢迎来到 EnglishCoach", {exact: true})).toHaveCount(0);
  await page.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", {name: "🎲 混合练习", exact: true})).toBeVisible();
});

test("EC-13 minimum daily goal never raises a lowered new-word quota", async ({app, page}) => {
  const ids = await app.seedCards(Array.from({length: 9}, (_, i) => ({word: `quota${i}`})));
  await app.request.post("/api/reviews", {data: {card_id: ids[0], rating: 1, source: "study", kind: "self_rating", submission_id: crypto.randomUUID()}});
  await page.goto(app.baseURL);
  await expect(page.getByTestId("new-word-limit")).toContainText("新词建议 5 个");
  await page.locator(".goal-daily-set").selectOption("20");
  await expect(page.locator(".goal-total")).toHaveText("/ 20");
  await expect(page.getByTestId("new-word-limit")).toContainText("新词建议 5 个");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("1 / 5");
});

test("EC-13 empty library shows loading and provides backup recovery entry", async ({app, page}) => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await page.route("**/api/today", async route => { await ready; await route.continue(); });
  await page.goto(app.baseURL, {waitUntil: "domcontentloaded"});
  await expect(page.getByText("加载中…", {exact: true})).toBeVisible();
  release();
  await expect(page.getByText("欢迎来到 EnglishCoach", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "先加几个词", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "体验入门词卡", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "恢复备份", exact: true}).click({timeout: 5000});
  await expect(page.getByLabel("选择备份文件", {exact: true})).toBeVisible();
});

test("EC-13 deleted card cannot count as complete and can exit to reload", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "removed"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBe(true);
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("保存");
  await expect(page.locator(".study-count")).toHaveText("1 / 1");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "退出本轮并重新加载", exact: true}).click({timeout: 5000});
  await expect(page.getByText("欢迎来到 EnglishCoach", {exact: true})).toBeVisible();
  expect((await (await app.request.get("/api/stats")).json()).reviewed_today).toBe(0);
});

test("EC-13 specialist detour preserves the suspended daily round", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec13-backlog.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.locator(".study-count")).toHaveText("2 / 22");
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await page.locator("summary").click();
  await page.locator(".error-entry").getByRole("button", {name: "复习 →", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("1 / 1");
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click({timeout: 5000});
  await expect(page.locator(".study-count")).toHaveText("2 / 22");
  const events = (await (await app.request.get("/api/cards/25")).json()).learning_events;
  expect(events.map(event => event.stage).sort()).toEqual(["main", "standalone"]);
});

test("EC-13 a completed full round leaves the backlog for a fresh next round", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec13-backlog.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  const seen = [];
  for (let i = 0; i < 22; i += 1) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 22`);
    seen.push(await page.locator(".front-main").textContent());
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-3").click();
  }
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  expect(seen).toEqual(["due25", ...Array.from({length: 19}, (_, i) => `due${i + 1}`), "new26", "new27"]);
  expect((await (await app.request.get("/api/stats")).json()).reviewed_today).toBe(22);
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 5 张");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("1 / 5");
  await expect(page.locator(".front-main")).toHaveText("due20");
});

test("EC-13 resuming before pending confirmation cannot review the same main card twice", async ({app, page}) => {
  const ids = await app.seedCards([{word: "first"}, {word: "second"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await app.failCommitOnce();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("保存");
  await page.reload();
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("1 / 2");
  // The first available confirmation used to be the global recovery banner.
  await page.getByRole("button", {name: "继续确认保存", exact: true}).first().click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2", {timeout: 5000});
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
  await expect(page.locator(".front-main")).toHaveText("second");
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.locator(".done-detail")).toContainText("2 张卡已保存");
  for (const id of ids) {
    const events = (await (await app.request.get(`/api/cards/${id}`)).json()).learning_events;
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe("main");
  }
});

async function enterDailyWithForeignPending(app, page) {
  const ids = await app.seedCards([{word: "first"}, {word: "second"}]);
  for (const id of ids) {
    expect((await app.request.post("/api/reviews", {data: {
      card_id: id, rating: 1, source: "study", kind: "self_rating", submission_id: crypto.randomUUID(),
    }})).ok()).toBe(true);
  }
  await app.setTime("2026-11-30T12:00:00Z");
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  const events = (await (await app.request.get(`/api/cards/${ids[0]}`)).json()).learning_events;
  const mainSessionId = events.find(event => event.stage === "main").session_id;
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await page.locator("summary").click();
  await page.locator(".error-entry").getByRole("button", {name: "复习 →", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("second");
  await app.failCommitOnce();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("保存");
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  return {ids, mainSessionId};
}

test("EC-13 standalone pending for the same card cannot count toward the daily session", async ({app, page}) => {
  const {ids, mainSessionId} = await enterDailyWithForeignPending(app, page);
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".front-main")).toHaveText("second");
  const recovered = (await (await app.request.get(`/api/cards/${ids[1]}`)).json()).learning_events;
  expect(recovered.map(event => event.stage)).toEqual(["standalone", "standalone"]);
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const main = (await (await app.request.get(`/api/cards/${ids[1]}`)).json()).learning_events.filter(event => event.stage === "main");
  expect(main).toHaveLength(1);
  expect(main[0].session_id).toBe(mainSessionId);
});

test("EC-13 an in-flight foreign recovery clears pending without advancing daily progress", async ({app, page}) => {
  const {ids, mainSessionId} = await enterDailyWithForeignPending(app, page);
  let release;
  const responseHeld = new Promise(resolve => { release = resolve; });
  await page.route("**/api/reviews", async route => {
    const response = await route.fetch();
    await responseHeld;
    await route.fulfill({response});
  }, {times: 1});
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect.poll(async () => (await (await app.request.get(`/api/cards/${ids[1]}`)).json()).learning_events.length).toBe(2);
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  release();
  await expect(page.getByRole("alert")).toHaveCount(0, {timeout: 5000});
  await expect(page.locator(".front-main")).toHaveText("second");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const events = (await (await app.request.get(`/api/cards/${ids[1]}`)).json()).learning_events;
  expect(events).toHaveLength(3);
  const main = events.filter(event => event.stage === "main");
  expect(main).toHaveLength(1);
  expect(main[0].session_id).toBe(mainSessionId);
});

for (const latePath of ["initial send", "retry", "home retry"]) {
  test(`EC-13 late ${latePath} confirmation preserves the next card's pending identity`, async ({app, page}) => {
    const ids = await app.seedCards([{word: "first"}, {word: "second"}]);
    const detail = async id => (await (await app.request.get(`/api/cards/${id}`)).json());
    const pending = () => page.evaluate(() => JSON.parse(localStorage.getItem("ec.pending.study")));
    await page.goto(app.baseURL);
    await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
    if (latePath !== "initial send") {
      await page.route("**/api/reviews", route => route.abort("failed"), {times: 1});
      await page.locator(".flip-hint").first().click();
      await page.locator(".rating-3").click();
      await expect(page.getByRole("alert")).toContainText("保存");
      if (latePath === "home retry") {
        await page.getByRole("button", {name: "← 退出", exact: true}).click();
      }
    }
    let releaseA, releaseB;
    const heldA = new Promise(resolve => { releaseA = resolve; });
    const heldB = new Promise(resolve => { releaseB = resolve; });
    const submissions = [];
    try {
      await page.route("**/api/reviews", async route => {
        const command = route.request().postDataJSON();
        submissions.push(command);
        const index = submissions.length;
        if (index === 2 || index > 3) return route.continue();
        const response = await route.fetch();
        await (index === 1 ? heldA : heldB);
        if (index === 1) await route.fulfill({response});
        else await route.abort("failed");
      });
      if (latePath !== "initial send") {
        await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
      } else {
        await page.locator(".flip-hint").first().click();
        await page.locator(".rating-3").click();
      }
      await expect.poll(async () => (await detail(ids[0])).learning_events.length).toBe(1);
      if (latePath === "home retry") {
        await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
        await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
      } else {
        await page.getByRole("button", {name: "← 退出", exact: true}).click();
        await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
        await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
        await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
      }
      await expect(page.locator(".front-main")).toHaveText("second");
      await page.locator(".flip-hint").first().click();
      await page.locator(".rating-3").click();
      await expect.poll(async () => (await detail(ids[1])).learning_events.length).toBe(1);
      const savedB = await detail(ids[1]);
      const pendingB = await pending();
      expect(pendingB.payload.card_id).toBe(ids[1]);
      const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/reviews") &&
        response.request().postDataJSON().submission_id === submissions[0].submission_id);
      releaseA();
      await (await lateResponse).finished();
      // Let the fulfilled response's JSON/React callbacks finish before inspecting storage.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await pending(), "late A must retain unconfirmed B for refresh recovery").toEqual(pendingB);
      await expect(page.locator(".study-count")).toHaveText("2 / 2");
      await expect(page.getByRole("status")).toContainText("正在确认保存");
      await expect(page.getByRole("heading", {name: "本轮主队列已保存", exact: true})).toHaveCount(0);
      releaseB();
      await expect(page.getByRole("alert")).toContainText("尚未确认保存");
      await page.reload();
      await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
      await expect(page.getByRole("heading", {name: "今日复习已完成", exact: true})).toBeVisible();
      await expect(page.locator(".today-stats")).toContainText("今日完成 2 词");
      expect(submissions.map(command => command.submission_id)).toEqual([
        submissions[0].submission_id, submissions[0].submission_id,
        pendingB.payload.submission_id, pendingB.payload.submission_id,
      ]);
      expect(await pending()).toBeNull();
      const finalB = await detail(ids[1]);
      expect(finalB.memory_state).toEqual(savedB.memory_state);
      expect(finalB.learning_events).toHaveLength(1);
      const backup = await (await app.request.get("/api/export/backup")).json();
      expect(backup.learning_events.filter(event => event.card_id === ids[1]).map(event => event.submission_id))
        .toEqual([pendingB.payload.submission_id]);
      expect(finalB.learning_events[0].stage).toBe("main");
      const finalA = await detail(ids[0]);
      expect(finalA.learning_events).toHaveLength(1);
      expect(finalA.learning_events[0].session_id).toBe(finalB.learning_events[0].session_id);
      expect(finalA.learning_events[0].stage).toBe("main");
    } finally {
      releaseA();
      releaseB();
    }
  });
}
