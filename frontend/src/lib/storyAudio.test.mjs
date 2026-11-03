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
