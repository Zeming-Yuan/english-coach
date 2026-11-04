import {test, expect} from "./support/test.mjs";

const start = page => page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
async function rate(page, rating = 3) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(`.rating-${rating}`).click();
}

test("EL-22 selected time gives one next step and resumes the same saved round", async ({app, page}) => {
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`, meaning: `词义${i}`})));
  await page.goto(app.baseURL);
  await page.getByLabel("今天可用时间").selectOption("3");
  const next = page.getByRole("region", {name: "今天下一步", exact: true});
  await expect(next.getByTestId("next-step-reason")).toHaveText("先学本轮的 2 个新词，再用少量练习巩固。");
  await expect(next.getByRole("button", {name: "开始今天的学习", exact: true})).toHaveCount(1);
  await expect(next).not.toContainText("word0");
  await start(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await expect(page.getByTestId("daily-closure")).toHaveCount(0);
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await page.reload();
  await expect(next.getByTestId("next-step-reason")).toHaveText("上轮还有 1 张未完成，先从保存的位置继续。");
  await expect(next.getByLabel("今天可用时间")).toBeDisabled();
  await next.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await expect(page.locator(".front-main")).toHaveText("word1");
  await page.screenshot({path: test.info().outputPath("resume.png")});
});

test("EL-22 home keeps its action above the fold and exposes estimates only on demand", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  const next = page.getByRole("region", {name: "今天下一步", exact: true});
  await expect(next.getByTestId("time-budget-plan")).toBeVisible();
  await expect(next.getByTestId("estimate-basis")).not.toBeVisible({timeout: 3000});
  await expect(next.getByLabel("每日最低完成目标")).not.toBeVisible();
  await expect(next.getByTestId("time-budget-plan")).toBeVisible();
  const action = next.getByRole("button", {name: "开始今天的学习", exact: true});
  await expect(action).toBeInViewport({ratio: 1});
  await expect(next.getByRole("heading", {name: "今天的学习", exact: true})).toBeInViewport({ratio: 1});
  await page.screenshot({path: test.info().outputPath("home-focused.png")});
  await next.getByText("计划详情与目标设置", {exact: true}).focus();
  await page.keyboard.press("Enter");
  await expect(next.getByTestId("estimate-basis")).toBeVisible();
  await next.getByLabel("每日最低完成目标").selectOption("15");
  await expect(next.getByTestId("round-target")).toContainText("1 张");
  await page.reload();
  await next.getByText("计划详情与目标设置", {exact: true}).click();
  await expect(next.getByRole("progressbar", {name: "今日最低目标进度"})).toHaveAttribute("aria-valuemax", "15");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("EL-22 saved completion closes the day while weak words and optional details remain honest", async ({app, page}) => {
  const ids = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await page.goto(app.baseURL);
  await start(page);
  await rate(page, 1);
  await rate(page);
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await expect(page.getByTestId("next-step-reason")).toHaveText("主队列已保存，继续可选巩固或查看本轮结果。");
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await expect(page.getByTestId("daily-closure")).toHaveText("本轮已完成，今天可以结束了。");
  await expect(page.locator(".done-detail")).toContainText("2 张卡已保存并排期");
  await expect(page.getByText("仍需复习：apple", {exact: true})).toBeVisible();
  await expect(page.getByText("自评：1 / 2", {exact: true})).not.toBeVisible();
  const before = await (await app.request.get("/api/export/backup")).json();
  await page.getByText("查看详细学习记录与自选练习", {exact: true}).click();
  await expect(page.getByText("自评：1 / 2", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "去做测验", exact: true})).toBeVisible();
  const after = await (await app.request.get("/api/export/backup")).json();
  expect(after.learning_events).toEqual(before.learning_events);
  expect(after.learning_events.map(event => event.card_id)).toEqual(ids);
  await page.getByText("查看详细学习记录与自选练习", {exact: true}).click();
  await page.screenshot({path: test.info().outputPath("daily-closure.png")});
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await expect(page.getByTestId("next-step-reason")).toContainText("今天可以结束了");
});

async function finishRound(page) {
  await expect(page.locator(".study-count")).toBeVisible();
  const [index, target] = (await page.locator(".study-count").textContent()).match(/\d+/g).map(Number);
  for (let position = index; position <= target; position++) {
    await rate(page);
    if (position < target) await expect(page.locator(".study-count")).toHaveText(`${position + 1} / ${target}`);
  }
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
}

async function twoInterruptedRounds(app, page) {
  for (const [round, day] of [[0, "01"], [1, "10"]]) {
    await app.setTime(`2026-12-${day}T01:00:00Z`);
    await page.goto(app.baseURL);
    await start(page);
    await rate(page);
    await expect(page.locator(".study-count")).toContainText("2 /");
    if (round === 0) {
      // Repeated pause and refresh of one round must never become two rounds.
      for (let pause = 0; pause < 2; pause++) {
        await page.getByRole("button", {name: "先到这里", exact: true}).click();
        await page.getByRole("button", {name: "返回首页", exact: true}).click();
        await page.reload();
        await expect(page.getByLabel("今天可用时间")).toHaveValue("8");
        await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
      }
      const sibling = await page.context().newPage();
      try {
        await sibling.goto(app.baseURL);
        await sibling.getByRole("button", {name: "继续本轮学习", exact: true}).click();
        const before = await (await app.request.get("/api/export/backup")).json();
        await Promise.all([page, sibling].map(tab => tab.getByRole("button", {name: "先到这里", exact: true}).click()));
        for (const tab of [page, sibling]) await expect(tab.getByRole("heading", {name: "本段已保存结果", exact: true})).toBeVisible();
        const after = await (await app.request.get("/api/export/backup")).json();
        expect(after.learning_events).toEqual(before.learning_events);
        await page.getByRole("button", {name: "返回首页", exact: true}).click();
        await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
      } finally {await sibling.close();}
    } else {
      await page.getByRole("button", {name: "← 退出", exact: true}).click();
      await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
    }
    await finishRound(page);
    if (round === 0) await expect(page.getByLabel("今天可用时间")).toHaveValue("8");
  }
}

test("EL-22 two interrupted rounds shorten only future advice without counting repeated pauses", async ({appFactory, page}) => {
  test.setTimeout(180000);
  const app = await appFactory({fixture: "el18-rollback.json"});
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`})));
  await twoInterruptedRounds(app, page);
  await expect(page.getByLabel("今天可用时间")).toHaveValue("3", {timeout: 3000});
  await advancePastDue(app);
  await page.reload();
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 5 张");
  await expect(page.getByTestId("next-step-reason")).toContainText("本浏览器");
  const regular = await (await app.request.get("/api/today?budget_minutes=8")).json();
  expect(regular.target).toBe(12);
  expect(regular.new_remaining).toBe(10);
  await page.screenshot({path: test.info().outputPath("shorter-advice.png")});
  // The learner can still explicitly choose a longer budget.
  await page.getByLabel("今天可用时间").selectOption("15");
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 12 张");
});

