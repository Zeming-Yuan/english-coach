import {createRequire} from "node:module";
import {startSourceUI} from "./support/source-ui.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const {test, expect} = require("@playwright/test");
test.setTimeout(15000);

let ui;
test.beforeAll(async () => {
  ui = await startSourceUI();
});
test.afterAll(async () => {
  await ui?.close();
});

function makeLesson({id = 1, level = 1, title = "Greeting", words = [], dialogue = []} = {}) {
  return {
    id,
    level,
    title,
    goal: "日常缩略与连接符号",
    content: {words, dialogue},
    words,
    dialogue,
    card_ids: Object.fromEntries(words.map(w => [w.word, w.id])),
  };
}

test("lessons and stories render apostrophes and ampersands without HTML entity artifacts", async ({page}) => {
  const words = [{id: 1, word: "don't & go", phonetic: "/doʊnt <go>/", meaning: "不 & 别"}];
  const dialogue = [{speaker: "A & B", en: "I'm ready, don't worry & \"go\"!", cn: "我准备好了 & 别担心"}];
  const lesson = makeLesson({title: "I'm & Don't", words, dialogue});
  const story = {
    id: 1,
    mode: "legacy",
    title: "Ben's Tea & Coffee",
    title_cn: "本的茶 & 咖啡",
    content: "I'm happy & don't rush.",
    content_cn: "我很开心。",
    words,
    visible_card_ids: [],
    line_card_ids: [[]],
  };

  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/lessons") {
      return route.fulfill({json: {lessons: [lesson], next_level: 2, is_done: false, counts: {generated: 1}}});
    }
    if (path === "/api/lessons/1") {
      return route.fulfill({json: lesson});
    }
    if (path === "/api/lessons/1/opened") {
      return route.fulfill({json: {learning_progress: {status: "opened"}}});
    }
    if (path === "/api/stories") {
      return route.fulfill({json: {stories: [story], generation_enabled: false, simplification_enabled: false}});
    }
    if (path === "/api/stories/1") {
      return route.fulfill({json: story});
    }
    return route.fulfill({status: 503, json: {detail: "unavailable fixture"}});
  });

  await ui.mount(page, "/src/views/LessonsPage.jsx", "{onExit() {}}");
  await expect(page.locator(".lesson-list-item-title")).toHaveText("第 1 课 · I'm & Don't");
  await page.locator(".lesson-list-item").click();
  await expect(page.locator("h2.page-title")).toHaveText("I'm & Don't");
  await expect(page.locator(".word-item-word")).toHaveText("don't & go");
  await expect(page.locator(".word-item-phonetic")).toHaveText("/doʊnt <go>/");
  await page.locator(".pretest-input").fill("I'm guessing & checking");
  await page.getByRole("button", {name: "揭晓", exact: true}).click();
  await expect(page.locator(".word-item-meaning")).toHaveText("不 & 别");
  await expect(page.locator(".pretest-guess")).toHaveText("你的猜测：I'm guessing & checking");
  await expect(page.locator(".spk")).toHaveText("A & B");
  await expect(page.locator(".bubble-en")).toHaveText("I'm ready, don't worry & \"go\"!");
  await expect(page.locator(".bubble-cn")).toHaveText("我准备好了 & 别担心");

  await ui.mount(page, "/src/views/StoriesPage.jsx", "{onNavigate() {}}");
  await expect(page.locator(".story-item-title")).toHaveText("Ben's Tea & Coffee");
  await expect(page.locator(".story-item-title-cn")).toHaveText("本的茶 & 咖啡");
  await expect(page.locator(".story-item-meta")).toContainText("I'm happy & don't rush.");
  await page.locator(".story-item-main").click();
  await page.locator(".reader-targets summary").click();
  await expect(page.locator(".story-word-row")).toContainText("don't & go /doʊnt <go>/ 不 & 别");
});

