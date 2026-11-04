import {test, expect} from "./support/test.mjs";

async function previewBackup(app, page, backup) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "learning-backup.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
}

async function assertReadablePreview(page, title, action, testInfo) {
  const heading = page.getByRole("heading", {name: title, exact: true});
  await expect(heading).toBeVisible();
  await expect(page.getByRole("heading", {name: "备份与恢复", exact: true})).toBeVisible();
  const confirm = page.getByRole("button", {name: action, exact: true});
  await expect(confirm).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    notes: [...document.querySelectorAll('.backup-preview [role="note"]')].map(node => ({
      font: parseFloat(getComputedStyle(node).fontSize),
      line: parseFloat(getComputedStyle(node).lineHeight),
    })),
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.notes.length).toBeGreaterThan(0);
  for (const note of dimensions.notes) {
    expect(note.font).toBeGreaterThanOrEqual(13);
    expect(note.line / note.font).toBeGreaterThanOrEqual(1.6);
  }
  await page.locator(".backup-preview").screenshot({path: testInfo.outputPath("restore-panel.png")});
  await testInfo.attach("restore-panel", {path: testInfo.outputPath("restore-panel.png"), contentType: "image/png"});
  await heading.scrollIntoViewIfNeeded();
  await page.screenshot({path: testInfo.outputPath("restore-preview.png"), fullPage: true});
  await testInfo.attach("restore-preview", {path: testInfo.outputPath("restore-preview.png"), contentType: "image/png"});
  await page.getByRole("button", {name: "取消", exact: true}).click();
  await expect(heading).toHaveCount(0);
}

test("EC-11 legacy restore preview is readable and keeps every compatibility warning", async ({app, page}, testInfo) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  const before = await (await app.request.get("/api/export/backup")).json();
  await previewBackup(app, page, {cards: [{id: 1, word: "apple", kind: "word"}]});
  await expect(page.getByTestId("missing-backup-collections").getByRole("listitem")).toHaveCount(9);
  await expect(page.getByText(/不会补造语境应用证据/)).toBeVisible();
  await expect(page.getByText(/不会补造隔日或一周保持证据/)).toBeVisible();
  await assertReadablePreview(page, "旧版部分恢复", "确认恢复包含的内容", testInfo);
  const after = await (await app.request.get("/api/export/backup")).json();
  delete before.exported_at;
  delete after.exported_at;
  expect(after).toEqual(before);
});

test("EC-12 full restore preview retains replacement counts and warnings in dark mode", async ({appFactory, page}, testInfo) => {
  const source = await appFactory({fixture: "ec12-full.json"});
  const backup = await (await source.request.get("/api/export/backup")).json();
  const target = await appFactory();
  await target.seedCards([{word: "keep", meaning: "保留"}]);
  await page.addInitScript(() => localStorage.setItem("darkMode", "true"));
  await previewBackup(target, page, backup);
  await expect(page.locator("body")).toHaveClass(/dark/);
  await expect(page.getByText("备份未包含的现有学习内容将被删除。", {exact: false})).toBeVisible();
  await expect(page.getByText(/将替换现有 1 张卡/)).toBeVisible();
  await assertReadablePreview(page, "全量恢复", "确认替换学习数据", testInfo);
  expect((await (await target.request.get("/api/cards")).json()).cards.map(card => card.word)).toEqual(["keep"]);
});
