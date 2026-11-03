import fs from "node:fs";
import {normalizedBackup} from "./support/backup-comparison.mjs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {test, expect, pythonBin} from "./support/test.mjs";

// Retain successful qualification traces too; these are delivery evidence.
test.use({trace: "on"});
const backup = async app => (await app.request.get("/api/export/backup")).json();
const semantic = payload => {const {exported_at, ...data} = payload; return data;};
const button = (page, name) => page.getByRole("button", {name, exact: true});
async function lessons(page, app) {
  await page.goto(app.baseURL);
  const summary = page.getByText("专项练习", {exact: true});
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  await page.getByTestId("open-lessons").click();
}
async function lessonAnswer(page) {
  await page.getByRole("textbox", {name: "英文答案"}).fill("hello");
  await button(page, "提交").click();
  await expect(page.getByText("✅ 正确！")).toBeVisible();
}
async function scene(page, app, title) {
  await page.goto(app.baseURL);
  await button(page, "场景练习").click();
  await button(page, title).click();
}
async function sceneAnswer(page, text) {
  const result = page.getByTestId("scene-session");
  await result.getByRole("textbox", {name: "你的答案", exact: true}).fill(text);
  await result.getByRole("button", {name: "提交答案", exact: true}).click();
  await expect(result).toContainText("已保存");
  await result.getByRole("button", {name: /下一轮|查看结果/}).click();
}
async function openBackup(page, app) {
  await page.goto(app.baseURL);
  await button(page, "设置").click();
  await button(page, "备份与恢复").click();
}
async function upload(page, payload) {
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "journey.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)),
  });
}
async function download(page, app, name) {
  await openBackup(page, app);
  const pending = page.waitForEvent("download");
  await button(page, "下载完整备份").click();
  const file = await (await pending).path();
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  await test.info().attach(name, {body: JSON.stringify(payload, null, 2), contentType: "application/json"});
  return payload;
}
async function generatedLesson(page, app) {
  await lessons(page, app);
  await button(page, "开始").click();
  await expect(page.getByTestId("lesson-goal")).toContainText("本课目标");
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
  await button(page, "内容已看完").click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已浏览");
  await button(page, "开始本课短测").click();
}

