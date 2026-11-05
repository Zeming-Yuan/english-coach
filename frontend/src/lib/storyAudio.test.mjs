import {test} from "node:test";
import assert from "node:assert/strict";
import {storyAudioSegments} from "./storyAudio.js";

test("story audio normalizes book punctuation for the existing TTS API", () => {
  assert.deepEqual(storyAudioSegments('“Are you looking for a story?” he asked. Lily’s book — a café tale.'), [
    "Are you looking for a story?", "he asked.", "Lily's book - a cafe tale.",
  ]);
});

test("long prose fits the existing 200-character speech limit without dropping words", () => {
  const text = Array(75).fill("bookshop").join(" ") + ".";
  const segments = storyAudioSegments(text);
  assert.ok(segments.length > 1);
  assert.ok(segments.every(segment => segment.length <= 200));
  assert.equal(segments.join(" "), text);
});

test("empty or unsupported-only prose does not request audio", () => {
  assert.deepEqual(storyAudioSegments("\n 中文\n"), []);
});

test("punctuation separates spoken words instead of merging them", () => {
  assert.deepEqual(storyAudioSegments("tea/coffee left;then"), ["tea coffee left then"]);
  const segments = storyAudioSegments(("tea/coffee left;then ").repeat(30));
  assert.ok(segments.every(segment => segment.length <= 200 && /^[\x00-\x7F]+$/.test(segment)));
  assert.equal(segments.join(" "), ("tea coffee left then ").repeat(30).trim());
});

test("unsupported separators preserve word boundaries without splitting accented words", () => {
  assert.deepEqual(storyAudioSegments("red&blue tea(coffee) a naïve café."), ["red blue tea coffee a naive cafe."]);
});

test('spoken text preserves letters that Unicode decomposition does not expand',()=>{
  assert.deepEqual(storyAudioSegments('Straße and smørrebrød.'),['Strasse and smorrebrod.']);
});