test("lesson detail load failure shows a working retry action that respects current selection and unmount", async ({page}) => {
  const lesson1 = makeLesson({id: 1, level: 1, title: "Lesson One", words: [{id: 1, word: "hello", meaning: "你好"}]});
  const lesson2 = makeLesson({id: 2, level: 2, title: "Lesson Two", words: [{id: 2, word: "world", meaning: "世界"}]});
  let lesson1Calls = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/today") return route.fulfill({json: {queue: [], target: 0, new_cards: [], due_cards: [], error_cards: []}});
    if (path === "/api/stats") return route.fulfill({json: {total_cards: 1}});
    if (path === "/api/recommended") return route.fulfill({json: {recommended: []}});
    if (path === "/api/stories") return route.fulfill({json: {stories: []}});
    if (path === "/api/lessons") return route.fulfill({json: {lessons: [lesson1, lesson2], next_level: 3, is_done: false, counts: {generated: 2}}});
    if (path === "/api/lessons/1") {
      lesson1Calls += 1;
      return lesson1Calls <= 3
        ? route.fulfill({status: 503, json: {detail: "lesson offline"}})
        : route.fulfill({json: lesson1});
    }
    if (path === "/api/lessons/2") return route.fulfill({json: lesson2});
    if (path.endsWith("/opened")) return route.fulfill({json: {learning_progress: {status: "opened"}}});
    return route.fulfill({status: 503, json: {detail: "unavailable fixture"}});
  });

  await ui.mount(page, "/src/App.jsx");
  await page.getByTestId("open-lessons").click();

  // First failure + user opens Lesson 2: lingering Lesson 1 toast retry must not clobber Lesson 2
  await page.locator(".lesson-list-item", {hasText: "第 1 课"}).click();
  await expect(page.locator(".toast")).toContainText("课程加载失败：lesson offline", {timeout: 2000});
  await page.locator(".lesson-list-item", {hasText: "第 2 课"}).click();
  await expect(page.locator("h2.page-title")).toHaveText("Lesson Two", {timeout: 2000});
  await page.locator(".toast-action", {hasText: "重试"}).click();
  await expect(page.locator("h2.page-title")).toHaveText("Lesson Two");
  expect(lesson1Calls).toBe(1);

  // Back to list, Lesson 1 fails again, then exiting LessonsPage invalidates the lingering toast retry
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await page.locator(".lesson-list-item", {hasText: "第 1 课"}).click();
  await expect(page.locator(".toast-action", {hasText: "重试"})).toBeVisible({timeout: 2000});
  await page.getByRole("navigation").getByRole("button", {name: "今天", exact: true}).first().click();
  await page.locator(".toast-action", {hasText: "重试"}).click();
  expect(lesson1Calls).toBe(2);

  // Re-enter LessonsPage, Lesson 1 fails once more, then immediate retry succeeds and opens Lesson 1
  await page.getByTestId("open-lessons").click();
  await page.locator(".lesson-list-item", {hasText: "第 1 课"}).click();
  await expect(page.locator(".toast-action", {hasText: "重试"})).toBeVisible({timeout: 2000});
  await page.locator(".toast-action", {hasText: "重试"}).click();
  await expect(page.locator("h2.page-title")).toHaveText("Lesson One", {timeout: 2000});
  expect(lesson1Calls).toBe(4);
});

