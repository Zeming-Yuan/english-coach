import fs from "node:fs";

import {test, expect} from "./support/test.mjs";

const legacyBuffer = () =>
  fs.readFileSync(new URL("./fixtures/ec11-legacy.json", import.meta.url));

async function openBackup(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
}

test("EC-11 invalid-file-keeps-data", async ({app, page}) => {
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  const before = await (await app.request.get("/api/export/backup")).json();
  delete before.exported_at;

  await openBackup(app, page);
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        cards: [{id: 1, word: "apple"}],
        reviews: [{card_id: 1, state: "bad"}],
      }),
    ),
  });
  await expect(page.getByRole("alert")).toContainText("state");

  const after = await (await app.request.get("/api/export/backup")).json();
  delete after.exported_at;
  expect(after).toEqual(before);
});

test("EC-11 cancel-preview-does-not-write", async ({app, page}) => {
  await openBackup(app, page);
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({cards: [{id: 1, word: "banana", kind: "word"}]}),
    ),
  });
  await expect(page.getByText("旧版部分恢复", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "取消", exact: true}).click();
  expect((await (await app.request.get("/api/cards")).json()).cards).toHaveLength(0);
});

test("EC-11 import-legacy-twice-keeps-story", async ({appFactory, page}) => {
  const instance = await appFactory({fixture: "ec11-seed-story.json"});
  await openBackup(instance, page);

  for (let i = 0; i < 2; i += 1) {
    await page.getByLabel("选择备份文件").setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: legacyBuffer(),
    });
    await expect(page.getByText("旧版部分恢复", {exact: true})).toBeVisible();
    await page.getByRole("button", {name: "确认恢复包含的内容"}).click();
    await expect(page.getByText(/恢复完成/)).toBeVisible();
  }

  const cards = (await (await instance.request.get("/api/cards")).json()).cards;
  const apples = cards.filter((card) => card.word === "apple");
  expect(apples).toHaveLength(2);
  expect(new Set(apples.map((card) => card.kind))).toEqual(
    new Set(["word", "sentence"]),
  );
  expect(cards.some((card) => card.word === "zebra")).toBe(true);

  const stories = (await (await instance.request.get("/api/stories")).json()).stories;
  expect(stories.some((story) => story.title === "Old story")).toBe(true);
});
