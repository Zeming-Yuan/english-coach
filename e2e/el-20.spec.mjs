import {test, expect} from "./support/test.mjs";

async function openBackup(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
}
function upload(page, payload) {
  return page.getByLabel("选择备份文件").setInputFiles({
    name: "contract.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)),
  });
}
function semantic(payload) {
  const {exported_at, ...data} = payload;
  return data;
}
const backup = async app => (await app.request.get("/api/export/backup")).json();

// The overview already belongs to the migrated real stats page.
test("EL-20 visible evidence overview remains independent of unlock counts", async ({app, page}) => {
  const [card_id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (let i = 0; i < 3; i++) {
    expect((await app.request.post("/api/typing/check", {data: {
      card_id, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID(), assistance: [],
    }})).ok()).toBe(true);
  }
  await page.goto(app.baseURL);
  await expect(page.getByRole("region", {name: "复习与学习依据"})).toContainText("仍需巩固1 张");
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("evidence-overview")).toContainText("学习证据");
  await expect(page.getByTestId("evidence-overview")).toContainText("仍需巩固 1 张");
  await expect(page.locator(".stats-grid")).toContainText("句子练习已解锁");
  await page.screenshot({path: test.info().outputPath("contract-evidence.png")});
});

test("EL-20 unknown collection upload rejects before confirmation without data loss", async ({app, page}) => {
  await app.seedCards([{word: "keep", meaning: "保留"}]);
  const before = await backup(app);
  const payload = structuredClone(before);
  payload.features.push("unregistered_feature");
  payload.extensions.unregistered_feature = [{id: "unknown"}];
  await openBackup(page, app);
  await upload(page, payload);
  await expect(page.getByRole("alert")).toContainText("未知功能");
  await expect(page.getByRole("button", {name: "确认替换学习数据", exact: true})).toHaveCount(0);
  expect(semantic(await backup(app))).toEqual(semantic(before));
});

test("EL-20 V3 restore preserves equal-time contacts and current evidence", async ({appFactory, page}) => {
  const source = await appFactory();
  const [card_id] = await source.seedCards([{word: "apple", meaning: "苹果"}]);
  const revision = (await (await source.request.get(`/api/cards/${card_id}`)).json()).content_revision;
  const submissions = [];
  for (const contactSource of ["words_list", "card_detail"]) {
    const submission_id = crypto.randomUUID();
    submissions.push(submission_id);
    expect((await source.request.post("/api/learning/contacts", {data: {
      card_id, revision, submission_id, source: contactSource, kind: "answer_visible",
    }})).ok()).toBe(true);
  }
  const payload = await backup(source);
  payload.extensions.learning_contacts.reverse();
  const target = await appFactory();
  await target.seedCards([{word: "replace", meaning: "替换", id: 500}]);
  await openBackup(page, target);
  await upload(page, payload);
  await expect(page.getByText(/备份格式：V3/)).toBeVisible();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  const restored = await backup(target);
  expect(restored.extensions.learning_contacts.map(row => row.submission_id)).toEqual(submissions);
  expect(restored.learning_events).toEqual([]);
  expect(restored.reviews).toEqual([]);
  const mapped = restored.cards[0].id;
  expect(mapped).not.toBe(card_id);
  const detail = await (await target.request.get(`/api/cards/${mapped}`)).json();
  expect(detail.last_contact.source).toBe("card_detail");
  expect(detail.learning_evidence.recall.status).toBe("insufficient");
  await page.goto(target.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("evidence-overview")).toContainText("独立证据不足 1 张");
});

