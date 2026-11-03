import {test, expect} from "./support/test.mjs";

async function openBackup(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "设置", exact: true}).click();
  await page.getByRole("button", {name: "备份与恢复", exact: true}).click();
}
function upload(page, payload) {
  return page.getByLabel("选择备份文件").setInputFiles({
    name: "contract.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)),
  });
}
function semantic(payload) {
  const {exported_at, ...data} = payload;
  return data;
}
const backup = async app => (await app.request.get("/api/export/backup")).json();

// The overview already belongs to the migrated real stats page.
test("EL-20 visible evidence overview remains independent of unlock counts", async ({app, page}) => {
  const [card_id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (let i = 0; i < 3; i++) {
    expect((await app.request.post("/api/typing/check", {data: {
      card_id, user_input: "wrong", source: "spelling", submission_id: crypto.randomUUID(), assistance: [],
    }})).ok()).toBe(true);
  }
  await page.goto(app.baseURL);
  await expect(page.getByRole("region", {name: "复习与学习依据"})).toContainText("仍需巩固1 张");
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("evidence-overview")).toContainText("学习证据");
  await expect(page.getByTestId("evidence-overview")).toContainText("仍需巩固 1 张");
  await expect(page.locator(".stats-grid")).toContainText("句子练习已解锁");
  await page.screenshot({path: test.info().outputPath("contract-evidence.png")});
});

test("EL-20 unknown collection upload rejects before confirmation without data loss", async ({app, page}) => {
  await app.seedCards([{word: "keep", meaning: "保留"}]);
  const before = await backup(app);
  const payload = structuredClone(before);
  payload.features.push("unregistered_feature");
  payload.extensions.unregistered_feature = [{id: "unknown"}];
  await openBackup(page, app);
  await upload(page, payload);
  await expect(page.getByRole("alert")).toContainText("未知功能");
  await expect(page.getByRole("button", {name: "确认替换学习数据", exact: true})).toHaveCount(0);
  expect(semantic(await backup(app))).toEqual(semantic(before));
});

test("EL-20 V3 restore preserves equal-time contacts and current evidence", async ({appFactory, page}) => {
  const source = await appFactory();
  const [card_id] = await source.seedCards([{word: "apple", meaning: "苹果"}]);
  const revision = (await (await source.request.get(`/api/cards/${card_id}`)).json()).content_revision;
  const submissions = [];
  for (const contactSource of ["words_list", "card_detail"]) {
    const submission_id = crypto.randomUUID();
    submissions.push(submission_id);
    expect((await source.request.post("/api/learning/contacts", {data: {
      card_id, revision, submission_id, source: contactSource, kind: "answer_visible",
    }})).ok()).toBe(true);
  }
  const payload = await backup(source);
  payload.extensions.learning_contacts.reverse();
  const target = await appFactory();
  await target.seedCards([{word: "replace", meaning: "替换", id: 500}]);
  await openBackup(page, target);
  await upload(page, payload);
  await expect(page.getByText(/备份格式：V3/)).toBeVisible();
  await page.getByRole("button", {name: "确认替换学习数据", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("恢复成功");
  const restored = await backup(target);
  expect(restored.extensions.learning_contacts.map(row => row.submission_id)).toEqual(submissions);
  expect(restored.learning_events).toEqual([]);
  expect(restored.reviews).toEqual([]);
  const mapped = restored.cards[0].id;
  expect(mapped).not.toBe(card_id);
  const detail = await (await target.request.get(`/api/cards/${mapped}`)).json();
  expect(detail.last_contact.source).toBe("card_detail");
  expect(detail.learning_evidence.recall.status).toBe("insufficient");
  await page.goto(target.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("evidence-overview")).toContainText("独立证据不足 1 张");
});
