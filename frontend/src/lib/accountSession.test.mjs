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