test("word detail example regeneration previews before saving so keeping old preserves revision and evidence", async ({page}) => {
  let storedCard = {
    id: 1,
    kind: "word",
    word: "apple",
    phonetic: "/ˈæpəl/",
    meaning: "苹果",
    example: "Old example.",
    example_cn: "旧例句。",
    explanation: "旧用法|旧搭配",
    contexts: [],
    review_count: 2,
    progress_label: "独立回忆已有证据",
    content_revision: {identity: "rev-apple-1234", version: 1},
    learning_evidence: {
      recall: {status: "verified", label: "独立回忆已有证据", count: 2},
      retention: {status: "insufficient", label: "尚无回测"},
      application: {status: "insufficient", label: "尚无场景依据"},
    },
  };
  const requests = [];
  let failFirstPut = true;
  let conflictPut = false;

  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    requests.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/cards" && method === "GET") {
      return route.fulfill({json: {cards: [storedCard]}});
    }
    if (url.pathname === "/api/cards/1" && method === "GET") {
      return route.fulfill({json: storedCard});
    }
    if (url.pathname === "/api/cards/1/regenerate" && method === "POST") {
      if (url.searchParams.get("preview") === "true") {
        return route.fulfill({
          json: {
            ...storedCard,
            example: "New preview example.",
            example_cn: "新预览例句。",
            explanation: "新用法|新搭配",
            preview: true,
          },
        });
      }
      // Unpreviewed legacy behavior mutates immediately (simulates old bug if ?preview=true is not used)
      storedCard = {
        ...storedCard,
        example: "New preview example.",
        example_cn: "新预览例句。",
        explanation: "新用法|新搭配",
        progress_label: "独立证据不足",
        content_revision: {...storedCard.content_revision, version: storedCard.content_revision.version + 1},
        learning_evidence: {
          ...storedCard.learning_evidence,
          recall: {status: "insufficient", label: "独立证据不足", count: 0},
        },
      };
      return route.fulfill({json: storedCard});
    }
    if (url.pathname === "/api/cards/1" && method === "PUT") {
      if (conflictPut) {
        conflictPut = false;
        storedCard = {
          ...storedCard,
          meaning: "并发更新的苹果",
          content_revision: {...storedCard.content_revision, version: 3},
        };
        return route.fulfill({status: 409, json: {detail: "Card content changed"}});
      }
      if (failFirstPut) {
        failFirstPut = false;
        return route.fulfill({status: 503, json: {detail: "save offline"}});
      }
      const body = route.request().postDataJSON();
      expect(body.expected_revision).toEqual({identity: "rev-apple-1234", version: 1});
      storedCard = {
        ...storedCard,
        example: body.example,
        example_cn: body.example_cn,
        explanation: body.explanation,
        progress_label: "独立证据不足",
        content_revision: {...storedCard.content_revision, version: 2},
        learning_evidence: {
          ...storedCard.learning_evidence,
          recall: {status: "insufficient", label: "独立证据不足", count: 0},
        },
      };
      return route.fulfill({json: storedCard});
    }
    if (url.pathname === "/api/learning-observations/contacts") {
      return route.fulfill({json: {committed: true}});
    }
    if (url.pathname.startsWith("/api/tts/")) {
      return route.fulfill({body: ""});
    }
    return route.fulfill({status: 503, json: {detail: "unavailable fixture"}});
  });

  await ui.mount(page, "/src/views/WordsPage.jsx");
  await page.locator(".word-item").click();
  await expect(page.locator(".word-detail-example")).toContainText("Old example.");
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");
  await expect(page.locator(".word-detail-evidence")).toContainText("独立回忆已有证据");

  // Preview + Keep Old: must NOT persist new example, bump revision, or invalidate recall evidence
  await page.getByRole("button", {name: "换一个例句", exact: true}).click();
  await expect(page.locator(".example-compare-new")).toHaveText("New preview example.");
  await page.getByRole("button", {name: "保留旧的", exact: true}).click();
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item").click();
  await expect(page.locator(".word-detail-example")).toContainText("Old example.", {timeout: 2000});
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");
  await expect(page.locator(".word-detail-evidence")).toContainText("独立回忆已有证据");
  expect(requests).toContain("POST /api/cards/1/regenerate?preview=true");

  // Preview + Use New: failed save retains candidate; retry saves via PUT, advances v2, and updates evidence
  await page.getByRole("button", {name: "换一个例句", exact: true}).click();
  await expect(page.locator(".example-compare-new")).toHaveText("New preview example.");
  await page.getByRole("button", {name: "用新的", exact: true}).click();
  await expect(page.locator(".example-compare-new")).toHaveText("New preview example.");
  await page.getByRole("button", {name: "用新的", exact: true}).click();
  await expect(page.locator(".word-detail-example")).toContainText("New preview example.", {timeout: 2000});
  await expect(page.getByTestId("revision-panel")).toContainText("第 2 版");
  await expect(page.locator(".word-detail-evidence")).toContainText("独立证据不足");

  // 409 conflict on Use New clears stale candidate and refreshes detail to latest server content
  storedCard = {...storedCard, example: "Base v2 example."};
  await page.getByRole("button", {name: /单词本/}).click();
  await page.locator(".word-item").click();
  await page.getByRole("button", {name: "换一个例句", exact: true}).click();
  await expect(page.locator(".example-compare-new")).toHaveText("New preview example.");
  conflictPut = true;
  await page.getByRole("button", {name: "用新的", exact: true}).click();
  await expect(page.locator(".example-compare-new")).toHaveCount(0);
  await expect(page.locator(".word-detail-meaning")).toHaveText("并发更新的苹果");
  await expect(page.getByTestId("revision-panel")).toContainText("第 3 版");
});

