import {test, expect} from "./support/test.mjs";

test("EC-01 no-key-home", async ({app, page}) => {
  await page.goto(app.baseURL);
  await expect(page.getByRole("button", {name: "先加几个词"})).toBeVisible();
  await expect(page.getByText("加载失败", {exact: true})).toHaveCount(0);
  const response = await app.request.post("/api/cards/generate", {
    data: {words: ["apple"]},
  });
  expect(response.status()).toBe(503);
  await expect(page.getByRole("navigation")).toBeVisible();
});

for (const llmState of ["missing", "timeout", "unavailable"]) {
  test("EC-01 external-" + llmState, async ({appFactory, page}) => {
    const instance = await appFactory({fixture: `ec01-${llmState}.json`});
    await page.goto(instance.baseURL);
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByText("加载失败", {exact: true})).toHaveCount(0);
    await expect(page.getByRole("button", {name: "先加几个词"})).toBeVisible();
  });
}