for (const version of [1, 2, 3]) {
  test(`EL-20 V${version} preview explains every missing collection before confirmation`, async ({app, page}) => {
    const [card_id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
    const current = await backup(app);
    const revision = (await (await app.request.get(`/api/cards/${card_id}`)).json()).content_revision;
    expect((await app.request.post("/api/learning/contacts", {data: {
      card_id, revision, submission_id: crypto.randomUUID(), source: "card_detail", kind: "answer_visible",
    }})).ok()).toBe(true);
    let payload;
    if (version === 1) payload = Object.fromEntries(["cards", "reviews", "memos", "errors"].map(key => [key, current[key]]));
    else if (version === 2) {
      payload = {...current, version: 2}; delete payload.features; delete payload.extensions;
    } else payload = {...current, features: [], extensions: {}};
    const before = semantic(await backup(app));
    await openBackup(page, app);
    await upload(page, payload);
    const missing = page.getByTestId("missing-backup-collections");
    await expect(missing).toContainText("应用内接触");
    await expect(missing).toContainText("课程进度");
    await expect(missing).toContainText("练习轮次");
    await expect(missing).toContainText("练习题目");
    await expect(missing).toContainText("场景首答");
    await expect(missing).toContainText("场景表达反馈");
    await expect(missing).toContainText("主动用时");
    await expect(missing).toContainText(version === 1 ? "保留现有记录" : "恢复 0 项，替换现有 1 项");
    if (version === 1) await expect(page.getByText("已有故事版本与操作去重记录将按本次备份替换。", {exact: false})).toHaveCount(0);
    expect(semantic(await backup(app))).toEqual(before);
    await page.screenshot({path: test.info().outputPath(`missing-v${version}.png`)});
    await page.getByRole("button", {name: "取消", exact: true}).click();
    expect(semantic(await backup(app))).toEqual(before);
  });
}

test("EL-20 partial V3 missing contacts keeps existing revision identities", async ({app, page}) => {
  const [card_id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  const payload = await backup(app);
  payload.features = payload.features.filter(name => name !== "learning_contacts");
  delete payload.extensions.learning_contacts;
  const originalRevision = payload.extensions.content_revisions[0];
  await openBackup(page, app);
  await upload(page, payload);
  const missing = page.getByTestId("missing-backup-collections");
  await expect(missing).toContainText("应用内接触");
  await expect(missing).not.toContainText("重新生成");
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  const restored = await backup(app);
  expect(restored.cards[0].id).not.toBe(card_id);
  expect(restored.extensions.content_revisions[0].identity).toBe(originalRevision.identity);
  expect(restored.extensions.content_revisions[0].version).toBe(originalRevision.version);
});

for (const fault of ["response-loss", "commit-failure"]) {
  test(`EL-20 contact ${fault} confirms the original record without learning credit`, async ({app, page}) => {
    const [card_id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
    await page.goto(app.baseURL);
    await page.getByRole("button", {name: "单词本", exact: true}).click();
    await expect.poll(async () => (await backup(app)).extensions.learning_contacts.length).toBe(1);
    const commands = [];
    page.on("request", request => {
      if (request.url().endsWith("/api/learning/contacts") && request.postDataJSON()?.source === "card_detail") commands.push(request.postDataJSON());
    });
    if (fault === "commit-failure") await app.failCommitOnce({contacts: true});
    await page.route("**/api/learning/contacts", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(fault === "response-loss" ? 200 : 500);
      if (fault === "response-loss") await route.abort("failed");
      else await route.fulfill({response});
    }, {times: 1});
    await page.locator(".word-item", {hasText: "apple"}).click();
    await expect(page.getByRole("alert")).toContainText("接触依据不完整");
    expect((await backup(app)).learning_events).toEqual([]);
    await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByTestId("last-contact")).toContainText("词卡详情");
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    const saved = await backup(app);
    expect(saved.extensions.learning_contacts.filter(row => row.submission_id === commands[0].submission_id)).toHaveLength(1);
    expect(saved.learning_events).toEqual([]);
    expect(saved.reviews).toEqual([]);
    const stats = await (await app.request.get("/api/stats")).json();
    expect(stats.attempted_today).toBe(0);
    expect(stats.evidence_counts.verified).toBe(0);
    expect((await (await app.request.get(`/api/cards/${card_id}`)).json()).learning_evidence.recall.count).toBe(0);
  });
}

test("EL-20 failed V3 replacement retains data and can restore the same preview", async ({appFactory, page}) => {
  const source = await appFactory();
  await source.seedCards([{word: "apple", meaning: "苹果"}]);
  const target = await appFactory();
  await target.seedCards([{word: "keep", meaning: "保留"}]);
  const before = semantic(await backup(target));
  await openBackup(page, target);
  await upload(page, await backup(source));
  await target.failCommitOnce();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("恢复失败");
  expect(semantic(await backup(target))).toEqual(before);
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  expect((await backup(target)).cards.map(row => row.word)).toEqual(["apple"]);
});
