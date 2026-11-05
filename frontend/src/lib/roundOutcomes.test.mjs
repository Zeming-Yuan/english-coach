import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRoundOutcome} from './roundOutcomes.js';
test('malformed workload targets never create workload advice observations',async()=>{
  globalThis.window=new EventTarget();
  const rows=new Map();
  globalThis.localStorage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
  for (const target of [undefined,null,NaN,Infinity,'3',1.5,0,-1]) {
    assert.equal(await recordRoundOutcome({id:'bad',startedAt:1,target,complete:true,observationGeneration:'initial'},'completed'),false);
  }
  assert.equal(rows.size,0);
});
