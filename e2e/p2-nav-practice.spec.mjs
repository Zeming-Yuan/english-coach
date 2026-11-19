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

