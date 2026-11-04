import {test, expect} from "./support/test.mjs";

async function openReader(page, appFactory, storyId) {
  const app = await appFactory({fixture: "story-reader-regressions.json"});
  // Control only the external media boundary; real UI, contacts and database remain in use.
  await page.addInitScript(() => {
    window.__readerAudio = [];
    window.Audio = class {
      constructor(src) { this.src = src; this.ended = false; this.paused = true; this.pauseCount = 0; }
      play() {
        this.paused = false;
        window.__readerAudio.push(this);
        return new Promise((resolve, reject) => { this.start = resolve; this.fail = reject; });
      }
      pause() { this.paused = true; this.pauseCount += 1; }
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
  [9, "normalized repeated accented target", [9]], [10, "normalized curly apostrophe target", [10]],
  [11, "normalized em dash target", [11]], [13, "normalized en dash target", [13]], [12, "normalized unsupported target exclusion", [1]],
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

test("starting a new story sentence stops the previous audio", async ({page, appFactory}) => {
  await openReader(page, appFactory, 14);
  await page.getByRole("button", {name: "朗读第 1 段"}).click();
  await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(1);
  await page.getByRole("button", {name: "朗读第 2 段"}).click();
  await expect.poll(() => page.evaluate(() => window.__readerAudio.length)).toBe(2);
  const previous = await page.evaluate(() => {
    const audio = window.__readerAudio[0];
    return {paused: audio.paused, pauseCount: audio.pauseCount};
  });
  expect(previous.paused).toBe(true);
  expect(previous.pauseCount).toBeGreaterThan(0);
});

test("local speech fallback cannot keep reading after a word starts", async ({page, appFactory}) => {
  const app = await appFactory({fixture: "story-reader-regressions.json"});
  await page.addInitScript(() => {
    window.__local = {spoken: [], canceled: [], active: null};
    window.Audio = class {
      constructor(src) { this.src = src; this.ended = false; }
      play() { return Promise.reject(new Error("no online audio")); }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{lang: "en-US", localService: true}],
        speak(utterance) {
          window.__local.spoken.push(utterance.text);
          window.__local.active = utterance;
          if (utterance.onstart) utterance.onstart();
        },
        cancel() {
          const current = window.__local.active;
          if (!current) return;
          window.__local.canceled.push(current.text);
          window.__local.active = null;
          // Real browsers may fire onend when an utterance is cancelled.
          if (current.onend) current.onend();
        },
      },
    });
  });
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "打开故事库", exact: true}).click();
  await page.getByText("Reader regression 14", {exact: true}).click();
  // 整段朗读走本地兜底，停在第一段。
  await page.getByRole("button", {name: "朗读", exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__local.spoken.length)).toBe(1);
  // 点词朗读必须掐断整段朗读，而不是被下一段反掐。
  await page.getByRole("button", {name: "查词 tea", exact: true}).first().click();
  await page.getByRole("button", {name: "朗读 tea", exact: true}).click();
  await page.waitForTimeout(1000);
  const local = await page.evaluate(() => ({spoken: window.__local.spoken, active: window.__local.active?.text}));
  expect(local.spoken).toEqual(["Tea is hot.", "tea"]);
  expect(local.active).toBe("tea");
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
