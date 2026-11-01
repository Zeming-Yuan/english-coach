import {randomUUID} from "node:crypto";
import {test, expect} from "./support/test.mjs";

async function typeWord(app, id, answer = "apple", assistance = []) {
  const response = await app.request.post("/api/typing/check", {
    data: {
      card_id: id,
      user_input: answer,
      source: "spelling",
      submission_id: randomUUID(),
      assistance,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function openDetail(page, app, word = "apple") {
  await page.goto(app.baseURL);
  await page.getByText("单词本", {exact: true}).click();
  await page.locator(".word-item", {hasText: word}).first().click();
}

test("EL-02 visible evidence panel states insufficient evidence", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await openDetail(page, app);
  await expect(page.getByTestId("learning-evidence")).toContainText("独立回忆");
  await expect(page.getByTestId("learning-evidence")).toContainText("证据不足");
  await expect(page.getByTestId("learning-evidence")).toContainText("0 次");
  await expect(page.getByTestId("learning-evidence")).toContainText("延迟保持 / 实际应用");
  await expect(page.locator(".mastery-bar-wrap")).toHaveCount(0);
});

test("EL-02 independent cross-day answers show verified recall", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-02T01:00:00Z");
  await typeWord(app, id);
  await openDetail(page, app);
  await expect(page.getByTestId("learning-evidence")).toContainText("已有独立证据");
  await expect(page.getByTestId("learning-evidence")).toContainText("2 次");
  await expect(page.getByTestId("learning-evidence")).toContainText("第 1 版");
});

test("EL-02 new failure changes verified recall to weak", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-02T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-03T01:00:00Z");
  await typeWord(app, id, "wrong");
  await openDetail(page, app);
  await expect(page.getByTestId("learning-evidence")).toContainText("待巩固");
});

test("EL-02 assisted answers never become independent evidence", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  await typeWord(app, id, "apple", ["first_letter"]);
  await app.setTime("2026-10-02T01:00:00Z");
  await typeWord(app, id, "apple", ["first_letter"]);
  await openDetail(page, app);
  await expect(page.getByTestId("learning-evidence")).toContainText("证据不足");
  await expect(page.getByTestId("learning-evidence")).toContainText("0 次");
});

test("EL-02 meaning edit moves old evidence to history", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await app.setTime("2026-10-01T01:00:00Z");
  await typeWord(app, id);
  await app.setTime("2026-10-02T01:00:00Z");
  await typeWord(app, id);
  const edited = await app.request.put(`/api/cards/${id}`, {
    data: {meaning: "一个苹果"},
  });
  expect(edited.ok()).toBeTruthy();
  await openDetail(page, app);
  await expect(page.getByTestId("learning-evidence")).toContainText("证据不足");
  await expect(page.getByTestId("learning-evidence")).toContainText("第 2 版");
});

test("EL-02 weak evidence never reads as mastery", async ({appFactory, page}) => {
  const app = await appFactory();
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (const rating of [4, 4, 4]) {
    const response = await app.request.post("/api/reviews", {
      data: {card_id: id, rating, source: "study"},
    });
    expect(response.ok()).toBeTruthy();
  }
  for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
    await app.setTime(`${day}T01:00:00Z`);
    await typeWord(app, id, "wrong");
  }
  await openDetail(page, app);
  await expect(page.getByTestId("learning-evidence")).toContainText("待巩固");
  await expect(page.getByText("句子练习已解锁").first()).toBeVisible();
  await expect(page.getByText(/100% 掌握/)).toHaveCount(0);
  await expect(page.locator(".mastery-bar-wrap")).toHaveCount(0);
});
