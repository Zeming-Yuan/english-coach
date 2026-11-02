import {test, expect} from "./support/test.mjs";

async function failed(app) {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  return id;
}

async function stats(page, app) {
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("learning-advice")).toBeVisible();
}

test("EL-10 failed advice starts the exact independent practice", async ({appFactory, page}) => {
  const app = await appFactory();
  const id = await failed(app);
  await stats(page, app);
  const advice = page.getByTestId("learning-advice");
  await expect(advice).toContainText("独立首答未答对");
  await expect(advice).toContainText("苹果");
  await expect(advice).not.toContainText("apple");
  await advice.getByRole("button", {name: "开始建议练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("专项练习");
  await page.getByRole("textbox", {name: "英文答案"}).fill("apple");
  await page.getByRole("button", {name: "提交", exact: true}).click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  const run = backup.extensions.practice_sessions.find(row => row.purpose === "targeted");
  expect(backup.extensions.practice_items.filter(row => row.session_id === run.session_id).map(row => row.card_id)).toEqual([id]);
  await page.screenshot({path: test.info().outputPath("targeted-result.png"), fullPage: true});
});

async function delayed(app, {id = null, word = "apple"} = {}) {
  if (!id) [id] = await app.seedCards([{word, meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: word, source: "spelling", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect((await app.request.post("/api/learning/contacts", {data: {
    card_id: id, revision: detail.content_revision, source: "card_detail", kind: "answer_visible", submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  await app.setTime("2026-10-08T01:00:00Z");
  return id;
}

async function start(page) {
  await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toBeVisible();
}

async function submit(page) {
  await page.getByRole("textbox", {name: "英文答案"}).fill("apple");
  await page.getByRole("button", {name: "提交", exact: true}).click();
}

test("EL-10 assisted-only advice remains separate from independent recall", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  expect((await app.request.post("/api/typing/check", {data: {
    card_id: id, user_input: "apple", source: "spelling", assistance: ["first_letter"], submission_id: crypto.randomUUID(),
  }})).ok()).toBeTruthy();
  await stats(page, app);
  await expect(page.getByTestId("learning-advice")).toContainText("已有辅助成功");
  await expect(page.getByTestId("learning-advice")).toContainText("依据 0 个样本");
  await start(page);
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
});

test("EL-10 no evidence explains uncertainty without diagnosing weakness", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await stats(page, app);
  await expect(page.getByTestId("learning-advice")).toContainText("暂无数据不代表能力不足");
  await expect(page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true})).toHaveCount(0);
});

for (const change of ["revision", "deletion"]) {
  test(`EL-10 ${change} before entry explains original target unavailable`, async ({appFactory, page}) => {
    const app = await appFactory();
    const id = await failed(app);
    await stats(page, app);
    if (change === "revision") expect((await app.request.put(`/api/cards/${id}`, {data: {meaning: "新释义"}})).ok()).toBeTruthy();
    else expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
    await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText(change === "revision" ? "已修订" : "已删除");
    await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveCount(0);
    await page.getByRole("button", {name: "返回建议", exact: true}).click();
    await expect(page.getByTestId("learning-advice")).toContainText("暂无数据");
  });
}

test("EL-10 delayed advice hides answers and reveal recalculates eligibility", async ({appFactory, page}) => {
  const app = await appFactory();
  const id = await delayed(app);
  await stats(page, app);
  const advice = page.getByTestId("learning-advice");
  await expect(advice).toContainText("一周回测");
  await expect(advice).not.toContainText("apple");
  const before = (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length;
  await advice.getByRole("button", {name: "展开英文答案（会重算回测资格）", exact: true}).click();
  await expect.poll(async () => (await (await app.request.get("/api/export/backup")).json()).extensions.learning_contacts.length).toBe(before + 1);
  await expect(advice).toContainText("暂无数据");
  expect((await (await app.request.get(`/api/cards/${id}`)).json()).learning_events).toHaveLength(1);
});

test("EL-10 delayed suggestion starts its exact window and records retention", async ({appFactory, page}) => {
  const app = await appFactory();
  await delayed(app);
  await stats(page, app);
  await start(page);
  await expect(page.getByTestId("practice-session")).toContainText("168 小时");
  await expect(page.getByTestId("practice-session")).not.toContainText("apple");
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  expect((await (await app.request.get("/api/stats")).json()).retention.week.count).toBe(1);
});

for (const mode of ["lost-response", "commit-failure"]) {
  test(`EL-10 ${mode} keeps answer and confirms one targeted event`, async ({appFactory, page}) => {
    const app = await appFactory();
    const id = await failed(app);
    await stats(page, app);
    await start(page);
    let submissionId;
    await page.route("**/api/practice-sessions/*/items/*/attempts", async route => {
      submissionId = route.request().postDataJSON().submission_id;
      if (mode === "lost-response") {await route.fetch(); await route.abort("failed");}
      else await route.continue();
    }, {times: 1});
    if (mode === "commit-failure") await app.failCommitOnce();
    await submit(page);
    await expect(page.locator(".practice-item").getByRole("alert")).toBeVisible();
    await page.reload();
    await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
    if (mode === "commit-failure") {
      await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveValue("apple");
      await page.locator(".practice-item").getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.getByText("✅ 正确！")).toBeVisible();
    } else {
      await expect(page.getByTestId("practice-session")).toContainText("通过 1");
      // 已保存但丢失的响应仍能使用原 pending 身份确认。
      await page.getByRole("button", {name: "← 返回建议", exact: true}).click();
      await page.getByRole("button", {name: "← 返回", exact: true}).click();
      await page.locator(".pending-recovery").getByRole("button", {name: "继续确认保存", exact: true}).click();
      await expect(page.locator(".pending-recovery")).toHaveCount(0);
    }
    const backup = await (await app.request.get("/api/export/backup")).json();
    expect(backup.learning_events.filter(row => row.submission_id === submissionId)).toHaveLength(1);
    expect(backup.learning_events.filter(row => row.card_id === id)).toHaveLength(2);
  });
}

test("EL-10 lost creation response continues the same frozen round", async ({appFactory, page}) => {
  const app = await appFactory();
  await failed(app);
  await stats(page, app);
  let identity;
  await page.route("**/api/practice-sessions", async route => {
    identity = route.request().postDataJSON().id;
    await route.fetch();
    await route.abort("failed");
  }, {times: 1});
  await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.extensions.practice_sessions.filter(row => row.session_id === identity)).toHaveLength(1);
});

test("EL-10 course shows its own short check and delayed samples", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el06-lesson-dialogue.json"});
  await delayed(app, {id: 1});
  await stats(page, app);
  await expect(page.getByTestId("learning-advice")).toContainText("第 1 课");
  await start(page);
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  await page.goto(app.baseURL);
  await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  const lesson = page.locator(".lesson-list-item").first();
  await expect(lesson).toContainText("短测：尚无");
  await expect(lesson.getByTestId("lesson-retention")).toContainText("本课一周回测：独立成功/样本 1/1");
  await lesson.click();
  await expect(page.getByTestId("lesson-progress")).toContainText("尚无（待检查）");
  await expect(page.getByTestId("lesson-retention")).toContainText("独立成功/样本 1/1");
  await page.screenshot({path: test.info().outputPath("course-retention.png"), fullPage: true});
});

test("EL-10 deleted frozen pool offers a return without a fake pass", async ({appFactory, page}) => {
  const app = await appFactory();
  const id = await failed(app);
  await stats(page, app);
  await start(page);
  expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
  await page.reload();
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("原目标已不可用");
  await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveCount(0);
  await expect(page.getByTestId("practice-session")).not.toContainText("专项练习：通过");
  await page.getByRole("button", {name: "返回建议", exact: true}).click();
  await expect(page.getByTestId("learning-advice")).toBeVisible();
});

test("EL-10 V3 restore resumes the original targeted round", async ({appFactory, page}) => {
  const source = await appFactory();
  await failed(source);
  await stats(page, source);
  await start(page);
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await target.seedCards([{id: 900, word: "reserved", meaning: "保留"}]);
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "targeted-v3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.goto(target.baseURL);
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  expect((await (await target.request.get("/api/export/backup")).json()).extensions.practice_sessions).toHaveLength(1);
});

test("EL-10 functional rollback keeps evidence and hides advice", async ({appFactory, page}) => {
  const source = await appFactory();
  await failed(source);
  await stats(page, source);
  await start(page);
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory({fixture: "el10-rollback.json"});
  const preview = await (await target.request.post("/api/import/preview", {data: backup})).json();
  expect((await target.request.post("/api/import/cards", {data: {backup, expected_revision: preview.expected_revision}})).ok()).toBeTruthy();
  await page.goto(target.baseURL);
  await expect(page.getByTestId("learning-advice")).toHaveCount(0);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("learning-advice")).toHaveCount(0);
  await expect(page.getByTestId("evidence-overview")).toContainText("独立样本");
  const current = await (await target.request.get("/api/export/backup")).json();
  expect(current.learning_events).toHaveLength(backup.learning_events.length);
  expect(current.extensions.practice_sessions[0].purpose).toBe("targeted");
});

test("EL-10 unavailable browser storage explains creation recovery limits", async ({appFactory, page}) => {
  const app = await appFactory();
  await failed(app);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "ec.advice.request") throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  await stats(page, app);
  await start(page);
  await expect(page.getByRole("note")).toContainText("浏览器未保存轮次标识");
});

test("EL-10 same-browser restore replaces stale advice entry with imported round", async ({appFactory, page}) => {
  const source = await appFactory();
  const sourceId = await failed(source);
  const advice = (await (await source.request.get("/api/learning/recommendations")).json()).suggestions[0];
  const imported = await (await source.request.post("/api/practice-sessions", {data: {
    id: crypto.randomUUID(), purpose: advice.purpose, targets: advice.targets, card_ids: advice.card_ids,
  }})).json();
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await failed(target);
  await stats(page, target);
  await start(page);
  const oldId = await page.evaluate(() => JSON.parse(localStorage.getItem("ec.advice.request")).id);
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.goto(target.baseURL);
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "英文答案"})).toBeVisible();
  await submit(page);
  await expect(page.getByText("✅ 正确！")).toBeVisible();
  const restored = await (await target.request.get("/api/export/backup")).json();
  expect(restored.extensions.practice_sessions.map(row => row.session_id)).toEqual([imported.id]);
  expect(restored.extensions.practice_sessions.some(row => row.session_id === oldId)).toBe(false);
  expect(restored.learning_events.filter(row => row.card_id === restored.cards.find(card => card.word === "apple").id)).toHaveLength(2);
});

test("EL-10 partial deletion invalidates the frozen multiword round", async ({appFactory, page}) => {
  const app = await appFactory();
  const ids = await app.seedCards([{word: "apple", meaning: "苹果"}, {word: "banana", meaning: "香蕉"}]);
  for (const id of ids) expect((await app.request.post("/api/typing/check", {data: {card_id: id, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID()}})).ok()).toBeTruthy();
  await stats(page, app);
  await start(page);
  expect((await app.request.delete(`/api/cards/${ids[1]}`)).ok()).toBeTruthy();
  await page.reload();
  await page.getByTestId("learning-advice").getByRole("button", {name: "继续建议练习", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("原目标已删除");
  await expect(page.getByRole("textbox", {name: "英文答案"})).toHaveCount(0);
  await expect(page.getByTestId("practice-session")).not.toContainText("专项练习：通过");
});
