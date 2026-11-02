import {test, expect} from "./support/test.mjs";

async function verified(app) {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (const now of ["2026-10-01T01:00:00Z", "2026-10-02T02:00:00Z"]) {
    await app.setTime(now);
    expect((await app.request.post("/api/typing/check", {data: {
      card_id: id, user_input: "apple", source: "spelling", submission_id: crypto.randomUUID(),
    }})).ok()).toBeTruthy();
  }
  return id;
}
async function library(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await expect(page.getByRole("button", {name: "生成新故事", exact: true})).toBeVisible();
}

test("EL-11 evidence based story shows checked coverage", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-stories.json"});
  await verified(app);
  await library(page, app);
  await page.getByRole("button", {name: "生成新故事", exact: true}).click();
  await expect(page.getByTestId("story-quality")).toContainText("已有回忆依据的目标词：apple");
  await page.locator(".story-item-main").click();
  await expect(page.getByTestId("story-quality")).toContainText("词形覆盖检查");
  await expect(page.getByTestId("story-quality")).toContainText("理解题材料已校验保存");
  await expect(page.locator(".story-sentence-cn")).toHaveCount(6);
  await page.screenshot({path: test.info().outputPath("bounded-story.png"), fullPage: true});
});

for (const basis of ["empty", "self-rating"]) {
  test(`EL-11 ${basis} library offers checked starter without fake mastery`, async ({appFactory, page}) => {
    const app = await appFactory();
    if (basis === "self-rating") {
      const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
      expect((await app.request.post("/api/reviews", {data: {card_id: id, rating: 4}})).ok()).toBeTruthy();
    }
    await library(page, app);
    await page.getByRole("button", {name: "生成新故事", exact: true}).click();
    await expect(page.getByTestId("story-quality")).toContainText("回忆依据不足");
    await page.getByRole("button", {name: "打开入门故事", exact: true}).click();
    await expect(page.locator(".story-read-title")).toContainText("My small book");
    await expect(page.getByTestId("story-quality")).toContainText("不代表个人掌握");
    expect((await (await app.request.get("/api/export/backup")).json()).stories).toHaveLength(0);
  });
}

test("EL-11 new target requires explicit consent without adding cards", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-new-target.json"});
  await verified(app);
  await app.seedCards([{word: "pear", meaning: "梨"}]);
  await library(page, app);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", {name: "生成新故事", exact: true}).click();
  await expect(page.getByTestId("story-quality")).toContainText("新目标：pear");
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.cards).toHaveLength(2);
  expect(backup.extensions.story_versions[0].include_new_target).toBe(true);
});

for (const failure of ["commit", "response-loss"]) {
  test(`EL-11 ${failure} retains operation through refresh and confirms once`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: "el11-stories.json"});
    await verified(app);
    await library(page, app);
    if (failure === "commit") await app.failCommitOnce();
    else await page.route("**/api/stories/generate", async route => {await route.fetch(); await route.abort("failed");}, {times: 1});
    await page.getByRole("button", {name: "生成新故事", exact: true}).click();
    await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toBeVisible();
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("ec.story-generation")));
    const before = await (await app.request.get("/api/export/backup")).json();
    expect(before.stories).toHaveLength(failure === "commit" ? 0 : 1);
    await page.reload();
    // Navigation selection is browser state; re-enter the story library after refresh.
    await page.getByRole("button", {name: /故事/}).click();
    await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
    await expect(page.getByTestId("story-quality")).toContainText("已有回忆依据");
    const after = await (await app.request.get("/api/export/backup")).json();
    expect(after.stories).toHaveLength(1);
    expect(after.extensions.story_versions.filter(row => row.operation_id === pending.operation_id)).toHaveLength(1);
  });
}

test("EL-11 invalid generation keeps saved story and offers starter", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-invalid.json"});
  await verified(app);
  expect((await app.request.post("/api/stories/generate")).ok()).toBeTruthy();
  await library(page, app);
  await page.getByRole("button", {name: "生成新故事", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("两次生成仍不合格");
  await expect(page.locator(".story-item")).toHaveCount(1);
  await page.getByRole("button", {name: "阅读入门材料", exact: true}).click();
  await expect(page.getByTestId("story-quality")).toContainText("已核对的入门材料");
  await page.locator(".story-item-main").click();
  await expect(page.locator(".story-read-title")).toContainText("My apple");
});

for (const external of ["missing", "timeout"]) {
  test(`EL-11 ${external} AI explains failure and keeps legacy reading`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: external === "missing" ? "ec04-story.json" : "ec01-timeout.json"});
    await verified(app);
    await library(page, app);
    await page.getByRole("button", {name: "生成新故事", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText(external === "missing" ? "LLM_API_KEY" : "故事生成失败");
    await page.getByRole("button", {name: "阅读入门材料", exact: true}).click();
    await expect(page.getByTestId("story-quality")).toContainText("已核对的入门材料");
    if (external === "missing") {
      await page.locator(".story-item-main").click();
      await expect(page.getByText("本篇暂无检查题", {exact: true})).toBeVisible();
    }
  });
}

