import {test, expect} from "./support/test.mjs";

async function addFromApple(page) {
  await page.locator(".card").press("Enter");
  await page.getByRole("button", {name: "多学一个", exact: true}).click();
  await page.getByRole("region", {name: "构词与扩展"}).getByRole("button", {name: /^apply /}).click();
  const preview = page.getByRole("dialog");
  await preview.getByRole("button", {name: "加入学习", exact: true}).click();
  await expect(preview.getByText("已加入学习", {exact: true})).toBeVisible();
  await preview.getByRole("button", {name: "返回原词卡"}).click();
  await expect(page.locator(".card.flipped .back-meaning")).toHaveText("苹果");
}

async function finishTen(page) {
  for (let index = 1; index <= 10; index += 1) {
    await expect(page.locator(".study-count")).toHaveText(`${index} / 10`);
    if (index > 1) await page.locator(".card").press("Enter");
    await page.getByRole("button", {name: /太简单/}).click();
  }
}

async function openApplyDetail(page) {
  await page.getByRole("button", {name: "单词本", exact: true}).click();
  await page.locator(".word-item").filter({hasText: /^apply/}).first().click();
  await expect(page.locator(".word-detail-word")).toHaveText("apply");
}

test("S95-03 home to expansion practice through the saved ten-card round", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await addFromApple(page);
  await finishTen(page);
  await page.getByRole("button", {name: "练习 apply", exact: true}).click({timeout: 4500});
  await expect(page.getByText("I want to ___ for this job.", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "application", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "apply", exact: true}).click();
  await expect(page.getByText("apply 是动词，此处表示申请工作。", {exact: true})).toBeVisible();
  const payload = await (await app.request.get("/api/export/backup")).json();
  expect(payload.learning_events.filter(event => event.kind === "self_rating")).toHaveLength(10);
  expect(payload.learning_events.filter(event => event.kind === "choice")).toHaveLength(1);
  await page.getByRole("button", {name: /返回本轮结果/}).first().click();
  await expect(page.getByRole("heading", {name: "今天的词都过了一遍"})).toBeVisible();
});

test("S95-03 daily summary links the selected word without inserting it", async ({app, page}) => {
  await app.request.post("/api/cards/starter");
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习"}).click();
  await addFromApple(page);
  await finishTen(page);
  await expect(page.getByRole("heading", {name: "本轮学习结果"})).toBeVisible();
  await page.reload();
  await page.getByRole("button", {name: "练习 apply", exact: true}).click();
  await expect(page.getByRole("button", {name: "apply", exact: true})).toBeVisible();
});

test("S95-03 detail retries one answer after reload and starts a new practice", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await addFromApple(page);
  await page.getByRole("button", {name: /退出/}).click();
  await openApplyDetail(page);

  const rounds = [];
  const submissions = [];
  await page.route("**/api/practice-sessions", async route => {
    if (route.request().method() === "POST") rounds.push(route.request().postDataJSON().id);
    await route.continue();
  });
  await page.route("**/api/practice-sessions/*/items/*/attempts", async route => {
    submissions.push(route.request().postDataJSON().submission_id);
    if (submissions.length !== 1) return route.continue();
    const result = await route.fetch();
    expect(result.ok()).toBe(true);
    await route.abort("failed");
  });

  await page.getByRole("button", {name: "练这个扩展词", exact: true}).click();
  await page.getByRole("button", {name: "application", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toBeVisible();
  await page.reload();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByText("apply 是动词，此处表示申请工作。", {exact: true})).toBeVisible();
  expect(submissions[1]).toBe(submissions[0]);
  await page.getByRole("button", {name: /返回词卡/}).first().click();
  await expect(page.locator(".word-detail-word")).toHaveText("apply");
  await page.getByRole("button", {name: "练这个扩展词", exact: true}).click();
  await page.getByRole("button", {name: "apply", exact: true}).click();
  await expect(page.getByRole("status").filter({hasText: "正确！已保存"})).toBeVisible();
  expect(rounds).toHaveLength(2);
  expect(rounds[0]).not.toBe(rounds[1]);
  const payload = await (await app.request.get("/api/export/backup")).json();
  expect(payload.learning_events.filter(event => event.kind === "choice").map(event => event.correct))
    .toEqual([false, true]);
});

test("S95-03 an unmatched word sense can return from the practice empty state", async ({app, page}) => {
  const [apply] = await app.seedCards([{word: "apply", meaning: "运用"}]);
  const starter = await (await app.request.post("/api/cards/starter")).json();
  const apple = starter.cards.find(card => card.word === "apple");
  const added = await app.request.post(`/api/cards/${apple.id}/expansion-additions`, {data: {
    operation_id: crypto.randomUUID(),
    source_revision: apple.content_revision,
    target: {word: "apply", meaning: "申请；应用"},
  }});
  expect(added.ok()).toBe(true);
  await page.goto(app.baseURL);
  await openApplyDetail(page);
  await page.getByRole("button", {name: "练这个扩展词", exact: true}).click();
  await expect(page.getByText(/暂无适合这个词义的语境题/)).toBeVisible();
  await page.getByRole("button", {name: /返回词卡/}).first().click();
  await expect(page.locator(".word-detail-word")).toHaveText("apply");
  const card = await (await app.request.get(`/api/cards/${apply}`)).json();
  expect(card.learning_events).toEqual([]);
});

test("S95-03 reopens the same practice after its create response is lost", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await addFromApple(page);
  await page.getByRole("button", {name: /退出/}).click();
  await openApplyDetail(page);
  const sent = [];
  await page.route("**/api/practice-sessions", async route => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push(route.request().postDataJSON().id);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.getByRole("button", {name: "练这个扩展词", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续确认创建"})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", {name: "apply", exact: true})).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(page.url()).toContain(`#/practice/${sent[0]}`);
});
