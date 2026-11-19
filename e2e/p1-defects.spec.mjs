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
  await page.getByRole("button", {name: "← 返回", exact: true}).click();
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
