import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSpellPool} from './practiceSession.js';
test('a partial today payload falls back to available vocabulary instead of throwing',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async path=>Response.json(path==='/api/today'?{}:{cards:[{id:1,kind:'word',word:'apple'}]});
  try {assert.deepEqual(await fetchSpellPool(),[{id:1,kind:'word',word:'apple'}]);}
  finally {globalThis.fetch=originalFetch;}
});