async function advancePastDue(app) {
  const backup = await (await app.request.get("/api/export/backup")).json();
  const due = backup.reviews.map(review => Date.parse(/Z$|[+-]\d\d:\d\d$/.test(review.due) ? review.due : review.due + "Z"));
  await app.setTime(new Date(Math.max(...due) + 86400000).toISOString());
}

test("EL-22 three uninterrupted completions restore advice and backup replacement resets its scope", async ({appFactory, page}) => {
  test.setTimeout(180000);
  const app = await appFactory({fixture: "el18-rollback.json"});
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`})));
  await twoInterruptedRounds(app, page);
  await expect(page.getByLabel("今天可用时间")).toHaveValue("3");
  for (let round = 0; round < 3; round++) {
    await advancePastDue(app);
    await page.reload();
    await start(page);
    if (round === 0) {
      const before = await (await app.request.get("/api/export/backup")).json();
      await app.failCommitOnce();
      await rate(page);
      await expect(page.getByRole("alert")).toContainText("尚未确认保存");
      await expect(page.locator(".study-count")).toHaveText("1 / 5");
      await expect(page.getByTestId("daily-closure")).toHaveCount(0);
      expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toEqual(before.learning_events);
      await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.locator(".study-count")).toHaveText("2 / 5");
    }
    await finishRound(page);
    await expect(page.getByLabel("今天可用时间")).toHaveValue(round < 2 ? "3" : "8", {timeout: 3000});
  }
  await advancePastDue(app);
  await page.reload();
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 12 张");
  await expect(page.getByTestId("next-step-reason")).toContainText("连续完成三轮");
  await page.screenshot({path: test.info().outputPath("steady-advice.png")});
  // Explicit choices remain possible, and the regular preference survives restore.
  await page.getByLabel("今天可用时间").selectOption("15");
  await page.reload();
  await expect(page.getByLabel("今天可用时间")).toHaveValue("8");
  const backup = await (await app.request.get("/api/export/backup")).json();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.locator('input[type="file"]').setInputFiles({name: "rounds.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await expect(page.getByLabel("今天可用时间")).toHaveValue("15");
  await expect(page.getByTestId("next-step-reason")).not.toContainText("本浏览器");
});

test("EL-22 skipped rounds do not count as stable completed work or change memory schedules", async ({appFactory, page}) => {
  test.setTimeout(180000);
  const app = await appFactory({fixture: "el18-rollback.json"});
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`})));
  await twoInterruptedRounds(app, page);
  await expect(page.getByLabel("今天可用时间")).toHaveValue("3");
  await advancePastDue(app);
  const before = await (await app.request.get("/api/export/backup")).json();
  for (let round = 0; round < 3; round++) {
    await page.reload();
    await start(page);
    for (let position = 1; position <= 5; position++) {
      await expect(page.locator(".study-count")).toHaveText(`${position} / 5`);
      await page.getByRole("button", {name: "跳过这张卡", exact: true}).click();
    }
    await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
    await expect(page.locator(".done-detail")).toContainText("0 张卡已保存并排期");
    await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  }
  await expect(page.getByLabel("今天可用时间")).toHaveValue("3", {timeout: 3000});
  const after = await (await app.request.get("/api/export/backup")).json();
  expect(after.reviews).toEqual(before.reviews);
  expect(after.learning_events.slice(before.learning_events.length)).toHaveLength(15);
  expect(after.learning_events.slice(before.learning_events.length).every(event => event.skipped && !event.scheduled)).toBe(true);
});

