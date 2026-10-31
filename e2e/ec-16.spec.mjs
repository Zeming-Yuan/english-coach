import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {test, expect, pythonBin} from "./support/test.mjs";

async function keyboardActivate(page, locator) {
  await expect(locator).toBeVisible({timeout: 5000});
  for (let tabs = 0; tabs < 100; tabs += 1) {
    if (await locator.evaluate(el => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
  const hittable = () => locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  });
  // Native keyboard focus may place a control behind the fixed navigation.
  // PageDown is a user keyboard scroll, and must make it reachable.
  if (!await hittable()) await page.keyboard.press("PageDown");
  await expect.poll(hittable).toBe(true);
  const bounds = await locator.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  // Browser scrolls the focused control into view; its center must be hittable.
  expect(await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  })).toBe(true);
  await page.keyboard.press("Enter");
}
async function backupUI(page) {
  await keyboardActivate(page, page.getByRole("button", {name: "设置", exact: true}));
  await keyboardActivate(page, page.getByRole("button", {name: "备份与恢复", exact: true}));
}
async function snapshot(app) {
  const response = await app.request.get("/api/export/backup"); expect(response.ok()).toBe(true);
  const data = await response.json(); delete data.exported_at; return data;
}

test("EC-16 complete install learn restore journey", async ({appFactory, page}, testInfo) => {
  const source = await appFactory();
  await page.goto(source.baseURL);
  await keyboardActivate(page, page.getByRole("button", {name: "体验入门词卡", exact: true}));
  await expect(page.locator(".study-count")).toHaveText("1 / 10");
  await page.getByRole("button", {name: "← 退出", exact: true}).click();
  await keyboardActivate(page, page.getByRole("button", {name: "开始今天的学习", exact: true}));
  let weakWord;
  for (let i = 0; i < 10; i += 1) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 10`);
    if (i === 0) weakWord = await page.locator(".front-main").textContent();
    await page.locator(".flip-hint").first().click();
    await keyboardActivate(page, page.locator(i === 0 ? ".rating-1" : ".rating-3"));
  }
  await expect(page.getByRole("heading", {name: "本轮巩固", exact: true})).toBeVisible();
  await page.locator(".spelling-input").fill(weakWord.trim());
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("status")).toContainText("已保存：答对");
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toHaveCount(0);
  await keyboardActivate(page, page.getByRole("button", {name: "查看本轮结果", exact: true}));
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const saved = await snapshot(source);
  expect(saved.learning_events.filter(e => e.stage === "main")).toHaveLength(10);
  expect(saved.learning_events.filter(e => e.stage === "reinforcement")).toHaveLength(1);
  await keyboardActivate(page, page.getByRole("button", {name: "← 返回队列", exact: true}));
  await source.setTime("2026-10-31T12:00:00Z");
  await page.reload();
  await keyboardActivate(page, page.getByRole("button", {name: "开始今天的学习", exact: true}));
  await page.locator(".flip-hint").first().click();
  await keyboardActivate(page, page.locator(".rating-3"));
  await expect.poll(async () => (await snapshot(source)).learning_events.length).toBe(12);
  // Exit a partially completed new day without inventing completion for the remainder.
  const exit = page.getByRole("button", {name: "← 退出", exact: true});
  await expect(exit).toBeVisible(); await exit.click();
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("streak")).toHaveText("2");
  await expect(page.locator('[data-date="2026-10-30"]')).toHaveAttribute("data-count", "11");
  await expect(page.locator('[data-date="2026-10-31"]')).toHaveAttribute("data-count", "1");
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await backupUI(page);
  const downloaded = page.waitForEvent("download");
  await keyboardActivate(page, page.getByRole("button", {name: "下载完整备份", exact: true}));
  const file = await (await downloaded).path();
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(exported.learning_events).toHaveLength(12);
  const target = await appFactory();
  await target.seedCards([{id: 900, word: "target-only"}]);
  const before = await snapshot(target);
  await page.goto(target.baseURL);
  await backupUI(page);
  const input = page.getByLabel("选择备份文件");
  // Reach the native file control using Tab; choosing the file is the OS seam.
  for (let tabs = 0; tabs < 100; tabs += 1) {
    if (await input.evaluate(el => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(input).toBeFocused();
  await input.setInputFiles(file);
  await expect(page.getByText("全量恢复", {exact: true})).toBeVisible();
  await keyboardActivate(page, page.getByRole("button", {name: "取消", exact: true}));
  expect(await snapshot(target)).toEqual(before);
  await input.setInputFiles(file);
  await keyboardActivate(page, page.getByRole("button", {name: "确认替换学习数据", exact: true}));
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await expect(page.getByRole("status")).toContainText("before-restore-");
  const restored = await snapshot(target);
  expect(restored.cards).toHaveLength(exported.cards.length);
  expect(restored.cards.filter(c => c.kind === "word")).toHaveLength(10);
  expect(restored.learning_events).toHaveLength(12);
  expect(restored.cards.every(c => c.id > 900)).toBe(true);
  expect(restored.learning_events.map(e => e.submission_id)).toEqual(exported.learning_events.map(e => e.submission_id));
  const word = restored.cards.find(c => c.kind === "word" && c.word === weakWord.trim());
  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: word.word}).first().click();
  await keyboardActivate(page, page.getByTestId("rate-good"));
  await expect.poll(async () => (await snapshot(target)).learning_events.length).toBe(13);
  const final = await snapshot(target);
  const originalSubmissions = new Set(restored.learning_events.map(e => e.submission_id));
  const continued = final.learning_events.filter(e => !originalSubmissions.has(e.submission_id));
  expect(continued).toHaveLength(1);
  expect(continued[0]).toMatchObject({card_id: word.id, source: "card_detail", kind: "self_rating"});
  await page.screenshot({path: testInfo.outputPath("continued-after-restore.png"), fullPage: true});
});

test("EC-16 three days retain ratings and two-thirds pass rate", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (const [day, rating] of [["28", 1], ["29", 3], ["30", 4]]) {
    await app.setTime(`2026-10-${day}T01:00:00Z`);
    await page.goto(app.baseURL);
    await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
    await page.locator(".flip-hint").first().click();
    await keyboardActivate(page, page.locator(`.rating-${rating}`));
    if (rating === 1) await page.getByRole("button", {name: "跳过本轮巩固", exact: true}).click();
    await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
    await page.getByRole("button", {name: "← 返回队列", exact: true}).click();
  }
  const detail = await (await app.request.get(`/api/cards/${id}`)).json();
  expect(detail.learning_events.map(e => e.self_rating)).toEqual([1, 3, 4]);
  expect(detail.learning_events.map(e => e.learning_day)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
  const stats = await (await app.request.get("/api/stats")).json();
  expect(stats.review_pass_rate).toMatchObject({successes: 2, count: 3, percent: 67});
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("self-report-metric")).toContainText("67%（2/3）");
  await expect(page.locator(".week-acc")).toHaveText("67%");
  await expect(page.getByTestId("streak")).toHaveText("3");
  for (const day of ["28", "29", "30"]) await expect(page.locator(`[data-date="2026-10-${day}"]`)).toHaveAttribute("data-count", "1");
});

test("EC-16 Shanghai midnight preserves both learning days", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-30T15:59:00Z");
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).click();
  await keyboardActivate(page, page.getByTestId("rate-good"));
  await expect.poll(async () => (await snapshot(app)).learning_events.length).toBe(1);
  await app.setTime("2026-10-30T16:01:00Z");
  await expect(page.getByTestId("rate-good")).toBeEnabled();
  await keyboardActivate(page, page.getByTestId("rate-good"));
  await expect.poll(async () => (await snapshot(app)).learning_events.length).toBe(2);
  const events = (await snapshot(app)).learning_events;
  expect(events.map(e => e.learning_day)).toEqual(["2026-10-30", "2026-10-31"]);
  expect(events.map(e => e.learning_timezone)).toEqual(["Asia/Shanghai", "Asia/Shanghai"]);
  expect(events.map(e => e.card_id)).toEqual([id, id]);
  await page.getByRole("navigation").getByRole("button", {name: /队列/}).click();
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("streak")).toHaveText("2");
  await expect(page.locator('[data-date="2026-10-30"]')).toHaveAttribute("data-count", "1");
  await expect(page.locator('[data-date="2026-10-31"]')).toHaveAttribute("data-count", "1");
});

// These are explicitly supplemental public HTTP/process cases, included by the main
// release command. Each XML report must contain every named successful parameter.
for (const [group, title] of [
  ["installation", "EC-16 installation configuration contracts"],
  ["upgrade", "EC-16 old database upgrade contracts"],
  ["concurrent", "EC-16 concurrent submission contracts"],
  ["invalid", "EC-16 invalid backup contracts"],
  ["faults", "EC-16 safety backup and insertion fault contracts"],
  ["ambiguous", "EC-16 ambiguous legacy contracts"],
]) {
  test(title, async ({}, testInfo) => {
    const report = testInfo.outputPath(`${group}.xml`);
    const result = spawnSync(pythonBin(), ["e2e/support/contracts.py", "--group", group, "--report", report], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 60000,
    });
    await testInfo.attach("public-contract-output", {body: `${result.stdout}\n${result.stderr}\nexit=${result.status}`, contentType: "text/plain"});
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const actual = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    expect(actual.group).toBe(group);
    expect(actual.passed_cases.length).toBeGreaterThan(0);
  });
}

test("EC-16 upgraded old database continues through UI", async ({appFactory, page}) => {
  const app = await appFactory({legacy: true});
  const before = await snapshot(app);
  expect(before.cards[0]).toMatchObject({id: 41, word: "apple"});
  expect(before.reviews[0]).toMatchObject({card_id: 41, review_count: 2, stability: 2.5});
  expect(before.learning_events).toHaveLength(0);
  expect(before.review_baselines).toHaveLength(1);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item", {hasText: "apple"}).click();
  await expect(page.getByText(/历史记录不完整/)).toBeVisible();
  await keyboardActivate(page, page.getByTestId("rate-good"));
  await expect.poll(async () => (await snapshot(app)).learning_events.length).toBe(1);
  const after = await snapshot(app);
  expect(after.reviews[0].review_count).toBe(3);
  expect(after.review_baselines).toEqual(before.review_baselines);
});

test("EC-16 server error retains unsaved answer", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  const before = await snapshot(app);
  await page.goto(app.baseURL);
  await keyboardActivate(page, page.getByRole("button", {name: "开始今天的学习", exact: true}));
  await page.locator(".flip-hint").first().click();
  await page.route("**/api/reviews", route => route.fulfill({status: 500, contentType: "application/json", body: JSON.stringify({detail: "release test server failure"})}), {times: 1});
  await keyboardActivate(page, page.locator(".rating-3"));
  await expect(page.getByRole("alert")).toContainText("保存");
  await expect(page.locator(".study-count")).toHaveText("1 / 1");
  expect(await snapshot(app)).toEqual(before);
  await keyboardActivate(page, page.getByRole("button", {name: "继续确认保存", exact: true}));
  await expect(page.getByRole("heading", {name: "本轮学习结果", exact: true})).toBeVisible();
  const after = await snapshot(app);
  expect(after.learning_events).toHaveLength(1);
  expect(after.learning_events[0].self_rating).toBe(3);
});
