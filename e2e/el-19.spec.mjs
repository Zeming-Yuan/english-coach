import {test, expect} from "./support/test.mjs";

async function prepareRecovery(app, count = 7) {
  const ids = await app.seedCards(Array.from({length: count + 1}, (_, i) => ({word: `return${i}`, meaning: `词${i}`})));
  await app.setTime("2026-10-01T01:00:00Z");
  for (const card_id of ids.slice(0, count)) {
    expect((await app.request.post("/api/reviews", {data: {
      card_id, rating: 1, source: "study", kind: "self_rating", submission_id: crypto.randomUUID(),
    }})).ok()).toBe(true);
  }
  await app.setTime("2026-10-05T01:00:00Z");
  return ids;
}
async function rate(page) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(".rating-3").click();
}
const resume = page => page.getByRole("button", {name: "继续本轮学习", exact: true}).click();
async function chooseRecovery(page) {
  await page.getByRole("button", {name: "选择恢复学习", exact: true}).click();
  await expect(page.getByTestId("round-target")).toContainText("新词 0 个");
  await page.getByRole("button", {name: "开始恢复学习", exact: true}).click();
}

test("EL-19 finite recovery saves five due words and returns to regular learning", async ({app, page}) => {
  const ids = await prepareRecovery(app);
  const before = await (await app.request.get("/api/export/backup")).json();
  await page.goto(app.baseURL);
  await expect(page.getByTestId("recovery-offer")).toContainText("恢复学习");
  await page.reload();
  await expect(page.getByTestId("recovery-offer")).toBeVisible();
  await chooseRecovery(page);
  for (let i = 0; i < 5; i++) {
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 5`);
    await expect(page.locator(".front-main")).toHaveText(`return${i}`);
    await rate(page);
  }
  await expect(page.getByRole("heading", {name: "恢复学习结果", exact: true})).toBeVisible();
  await expect(page.locator(".done-detail")).toContainText("5 张卡已保存");
  await expect(page.getByTestId("recovery-remaining")).toContainText("剩余到期 2 张");
  await page.screenshot({path: test.info().outputPath("recovery-result.png")});
  const after = await (await app.request.get("/api/export/backup")).json();
  expect(after.learning_events).toHaveLength(before.learning_events.length + 5);
  expect(after.reviews.find(row => row.card_id === ids[5])).toEqual(before.reviews.find(row => row.card_id === ids[5]));
  expect(after.reviews.find(row => row.card_id === ids[0]).due).not.toEqual(before.reviews.find(row => row.card_id === ids[0]).due);
  await page.getByRole("button", {name: "继续常规计划", exact: true}).click();
  await expect(page.getByTestId("recovery-offer")).toHaveCount(0);
  await expect(page.getByRole("combobox", {name: "今天可用时间"})).toHaveValue("8");
  await expect(page.getByTestId("round-target")).toContainText("新词 1 个");
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await expect(page.locator(".front-main")).toHaveText("return5");
});
