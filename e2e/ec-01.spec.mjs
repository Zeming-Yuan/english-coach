import {test, expect} from "./support/test.mjs";

test("EC-01 no-key-home", async ({app, page}) => {
  await page.goto(app.baseURL);
  await expect(page.getByRole("button", {name: "先加几个词"})).toBeVisible();
  await expect(page.getByText(/加载失败/)).toHaveCount(0);
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
    await expect(page.getByText(/加载失败/)).toHaveCount(0);
    await expect(page.getByRole("button", {name: "先加几个词"})).toBeVisible();

    // AI 失败必须可观察，且不能把本地页面打挂
    const response = await instance.request.post("/api/cards/generate", {
      data: {words: ["apple"]},
    });
    if (llmState === "missing") {
      expect(response.status()).toBe(503);
      expect((await response.json()).detail).toContain("LLM_API_KEY");
    } else {
      expect(response.status()).toBeGreaterThanOrEqual(500);
      // 证明失败确实经过外部服务适配层替身，而不是连接默认地址失败
      expect(await instance.externalCalls()).toContain(llmState);
    }
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByText(/加载失败/)).toHaveCount(0);
  });
}
