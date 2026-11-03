import {test, expect} from "./support/test.mjs";

async function prepareRecovery(app, count = 7) {
  const ids = await app.seedCards(Array.from({length: count + 1}, (_, i) => ({word: `return${i}`, meaning: `词${i}`})));
  await app.setTime("2026-10-01T01:00:00Z");
  for (const card_id of ids.slice(0, count)) {
    expect((await app.request.post("/api/reviews", {data: {
      card_id, rating: 1, source: "study", kind: "self_rating", submission_id: crypto.randomUUID(),
    }})).ok()).toBe(true);
  }
  await app.setTime("2026-10-05T01:00:00Z");
  return ids;
}
async function rate(page) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(".rating-3").click();
}
const resume = page => page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
async function chooseRecovery(page) {
  await page.getByRole("button", {name: "选择恢复学习", exact: true}).click();
  await expect(page.getByTestId("round-target")).toContainText("新词 0 个");
  await page.getByRole("button", {name: "开始恢复学习", exact: true}).click();
}

test("EL-19 finite recovery saves five due words and returns to regular learning", async ({app, page}) => {
  const ids = await prepareRecovery(app);
  const before = await (await app.request.get("/api/export/backup")).json();
  await page.goto(app.baseURL);
  await expect(page.getByTestId("recovery-offer")).toContainText("恢复学习");
  await page.reload();
  await expect(page.getByTestId("recovery-offer")).toBeVisible();
  await chooseRecovery(page);
  for (let i = 0; i < 5; i++) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 5`);
    await expect(page.locator(".front-main")).toHaveText(`return${i}`);
    await rate(page);
  }
  await expect(page.getByRole("heading", {name: "恢复学习结果", exact: true})).toBeVisible();
  await expect(page.locator(".done-detail")).toContainText("5 张卡已保存");
  await expect(page.getByTestId("recovery-remaining")).toContainText("剩余到期 2 张");
  await page.screenshot({path: test.info().outputPath("recovery-result.png")});
  const after = await (await app.request.get("/api/export/backup")).json();
  expect(after.learning_events).toHaveLength(before.learning_events.length + 5);
  expect(after.reviews.find(row => row.card_id === ids[5])).toEqual(before.reviews.find(row => row.card_id === ids[5]));
  expect(after.reviews.find(row => row.card_id === ids[0]).due).not.toEqual(before.reviews.find(row => row.card_id === ids[0]).due);
  await page.getByRole("button", {name: "继续常规计划", exact: true}).click();
  await expect(page.getByTestId("recovery-offer")).toHaveCount(0);
  await expect(page.getByRole("combobox", {name: "今天可用时间"})).toHaveValue("8");
  await expect(page.getByTestId("round-target")).toContainText("新词 1 个");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("return5");
});

for (const [days, hasDue, available] of [[2, true, false], [3, true, true], [2, false, false], [3, false, false]]) {
  test(`EL-19 ${days} day interruption with ${hasDue ? "due" : "no due"} words offers recovery honestly`, async ({app, page}) => {
    const [card_id] = await app.seedCards([{word: "apple", kind: hasDue ? "word" : "sentence"}, {word: "fresh"}]);
    await app.setTime("2026-10-01T15:59:00Z"); // Shanghai Oct 1
    expect((await app.request.post("/api/reviews", {data: {card_id, rating: 1, source: "study", kind: "self_rating", submission_id: crypto.randomUUID()}})).ok()).toBe(true);
    await app.setTime(`2026-10-0${days + 1}T15:59:00Z`);
    const before = await (await app.request.get("/api/export/backup")).json();
    await page.goto(app.baseURL);
    await expect(page.getByTestId("round-target")).toBeVisible();
    await expect(page.getByTestId("recovery-offer")).toHaveCount(available ? 1 : 0);
    await page.reload();
    await expect(page.getByTestId("round-target")).toBeVisible();
    await expect(page.getByTestId("recovery-offer")).toHaveCount(available ? 1 : 0);
    expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toEqual(before.learning_events);
    if (days === 2 && hasDue) {
      await app.setTime("2026-10-03T16:00:00Z"); // Shanghai Oct 4, UTC still Oct 3
      await page.reload();
      await expect(page.getByTestId("recovery-offer")).toBeVisible();
    }
  });
}

test("EL-19 explicit recovery selection preserves regular budget and zero fresh words", async ({app, page}) => {
  await prepareRecovery(app, 1);
  await app.setTime("2026-11-01T01:00:00Z");
  await page.goto(app.baseURL);
  await page.getByRole("combobox", {name: "今天可用时间"}).selectOption("15");
  await page.getByRole("button", {name: "选择恢复学习", exact: true}).click();
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 1 张 · 到期复习 1 张 · 新词 0 个");
  await expect(page.getByRole("combobox", {name: "今天可用时间"})).toHaveValue("3");
  await page.getByRole("button", {name: "选择常规计划", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "今天可用时间"})).toHaveValue("15");
  await expect(page.getByTestId("round-target")).toContainText("新词 1 个");
  await chooseRecovery(page);
  await rate(page);
  await expect(page.getByRole("heading", {name: "恢复学习结果", exact: true})).toBeVisible();
  await expect(page.getByTestId("recovery-remaining")).toContainText("剩余到期 0 张");
  await page.getByRole("button", {name: "继续常规计划", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "今天可用时间"})).toHaveValue("15");
});

test("EL-19 pause and refresh preserve frozen recovery without inventing skipped work", async ({app, page}) => {
  await prepareRecovery(app);
  await page.goto(app.baseURL);
  await chooseRecovery(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 5");
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本段已保存结果", exact: true})).toBeVisible();
  await expect(page.locator(".done-detail")).toContainText("1 张卡已保存");
  await expect(page.getByTestId("recovery-remaining")).toContainText("剩余到期 6 张");
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await page.reload();
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 5 张");
  await expect(page.getByRole("combobox", {name: "今天可用时间"})).toBeDisabled();
  await resume(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 5");
  await expect(page.locator(".front-main")).toHaveText("return1");
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events).toHaveLength(8);
  expect(backup.learning_events.filter(e => e.stage === "main")).toHaveLength(1);
  expect(backup.learning_events.some(e => e.skipped)).toBe(false);
});

for (const fault of ["response-loss", "commit-failure"]) {
  test(`EL-19 ${fault} retains original pending identity through refresh`, async ({app, page}) => {
    await prepareRecovery(app);
    await page.goto(app.baseURL);
    await chooseRecovery(page);
    const commands = [];
    page.on("request", request => {if (request.url().endsWith("/api/reviews")) commands.push(request.postDataJSON());});
    if (fault === "commit-failure") await app.failCommitOnce();
    await page.route("**/api/reviews", async route => {
      const response = await route.fetch();
      if (fault === "response-loss") await route.abort("failed");
      else await route.fulfill({response});
    }, {times: 1});
    await rate(page);
    await expect(page.getByRole("alert")).toContainText("尚未确认保存");
    await expect(page.locator(".study-count")).toHaveText("1 / 5");
    await expect(page.getByRole("button", {name: "先到这里", exact: true})).toBeDisabled();
    await page.reload();
    await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
    await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
    await resume(page);
    await expect(page.locator(".study-count")).toHaveText("2 / 5");
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    const replay = await app.request.post("/api/reviews", {data: commands[0]});
    expect(replay.ok()).toBe(true);
    expect((await app.request.post("/api/reviews", {data: {...commands[0], rating: 4}})).status()).toBe(409);
    const backup = await (await app.request.get("/api/export/backup")).json();
    expect(backup.learning_events.filter(e => e.submission_id === commands[0].submission_id)).toHaveLength(1);
    expect(backup.learning_events).toHaveLength(8);
  });
}

for (const change of ["revision", "deletion"]) {
  test(`EL-19 frozen ${change} requires explicit recovery reload`, async ({app, page}) => {
    const ids = await prepareRecovery(app);
    await page.goto(app.baseURL);
    await chooseRecovery(page);
    if (change === "revision") expect((await app.request.put(`/api/cards/${ids[0]}`, {data: {meaning: "修改后含义"}})).ok()).toBe(true);
    else expect((await app.request.delete(`/api/cards/${ids[0]}`)).ok()).toBe(true);
    await rate(page);
    await expect(page.getByRole("alert")).toContainText(change === "revision" ? "内容已修改" : "Card not found");
    await expect(page.locator(".study-count")).toHaveText("1 / 5");
    await page.getByRole("button", {name: "退出本轮并重新加载", exact: true}).click();
    await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toBeVisible();
    const backup = await (await app.request.get("/api/export/backup")).json();
    expect(backup.learning_events.filter(e => e.stage === "main")).toHaveLength(0);
    expect(backup.learning_events).toHaveLength(change === "deletion" ? 6 : 7);
  });
}

async function restoreFromUI(page, backup) {
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "recovery.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
}

test("EL-19 V3 restore clears stale browser round and retains saved recovery evidence", async ({app, page}) => {
  await prepareRecovery(app);
  await page.goto(app.baseURL);
  await chooseRecovery(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 5");
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await expect(page.locator(".done-detail")).toContainText("1 张卡已保存");
  const backup = await (await app.request.get("/api/export/backup")).json();
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await restoreFromUI(page, backup);
  await expect(page.getByRole("button", {name: "继续本轮学习", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toBeVisible();
  const restored = await (await app.request.get("/api/export/backup")).json();
  expect(restored.learning_events).toHaveLength(8);
  expect(restored.learning_events.map(e => e.submission_id)).toEqual(backup.learning_events.map(e => e.submission_id));
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("return1");
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 7");
});

test("EL-19 functional rollback hides offer and completes an already frozen recovery", async ({appFactory, page}) => {
  const app = await appFactory();
  await prepareRecovery(app);
  await page.goto(app.baseURL);
  await chooseRecovery(page);
  const frozen = await page.evaluate(() => localStorage.getItem("activeDailySession"));
  const disabled = await appFactory({fixture: "el19-rollback.json", snapshotOf: app.databasePath});
  await disabled.setTime("2026-10-05T01:00:00Z");
  await page.addInitScript(value => localStorage.setItem("activeDailySession", value), frozen);
  await page.goto(disabled.baseURL);
  await expect(page.getByTestId("recovery-offer")).toHaveCount(0);
  await resume(page);
  for (let i = 0; i < 5; i++) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 5`);
    await rate(page);
  }
  await expect(page.getByRole("heading", {name: "恢复学习结果", exact: true})).toBeVisible();
  await expect(page.getByTestId("recovery-remaining")).toContainText("剩余到期 2 张");
  await page.getByRole("button", {name: "继续常规计划", exact: true}).click();
  await expect(page.getByTestId("recovery-offer")).toHaveCount(0);
  expect((await (await disabled.request.get("/api/export/backup")).json()).learning_events).toHaveLength(12);
});

