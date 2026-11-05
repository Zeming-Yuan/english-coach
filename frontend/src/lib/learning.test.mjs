import test from "node:test";
import assert from "node:assert/strict";

import {
  makePending,
  sendPending,
  savePending,
  loadPending,
  clearPending,
} from "./learning.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("makePending assigns a stable submission id", () => {
  const pending = makePending("/api/reviews", {card_id: 1, rating: 3});
  assert.match(pending.payload.submission_id, UUID);
  assert.equal(
    makePending(pending.path, pending.payload).payload.submission_id,
    pending.payload.submission_id,
  );
});

test("denied storage keeps the pending request in memory", () => {
  globalThis.localStorage = {
    setItem() {
      throw Error("denied");
    },
    getItem() {
      throw Error("denied");
    },
    removeItem() {
      throw Error("denied");
    },
  };
  const pending = makePending("/api/reviews", {card_id: 1, rating: 3});
  assert.equal(savePending("study", pending), false);
  assert.deepEqual(loadPending("study"), pending);
  clearPending("study");
  assert.equal(loadPending("study"), null);
});

test("sendPending keeps the id across retries and surfaces status/detail", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({path, options});
    return {
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({detail: "该提交标识已用于不同内容"}),
    };
  };
  try {
    const pending = makePending("/api/reviews", {card_id: 1, rating: 3});
    const error = await sendPending(pending).then(
      () => null,
      (failure) => failure,
    );
    assert.equal(error.status, 409);
    assert.equal(error.detail, "该提交标识已用于不同内容");

    await sendPending(pending).catch(() => {});
    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, "/api/reviews");
    assert.equal(
      JSON.parse(calls[0].options.body).submission_id,
      pending.payload.submission_id,
    );
    assert.equal(
      JSON.parse(calls[1].options.body).submission_id,
      pending.payload.submission_id,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendPending returns the saved result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({committed: true, event_id: "e1"}),
  });
  try {
    const pending = makePending("/api/reviews", {card_id: 1, rating: 3});
    assert.deepEqual(await sendPending(pending), {
      committed: true,
      event_id: "e1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restoring data retires pending learning from memory and storage", async () => {
  const {clearAllPending} = await import("./learning.js");
  const rows = new Map();
  globalThis.localStorage = {
    get length() {return rows.size;},
    key(index) {return [...rows.keys()][index];},
    getItem(key) {return rows.get(key) ?? null;},
    setItem(key, value) {rows.set(key, value);},
    removeItem(key) {rows.delete(key);},
  };
  const pending = makePending("/api/reviews", {card_id: 1, rating: 3});
  savePending("old-study", pending);
  rows.set("ec.pending.other-tab", JSON.stringify(pending));
  rows.set("ttsRate", "0.9");
  clearAllPending();
  assert.equal(loadPending("old-study"), null);
  assert.equal(loadPending("other-tab"), null);
  assert.equal(rows.get("ttsRate"), "0.9");
});

test("a non-JSON success response stays unconfirmed with a readable error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => {throw new SyntaxError("Unexpected token '<'");}});
  try {
    await assert.rejects(sendPending(makePending("/api/reviews", {card_id: 1, rating: 3})), error => {
      assert.equal(error instanceof SyntaxError, false);
      assert.match(error.message, /尚未确认保存/);
      return true;
    });
  } finally {globalThis.fetch = originalFetch;}
});

test("a cleared pending request is not reloaded when storage removal is denied", () => {
  const rows = new Map();
  globalThis.localStorage = {
    getItem(key) {return rows.get(key) ?? null;},
    setItem(key, value) {rows.set(key, value);},
    removeItem() {throw new Error("denied");},
  };
  savePending("retired", makePending("/api/reviews", {card_id: 1, rating: 3}));
  clearPending("retired");
  assert.equal(loadPending("retired"), null);
});
