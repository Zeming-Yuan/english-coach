import assert from "node:assert/strict";
import test from "node:test";
import { formatRouteHash, parseRoute, routesEqual } from "./router.js";

test("parseRoute normalizes empty, root, and unknown hashes to the queue home route", () => {
  for (const raw of ["", "#", "#/", "#/queue", "#/not-a-view", "#/words/1/extra"]) {
    assert.deepEqual(parseRoute(raw), {
      view: "queue",
      detailId: null,
      subView: null,
      window: "week",
      origin: null,
    });
  }
});

test("parseRoute parses secondary detail ids and sub-routes for words, lessons, stories, and spelling", () => {
  assert.deepEqual(parseRoute("#/words/42"), {
    view: "words",
    detailId: 42,
    subView: null,
    window: "week",
    origin: null,
  });
  assert.deepEqual(parseRoute("#/lessons/3"), {
    view: "lessons",
    detailId: 3,
    subView: null,
    window: "week",
    origin: null,
  });
  assert.deepEqual(parseRoute("#/lessons/3/check"), {
    view: "lessons",
    detailId: 3,
    subView: "check",
    window: "week",
    origin: null,
  });
  assert.deepEqual(parseRoute("#/stories/9"), {
    view: "stories",
    detailId: 9,
    subView: null,
    window: "week",
    origin: null,
  });
  assert.deepEqual(parseRoute("#/stories/starter"), {
    view: "stories",
    detailId: null,
    subView: "starter",
    window: "week",
    origin: null,
  });
  assert.deepEqual(parseRoute("#/spelling/18"), {
    view: "spelling",
    detailId: 18,
    subView: null,
    window: "week",
    origin: null,
  });

  for (const invalid of ["#/words/0", "#/words/-3", "#/words/abc", "#/lessons/NaN", "#/lessons/0/check", "#/stories/1.5", "#/spelling/abc"]) {
    const parsed = parseRoute(invalid);
    assert.equal(parsed.detailId, null);
    assert.equal(parsed.subView, null);
  }
});

test("parseRoute parses delayed check window and sanitizes history state origin", () => {
  assert.deepEqual(parseRoute("#/delayed/day", { origin: "queue" }), {
    view: "delayed",
    detailId: null,
    subView: null,
    window: "day",
    origin: "queue",
  });
  assert.deepEqual(parseRoute("#/delayed", { origin: "stats" }), {
    view: "delayed",
    detailId: null,
    subView: null,
    window: "week",
    origin: "stats",
  });
  assert.deepEqual(parseRoute("#/delayed/other", { origin: "evil" }), {
    view: "delayed",
    detailId: null,
    subView: null,
    window: "week",
    origin: null,
  });
  assert.deepEqual(parseRoute("#/backup", { origin: "settings" }), {
    view: "backup",
    detailId: null,
    subView: null,
    window: "week",
    origin: "settings",
  });
});

test("formatRouteHash produces canonical hashes and routesEqual avoids duplicate history entries", () => {
  assert.equal(formatRouteHash({ view: "queue" }), "#/");
  assert.equal(formatRouteHash({ view: "words", detailId: 12 }), "#/words/12");
  assert.equal(formatRouteHash({ view: "words", detailId: null }), "#/words");
  assert.equal(formatRouteHash({ view: "lessons", detailId: 2 }), "#/lessons/2");
  assert.equal(
    formatRouteHash({ view: "lessons", detailId: 2, subView: "check" }),
    "#/lessons/2/check",
  );
  assert.equal(formatRouteHash({ view: "stories", detailId: 8 }), "#/stories/8");
  assert.equal(
    formatRouteHash({ view: "stories", subView: "starter" }),
    "#/stories/starter",
  );
  assert.equal(formatRouteHash({ view: "spelling", detailId: 7 }), "#/spelling/7");
  assert.equal(formatRouteHash({ view: "delayed", window: "day" }), "#/delayed/day");
  assert.equal(formatRouteHash({ view: "delayed", window: "week" }), "#/delayed/week");
  assert.equal(formatRouteHash({ view: "scene" }), "#/scene");

  assert.equal(
    routesEqual(
      { view: "words", detailId: 12, subView: null, window: "week", origin: null },
      { view: "words", detailId: 12 },
    ),
    true,
  );
  assert.equal(
    routesEqual(
      { view: "lessons", detailId: 2, subView: "check" },
      { view: "lessons", detailId: 2 },
    ),
    false,
  );
  assert.equal(
    routesEqual(
      { view: "advice", origin: "queue" },
      { view: "advice", origin: "stats" },
    ),
    false,
  );
});
