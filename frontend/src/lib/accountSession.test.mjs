import {test} from 'node:test';
import assert from 'node:assert/strict';
const source = await import('./accountSession.js').catch(() => null);

test('pending learning state is isolated by account while local mode preserves existing keys', () => {
  assert.ok(source, 'account-aware browser storage has not been implemented');
  const rows = new Map([['ec.pending.study', 'legacy-local-record']]);
  const raw={get length(){return rows.size;},key:i=>[...rows.keys()][i]??null,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,String(v)),removeItem:k=>rows.delete(k)};
  const owner=source.createAccountStorage('owner',()=>raw);
  const friend=source.createAccountStorage('friend1',()=>raw);
  owner.setItem('ec.pending.study','owner-record');
  friend.setItem('ec.pending.study','friend-record');
  assert.equal(owner.getItem('ec.pending.study'),'owner-record');
  assert.equal(friend.getItem('ec.pending.study'),'friend-record');
  assert.equal(owner.length,1);
  assert.equal(owner.key(0),'ec.pending.study');
  owner.removeItem('ec.pending.study');
  assert.equal(owner.getItem('ec.pending.study'),null);
  assert.equal(friend.getItem('ec.pending.study'),'friend-record');
  assert.equal(source.createAccountStorage(null,()=>raw).getItem('ec.pending.study'),'legacy-local-record');
});

test('browser requests carry their mounted account even after cookies switch', async () => {
  assert.ok(source, 'account-aware browser requests have not been implemented');
  source.configureAccount('owner');
  let headers;
  globalThis.fetch=async (_url,options)=>{headers=new Headers(options.headers);return {status:200};};
  await source.accountFetch('/api/cards/starter',{method:'POST',headers:{'Content-Type':'application/json','X-EC-Account':'friend1'}});
  assert.equal(headers.get('X-EC-Account'),'owner');
  assert.equal(headers.get('Content-Type'),'application/json');
  assert.throws(()=>source.configureAccount('friend1'));
});

test('another tab of the same account refreshes workload advice without reacting to another account', async () => {
  assert.ok(source);
  source.configureAccount('owner');
  globalThis.window=new EventTarget();
  const rows=new Map();
  globalThis.localStorage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,String(v))};
  const {subscribeRoundAdvice}=await import('./roundOutcomes.js');
  const caps=[];
  const unsubscribe=subscribeRoundAdvice(cap=>caps.push(cap));
  rows.set('ec.account.owner:ec.round-outcomes.v1',JSON.stringify({generation:'initial',rounds:[
    {id:'one',startedAt:1,interrupted:true,completed:false},
    {id:'two',startedAt:2,interrupted:true,completed:false},
  ]}));
  const eventFor=key=>{const event=new Event('storage');Object.defineProperty(event,'key',{value:key});return event;};
  window.dispatchEvent(eventFor('ec.account.friend1:ec.round-outcomes.v1'));
  assert.deepEqual(caps,[]);
  window.dispatchEvent(eventFor('ec.account.owner:ec.round-outcomes.v1'));
  assert.deepEqual(caps,[3]);
  unsubscribe();
});
