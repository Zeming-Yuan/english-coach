import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingDurations, saveDuration, discardDuration} from './durations.js';
function setup() {
  const rows = new Map();
  globalThis.localStorage = {get length(){return rows.size;}, key(i){return [...rows.keys()][i];},
    getItem(k){return rows.get(k) ?? null;},setItem(k,v){rows.set(k,v);},removeItem(k){rows.delete(k);}};
  globalThis.window = new EventTarget();
}
test('a corrupted duration does not hide other recoverable samples', () => {
  setup();
  localStorage.setItem('ec.duration.bad', '{');
  localStorage.setItem('ec.duration.good', JSON.stringify({sample_id:'good',active_ms:1200}));
  assert.deepEqual(pendingDurations(), [{sample_id:'good',active_ms:1200}]);
});

test('discard aborts an in-flight duration and cannot retire a newer retry', async () => {
  setup();
  const originalFetch = globalThis.fetch;
  const signals = [];
  const releases = [];
  globalThis.fetch = (_, options) => {signals.push(options.signal); return new Promise(resolve=>releases.push(resolve));};
  const payload = {sample_id:'cancelled',active_ms:1200};
  try {
    const first = saveDuration(payload);
    discardDuration(payload.sample_id);
    assert.equal(signals[0]?.aborted, true);
    const second = saveDuration(payload);
    releases[0]({ok:true,json:async()=>({committed:true})});
    await first;
    assert.deepEqual(pendingDurations(), [payload]);
    releases[1]({ok:true,json:async()=>({committed:true})});
    await second;
    assert.deepEqual(pendingDurations(), []);
  } finally {globalThis.fetch = originalFetch;}
});