for (const legacy of [false, true]) {
  test(`EL-21 ${legacy ? "upgraded database" : "new install"} completes six learning paths`, async ({appFactory, page}) => {
    test.setTimeout(180000);
    const app = await appFactory({legacy, fixture: "el21-journey.json"});
    const initial = await backup(app);
    expect(initial.learning_events).toEqual([]);
    expect(initial.cards).toHaveLength(legacy ? 1 : 0);
    expect(initial.review_baselines).toHaveLength(legacy ? 1 : 0);
    await app.setTime("2026-10-01T01:00:00Z");
    await generatedLesson(page, app);
    await lessonAnswer(page);
    await button(page, "查看结果").click();
    await expect(page.getByTestId("practice-session")).toContainText("本课短测：通过");
    await button(page, "返回课程").click();
    await expect(page.getByTestId("lesson-progress")).toContainText("已通过本轮检查");

    // A second real UI answer after 25 hours establishes recall and retention.
    // Navigate inside React so visible-contact requests can finish before moving time.
    await button(page, "← 返回").click();
    await button(page, "← 返回").click();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("ec.contact.")).length)).toBe(0);
    await app.setTime("2026-10-02T02:00:00Z");
    await page.reload();
    await button(page, "隔日回测").click();
    await expect(page.getByTestId("practice-session")).toContainText("25 小时");
    await lessonAnswer(page);
    await button(page, "查看结果").click();
    await button(page, "返回统计").click();
    await expect(page.getByTestId("retention-overview")).toContainText("独立成功/样本 1/1");
    const book = (await backup(app)).cards.find(row => row.word === "hello");
    const detail = await (await app.request.get(`/api/cards/${book.id}`)).json();
    expect(detail.learning_evidence.recall.status).toBe("verified");
    expect(detail.learning_evidence.recall.count).toBe(2);

    const [teaId] = await app.seedCards([{word: "tea", meaning: "茶"}]);
    expect((await app.request.post("/api/typing/check", {data: {card_id: teaId, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID()}})).ok()).toBe(true);
    await page.reload();
    await page.locator(".today-stats").click();
    await expect(page.getByTestId("learning-advice")).toContainText("独立首答未答对");
    await page.getByTestId("learning-advice").getByRole("button", {name: "开始建议练习", exact: true}).first().click();
    await page.getByRole("textbox", {name: "英文答案"}).fill("tea");
    await button(page, "提交").click();
    await expect(page.getByText("✅ 正确！")).toBeVisible();
    await page.goto(app.baseURL);
    await button(page, "故事").click();
    await button(page, "生成新故事").click();
    await page.locator(".story-item-main").click();
    const original = await page.locator("[data-story-version]").getAttribute("data-story-version");
    await button(page, "更简单").click();
    await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
    await expect(page.locator("[data-story-version]")).not.toHaveAttribute("data-story-version", original);
    await button(page, "读后检查").click();
    await button(page, "hello").click();
    await button(page, "下一题").click();
    await page.getByRole("textbox", {name: "你的答案", exact: true}).fill("hello");
    await button(page, "提交答案").click();
    await button(page, "查看结果").click();
    await expect(page.getByTestId("practice-session")).toContainText("阅读识别 1 · 词汇独立 1 · 辅助 0");

    await app.seedCards([
      {word: "water", meaning: "水"}, {word: "one", meaning: "一"}, {word: "thank", meaning: "感谢"},
      {word: "station", meaning: "车站"}, {word: "left", meaning: "左边"},
    ]);
    for (const [title, answers] of [
      ["买饮品", ["Can I have water, please?", "one", "Yes, thank you."]],
      ["自我介绍", ["My name is 李", "I am from 北京", "I like tea."]],
      ["问路", ["Excuse me, where is the station?", "Should I turn left?", "Yes, thank you."]],
    ]) {
      await scene(page, app, title);
      for (const text of answers) await sceneAnswer(page, text);
      await expect(page.getByTestId("scene-session")).toContainText("本场景独立通过");
    }
    await page.goto(app.baseURL);
    for (const budget of ["3", "8", "15"]) {
      await page.getByRole("combobox", {name: "今天可用时间"}).selectOption(budget);
      await expect(page.getByTestId("round-target")).toBeVisible();
    }
    await expect(page.getByTestId("estimate-basis")).toContainText("默认估算");
    await app.setTime("2026-11-01T02:00:00Z");
    await page.reload();
    await button(page, "选择恢复学习").click();
    await expect(page.getByTestId("round-target")).toContainText("新词 0 个");
    await button(page, "开始恢复学习").click();
    // The round contains only previously scheduled cards (book, tea, plus legacy apple).
    const total = legacy ? 3 : 2;
    for (let i = 0; i < total; i++) {
      await expect(page.locator(".study-count")).toHaveText(`${i + 1} / ${total}`);
      await button(page, "点击翻面").click();
      await page.locator(".rating-3").click();
    }
    await expect(page.getByRole("heading", {name: "恢复学习结果", exact: true})).toBeVisible();
    await expect(page.getByTestId("recovery-remaining")).toContainText("剩余到期 0 张");
    await button(page, "继续常规计划").click();
    const saved = await download(page, app, "six-paths-v3");
    expect(saved.version).toBe(3);
    expect(saved.extensions.story_versions).toHaveLength(2);
    expect(saved.extensions.scene_attempts).toHaveLength(9);
    expect(saved.extensions.scene_feedback).toHaveLength(9);
    expect(saved.extensions.lesson_progress).toHaveLength(1);
    expect(saved.extensions.practice_durations.length).toBeGreaterThan(0);
    expect(saved.review_baselines).toEqual(initial.review_baselines);
    await page.screenshot({path: test.info().outputPath("six-paths-complete.png"), fullPage: true});
    const target = await appFactory();
    await target.seedCards([{id: 900, word: "replace"}]);
    await target.setTime("2026-11-01T02:00:00Z");
    await openBackup(page, target);
    await upload(page, saved);
    await button(page, "确认替换学习数据").click();
    await expect(page.getByTestId("release-journey")).toContainText("恢复成功");
    expect(normalizedBackup(await backup(target))).toEqual(normalizedBackup(saved));
    await scene(page, target, "问路");
    await expect(page.getByTestId("scene-session")).toContainText("本场景独立通过");
    await page.goto(target.baseURL);
    await button(page, "单词本").click();
    await page.locator(".word-item", {hasText: "hello"}).first().click();
    const count = saved.learning_events.length;
    await page.getByTestId("rate-good").click();
    await expect.poll(async () => (await backup(target)).learning_events.length).toBe(count + 1);
    await download(page, target, "six-paths-restored-continued-v3");
  });
}