test("EL-19 long interruption caps fast personal estimates at five due words", async ({app, page}) => {
  const ids = await prepareRecovery(app, 12);
  await app.setTime("2026-10-01T02:00:00Z");
  for (const card_id of ids.slice(0, 5)) {
    const submission_id = crypto.randomUUID();
    expect((await app.request.post("/api/reviews", {data: {card_id, rating: 1, source: "study", kind: "self_rating", submission_id}})).ok()).toBe(true);
    expect((await app.request.post("/api/learning/durations", {data: {sample_id: crypto.randomUUID(), submission_id, kind: "review", active_ms: 2000}})).ok()).toBe(true);
  }
  await app.setTime("2026-11-01T01:00:00Z");
  await page.goto(app.baseURL);
  await page.getByRole("combobox", {name: "今天可用时间"}).selectOption("3");
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 13 张 · 到期复习 12 张 · 新词 1 个");
  await page.getByRole("button", {name: "选择恢复学习", exact: true}).click();
  await expect(page.getByTestId("round-target")).toContainText("本轮目标 5 张 · 到期复习 5 张 · 新词 0 个");
  await expect(page.getByTestId("remaining-due")).toContainText("另有 7 张");
  await page.screenshot({path: test.info().outputPath("recovery-offer.png")});
  await page.getByRole("button", {name: "开始恢复学习", exact: true}).click();
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 5");
});
