import {randomUUID} from "node:crypto";
import {test, expect} from "./support/test.mjs";

async function typeWord(app, id, answer = "apple") {
  const response = await app.request.post("/api/typing/check", {
    data: {
      card_id: id,
      user_input: answer,
      source: "spelling",
      submission_id: randomUUID(),
      assistance: [],
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function verifiedThenWeak(app, id) {
  await app.setTime("2026-10-01T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-02T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-03T01:00:00Z");
  await typeWord(app, id, "wrong");
}

test("EL-03 visible evidence overview from today stats", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("evidence-overview")).toContainText("学习证据");
  await expect(page.getByTestId("evidence-overview")).toContainText("独立证据不足 1 张");
});

test("EL-03 weak evidence reads the same on home, stats and list", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await verifiedThenWeak(app, id);

  await page.goto(app.baseURL);
  await expect(page.locator(".today-stats")).toContainText("仍需巩固 1 张");
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("evidence-overview")).toContainText("仍需巩固 1 张");
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: /单词本/}).click();
  await expect(page.locator(".word-item", {hasText: "apple"})).toContainText("仍需巩固");
});

test("EL-03 share report downloads with the exported state", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-02T01:00:00Z");
  await typeWord(app, id);
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: /成绩单/}).click();
  expect((await download).suggestedFilename()).toBe("englishcoach_report.png");
});
