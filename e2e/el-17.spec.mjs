import {test, expect} from "./support/test.mjs";

const start = page => page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
const resume = page => page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
async function rate(page) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(".rating-3").click();
}

test("EL-17 budget preview pauses saved work and refresh resumes frozen round", async ({app, page}) => {
  const ids = await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`})));
  await page.goto(app.baseURL);
  const budget = page.getByRole("combobox", {name: "今天可用时间"});
  await expect(budget).toHaveValue("8");
  await budget.selectOption("15");
  await expect(page.getByTestId("round-target")).toContainText("10 张");
  await budget.selectOption("3");
  await expect(page.getByTestId("time-budget-plan")).toContainText("预计");
  await expect(page.getByTestId("round-target")).toContainText("2 张");
  await page.screenshot({path: test.info().outputPath("budget-preview.png")});
  await start(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await expect(page.getByRole("heading", {name: "本段已保存结果", exact: true})).toBeVisible();
  await expect(page.locator(".done-detail")).toContainText("1 张卡已保存");
  await expect(page.getByText("本轮目标 2 张，仍有 1 张未完成", {exact: true})).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.learning_events).toHaveLength(1);
  expect(backup.learning_events[0].skipped).toBe(false);
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await page.reload();
  await expect(budget).toBeDisabled();
  await expect(page.getByTestId("round-target")).toContainText("2 张");
  await resume(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await expect(page.locator(".front-main")).toHaveText("word1");
  await rate(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  await expect(page.getByTestId("new-word-limit")).toContainText("今日剩余 8");
  expect((await (await app.request.get(`/api/cards/${ids[1]}`)).json()).learning_events).toHaveLength(1);
});

for (const fault of ["response-loss", "commit-failure"]) {
  test(`EL-17 ${fault} at budget expiry keeps pending identity and confirms once`, async ({app, page}) => {
    await page.clock.install();
    await app.seedCards([{word: "first"}, {word: "second"}]);
    await page.goto(app.baseURL);
    await page.getByRole("combobox", {name: "今天可用时间"}).selectOption("3");
    await start(page);
    const commands = [];
    page.on("request", request => {
      if (request.url().endsWith("/api/reviews")) commands.push(request.postDataJSON());
    });
    if (fault === "commit-failure") await app.failCommitOnce();
    let release, fetched;
    const hold = new Promise(resolve => {release = resolve;});
    const reached = new Promise(resolve => {fetched = resolve;});
    await page.route("**/api/reviews", async route => {
      const result = await route.fetch();
      fetched();
      await hold;
      if (fault === "response-loss") await route.abort("failed");
      else await route.fulfill({response: result});
    }, {times: 1});
    try {
      await rate(page);
      await reached;
      await page.clock.fastForward(181000);
      await expect(page.getByTestId("budget-expired")).toContainText("可在确认保存后先到这里");
      await expect(page.locator(".study-count")).toHaveText("1 / 2");
      await expect(page.getByRole("button", {name: "先到这里", exact: true})).toBeDisabled();
      release();
      await expect(page.getByRole("alert")).toContainText("尚未确认保存");
      await page.reload();
      await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toHaveCount(0);
      await resume(page);
      await expect(page.locator(".study-count")).toHaveText("2 / 2");
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      const backup = await (await app.request.get("/api/export/backup")).json();
      expect(backup.learning_events).toHaveLength(1);
      expect(backup.learning_events[0].submission_id).toBe(commands[0].submission_id);
      await page.getByRole("button", {name: "先到这里", exact: true}).click();
      await expect(page.locator(".done-detail")).toContainText("1 张卡已保存");
    } finally {release();}
  });
}

for (const change of ["revision", "deletion"]) {
  test(`EL-17 frozen ${change} keeps target and offers explicit reload`, async ({app, page}) => {
    const [id] = await app.seedCards([{word: "first"}, {word: "second"}]);
    await page.goto(app.baseURL);
    await start(page);
    if (change === "revision") expect((await app.request.put(`/api/cards/${id}`, {data: {meaning: "修改后的含义"}})).ok()).toBe(true);
    else expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBe(true);
    await rate(page);
    await expect(page.getByRole("alert")).toContainText(change === "revision" ? "内容已修改" : "Card not found");
    await expect(page.locator(".study-count")).toHaveText("1 / 2");
    await expect(page.getByRole("button", {name: "先到这里", exact: true})).toBeDisabled();
    await page.getByRole("button", {name: "退出本轮并重新加载", exact: true}).click();
    await expect(page.getByRole("button", {name: "开始今天的学习", exact: true})).toBeVisible();
    expect((await (await app.request.get("/api/export/backup")).json()).learning_events).toHaveLength(0);
  });
}

test("EL-17 late pause summary cannot finish a resumed incomplete round", async ({app, page}) => {
  await app.seedCards([{word: "first"}, {word: "second"}]);
  await page.goto(app.baseURL);
  await start(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  let release, fetched;
  const hold = new Promise(resolve => {release = resolve;});
  const reached = new Promise(resolve => {fetched = resolve;});
  await page.route("**/api/sessions/*/summary", async route => {
    const result = await route.fetch(); fetched();
    await hold;
    await route.fulfill({response: result});
  }, {times: 1});
  try {
    await page.getByRole("button", {name: "先到这里", exact: true}).click();
    await reached;
    await expect(page.getByRole("status")).toContainText("正在读取本段已保存结果");
    await resume(page);
    await expect(page.locator(".study-count")).toHaveText("2 / 2");
    const response = page.waitForResponse(response => response.url().endsWith("/summary"));
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(".study-count")).toHaveText("2 / 2");
    await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
    await expect(page.locator(".front-main")).toHaveText("second");
    await page.reload();
    await resume(page);
    await expect(page.locator(".study-count")).toHaveText("2 / 2");
  } finally {release();}
});
