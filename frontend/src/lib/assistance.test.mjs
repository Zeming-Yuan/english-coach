import test from 'node:test';
import assert from 'node:assert/strict';
import {assistanceFor} from './assistance.js';
test('malformed assistance is removed while valid assistance remains recoverable',()=>{
  const rows=new Map([['ec.assistance.study:one','{'],['ec.assistance.study:two','["length","unknown","length"]']]);
  globalThis.localStorage={getItem:key=>rows.get(key)??null,removeItem:key=>rows.delete(key),setItem:(key,value)=>rows.set(key,value)};
  assert.deepEqual(assistanceFor('study','one'),[]);
  assert.equal(rows.has('ec.assistance.study:one'),false);
  assert.deepEqual(assistanceFor('study','two'),['length']);
  assert.equal(rows.get('ec.assistance.study:two'),'["length"]');
});
