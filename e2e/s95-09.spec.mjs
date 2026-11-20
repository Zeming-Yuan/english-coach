import {test, expect} from "./support/test.mjs";

const starter = page => page.getByRole("button", {name: "阅读入门材料", exact: true});
const title = page => page.getByRole("heading", {name: "My small book", exact: true});
const back = page => page.getByRole("button", {name: "返回故事列表", exact: true}).first();

async function openLibrary(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "打开故事库", exact: true}).click();
}

test("S95-09 one click opens starter reader", async ({app, page}) => {
  const before = await (await app.request.get("/api/export/backup")).json();
  expect(before.cards).toHaveLength(0);
  expect((await (await app.request.get("/api/ai-config")).json()).has_key).toBe(false);

  await openLibrary(page, app);
  await starter(page).click();
  await expect(title(page)).toBeVisible({timeout: 5000});
  await expect(page.locator(".story-read-content")).toContainText("A small book is on my table.");

  const translation = page.getByRole("switch", {name: "显示译文"});
  await translation.click();
  await expect(page.locator(".story-sentence-cn")).toHaveCount(0);
  await translation.click();
  await expect(page.locator(".story-read-content")).toContainText("我的桌上有一本小书");

  const quality = page.getByTestId("story-quality");
  await expect(quality).toBeHidden();
  await page.getByText("材料说明", {exact: true}).click();
  await expect(quality).toContainText("el11-support-v1");
  await expect(quality).toContainText("未覆盖词形：无");

  const book = page.getByRole("button", {name: "查词 book", exact: true}).first();
  await book.click();
  await expect(page.locator(".story-word-panel-meaning")).toHaveText("书");
  await page.keyboard.press("Escape");
  await expect(book).toBeFocused();

  const played = page.waitForResponse(response => response.url().includes("/api/tts/audio/"));
  await page.getByRole("button", {name: "朗读第 1 段", exact: true}).click();
  expect((await played).ok()).toBe(true);
  await expect.poll(() => app.externalCalls()).toContain("tts");
  await expect(page.getByRole("button", {name: "朗读", exact: true})).toBeEnabled();
  await expect(page.getByText("暂时无法朗读，请稍后重试", {exact: true})).toHaveCount(0);

  await back(page).press("Enter");
  await expect(starter(page)).toBeFocused();
  await starter(page).click();
  await expect(title(page)).toBeVisible();
  await expect(page).toHaveURL(/#\/stories\/starter$/);
  await page.reload();
  await expect(title(page)).toBeVisible();
  await expect(page.getByRole("button", {name: "读后检查", exact: true})).toHaveCount(0);
  await back(page).click();
  await expect(starter(page)).toBeVisible();

  const after = await (await app.request.get("/api/export/backup")).json();
  for (const field of ["cards", "stories", "learning_events", "extensions"]) {
    expect(after[field]).toEqual(before[field]);
  }
});

test("S95-09 unavailable generation and audio leave starter readable", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-rollback.json"});
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {value: {getVoices: () => [], cancel() {}}});
  });
  await page.route("**/api/tts/audio/**", route => route.abort("failed"));
  await openLibrary(page, app);
  await expect(page.getByRole("button", {name: "生成新故事", exact: true})).toHaveCount(0);
  await starter(page).click();
  await expect(title(page)).toBeVisible();
  await page.getByRole("button", {name: "朗读第 1 段", exact: true}).click();
  await expect(page.getByText("暂时无法朗读，请稍后重试", {exact: true})).toBeVisible();
  await expect(page.locator(".story-read-content")).toContainText("Now I can read my book.");
  await back(page).click();
  await expect(starter(page)).toBeVisible();
});

test("S95-09 leaving the library ignores a late starter response", async ({app, page}) => {
  let fetched;
  let release;
  const inFlight = new Promise(resolve => { fetched = resolve; });
  const gate = new Promise(resolve => { release = resolve; });

  await openLibrary(page, app);
  await page.route("**/api/stories/starter", async route => {
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({response});
  });
  try {
    await starter(page).click();
    await inFlight;
    await page.getByRole("navigation").getByRole("button", {name: "单词本", exact: true}).first().click();
    await expect(page).toHaveURL(/#\/words$/);
    const arrived = page.waitForResponse("**/api/stories/starter");
    release();
    await (await arrived).finished();
    await expect(page).toHaveURL(/#\/words$/);
    await page.getByRole("navigation").getByRole("button", {name: "故事", exact: true}).first().click();
    await expect(starter(page)).toBeVisible();
    await expect(title(page)).toHaveCount(0);
  } finally {
    release();
  }
});
