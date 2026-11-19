import { test, expect } from "./support/test.mjs";

async function navigatePrimary(page, testInfo, label) {
  if (testInfo.project.name === "desktop") {
    await page
      .getByRole("navigation", { name: "主导航", exact: true })
      .getByRole("button", { name: label, exact: true })
      .click();
  } else if (label === "课程") {
    await page.getByRole("button", { name: "打开课程", exact: true }).click();
  } else {
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: label, exact: true })
      .click();
  }
}

test("P2 Slice 1: word detail, lesson detail, and story reader sync URL hash across reload and browser back/forward without duplicate fetches", async ({
  appFactory,
  page,
}, testInfo) => {
  const app = await appFactory({ fixture: "full-design.json" });
  const detailRequests = { cards: 0, lessons: 0, stories: 0 };
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    const { pathname } = new URL(req.url());
    if (/^\/api\/cards\/\d+$/.test(pathname)) detailRequests.cards += 1;
    if (/^\/api\/lessons\/\d+$/.test(pathname)) detailRequests.lessons += 1;
    if (/^\/api\/stories\/\d+$/.test(pathname)) detailRequests.stories += 1;
  });

  await page.goto(app.baseURL);

  // 1. 单词本 -> 词卡详情（仅发 1 次详情请求）-> 刷新留驻 -> 后退/前进 -> 测这个词不泄漏 singleCard
  await navigatePrimary(page, testInfo, "单词本");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/words");

  detailRequests.cards = 0;
  await page.locator(".word-item").filter({ hasText: "apple" }).click();
  await expect(page.locator(".word-detail-word")).toHaveText("apple");
  const wordHash = new URL(page.url()).hash;
  expect(wordHash).toMatch(/^#\/words\/\d+$/);
  // 1 次初始详情读取 + 至多 1 次接触确认后的详情刷新，无路由同步引发的重复拉取
  expect(detailRequests.cards).toBeLessThanOrEqual(2);

  await page.reload();
  await expect(page.locator(".word-detail-word")).toHaveText("apple");
  expect(new URL(page.url()).hash).toBe(wordHash);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/words");
  await expect(page.locator(".word-search-input")).toBeVisible();

  await page.goForward();
  await expect.poll(() => new URL(page.url()).hash).toBe(wordHash);
  await expect(page.locator(".word-detail-word")).toHaveText("apple");

  // 测这个词同步 #/spelling/:id，刷新仍保持单题，后退回词卡详情后普通 #/spelling 不泄漏单题
  await page.getByRole("button", { name: "测这个词", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/spelling\/\d+$/);
  await expect(page.locator(".study-count")).toContainText("/ 1");
  await page.reload();
  await expect(page.locator(".study-count")).toContainText("/ 1");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(wordHash);
  await expect(page.locator(".word-detail-word")).toHaveText("apple");

  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/words");

  // 2. 课程列表 -> 课程详情（仅发 1 次详情请求）-> 本课短测 #/lessons/:level/check -> 后退回课程详情 -> 后退回列表
  await navigatePrimary(page, testInfo, "课程");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/lessons");
  detailRequests.lessons = 0;
  await page.locator(".lesson-list-item").first().click();
  await expect(page.getByTestId("lesson-goal")).toBeVisible();
  const lessonHash = new URL(page.url()).hash;
  expect(lessonHash).toMatch(/^#\/lessons\/\d+$/);
  expect(detailRequests.lessons).toBe(1);

  await page.getByRole("button", { name: "开始本课短测", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe(`${lessonHash}/check`);
  await expect(page.getByTestId("practice-session")).toContainText("本课短测");

  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(lessonHash);
  await expect(page.getByTestId("lesson-goal")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("lesson-goal")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(lessonHash);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/lessons");
  await expect(page.locator(".lesson-list-item").first()).toBeVisible();

  // 3. 故事库 -> 故事阅读（仅发 1 次详情请求）-> 刷新留驻 -> 浏览器后退回故事库
  await navigatePrimary(page, testInfo, "故事");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/stories");
  detailRequests.stories = 0;
  await page.locator(".story-item-main").first().click();
  await expect(page.locator(".story-reader")).toBeVisible();
  const storyHash = new URL(page.url()).hash;
  expect(storyHash).toMatch(/^#\/stories\/\d+$/);
  expect(detailRequests.stories).toBe(1);

  await page.reload();
  await expect(page.locator(".story-reader")).toBeVisible();
  expect(new URL(page.url()).hash).toBe(storyHash);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/stories");
  await expect(page.locator(".story-library")).toBeVisible();

  // 验证从首页进入普通拼写练习不会受此前测这个词污染（多于 1 题）
  await page.goto(`${app.baseURL}/#/spelling`);
  await expect(page.locator(".study-count")).not.toHaveText(/\/\s*1$/);
});

test("P2 Slice 1: missing secondary detail hashes fall back cleanly, delete pops cleanly, and locked backup restore blocks popstate exit", async ({
  appFactory,
  page,
}, testInfo) => {
  const app = await appFactory({ fixture: "full-design.json" });

  // 不存在的词卡/故事/课程深链回退到对应列表页，无会话的 #/study 回退首页
  await page.goto(`${app.baseURL}/#/words/99999`);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/words");
  await expect(page.locator(".word-search-input")).toBeVisible();

  await page.goto(`${app.baseURL}/#/stories/99999`);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/stories");
  await expect(page.locator(".story-library")).toBeVisible();

  await page.goto(`${app.baseURL}/#/lessons/99`);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/lessons");
  await expect(page.locator(".lesson-list-item").first()).toBeVisible();

  await page.goto(`${app.baseURL}/#/study`);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/");
  await expect(
    page.getByRole("heading", { name: "今天的学习", exact: true }),
  ).toBeVisible();

  // 首页 -> 单词本 -> 打开词卡 -> 删除词卡后回到 #/words，再点一次后退直接回首页（无重复 #/words 栈项）
  await navigatePrimary(page, testInfo, "单词本");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/words");
  await page.locator(".word-item").first().click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/words\/\d+$/);
  await page.getByLabel("更多操作").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/words");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/");

  // 恢复备份进行中触发浏览器后退不会卸载 BackupPage
  const backup = await (await app.request.get("/api/export/backup")).json();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/backup");

  await page.locator('input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(
    page.getByRole("button", { name: "确认替换学习数据", exact: true }),
  ).toBeVisible();

  let releaseImport;
  const gate = new Promise((resolve) => {
    releaseImport = resolve;
  });
  await page.route("**/api/import/cards", async (route) => {
    await gate;
    await route.continue();
  });

  await page
    .getByRole("button", { name: "确认替换学习数据", exact: true })
    .click();
  await expect(page.getByText(/正在恢复/)).toBeVisible();

  // 模拟恢复中途触发 popstate 后退
  await page.evaluate(() => window.history.back());
  await expect(page.getByText(/正在恢复/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/backup");

  releaseImport();
  await expect(page.getByText(/恢复成功/)).toBeVisible();
});

test("P2 Slice 2: advice and delayed check return to their entry origin (home vs stats) including after reload", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();
  const [cardId] = await app.seedCards([{ word: "apple", meaning: "苹果" }]);
  expect(
    (
      await app.request.post("/api/typing/check", {
        data: {
          card_id: cardId,
          user_input: "wrong",
          source: "spelling",
          submission_id: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true);

  await page.goto(app.baseURL);

  // 1. 从首页进入「一周回测」-> 刷新后点返回 -> 回到首页 (#/) 而非 stats
  await page.getByRole("button", { name: "一周回测", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/delayed/week");
  await expect(page.getByTestId("practice-session")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("practice-session")).toBeVisible();
  await page.getByRole("button", { name: "← 返回首页", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^(#\/)?$/);
  await expect(
    page.getByRole("heading", { name: "今天的学习", exact: true }),
  ).toBeVisible();

  // 2. 从首页进入「建议练习」-> 点返回 -> 回到首页 (#/)
  await page
    .getByTestId("learning-advice")
    .getByRole("button", { name: "开始建议练习", exact: true })
    .first()
    .click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/advice");
  await expect(page.getByTestId("practice-session")).toBeVisible();
  await page.getByRole("button", { name: "← 返回建议", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^(#\/)?$/);
  await expect(
    page.getByRole("heading", { name: "今天的学习", exact: true }),
  ).toBeVisible();

  // 3. 从学习记录页 (#/stats) 进入「一周回测」与「建议练习」-> 点返回仍回 #/stats
  await page.locator(".today-stats").click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/stats");

  await page.getByRole("button", { name: "一周回测", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/delayed/week");
  await page.reload();
  await expect(page.getByTestId("practice-session")).toBeVisible();
  await page.getByRole("button", { name: "← 返回统计", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/stats");

  await page
    .getByTestId("learning-advice")
    .getByRole("button", { name: "继续建议练习", exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/advice");
  await page.reload();
  await expect(page.getByTestId("practice-session")).toBeVisible();
  await page.getByRole("button", { name: "← 返回建议", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/stats");
});

test("P2 Slice 2: unified navigation labels/icons, mobile story topbar entries, scene title, and no root back buttons", async ({
  appFactory,
  page,
}, testInfo) => {
  const app = await appFactory({ fixture: "full-design.json" });
  await page.goto(app.baseURL);

  if (testInfo.project.name === "mobile") {
    // 移动底栏统一命名为「今天」，不存在「队列」
    await expect(
      page.locator(".bottom-nav").getByRole("button", { name: "今天", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".bottom-nav").getByRole("button", { name: "队列", exact: true }),
    ).toHaveCount(0);

    // 移动端故事列表页与阅读详情页均保留 .topbar（课程 / 学习记录 / 设置入口可达）
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: "故事", exact: true })
      .click();
    await expect(page.locator(".story-library")).toBeVisible();
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(
      page.locator(".topbar").getByRole("button", { name: "打开课程", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".topbar").getByRole("button", { name: "学习记录", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".topbar").getByRole("button", { name: "设置", exact: true }),
    ).toBeVisible();

    await page.locator(".story-item-main").first().click();
    await expect(page.locator(".story-reader")).toBeVisible();
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(
      page.locator(".topbar").getByRole("button", { name: "设置", exact: true }),
    ).toBeVisible();
  } else {
    // 桌面侧栏「课程」与「故事」使用不同图标
    const nav = page.getByRole("navigation", { name: "主导航", exact: true });
    const lessonsSvg = await nav
      .getByRole("button", { name: "课程", exact: true })
      .locator("svg")
      .innerHTML();
    const storiesSvg = await nav
      .getByRole("button", { name: "故事", exact: true })
      .locator("svg")
      .innerHTML();
    expect(lessonsSvg).not.toBe(storiesSvg);
  }

  // 场景练习顶栏标题配置为「场景练习」（非空白）
  await page.goto(`${app.baseURL}/#/scene`);
  await expect(page.locator(".workspace-location")).toHaveText("场景练习");

  // 一级页「课程」根列表与「学习记录」根视图不渲染多余的「← 返回」，但课程二级详情保留「← 返回」
  await page.goto(`${app.baseURL}/#/lessons`);
  await expect(page.locator(".lesson-list-item").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "← 返回", exact: true }),
  ).toHaveCount(0);

  await page.locator(".lesson-list-item").first().click();
  await expect(
    page.getByRole("button", { name: "← 返回", exact: true }),
  ).toBeVisible();

  await page.goto(`${app.baseURL}/#/stats`);
  await expect(page.locator(".stats-grid")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "← 返回", exact: true }),
  ).toHaveCount(0);
});

test("P2 Slice 3: DailySession reinforcement, Quiz typed items, and Mixed spell items expose explicit submit buttons in .practice-actions", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();
  const [cardId] = await app.seedCards([{ word: "apple", meaning: "苹果" }]);

  // 1. 每日轮次巩固（DailySessionPage）：软键盘收起（blur）后点击 .practice-actions「提交答案」完成提交保存
  await page.goto(app.baseURL);
  await page.getByRole("button", { name: "开始今天的学习", exact: true }).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-1").click();
  await expect(
    page.getByRole("heading", { name: "本轮巩固", exact: true }),
  ).toBeVisible();

  const dailySubmit = page
    .locator(".practice-actions")
    .getByRole("button", { name: "提交答案", exact: true });
  await expect(dailySubmit).toBeVisible();
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").blur();
  await dailySubmit.click();
  await expect(page.getByRole("status")).toContainText("已保存：答对");
  await page.getByRole("button", { name: "查看本轮结果", exact: true }).click();
  await page.getByRole("button", { name: "← 返回队列", exact: true }).click();

  // 2. 测验输入题（QuizPage cn2en）：点击 .practice-actions「提交答案」提交保存
  await page.goto(`${app.baseURL}/#/quiz`);
  await expect(page.locator(".quiz-prompt")).toContainText("苹果");
  const quizSubmit = page
    .locator(".practice-actions")
    .getByRole("button", { name: "提交答案", exact: true });
  await expect(quizSubmit).toBeVisible();
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").blur();
  await quizSubmit.click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.locator(".quiz-feedback")).toContainText("正确");

  // 3. 混合练习拼写题（MixedPage spell）：空输入点击不误提交，填写后点击 .practice-actions「提交答案」提交保存
  await page.goto(`${app.baseURL}/#/mixed`);
  await expect(page.locator(".study-count")).toContainText("拼写");
  const mixedSubmit = page
    .locator(".practice-actions")
    .getByRole("button", { name: "提交答案", exact: true });
  await expect(mixedSubmit).toBeVisible();
  await mixedSubmit.click();
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").blur();
  await mixedSubmit.click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const detail = await (await app.request.get(`/api/cards/${cardId}`)).json();
  const sources = detail.learning_events.map((e) => e.source);
  expect(sources).toEqual(
    expect.arrayContaining(["reinforcement", "quiz", "mixed"]),
  );
});

test("P2 Slice 4: DailySession reinforcement groups header and actions without 100%-width stacked buttons", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();
  await app.seedCards([
    { word: "apple", meaning: "苹果" },
    { word: "book", meaning: "书" },
  ]);

  await page.goto(app.baseURL);
  await page.getByRole("button", { name: "开始今天的学习", exact: true }).click();
  for (let i = 0; i < 2; i += 1) {
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-1").click();
  }
  await expect(
    page.getByRole("heading", { name: "本轮巩固", exact: true }),
  ).toBeVisible();

  const exitBtn = page
    .locator(".page-head")
    .getByRole("button", { name: "← 退出", exact: true });
  const pauseBtn = page
    .locator(".page-head")
    .getByRole("button", { name: "先到这里", exact: true });
  const hintBtn = page
    .locator(".spelling-difficulty")
    .getByRole("button", { name: "提示首字母", exact: true });
  const submitBtn = page
    .locator(".practice-actions")
    .getByRole("button", { name: "提交答案", exact: true });
  const skipBtn = page
    .locator(".practice-actions")
    .getByRole("button", { name: "跳过本轮巩固", exact: true });

  await expect(exitBtn).toBeVisible();
  await expect(pauseBtn).toBeVisible();
  await expect(hintBtn).toBeVisible();
  await expect(submitBtn).toBeVisible();
  await expect(skipBtn).toBeVisible();

  const containerBox = await page.locator(".view-practice").boundingBox();
  for (const btn of [exitBtn, pauseBtn, hintBtn]) {
    const box = await btn.boundingBox();
    expect(box.width).toBeLessThan(containerBox.width * 0.6);
  }
});

test("P2 Slice 4: MixedPage pauses on wrong/skipped answers, keeps 900ms auto-advance on correct, and styles recovery/error buttons with .btn", async ({
  appFactory,
  page,
}) => {
  const app = await appFactory();

  // 1. DurationRecovery 与 LearningAdvice 错误态按钮均带 .btn 类名
  await page.addInitScript(() => {
    if (sessionStorage.getItem("durationSeeded")) return;
    sessionStorage.setItem("durationSeeded", "1");
    const sampleId = "00000000-0000-4000-8000-000000000001";
    localStorage.setItem(
      `ec.duration.${sampleId}`,
      JSON.stringify({
        sample_id: sampleId,
        kind: "review",
        duration_ms: 4000,
        recorded_at: "2026-10-30T12:00:00Z",
      }),
    );
  });
  await page.route(
    "**/api/learning/recommendations",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"advice-boom"}',
      }),
    { times: 1 },
  );
  await page.route(
    "**/api/practice-sessions?purpose=targeted",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"session-boom"}',
      }),
    { times: 1 },
  );

  await page.goto(app.baseURL);
  const durationBanner = page.getByTestId("duration-recovery");
  await expect(
    durationBanner.getByRole("button", { name: "继续确认时长", exact: true }),
  ).toHaveClass(/\bbtn\b/);
  await expect(
    durationBanner.getByRole("button", { name: "放弃时长记录", exact: true }),
  ).toHaveClass(/\bbtn\b/);
  await durationBanner
    .getByRole("button", { name: "放弃时长记录", exact: true })
    .click();

  const adviceSection = page.getByTestId("learning-advice");
  await expect(
    adviceSection.getByRole("button", { name: "重新读取建议", exact: true }),
  ).toHaveClass(/\bbtn\b/);
  await expect(
    adviceSection.getByRole("button", { name: "重新查找轮次", exact: true }),
  ).toHaveClass(/\bbtn\b/);

  // 2. MixedPage 空态与加载错误态按钮均带 .btn 类名
  await page.goto(`${app.baseURL}/#/mixed`);
  await expect(page.getByText("没有可练习的题目，先去加词吧")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返回", exact: true }),
  ).toHaveClass(/\bbtn\b/);

  await app.seedCards([{ word: "apple", meaning: "苹果" }]);
  await page.route(
    "**/api/quiz/choice?limit=4",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"mixed-boom"}',
      }),
    { times: 1 },
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("题目加载失败");
  await expect(
    page.getByRole("button", { name: "重新加载", exact: true }),
  ).toHaveClass(/\bbtn\b/);
  await expect(
    page.getByRole("button", { name: "返回", exact: true }),
  ).toHaveClass(/\bbtn\b/);

  // 3. MixedPage 保存失败重试按钮带 .btn；答错与跳过不自动跳题，答对 900ms 自动下一题
  await page.clock.install();
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator(".study-count")).toContainText("1 / 1 · 拼写");

  await page.route("**/api/typing/check", (route) => route.abort("failed"), {
    times: 1,
  });
  await page.locator(".spelling-input").fill("wrong");
  await page.locator(".spelling-input").press("Enter");
  const retryBtn = page.getByRole("button", { name: /重试保存/ });
  await expect(retryBtn).toHaveClass(/\bbtn\b/);
  await retryBtn.click();
  await expect(page.getByRole("status")).toContainText("正确答案：apple");

  // 答错后经过 2000ms 仍停留在当前题，直到手动点击「下一题 →」
  await page.clock.runFor(2000);
  await expect(page.getByText("混合练习完成！")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("正确答案：apple");
  await page.getByRole("button", { name: "下一题 →", exact: true }).click();
  await expect(page.getByText("混合练习完成！")).toBeVisible();

  // 跳过后经过 2000ms 仍停留在当前题，按 Enter 进入完成页
  await page.getByRole("button", { name: "再来一轮", exact: true }).click();
  await expect(page.locator(".study-count")).toContainText("1 / 1 · 拼写");
  await page.getByRole("button", { name: "跳过这题 →", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已跳过");
  await page.clock.runFor(2000);
  await expect(page.getByText("混合练习完成！")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByText("混合练习完成！")).toBeVisible();

  // 答对保留 900ms 自动跳题
  await page.getByRole("button", { name: "再来一轮", exact: true }).click();
  await expect(page.locator(".study-count")).toContainText("1 / 1 · 拼写");
  await page.locator(".spelling-input").fill("apple");
  await page.locator(".spelling-input").press("Enter");
  await expect(page.getByRole("status")).toContainText("正确");
  await page.clock.runFor(1000);
  await expect(page.getByText("混合练习完成！")).toBeVisible();
});

test("P2 Slice 4: ScenePage supports Enter submit, renders 开始/继续 card buttons, and deduplicates Standard /api/cards fetches", async ({
  appFactory,
  page,
}) => {
  await page.addInitScript(() => {
    delete window.speechSynthesis;
  });
  const app = await appFactory({ fixture: "ec16-tts-error.json" });
  await app.seedCards([{ word: "water", meaning: "水" }]);

  let cardsRequests = 0;
  page.on("request", (req) => {
    if (req.method() === "GET" && new URL(req.url()).pathname === "/api/cards") {
      cardsRequests += 1;
    }
  });

  await page.goto(`${app.baseURL}/#/scene`);
  const drinksCard = page.getByRole("article", { name: "买饮品", exact: true });
  const introCard = page.getByRole("article", { name: "自我介绍", exact: true });
  await expect(
    drinksCard.getByRole("button", { name: "开始", exact: true }),
  ).toBeVisible();
  await expect(
    introCard.getByRole("button", { name: "开始", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "买饮品", exact: true }),
  ).toHaveCount(0);

  await drinksCard.getByRole("button", { name: "开始", exact: true }).click();
  const scene = page.getByTestId("scene-session");
  await expect(scene).toContainText("第 1/3 轮");

  cardsRequests = 0;
  await scene.getByRole("button", { name: "查看标准表达", exact: true }).click();
  await expect(scene).toContainText("Can I have water, please?");
  await scene.getByRole("button", { name: "朗读标准表达", exact: true }).click();
  await expect(scene).toContainText("语音暂不可用");
  await scene.getByRole("button", { name: "朗读标准表达", exact: true }).click();
  expect(cardsRequests).toBe(1);

  // 输入法组词态 Enter 不误提交；普通 Enter 直接提交本轮答案
  const input = scene.getByRole("textbox", { name: "你的答案", exact: true });
  await input.fill("Can I have water, please?");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(scene).not.toContainText("已保存 ·");
  await input.press("Enter");
  await expect(scene).toContainText("已保存 · 规则认可");

  // 进入第 2 轮再次展示与朗读标准表达，仍复用同一次 /api/cards 结果
  await scene.getByRole("button", { name: "下一轮", exact: true }).click();
  await scene.getByRole("button", { name: "查看标准表达", exact: true }).click();
  await expect(scene).toContainText("One cup, please.");
  await scene.getByRole("button", { name: "朗读标准表达", exact: true }).click();
  expect(cardsRequests).toBe(1);

  // 返回场景列表后，已开启的场景显示「继续」，未开启的仍显示「开始」
  await scene.getByRole("button", { name: "返回场景列表", exact: true }).click();
  await expect(
    drinksCard.getByRole("button", { name: "继续", exact: true }),
  ).toBeVisible();
  await expect(
    introCard.getByRole("button", { name: "开始", exact: true }),
  ).toBeVisible();
});
