import test from "node:test";
import assert from "node:assert/strict";
import {highlightWord, hasLessonLevelPrefix, formatLessonTitle} from "./utils.js";

test("highlighting matches words without corrupting escaped markup or entities", () => {
  assert.equal(highlightWord("red & blue amp <lt>", "amp"), "red &amp; blue <mark>amp</mark> &lt;lt&gt;");
  assert.equal(highlightWord("red & blue amp <lt>", "lt"), "red &amp; blue amp &lt;<mark>lt</mark>&gt;");
  assert.equal(highlightWord('<img onerror="alert(1)">', "img"), '&lt;<mark>img</mark> onerror=&quot;alert(1)&quot;&gt;');
});

test("formatLessonTitle deduplicates level prefixes while keeping distinct subtitles", () => {
  assert.equal(hasLessonLevelPrefix(1, "第 1 课"), true);
  assert.equal(hasLessonLevelPrefix(1, "第1课：问候"), true);
  assert.equal(hasLessonLevelPrefix(1, "I'm & Don't"), false);
  assert.equal(formatLessonTitle(1, ""), "第 1 课");
  assert.equal(formatLessonTitle(1, "第 1 课"), "第 1 课");
  assert.equal(formatLessonTitle(1, "第1课：问候"), "第1课：问候");
  assert.equal(formatLessonTitle(1, "对话课"), "第 1 课 · 对话课");
});
