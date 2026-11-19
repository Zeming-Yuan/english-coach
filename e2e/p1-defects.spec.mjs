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
