import {test, expect} from "./support/test.mjs";

async function openOriginal(app, page) {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (const now of ["2026-10-01T01:00:00Z", "2026-10-02T02:00:00Z"]) {
    await app.setTime(now);
    expect((await app.request.post("/api/typing/check", {data: {
      card_id: id, user_input: "apple", source: "spelling", submission_id: crypto.randomUUID(),
    }})).ok()).toBeTruthy();
  }
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await page.getByRole("button", {name: "生成新故事", exact: true}).click();
  await page.locator(".story-item-main").click();
  await expect(page.locator(".story-read-title")).toContainText("My apple");
  return page.locator("[data-story-version]").getAttribute("data-story-version");
}

test("EL-12 simpler story preserves original and separate unchecked versions", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-stories.json"});
  const original = await openOriginal(app, page);
  await page.getByRole("button", {name: "更简单", exact: true}).click({timeout: 3000});
  const version = page.locator("[data-story-version]");
  await expect(version).not.toHaveAttribute("data-story-version", original);
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
  await expect(page.locator(".story-sentence-cn")).toHaveCount(4);
  await page.getByRole("button", {name: "查看原版", exact: true}).click();
  await expect(version).toHaveAttribute("data-story-version", original);
  await expect(page.locator(".story-sentence-cn")).toHaveCount(6);
  await page.getByRole("button", {name: "查看简化版", exact: true}).click();
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.extensions.story_versions).toHaveLength(2);
  expect(backup.extensions.learning_contacts.filter(c => c.source === "story").length).toBeGreaterThanOrEqual(2);
  await page.screenshot({path: test.info().outputPath("simpler-story.png"), fullPage: true});
});

for (const failure of ["commit", "response-loss"]) {
  test(`EL-12 ${failure} refresh confirms the same simplification once`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: "el12-stories.json"});
    const original = await openOriginal(app, page);
    if (failure === "commit") await app.failCommitOnce();
    else await page.route("**/api/stories/*/simplify", async route => {await route.fetch(); await route.abort("failed");}, {times: 1});
    await page.getByRole("button", {name: "更简单", exact: true}).click();
    await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toBeVisible();
    const pending = await page.evaluate(root => JSON.parse(localStorage.getItem(`ec.story-simplification.${root}`)), original);
    await page.reload();
    await page.getByRole("button", {name: /故事/}).click();
    await page.locator(".story-item-main").filter({hasText: "原版 · 未检查"}).click();
    await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
    await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
    const backup = await (await app.request.get("/api/export/backup")).json();
    expect(backup.extensions.story_versions.filter(v => v.operation_id === pending.operation_id)).toHaveLength(1);
    expect(backup.extensions.story_versions).toHaveLength(2);
  });
}

test("EL-12 a late simplification cannot replace selected original", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-stories.json"});
  const original = await openOriginal(app, page);
  let release, ready;
  const gate = new Promise(resolve => {release = resolve;});
  const saved = new Promise(resolve => {ready = resolve;});
  await page.route("**/api/stories/*/simplify", async route => {
    const response = await route.fetch(); ready(); await gate; await route.fulfill({response});
  }, {times: 1});
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await saved;
  await page.getByRole("button", {name: "查看原版", exact: true}).click();
  release();
  await expect(page.getByText("简化并确认保存中…", {exact: true})).toHaveCount(0);
  await expect(page.locator("[data-story-version]")).toHaveAttribute("data-story-version", original);
  await page.getByRole("button", {name: "查看简化版", exact: true}).click();
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
});

test("EL-12 invalid simpler content keeps original readable", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-invalid.json"});
  const original = await openOriginal(app, page);
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("两次生成仍不合格");
  await expect(page.locator("[data-story-version]")).toHaveAttribute("data-story-version", original);
  await expect(page.locator(".story-sentence-cn")).toHaveCount(6);
  expect((await (await app.request.get("/api/export/backup")).json()).stories).toHaveLength(1);
});

test("EL-12 deleted source during generation offers explicit failure", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-stories.json"});
  await openOriginal(app, page);
  let release, ready;
  const gate = new Promise(resolve => {release = resolve;});
  const entered = new Promise(resolve => {ready = resolve;});
  await page.route("**/api/stories/*/simplify", async route => {ready(); await gate; await route.continue();}, {times: 1});
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await entered;
  const rows = (await (await app.request.get("/api/stories")).json()).stories;
  expect((await app.request.delete(`/api/stories/${rows[0].id}`)).ok()).toBeTruthy();
  release();
  await expect(page.getByRole("alert")).toContainText("原故事已删除");
  expect((await (await app.request.get("/api/export/backup")).json()).stories).toHaveLength(0);
});

test("EL-12 V3 restore keeps versions materials and replay identity", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "el12-stories.json"});
  const original = await openOriginal(source, page);
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
  const short = await page.locator("[data-story-version]").getAttribute("data-story-version");
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({name: "versions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))});
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await page.locator(".story-item-main").filter({hasText: "原版 · 未检查"}).click();
  await expect(page.locator("[data-story-version]")).toHaveAttribute("data-story-version", original);
  await page.getByRole("button", {name: "查看简化版", exact: true}).click();
  await expect(page.locator("[data-story-version]")).toHaveAttribute("data-story-version", short);
  const after = await (await target.request.get("/api/export/backup")).json();
  expect(after.extensions.story_versions.map(v => [v.version_id, v.parent_version_id, v.operation_id, v.material])).toEqual(backup.extensions.story_versions.map(v => [v.version_id, v.parent_version_id, v.operation_id, v.material]));
});

test("EL-12 functional rollback hides simplify and retains saved versions", async ({appFactory, page}) => {
  const source = await appFactory({fixture: "el12-stories.json"});
  await openOriginal(source, page);
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory({fixture: "el12-disabled.json"});
  const preview = await (await target.request.post("/api/import/preview", {data: backup})).json();
  expect((await target.request.post("/api/import/cards", {data: {backup, expected_revision: preview.expected_revision}})).ok()).toBeTruthy();
  await page.goto(target.baseURL);
  await page.getByRole("button", {name: /故事/}).click();
  await page.locator(".story-item-main").filter({hasText: "原版 · 未检查"}).click();
  await expect(page.getByRole("button", {name: "更简单", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "查看简化版", exact: true}).click();
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查");
  expect((await (await target.request.get("/api/export/backup")).json()).extensions.story_versions).toHaveLength(2);
});

test("EL-12 pending confirmation after restore uses mapped original identity", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-stories.json"});
  await openOriginal(app, page);
  await page.route("**/api/stories/*/simplify", async route => {await route.fetch(); await route.abort("failed");}, {times: 1});
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await expect(page.getByRole("button", {name: "继续确认保存", exact: true})).toBeVisible();
  const backup = await (await app.request.get("/api/export/backup")).json();
  const preview = await (await app.request.post("/api/import/preview", {data: backup})).json();
  expect((await app.request.post("/api/import/cards", {data: {backup, expected_revision: preview.expected_revision}})).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", {name: /故事/}).click();
  await page.locator(".story-item-main").filter({hasText: "原版 · 未检查"}).click();
  await page.getByRole("button", {name: "继续确认保存", exact: true}).click();
  await expect(page.getByTestId("story-check-status")).toHaveText("简化版 · 未检查", {timeout: 4000});
  expect((await (await app.request.get("/api/export/backup")).json()).extensions.story_versions).toHaveLength(2);
});
