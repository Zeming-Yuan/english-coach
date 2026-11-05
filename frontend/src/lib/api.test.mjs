import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from './api.js';
test('network failures have a readable message and preserve explicit cancellation', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {throw new TypeError('Failed to fetch');};
    await assert.rejects(api('/api/cards'), /网络|连接/);
    globalThis.fetch = async () => {throw new DOMException('Aborted','AbortError');};
    await assert.rejects(api('/api/cards'), {name:'AbortError'});
  } finally {globalThis.fetch=originalFetch;}
});

test('an empty successful API response resolves to null', async () => {
  const originalFetch=globalThis.fetch;
  try {
    for (const response of [new Response(null,{status:204}),new Response('',{status:200})]) {
      globalThis.fetch=async()=>response;
      assert.equal(await api('/api/empty'),null);
    }
  } finally {globalThis.fetch=originalFetch;}
});
