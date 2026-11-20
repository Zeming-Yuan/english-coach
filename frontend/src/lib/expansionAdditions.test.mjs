import assert from "node:assert/strict";
import test from "node:test";
import {webcrypto} from "node:crypto";
import {configureAccount} from "./accountSession.js";
import {
  confirmAddition, createAdditionPending, loadAdditionPending, saveAdditionPending,
  selectedExpansionOperations,
} from "./expansionAdditions.js";

test("a pending addition is account scoped and concurrent retries share one request", async () => {
  const rows = new Map();
  globalThis.localStorage = {
    get length() { return rows.size; },
    key(index) { return [...rows.keys()][index] ?? null; },
    getItem(key) { return rows.get(key) ?? null; },
    setItem(key, value) { rows.set(key, value); },
    removeItem(key) { rows.delete(key); },
  };
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const originalFetch = globalThis.fetch;
  configureAccount("learner");
  const card = {id: 10, content_revision: {identity: "apple-v1", version: 1}};
  const row = {word: "apple juice", meaning: "苹果汁"};
  const pending = createAdditionPending(card, row, "round-a");
  assert.equal(saveAdditionPending(pending), true);
  assert.deepEqual(loadAdditionPending(), [pending]);
  assert.deepEqual(createAdditionPending(card, row, "round-a"), pending);

  let calls = 0;
  globalThis.fetch = async (path, options) => {
    calls += 1;
    assert.equal(path, "/api/cards/10/expansion-additions");
    assert.equal(options.headers.get("X-EC-Account"), "learner");
    assert.deepEqual(JSON.parse(options.body), pending.command);
    return new Response(JSON.stringify({
      committed: true, available: true, card_id: 12, operation_id: pending.command.operation_id,
    }), {status: 200});
  };
  try {
    const results = await Promise.all([confirmAddition(pending), confirmAddition(pending)]);
    assert.deepEqual(results.map(result => result.card_id), [12, 12]);
    assert.equal(calls, 1);
    assert.deepEqual(loadAdditionPending(), []);
    assert.deepEqual(selectedExpansionOperations("round-a"), [pending.command.operation_id]);
    assert.deepEqual(selectedExpansionOperations("round-b"), []);
    assert.ok([...rows.keys()].every(key => key.startsWith("ec.account.learner:")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
