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
