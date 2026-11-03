import {test, expect} from "./support/test.mjs";

async function openReader(page, appFactory, storyId) {
  const app = await appFactory({fixture: "story-reader-regressions.json"});
  // Control only the external media boundary; real UI, contacts and database remain in use.
  await page.addInitScript(() => {
    window.__readerAudio = [];
    window.Audio = class {
      constructor(src) { this.src = src; this.ended = false; }
      play() {
        window.__readerAudio.push(this);
        return new Promise((resolve, reject) => { this.start = resolve; this.fail = reject; });
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
  });
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "打开故事库", exact: true}).click();
  await page.getByText(`Reader regression ${storyId}`, {exact: true}).click();
  await expect(page.locator(".story-reader")).toBeVisible();
  return app;
}

async function audioIds(app) {
  const backup = await (await app.request.get("/api/export/backup")).json();
  return backup.extensions.learning_contacts.filter(row => row.kind === "answer_audio").map(row => row.card_id).sort((a, b) => a - b);
}

for (const [storyId, label, expected] of [
  [1, "em dash", [1]], [2, "possessive", [1]], [3, "multiword target", [2]],
  [4, "slash and semicolon", [3, 4, 5, 6]], [7, "substring exclusion", []],
]) {
  test(`story audio confirms full-word contacts for ${label} only after playback`, async ({page, appFactory}) => {
    const app = await openReader(page, appFactory, storyId);
    await page.getByRole("button", {name: "朗读", exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(1);
    expect(await audioIds(app)).toEqual([]);
    await page.evaluate(() => window.__readerAudio[0].start());
    await expect.poll(() => audioIds(app)).toEqual(expected);
    await page.evaluate(() => { const audio = window.__readerAudio[0]; audio.ended = true; audio.onended(); });
    await expect(page.getByRole("button", {name: "朗读", exact: true})).toBeVisible();
    expect(await audioIds(app)).toEqual(expected);
    for (const id of expected) {
      const card = await (await app.request.get(`/api/cards/${id}`)).json();
      expect(card.learning_events).toEqual([]);
      expect(card.learning_evidence.recall.count).toBe(0);
    }
  });
}

test("story audio does not confirm targets in a segment that has not started", async ({page, appFactory}) => {
  const app = await openReader(page, appFactory, 5);
  await page.getByRole("button", {name: "朗读", exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(1);
  expect(await audioIds(app)).toEqual([]);
  await page.evaluate(() => window.__readerAudio[0].start());
  await expect.poll(() => audioIds(app)).toEqual([3]);
  await page.evaluate(() => { window.__readerAudio[0].ended = true; window.__readerAudio[0].onended(); });
  await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(2);
  expect(await audioIds(app)).toEqual([3]);
  await page.evaluate(() => { window.__readerAudio[1].ended = true; window.__readerAudio[1].onended(); });
  await expect(page.getByRole("button", {name: "朗读", exact: true})).toBeVisible();
  expect(await audioIds(app)).toEqual([3]);
});

test("repeated story word shows the sentence containing the clicked occurrence", async ({page, appFactory}) => {
  await openReader(page, appFactory, 6);
  await page.getByRole("button", {name: "查词 book", exact: true}).nth(1).click();
  await expect(page.locator(".reader-context blockquote")).toHaveText("Ann reads the book.");
});

for (const firstStarted of [true, false]) {
  test(`story audio spanning segments ${firstStarted ? "confirms only when both parts start" : "requires the first part to have started"}`, async ({page, appFactory}) => {
    const app = await openReader(page, appFactory, 8);
    await page.getByRole("button", {name: "朗读", exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(1);
    expect(await audioIds(app)).toEqual([]);
    if (firstStarted) await page.evaluate(() => window.__readerAudio[0].start());
    expect(await audioIds(app)).toEqual([]);
    await page.evaluate(() => { window.__readerAudio[0].ended = true; window.__readerAudio[0].onended(); });
    await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(2);
    expect(await audioIds(app)).toEqual([]);
    await page.evaluate(() => window.__readerAudio[1].start());
    if (firstStarted) await expect.poll(() => audioIds(app)).toEqual([2]);
    await page.evaluate(() => { window.__readerAudio[1].ended = true; window.__readerAudio[1].onended(); });
    await expect(page.getByRole("button", {name: "朗读", exact: true})).toBeVisible();
    expect(await audioIds(app)).toEqual(firstStarted ? [2] : []);
  });
}
