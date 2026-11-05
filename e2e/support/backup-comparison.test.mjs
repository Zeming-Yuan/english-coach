import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizedBackup} from './backup-comparison.mjs';

const backup = () => ({version: 3, cards: [{id: 1, kind: 'word', word: 'apple'}], lessons: [], stories: [], learning_events: [], reviews: [], review_baselines: [], memos: [], errors: [], hard_cards: [], story_words: [], extensions: {learning_contacts: []}});

test('backup comparison rejects invalid collection and row shapes with a path', () => {
  for (const [path, edit] of [
    ['cards', b => b.cards = {}],
    ['cards', b => b.cards = [null]],
    ['extensions', b => b.extensions = []],
    ['learning_contacts', b => b.extensions.learning_contacts = {}],
    ['learning_events', b => delete b.learning_events],
  ]) {
    const b = backup(); edit(b);
    assert.throws(() => normalizedBackup(b), new RegExp(`Invalid backup.*${path}`));
  }
});

test('backup comparison refuses dangling live references instead of erasing them', () => {
  for (const reference of [{card_id: 99}, {resource_kind: 'card', resource_id: 99}, {resource_kind: 'unknown', resource_id: 1}]) {
    const b = backup(); b.extensions.learning_contacts.push(reference);
    assert.throws(() => normalizedBackup(b), /Invalid backup.*reference/);
  }
});

test('backup comparison handles large collections without losing order or audit data', () => {
  const b = backup();
  b.learning_events = Array.from({length: 160000}, (_, i) => ({id: `event-${i}`, card_id: 1, answer: String(i), fingerprint: 'remapped'}));
  b.review_baselines = [{id: 'baseline', card_id: 1, raw: {card_id: 999}}];
  const result = normalizedBackup(b);
  assert.equal(result.learning_events.length, 160000);
  assert.equal(result.learning_events[159999].answer, '159999');
  assert.deepEqual(result.review_baselines[0].raw, {card_id: 999});
  assert.equal(b.learning_events[0].fingerprint, 'remapped');
});

test('backup comparison rejects ambiguous parent IDs', () => {
  const b = backup(); b.cards.push({id: 1, kind: 'word', word: 'banana'});
  assert.throws(() => normalizedBackup(b), /Invalid backup.*cards.*id/);
});

test('valid v3 feature names and remapped references compare equally', () => {
  const a = backup();
  a.features = ['learning_contacts'];
  a.extensions.learning_contacts = [{id:'contact',card_id:1,resource_kind:'card',resource_id:1}];
  const b = structuredClone(a);
  b.cards[0].id = 88;
  b.extensions.learning_contacts[0].card_id = 88;
  b.extensions.learning_contacts[0].resource_id = 88;
  assert.deepEqual(normalizedBackup(a), normalizedBackup(b));
});

test('backup comparison validates every core collection, including those with no references', () => {
  for (const collection of ['reviews','review_baselines','memos','errors','hard_cards','story_words']) {
    for (const value of [{},[null]]) {
      const b = backup(); b[collection] = value;
      assert.throws(() => normalizedBackup(b), new RegExp(`Invalid backup.*${collection}`));
    }
  }
});
