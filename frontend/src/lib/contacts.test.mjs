import test from "node:test";
import assert from "node:assert/strict";
import {beginVisibleContactLookup, retryVisibleContactLookup, clearVisibleContactLookups, pendingVisibleContactLookups} from "./contacts.js";

const cards = [1, 2].map(id => ({id, kind: "word", word: id === 1 ? "apple" : "pear", content_revision: {identity: `card-${id}`, version: 1}}));
function storage() {
  const rows = new Map();
  globalThis.localStorage = {
    get length() {return rows.size;}, key(index) {return [...rows.keys()][index];},
    getItem(key) {return rows.get(key) ?? null;}, setItem(key, value) {rows.set(key, value);}, removeItem(key) {rows.delete(key);},
  };
}
const response = (data, ok = true) => ({ok, status: ok ? 200 : 503, statusText: "Unavailable", text: async () => JSON.stringify(data), json: async () => data});

test("one feedback lookup coalesces overlapping confirmation requests", async () => {
  storage();
  const originalFetch = globalThis.fetch;
  const posts = [];
  let release;
  const barrier = new Promise(resolve => {release = resolve;});
  let gets = 0;
  globalThis.fetch = async (path, options) => {
    if (path === "/api/cards") {if (++gets === 1) await barrier; return response({cards: cards.slice(0, 1)});}
    posts.push(JSON.parse(options.body)); return response({committed: true});
  };
  try {
    beginVisibleContactLookup("overlap", {source: "scene", text: "apple"});
    const first = retryVisibleContactLookup("lookup:overlap");
    const second = retryVisibleContactLookup("lookup:overlap");
    release();
    await Promise.all([first, second]);
    assert.equal(posts.length, 1);
    assert.equal(gets, 1);
  } finally {clearVisibleContactLookups(); globalThis.fetch = originalFetch;}
});

test("partial feedback retry keeps confirmed targets and original submission identities", async () => {
  storage();
  const nativeSet = localStorage.setItem;
  let denied = true;
  localStorage.setItem = (key, value) => {
    if (denied && key === "ec.contact.scene:answer_visible:2") throw new Error("quota");
    nativeSet(key, value);
  };
  const originalFetch = globalThis.fetch;
  const posts = [];
  let pearFailed = false;
  globalThis.fetch = async (path, options) => {
    if (path === "/api/cards") return response({cards});
    const body = JSON.parse(options.body); posts.push(body);
    if (body.card_id === 2 && !pearFailed) {pearFailed = true; return response({detail: "offline"}, false);}
    return response({committed: true});
  };
  try {
    beginVisibleContactLookup("partial", {source: "scene", text: "apple pear"});
    await assert.rejects(retryVisibleContactLookup("lookup:partial"));
    denied = false;
    await retryVisibleContactLookup("lookup:partial");
    assert.equal(posts.filter(row => row.card_id === 1).length, 1);
    const pear = posts.filter(row => row.card_id === 2);
    assert.equal(pear.length, 2);
    assert.equal(pear[0].submission_id, pear[1].submission_id);
    assert.equal(pendingVisibleContactLookups().length, 0);
  } finally {clearVisibleContactLookups(); globalThis.fetch = originalFetch;}
});

test("a rejected outdated feedback target settles without inventing contact", async () => {
  storage();
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (path) => {
    if (path === "/api/cards") return response({cards: cards.slice(0, 1)});
    posts++;
    return {ok: false, status: 409, statusText: "Conflict", json: async () => ({detail: "content changed"})};
  };
  try {
    beginVisibleContactLookup("terminal", {source: "scene", text: "apple"});
    const result = await retryVisibleContactLookup("lookup:terminal");
    assert.equal(result.failed.length, 0);
    assert.equal(result.unrecorded.length, 1);
    assert.equal(pendingVisibleContactLookups().length, 0);
    assert.equal(posts, 1);
  } finally {clearVisibleContactLookups(); globalThis.fetch = originalFetch;}
});

test("a newly visible revision replaces a failed contact for older content", async () => {
  storage();
  const {recordContact} = await import('./contacts.js');
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(options.body); posts.push(body);
    return body.revision.version === 1 ? response({detail:'offline'}, false) : response({committed:true});
  };
  const target = {cardId:101, revision:{identity:'revision-card',version:1},source:'word_detail',kind:'answer_visible'};
  try {
    await assert.rejects(recordContact(target));
    await recordContact({...target, revision:{...target.revision,version:2}});
    assert.equal(posts[1].revision.version, 2);
    assert.notEqual(posts[0].submission_id, posts[1].submission_id);
  } finally {globalThis.fetch = originalFetch;}
});

test("pending contact ids use one scope and clear storage-denied markers after success", async () => {
  storage();
  const {recordContact,pendingContactIds} = await import('./contacts.js');
  const originalFetch = globalThis.fetch;
  const nativeSet = localStorage.setItem;
  localStorage.setItem = (key,value) => {if(key.endsWith(':102')) throw Error('quota'); nativeSet(key,value);};
  globalThis.fetch = async () => response({detail:'offline'}, false);
  const target = {cardId:102, revision:{identity:'card-102',version:1},source:'word_detail',kind:'answer_visible'};
  try {
    await assert.rejects(recordContact(target));
    assert.deepEqual(pendingContactIds(), ['word_detail:answer_visible:102']);
    localStorage.setItem = nativeSet;
    globalThis.fetch = async () => response({committed:true});
    await recordContact(target);
    assert.deepEqual(pendingContactIds(), []);
    globalThis.fetch = async () => response({detail:'offline'},false);
    await assert.rejects(recordContact({...target,cardId:103}));
    assert.deepEqual(pendingContactIds(), ['word_detail:answer_visible:103']);
  } finally {globalThis.fetch = originalFetch;}
});

test('fresh feedback lookup does not reuse an older revision contact',async()=>{
  storage();
  const {recordContact}=await import('./contacts.js');
  const originalFetch=globalThis.fetch;
  const posts=[];
  globalThis.fetch=async(path,options)=>{
    if(path==='/api/cards') return response({cards:[{id:104,kind:'word',word:'apple',content_revision:{identity:'lookup-card',version:2}}]});
    const body=JSON.parse(options.body);posts.push(body);
    return body.revision.version===1?response({detail:'offline'},false):response({committed:true});
  };
  try{
    await assert.rejects(recordContact({cardId:104,revision:{identity:'lookup-card',version:1},source:'scene',kind:'answer_visible'}));
    beginVisibleContactLookup('new-revision-feedback',{source:'scene',text:'apple'});
    await retryVisibleContactLookup('lookup:new-revision-feedback');
    assert.equal(posts[1].revision.version,2);
  }finally{clearVisibleContactLookups();globalThis.fetch=originalFetch;}
});
