import {test, expect} from "./support/test.mjs";
import {readFile} from "node:fs/promises";

test("EC-10 download-complete-backup", async ({app, page}) => {
  await app.seedCards([
    {word: "apple", kind: "word"},
    {word: "apple", kind: "sentence"},
  ]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "下载完整备份", exact: true}).click();
  const download = await downloadPromise;
  const data = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(data.version).toBe(2);
  expect(data.cards).toHaveLength(2);
});

test("EC-10 export-failure-is-visible", async ({app, page}) => {
  await app.seedCards([{word: "apple"}]);
  await page.route("**/api/export/backup", (route) => route.abort("failed"), {times: 1});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
  await page.getByRole("button", {name: "下载完整备份", exact: true}).click();

  await expect(page.getByRole("alert")).toContainText("备份");
  await expect(page.getByText(/备份已下载/)).toHaveCount(0);
});

test("EC-10 backup-scope-and-keyboard-navigation", async ({app, page}) => {
  await app.seedCards([{word: "apple"}]);
  await page.goto(app.baseURL);

  await page.getByRole("button", {name: "设置", exact: true}).focus();
  await page.keyboard.press("Enter");
  const entry = page.getByRole("button", {name: "备份与恢复", exact: true});
  await entry.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText(/词卡全部字段/)).toBeVisible();
  await expect(page.getByText(/API 密钥/)).toBeVisible();
  await expect(page.getByText(/语音缓存/)).toBeVisible();
  await expect(page.getByText(/浏览器中的外观与播放偏好/)).toBeVisible();
  await expect(page.getByRole("button", {name: /恢复/})).toHaveCount(0);

  const back = page.getByRole("button", {name: "返回设置", exact: true});
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(entry).toBeVisible();
});