test("EL-22 unavailable browser storage cannot block saved learning or invent completed observations", async ({app, page}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {throw new DOMException("blocked", "QuotaExceededError");};
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await start(page);
  await finishRound(page);
  await expect(page.getByLabel("今天可用时间")).toHaveValue("8");
  expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("EL-22 empty due and recovery reasons reflect the real queue without creating learning events", async ({app, page}) => {
  await page.goto(app.baseURL);
  await expect(page.getByTestId("next-step-reason")).toHaveText("先添加想学的词，或从入门词卡开始。");
  for (const minutes of [3, 8, 15]) {
    await page.getByLabel("今天可用时间").selectOption(String(minutes));
    await expect(page.getByTestId("time-budget-plan")).toContainText("预计约 0 分钟");
  }
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "book", meaning: "书"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  expect((await app.request.post("/api/reviews", {data: {card_id: id, rating: 1, source: "study", kind: "self_rating", submission_id: crypto.randomUUID()}})).ok()).toBe(true);
  await app.setTime("2026-10-05T01:00:00Z");
  await page.reload();
  await expect(page.getByTestId("next-step-reason")).toContainText("先复习本轮的 1 张到期词卡");
  await page.getByRole("button", {name: "选择恢复学习", exact: true}).click();
  await expect(page.getByTestId("next-step-reason")).toHaveText("先用一小轮到期复习找回节奏，无需一次清空积压。");
  await expect(page.getByRole("region", {name: "今天下一步", exact: true})).not.toContainText("apple");
  expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toHaveLength(1);
  await page.getByRole("button", {name: "开始恢复学习", exact: true}).click();
  await rate(page);
  await expect(page.getByTestId("daily-closure")).toBeVisible();
  await page.getByRole("button", {name: "今天先到这里", exact: true}).click();
  await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toBeVisible();
  await expect(page.getByLabel("今天可用时间")).toHaveValue("15");
});

test("EL-22 deleting every card still offers the frozen round and an explicit invalid-round exit", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await start(page);
  expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", {name: "继续本轮学习", exact: true})).toBeVisible({timeout: 3000});
  await page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await rate(page);
  await expect(page.getByRole("alert")).toContainText("Card not found");
  await expect(page.getByTestId("daily-closure")).toHaveCount(0);
  await page.getByRole("button", {name: "退出本轮并重新加载", exact: true}).click();
  await expect(page.getByRole("heading", {name: "欢迎来到 EnglishCoach", exact: true})).toBeVisible();
  expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toHaveLength(0);
});

test("EL-22 a stale tab leaving after completion cannot downgrade future advice", async ({appFactory, page}) => {
  test.setTimeout(180000);
  const app = await appFactory({fixture: "el18-rollback.json"});
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`})));
  await twoInterruptedRounds(app, page);
  let sibling;
  try {
    for (let round = 0; round < 3; round++) {
      await advancePastDue(app);
      await page.reload();
      await start(page);
      if (round === 2) {
        sibling = await page.context().newPage();
        await sibling.goto(app.baseURL);
        await sibling.getByRole("button", {name: "继续本轮学习", exact: true}).click();
        await expect(sibling.locator(".study-count")).toHaveText("1 / 5");
      }
      await finishRound(page);
    }
    await expect(page.getByLabel("今天可用时间")).toHaveValue("8");
    const before = await (await app.request.get("/api/export/backup")).json();
    await sibling.getByRole("button", {name: "← 退出", exact: true}).click();
    await expect(sibling.getByRole("button", {name: "继续本轮学习", exact: true})).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("今天可用时间")).toHaveValue("8", {timeout: 3000});
    expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toEqual(before.learning_events);
  } finally {await sibling?.close();}
});