test("stats page routes backup to V3 BackupPage and exports non-overlapping themed report releasing ObjectURL", async ({page}) => {
  await page.addInitScript(() => {
    window.__canvasCalls = {texts: [], fills: [], createdUrls: [], revokedUrls: []};
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      window.__canvasCalls.texts.push({text: String(text), x, y, fillStyle: String(this.fillStyle)});
      return origFillText.call(this, text, x, y, ...rest);
    };
    const origFillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      window.__canvasCalls.fills.push({x, y, w, h, fillStyle: String(this.fillStyle).toLowerCase()});
      return origFillRect.call(this, x, y, w, h);
    };
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      const url = origCreate(blob);
      window.__canvasCalls.createdUrls.push(url);
      return url;
    };
    URL.revokeObjectURL = function (url) {
      window.__canvasCalls.revokedUrls.push(url);
      return origRevoke(url);
    };
  });

  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/today") return route.fulfill({json: {queue: [], target: 0, new_cards: [], due_cards: [], error_cards: []}});
    if (path === "/api/stats") {
      return route.fulfill({
        json: {
          total_cards: 128,
          graduated: 34,
          streak: 12,
          reviewed_today: 5,
          attempted_today: 6,
          skipped_today: 0,
          evidence_counts: {verified: 10, weak: 2, stale: 1, history_incomplete: 0, insufficient: 115},
          evidence_samples: 25,
        },
      });
    }
    if (path === "/api/stats/history") return route.fulfill({json: {days: []}});
    if (path === "/api/stats/weekly") return route.fulfill({json: {this_week: 85, weeks: []}});
    if (path === "/api/export/anki") return route.fulfill({contentType: "text/csv", body: "apple\t苹果\n"});
    if (path === "/api/import/preview") {
      return route.fulfill({
        json: {
          mode: "full_replace",
          expected_revision: "rev-safe",
          counts: {cards: 1, learning_events: 0},
          impact: {replaced: {cards: 1, learning_events: 0}},
          missing_collections: [],
        },
      });
    }
    if (path === "/api/import/cards") return route.fulfill({json: {mode: "full_replace", counts: {cards: 1}}});
    if (path === "/api/recommended") return route.fulfill({json: {recommended: []}});
    if (path === "/api/lessons") return route.fulfill({json: {lessons: [], next_level: 1, is_done: false, counts: {generated: 0}}});
    if (path === "/api/stories") return route.fulfill({json: {stories: []}});
    return route.fulfill({status: 503, json: {detail: "unavailable fixture"}});
  });

  await ui.mount(page, "/src/App.jsx");
  await expect(page.locator(".home-record-total")).toContainText("共 128 张卡");
  await page.getByRole("button", {name: "查看学习记录"}).click();
  await expect(page.getByRole("heading", {name: "学习记录"})).toBeVisible();
  await expect(page.locator(".stats-grid")).toContainText("共 128 张卡");

  // Legacy partial export / unpreviewed import controls are removed
  await expect(page.getByRole("button", {name: "备份词库"})).toHaveCount(0, {timeout: 2000});
  await expect(page.getByRole("button", {name: "恢复词库"})).toHaveCount(0);
  await expect(page.locator("input[type='file']")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "导出 Anki", exact: true})).toBeVisible();
  const ankiDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "导出 Anki", exact: true}).click();
  expect((await ankiDownload).suggestedFilename()).toBe("englishcoach_anki.csv");

  // Report canvas has non-overlapping rows within bounds, warm product theme colors, and revokes ObjectURL
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "成绩单", exact: true}).click();
  await downloadPromise;
  await expect(page.getByTestId("export-summary")).toContainText("共 128 张卡");

  await expect.poll(async () => {
    const c = await page.evaluate(() => window.__canvasCalls);
    return c.createdUrls.length >= 2 && c.createdUrls.every(u => c.revokedUrls.includes(u));
  }, {timeout: 3000}).toBe(true);

  const canvasAudit = await page.evaluate(() => window.__canvasCalls);
  const yOf = label => canvasAudit.texts.find(t => t.text.includes(label))?.y;
  const orderedYs = [
    yOf("EnglishCoach 学习报告"),
    yOf("零基础英语"),
    yOf("共 128 张卡"),
    yOf("达到句子解锁条件的词"),
    yOf("连续天数"),
    yOf("独立回忆已有证据"),
    yOf("历史证据，待复测"),
    yOf("历史依据不完整"),
    yOf("坚持每天"),
  ];
  for (let i = 0; i < orderedYs.length; i += 1) {
    expect(orderedYs[i]).toBeGreaterThan(0);
    expect(orderedYs[i]).toBeLessThan(460);
    if (i > 0) expect(orderedYs[i] - orderedYs[i - 1]).toBeGreaterThanOrEqual(18);
  }
  const allStyles = [
    ...canvasAudit.fills.map(f => f.fillStyle.toLowerCase()),
    ...canvasAudit.texts.map(t => t.fillStyle.toLowerCase()),
  ];
  for (const legacyColor of ["#f7fbfa", "#2dbe9e", "#1e2a32", "#7a8b94", "#d9e2e6"]) {
    expect(allStyles).not.toContain(legacyColor);
  }
  expect(allStyles).toContain("#a26243");
  expect(allStyles).toContain("#fcfaf6");
  expect(allStyles).toContain("#302e2b");
  expect(allStyles).toContain("#736c63");

  // Backup & Restore button routes uniformly to V3 BackupPage, returns to StatsPage, and runs V3 preview/confirm
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await expect(page.getByLabel("选择备份文件")).toBeVisible();
  await page.getByRole("button", {name: /返回/}).click();
  await expect(page.getByRole("heading", {name: "学习记录"})).toBeVisible();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByTestId("release-journey")).toBeVisible();
});

