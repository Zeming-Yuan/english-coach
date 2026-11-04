import {test, expect} from "./support/test.mjs";

const start = page => page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
async function rate(page, rating = 3) {
  await page.getByRole("button", {name: "点击翻面", exact: true}).click();
  await page.locator(`.rating-${rating}`).click();
}

test("EL-22 selected time gives one next step and resumes the same saved round", async ({app, page}) => {
  await app.seedCards(Array.from({length: 12}, (_, i) => ({word: `word${i}`, meaning: `词义${i}`})));
  await page.goto(app.baseURL);
  await page.getByLabel("今天可用时间").selectOption("3");
  const next = page.getByRole("region", {name: "今天下一步", exact: true});
  await expect(next.getByTestId("next-step-reason")).toHaveText("先学本轮的 2 个新词，再用少量练习巩固。");
  await expect(next.getByRole("button", {name: "开始今天的学习", exact: true})).toHaveCount(1);
  await expect(next).not.toContainText("word0");
  await start(page);
  await rate(page);
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await page.getByRole("button", {name: "先到这里", exact: true}).click();
  await page.getByRole("button", {name: "返回首页", exact: true}).click();
  await page.reload();
  await expect(next.getByTestId("next-step-reason")).toHaveText("上轮还有 1 张未完成，先从保存的位置继续。");
  await expect(next.getByLabel("今天可用时间")).toBeDisabled();
  await next.getByRole("button", {name: "继续本轮学习", exact: true}).click();
  await expect(page.locator(".study-count")).toHaveText("2 / 2");
  await expect(page.locator(".front-main")).toHaveText("word1");
  await page.screenshot({path: test.info().outputPath("resume.png")});
});