test("EL-11 V3 restore preserves version materials and operation replay", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "el11-stories.json"});
  await verified(source);
  const operation = {operation_id: crypto.randomUUID(), include_new_target: false};
  const story = await (await source.request.post("/api/stories/generate", {data: operation})).json();
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "story-v3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  const replay = await (await target.request.post("/api/stories/generate", {data: operation})).json();
  expect(replay.version_id).toBe(story.version_id);
  expect(replay.check_material).toEqual(story.check_material);
  await library(page, target);
  await page.locator(".story-item-main").click();
  await expect(page.getByTestId("story-quality")).toContainText("已有回忆依据的目标词：apple");
});

test("EL-11 late detail cannot replace current selection", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-stories.json"});
  await verified(app);
  const first = await (await app.request.post("/api/stories/generate")).json();
  const second = await (await app.request.post("/api/stories/generate")).json();
  await library(page, app);
  let release, fetched, delivered;
  const done = new Promise(resolve => {delivered = resolve;});
  const ready = new Promise(resolve => {fetched = resolve;});
  const gate = new Promise(resolve => {release = resolve;});
  await page.route(`**/api/stories/${first.id}`, async route => {const result = await route.fetch(); fetched(); await gate; await route.fulfill({response: result}); delivered();});
  await page.locator(".story-item-main").last().click();
  await ready;
  await page.locator(".story-item-main").first().click();
  await expect(page.locator(".story-read-title")).toBeVisible();
  release();
  await done;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator("[data-story-version]")).toHaveAttribute("data-story-version", second.version_id);
  expect((await (await app.request.get(`/api/stories/${second.id}`)).json()).version_id).toBe(second.version_id);
});

test("EL-11 functional rollback hides generation and preserves compatibility", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-rollback.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await expect(page.getByRole("heading", {name: /故事/})).toBeVisible();
  await expect(page.getByRole("button", {name: "生成新故事", exact: true})).toHaveCount(0);
  expect((await app.request.post("/api/stories/generate")).status()).toBe(403);
  expect((await app.request.get("/api/export/backup")).ok()).toBeTruthy();
});

test("EL-11 deletion failure is visible and replay cannot resurrect deleted story", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el11-stories.json"});
  await verified(app);
  const operation = {operation_id: crypto.randomUUID()};
  const story = await (await app.request.post("/api/stories/generate", {data: operation})).json();
  await library(page, app);
  page.on("dialog", dialog => dialog.accept());
  await app.failCommitOnce();
  await page.locator(".story-delete").click();
  await expect(page.getByText(/删除失败/)).toBeVisible();
  await expect(page.locator(".story-item")).toHaveCount(1);
  await page.locator(".story-delete").click();
  await expect(page.locator(".story-item")).toHaveCount(0);
  expect((await app.request.get(`/api/stories/${story.id}`)).status()).toBe(404);
  expect((await app.request.post("/api/stories/generate", {data: operation})).status()).toBe(410);
  expect((await (await app.request.get("/api/export/backup")).json()).cards).toHaveLength(1);
});

test("EL-11 old backup explicitly has no story versions or checks", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-story.json"});
  const backup = await (await app.request.get("/api/export/backup")).json();
  delete backup.extensions;
  delete backup.features;
  backup.version = 2;
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "old-story.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await expect(page.getByText(/此备份没有故事版本与检查材料/)).toBeVisible();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await library(page, app);
  await page.locator(".story-item-main").click();
  await expect(page.getByText("本篇暂无检查题", {exact: true})).toBeVisible();
});

test("EL-11 early V3 missing versions does not claim revisions are missing", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-story.json"});
  const backup = await (await app.request.get("/api/export/backup")).json();
  backup.features = backup.features.filter(name => name !== "story_versions");
  delete backup.extensions.story_versions;
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "early-story.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await expect(page.getByText(/此备份没有故事版本与检查材料/)).toBeVisible();
  await expect(page.getByText(/此备份缺少内容修订/)).toHaveCount(0);
});