test("practice modes provide exit and empty-state actions and quiz wrong items are honest static rows", async ({page}) => {
  let quizEmpty = true;
  let heldScore = null;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/today") {
      return route.fulfill({
        json: {
          queue: [],
          target: 0,
          new_cards: quizEmpty ? [] : [{id: 1, kind: "word", word: "apple", meaning: "苹果"}],
          due_cards: [],
          error_cards: [],
        },
      });
    }
    if (path === "/api/cards") {
      return route.fulfill({json: {cards: quizEmpty ? [] : [{id: 1, kind: "word", word: "apple", meaning: "苹果"}]}});
    }
    if (path === "/api/stats") return route.fulfill({json: {total_cards: 1}});
    if (path === "/api/recommended") return route.fulfill({json: {recommended: []}});
    if (path === "/api/lessons") return route.fulfill({json: {lessons: [], next_level: 1, is_done: false, counts: {generated: 0}}});
    if (path === "/api/stories") return route.fulfill({json: {stories: []}});
    if (path === "/api/listening") return route.fulfill({json: {questions: []}});
    if (path === "/api/quiz") {
      return route.fulfill({
        json: {
          questions: quizEmpty
            ? []
            : [{id: 1, card_id: 1, type: "choice", prompt: "苹果", question_token: "tok-1", options: ["apple", "pear"]}],
        },
      });
    }
    if (path === "/api/quiz/score") {
      heldScore = route;
      return;
    }
    if (path.startsWith("/api/tts/")) return route.fulfill({status: 503, body: "unavailable"});
    return route.fulfill({status: 503, json: {detail: "unavailable fixture"}});
  });

  await ui.mount(page, "/src/App.jsx");
  await expect(page.locator(".topbar .logo")).toBeDisabled();

  // 1. Empty SpellingPage: exercises both "去加词" and "返回"
  await page.getByRole("button", {name: "拼写练习"}).click();
  await expect(page.getByText("还没有单词，先去加词吧")).toBeVisible();
  await page.getByRole("button", {name: "去加词", exact: true}).click({timeout: 2000});
  await expect(page.locator(".workspace-location")).toHaveText("添加单词");
  await page.locator(".topbar .logo").click();
  await expect(page.getByRole("heading", {name: "今天的学习"})).toBeVisible();
  await page.getByRole("button", {name: "拼写练习"}).click();
  await page.getByRole("button", {name: "返回", exact: true}).click();
  await expect(page.getByRole("heading", {name: "今天的学习"})).toBeVisible();

  // 2. Empty ListeningPage: exercises both "去加词" and "返回", plus topbar Logo exit
  await page.getByRole("button", {name: "听写练习"}).click();
  await expect(page.getByText("今天没有需要听写的词")).toBeVisible();
  await page.getByRole("button", {name: "返回", exact: true}).click();
  await expect(page.getByRole("heading", {name: "今天的学习"})).toBeVisible();
  await page.getByRole("button", {name: "听写练习"}).click();
  await page.getByRole("button", {name: "去加词", exact: true}).click();
  await expect(page.locator(".workspace-location")).toHaveText("添加单词");
  await page.locator(".topbar .logo").click();
  await expect(page.getByRole("heading", {name: "今天的学习"})).toBeVisible();

  // 3. Empty QuizPage: exercises both "去加词" and "返回"
  await page.getByRole("button", {name: "直接做测验"}).click();
  await expect(page.getByText("题库是空的")).toBeVisible();
  await page.getByRole("button", {name: "去加词", exact: true}).click();
  await expect(page.locator(".workspace-location")).toHaveText("添加单词");
  await page.locator(".topbar .logo").click();
  await page.getByRole("button", {name: "直接做测验"}).click();
  await page.getByRole("button", {name: "返回", exact: true}).click();
  await expect(page.getByRole("heading", {name: "今天的学习"})).toBeVisible();

  // 4. Active QuizPage: "← 返回" works, locks during in-flight save, and wrong list has no fake pointer/chevron
  quizEmpty = false;
  await page.getByRole("button", {name: "直接做测验"}).click();
  await expect(page.locator(".quiz-prompt")).toContainText("苹果");
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
  await expect(page.getByRole("heading", {name: "今天的学习"})).toBeVisible();

  await page.getByRole("button", {name: "直接做测验"}).click();
  await page.locator(".quiz-option", {hasText: "pear"}).click();
  await page.getByRole("button", {name: "确认", exact: true}).click();
  await expect(page.getByRole("button", {name: "← 返回", exact: true})).toBeDisabled();
  await expect.poll(() => Boolean(heldScore)).toBe(true);
  await heldScore.fulfill({json: {committed: true, details: [{correct: false, expected: "apple"}]}});
  await expect(page.getByRole("button", {name: "← 返回", exact: true})).toBeEnabled();
  await page.getByRole("button", {name: "查看结果", exact: true}).click();
  const wrongItem = page.locator(".quiz-wrong-item");
  await expect(wrongItem).toBeVisible();
  await expect(wrongItem).not.toHaveCSS("cursor", "pointer");
  await expect(page.locator(".quiz-wrong-expected")).toHaveText("apple");
});
