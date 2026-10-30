import {test, expect} from "./support/test.mjs";

test("EC-08 three-day-calendar", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  for (const day of ["28", "29", "30"]) {
    await app.setTime(`2026-10-${day}T01:00:00+00:00`);
    const response = await app.request.post("/api/reviews", {
      data: {
        card_id: id,
        rating: 3,
        source: "study",
        kind: "self_rating",
        submission_id: crypto.randomUUID(),
      },
    });
    expect(response.status()).toBe(200);
  }

  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("streak")).toContainText("3");
  for (const day of ["28", "29", "30"]) {
    await expect(page.locator(`[data-date="2026-10-${day}"]`)).toHaveAttribute(
      "data-count",
      "1",
    );
  }
});

test("EC-08 same-day-two-attempts-one-word", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  const payload = {
    card_id: id,
    rating: 3,
    source: "study",
    kind: "self_rating",
    submission_id: crypto.randomUUID(),
  };
  await app.request.post("/api/reviews", {data: payload});
  await app.request.post("/api/reviews", {data: payload});
  await app.request.post("/api/reviews", {
    data: {...payload, submission_id: crypto.randomUUID()},
  });

  await page.goto(app.baseURL);
  await expect(page.locator(".today-stats")).toContainText("完成 1 词");
  await expect(page.locator(".today-stats")).toContainText("练习 2 次");
});

test("EC-08 legacy-baseline-does-not-fake-days", async ({appFactory, page}) => {
  const instance = await appFactory({fixture: "ec08-legacy.json"});
  await page.goto(instance.baseURL);
  await page.locator(".today-stats").click();

  await expect(page.getByRole("note")).toContainText("部分旧历史不可还原");
  const counts = await page
    .locator("[data-date]")
    .evaluateAll((cells) => cells.map((cell) => Number(cell.dataset.count)));
  expect(counts.length).toBeGreaterThan(0);
  expect(counts.every((count) => count === 0)).toBe(true);
});
