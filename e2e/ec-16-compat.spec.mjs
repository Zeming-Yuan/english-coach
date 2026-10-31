import {test, expect} from "./support/test.mjs";
const legacyRef = "5868cd1629bc3c36f2bfd5a1009ae048481c94f8";
async function snapshot(app) {
  const response = await app.request.get("/api/export/backup");
  expect(response.ok()).toBe(true);
  const result = await response.json(); delete result.exported_at; return result;
}

test("EC-16 legacy readonly preserves new events and forward learning", async ({appFactory, legacyAppFactory}) => {
  const live = await appFactory({fixture: "ec12-full.json"});
  const before = await snapshot(live);
  expect(before.learning_events.length).toBeGreaterThan(0);
  const copy = await appFactory({snapshotOf: live.databasePath});
  expect(await snapshot(copy)).toEqual(before);
  const old = await legacyAppFactory({gitRef: legacyRef, databasePath: copy.databasePath});
  expect(old.gitRef).toBe(legacyRef);
  const cards = await old.request.get("/api/cards");
  expect(cards.status()).toBe(200);
  expect((await cards.json()).cards.map(c => c.word)).toContain("apple");
  const story = await old.request.get(`/api/stories/${before.stories[0].id}`);
  expect(story.status()).toBe(200);
  const blocked = await old.request.post("/api/reviews", {data: {card_id: before.cards[0].id, rating: 1}});
  expect(blocked.status()).toBe(503);
  expect((await blocked.json()).detail).toContain("只读");
  expect(await snapshot(copy)).toEqual(before);
  await old.close();
  const saved = await copy.request.post("/api/reviews", {data: {card_id: before.cards[0].id, rating: 3, source: "study", submission_id: crypto.randomUUID()}});
  expect(saved.status()).toBe(200);
  expect((await snapshot(copy)).learning_events).toHaveLength(before.learning_events.length + 1);
  expect(await snapshot(live)).toEqual(before);
});

test("EC-16 legacy implicit GET write is visibly blocked", async ({appFactory, legacyAppFactory}) => {
  const app = await appFactory({fixture: "ec11-seed-story.json"});
  const copy = await appFactory({snapshotOf: app.databasePath});
  const before = await snapshot(copy);
  const old = await legacyAppFactory({gitRef: legacyRef, databasePath: copy.databasePath});
  const result = await old.request.get("/api/stories/1");
  expect(result.status()).toBe(503);
  expect((await result.json()).detail).toContain("只读");
  expect(await snapshot(copy)).toEqual(before);
});
