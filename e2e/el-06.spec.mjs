import {test, expect} from "./support/test.mjs";

async function contacts(app) {
  const payload = await (await app.request.get("/api/export/backup")).json();
  return payload.extensions?.learning_contacts || [];
}

async function openStory(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "故事", exact: true}).click();
  await page.getByText("Apple Story", {exact: true}).click();
  await expect(page.getByTestId("content-contact-status")).toContainText("应用内接触");
}

test("EL-06 story reading records visible target contacts", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-story.json"});
  await openStory(app, page);
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === 1 &&
          row.source === "story" &&
          row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);
});

test("EL-06 story sentence playback records answer audio", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-story.json"});
  await openStory(app, page);
  await page.locator(".sentence-speak").first().click();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === 1 &&
          row.source === "story" &&
          row.kind === "answer_audio",
      ).length;
    })
    .toBeGreaterThan(0);
});

test("EL-06 lesson reading records word contacts", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await page.goto(app.baseURL);
  if (await page.getByText("专项练习", {exact: true}).locator("..").getAttribute("open") === null) await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  await page.locator(".lesson-list-item").first().click();
  await expect(page.getByTestId("content-contact-status")).toContainText("应用内接触");
  // 答案（释义）真正揭晓后才算接触。
  await page.getByRole("button", {name: "猜不到"}).first().click();
  await expect(page.locator(".word-item-meaning").filter({hasText: "苹果"})).toBeVisible();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === 1 &&
          row.source === "lesson" &&
          row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);
});

test("EL-06 lesson dialogue playback records answer audio", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el06-lesson-dialogue.json"});
  await page.goto(app.baseURL);
  if (await page.getByText("专项练习", {exact: true}).locator("..").getAttribute("open") === null) await page.getByText("专项练习", {exact: true}).click();
  await page.getByTestId("open-lessons").click();
  await page.locator(".lesson-list-item").first().click();
  await page.locator(".lesson-dialogue-row").first().click();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === 1 &&
          row.source === "lesson" &&
          row.kind === "answer_audio",
      ).length;
    })
    .toBeGreaterThan(0);
});

test("EL-06 story point-word records contact after meaning", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-story.json"});
  await openStory(app, page);
  const storyContacts = async () =>
    (await contacts(app)).filter(
      (row) => row.source === "story" && row.kind === "answer_visible",
    ).length;
  await expect.poll(storyContacts).toBe(1);
  await page.locator(".sw").first().click();
  await expect(page.locator(".story-word-panel-meaning")).toContainText("苹果");
  await expect.poll(storyContacts).toBe(2);
});

test("EL-06 offscreen story target is not a contact until visible", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el06-story-long.json"});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "故事", exact: true}).click();
  await page.getByText("Long Story", {exact: true}).click();
  const lastLine = page.locator(".story-sentence-row").last();
  await expect(lastLine).not.toBeInViewport();
  await page.waitForTimeout(300);
  expect(
    (await contacts(app)).filter(
      (row) => row.card_id === 1 && row.source === "story",
    ),
  ).toHaveLength(0);
  await lastLine.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const rows = await contacts(app);
      return rows.filter(
        (row) =>
          row.card_id === 1 &&
          row.source === "story" &&
          row.kind === "answer_visible",
      ).length;
    })
    .toBe(1);
});

test("EL-06 contact failure does not block reading", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-story.json"});
  await page.route("**/api/learning/contacts", (route) => route.abort("failed"), {
    times: 1,
  });
  await openStory(app, page);
  await expect(page.getByText("An apple a day.", {exact: false})).toBeVisible();
  await expect(page.getByText(/接触依据不完整/)).toBeVisible();
});
