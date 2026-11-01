import fs from "node:fs";
import {test, expect} from "./support/test.mjs";

async function openBackup(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
}

function upload(page, backup) {
  return page.getByLabel("选择备份文件").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
}

async function openDetail(page, word) {
  await page.getByText("单词本", {exact: true}).click();
  await page.locator(".word-item", {hasText: word}).first().click();
}

test("EL-01 visible revision panel tracks semantic edits", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await openDetail(page, "apple");
  await expect(page.getByTestId("revision-panel")).toContainText("内容修订");
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");

  page.once("dialog", (dialog) => dialog.accept("一个苹果"));
  await page.getByRole("button", {name: /编辑/}).click();
  await expect(page.getByTestId("revision-panel")).toContainText("第 2 版");
});

test("EL-01 v3 roundtrip preserves revision and keeps working", async ({appFactory, page}) => {
  const source = await appFactory();
  await source.seedCards([{word: "apple", meaning: "苹果"}]);
  const listed = await (await source.request.get("/api/cards")).json();
  const card = listed.cards.find((row) => row.word === "apple");
  await source.request.put(`/api/cards/${card.id}`, {data: {meaning: "一个苹果"}});
  const before = (await (await source.request.get(`/api/cards/${card.id}`)).json()).content_revision;

  await openBackup(page, source);
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "下载完整备份", exact: true}).click();
  const file = await (await download).path();
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(exported.version).toBe(3);
  expect(exported.extensions.content_revisions[0].identity).toBe(before.identity);

  const target = await appFactory();
  await openBackup(page, target);
  await page.getByLabel("选择备份文件").setInputFiles(file);
  await expect(page.getByText(/备份格式：V3/)).toBeVisible();
  await expect(page.getByText(/现有数据库学习内容将被备份替换/)).toBeVisible();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");

  await page.getByRole("button", {name: "返回设置", exact: true}).click();
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await openDetail(page, "apple");
  await expect(page.getByTestId("revision-panel")).toContainText("第 2 版");

  page.once("dialog", (dialog) => dialog.accept("苹果（恢复后）"));
  await page.getByRole("button", {name: /编辑/}).click();
  await expect(page.getByTestId("revision-panel")).toContainText("第 3 版");

  const restored = await (await target.request.get("/api/export/backup")).json();
  const restoredCard = restored.cards.find((row) => row.word === "apple");
  const revision = restored.extensions.content_revisions.find(
    (row) => row.resource_kind === "card" && row.resource_id === restoredCard.id,
  );
  expect(revision.identity).toBe(before.identity);
  expect(revision.version).toBe(3);
});

test("EL-01 v2 preview announces missing revisions and regenerates identity", async ({appFactory, page}) => {
  const source = await appFactory();
  await source.seedCards([{word: "apple", meaning: "苹果"}]);
  const current = await (await source.request.get("/api/export/backup")).json();
  const original = current.extensions.content_revisions[0];
  const v2 = {...current, version: 2};
  delete v2.features;
  delete v2.extensions;

  const target = await appFactory();
  await target.seedCards([{word: "keep", meaning: "保留"}]);
  await openBackup(page, target);
  await upload(page, v2);
  await expect(page.getByText(/备份格式：V2/)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("缺少内容修订");
  const untouched = await (await target.request.get("/api/export/backup")).json();
  expect(untouched.cards.map((row) => row.word)).toEqual(["keep"]);

  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");

  const restored = await (await target.request.get("/api/export/backup")).json();
  const card = restored.cards.find((row) => row.word === "apple");
  const revision = restored.extensions.content_revisions.find(
    (row) => row.resource_kind === "card" && row.resource_id === card.id,
  );
  expect(revision.version).toBe(1);
  expect(revision.identity).not.toBe(original.identity);
});

test("EL-01 unknown v3 feature is rejected without touching data", async ({appFactory, page}) => {
  const source = await appFactory();
  await source.seedCards([{word: "apple", meaning: "苹果"}]);
  const backup = await (await source.request.get("/api/export/backup")).json();
  backup.features.push("future_notes");
  backup.extensions.future_notes = [];

  const target = await appFactory();
  await target.seedCards([{word: "keep", meaning: "保留"}]);
  const before = await (await target.request.get("/api/export/backup")).json();
  delete before.exported_at;
  await openBackup(page, target);
  await upload(page, backup);
  await expect(page.getByRole("alert")).toContainText("未知功能");
  const after = await (await target.request.get("/api/export/backup")).json();
  delete after.exported_at;
  expect(after).toEqual(before);
});

test("EL-01 lost edit response replays without double revision", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await openDetail(page, "apple");
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");

  await page.route(
    "**/api/cards/*",
    async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      await route.fetch();
      await route.abort("failed");
    },
    {times: 1},
  );
  page.once("dialog", (dialog) => dialog.accept("一个苹果"));
  await page.getByRole("button", {name: /编辑/}).click();
  await expect(page.getByTestId("revision-panel")).toContainText("第 1 版");

  page.once("dialog", (dialog) => dialog.accept("一个苹果"));
  await page.getByRole("button", {name: /编辑/}).click();
  await expect(page.getByTestId("revision-panel")).toContainText("第 2 版");

  const exported = await (await app.request.get("/api/export/backup")).json();
  const card = exported.cards.find((row) => row.word === "apple");
  const revision = exported.extensions.content_revisions.find(
    (row) => row.resource_kind === "card" && row.resource_id === card.id,
  );
  expect(revision.version).toBe(2);
});