// Transfer unfinished contexts, rather than just counting restored records.
test("EL-21 V3 device transfer resumes saved learning and contexts", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "el21-journey.json"});
  await generatedLesson(page, source);
  await button(page, "提示首字母").click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：h");

  await scene(page, source, "自我介绍");
  await sceneAnswer(page, "My name is 李");
  const exported = await download(page, source, "source-v3");
  const target = await appFactory();
  await target.seedCards([{id: 900, word: "replace", meaning: "替换"}]);
  await target.setTime("2026-10-30T12:00:00Z");
  await openBackup(page, target);
  await upload(page, exported);
  await expect(page.getByText(/备份格式：V3/)).toBeVisible();
  await page.screenshot({path: test.info().outputPath("device-preview.png"), fullPage: true});
  await button(page, "确认替换学习数据").click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  const restored = await backup(target);
  expect(restored.cards[0].id).toBeGreaterThan(900);
  for (const name of exported.features) expect(restored.extensions[name]).toHaveLength(exported.extensions[name].length);
  expect(restored.extensions.practice_items.map(row => row.item_id)).toEqual(exported.extensions.practice_items.map(row => row.item_id));
  expect(restored.extensions.practice_sessions.map(row => [row.session_id, row.context, row.rule_version])).toEqual(exported.extensions.practice_sessions.map(row => [row.session_id, row.context, row.rule_version]));
  expect(restored.extensions.scene_attempts).toEqual(exported.extensions.scene_attempts);
  expect(restored.extensions.content_revisions.map(row => [row.identity, row.version])).toEqual(exported.extensions.content_revisions.map(row => [row.identity, row.version]));
  // Practice sessions freeze server-owned contexts; their browser pointers are local.
  // Signed ad hoc questions are covered by the HTTP supplement below.
  await lessons(page, target);
  await page.locator(".lesson-list-item").first().click();
  await button(page, "开始本课短测").click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：h");
  await lessonAnswer(page);
  await button(page, "查看结果").click();
  await expect(page.getByTestId("practice-session")).toContainText("本课短测：待巩固");
  await scene(page, target, "自我介绍");
  await expect(page.getByTestId("scene-session")).toContainText("第 2/3 轮");
  await sceneAnswer(page, "I am from 北京");
  await sceneAnswer(page, "I like tea.");
  await expect(page.getByTestId("scene-session")).toContainText("本场景独立通过");
  const continued = await download(page, target, "continued-v3");
  expect(continued.learning_events).toHaveLength(1);
  expect(continued.extensions.scene_attempts).toHaveLength(3);
  expect(continued.extensions.scene_attempts[0]).toEqual(exported.extensions.scene_attempts[0]);
});

test("EL-21 restore failures protect learning and allow continuation", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "el21-journey.json"});
  await generatedLesson(page, source);
  await lessonAnswer(page);
  const exported = await download(page, source, "fault-source-v3");
  const target = await appFactory();
  const [card_id] = await target.seedCards([{word: "keep", meaning: "保留"}]);
  await openBackup(page, target);
  const before = semantic(await backup(target));
  const corrupt = structuredClone(exported);
  corrupt.extensions.practice_items[0].session_id = crypto.randomUUID();
  await upload(page, corrupt);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(button(page, "确认替换学习数据")).toHaveCount(0);
  expect(semantic(await backup(target))).toEqual(before);
  await upload(page, exported);
  expect((await target.request.post("/api/reviews", {data: {card_id, rating: 3, source: "study", kind: "self_rating", submission_id: crypto.randomUUID()}})).ok()).toBe(true);
  const learned = semantic(await backup(target));
  await button(page, "确认替换学习数据").click();
  await expect(page.getByRole("alert")).toContainText("变化");
  expect(semantic(await backup(target))).toEqual(learned);
  await button(page, "取消").click();
  await upload(page, exported);
  await target.failCommitOnce();
  await button(page, "确认替换学习数据").click();
  await expect(page.getByRole("alert")).toContainText("恢复失败");
  expect(semantic(await backup(target))).toEqual(learned);
  await button(page, "确认替换学习数据").click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await lessons(page, target);
  await page.locator(".lesson-list-item").first().click();
  await expect(page.getByTestId("lesson-progress")).toContainText("已通过本轮检查");
  expect((await backup(target)).learning_events).toHaveLength(1);
  await page.screenshot({path: test.info().outputPath("faults-continued.png"), fullPage: true});
});


test("EL-21 HTTP restore and content contracts", async ({}, testInfo) => {
  test.setTimeout(180000);
  const result = spawnSync(pythonBin(), ["e2e/support/contracts.py", "--group", "learning_restore", "--report", testInfo.outputPath("learning-restore.xml")], {
    cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 160000,
  });
  await testInfo.attach("public-contract-output", {body: `${result.stdout}\n${result.stderr}\nexit=${result.status}`, contentType: "text/plain"});
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  expect(report.group).toBe("learning_restore");
  expect(report.passed_cases).toHaveLength(19);
});


test("EL-21 unavailable browser storage resumes the saved course context", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el21-journey.json"});
  await generatedLesson(page, app);
  await button(page, "提示首字母").click();
  await expect(page.getByTestId("practice-session")).toContainText("首字母：h");
  const original = (await backup(app)).extensions.practice_sessions[0].session_id;
  // A different browser has no local pointer; service-owned help must still resume.
  const other = await page.context().browser().newContext({viewport: page.viewportSize()});
  try {
    await other.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException("quota", "QuotaExceededError"); };
    });
    const next = await other.newPage();
    await lessons(next, app);
    await next.locator(".lesson-list-item").first().click();
    await button(next, "开始本课短测").click();
    await expect(next.getByTestId("practice-session")).toContainText("首字母：h");
    expect((await backup(app)).extensions.practice_sessions.map(row => row.session_id)).toEqual([original]);
    await lessonAnswer(next);
    await button(next, "查看结果").click();
    await expect(next.getByTestId("practice-session")).toContainText("本课短测：待巩固");
  } finally {await other.close();}
});
