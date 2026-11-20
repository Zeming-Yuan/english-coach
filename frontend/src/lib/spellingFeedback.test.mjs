import assert from "node:assert/strict";
import test from "node:test";
import {spellingDifference} from "./spellingFeedback.js";

test("spelling feedback keeps a matching suffix aligned across missing and extra letters", () => {
  assert.equal(spellingDifference("dig", "dog"), "第 2 个字母：i → o");
  assert.equal(spellingDifference("dg", "dog"), "第 2 处缺少：o");
  assert.equal(spellingDifference("dogs", "dog"), "第 4 处多写：s");
  assert.equal(spellingDifference("DOG", "dog"), "");
  assert.equal(spellingDifference("apple juce", "apple juice"), "第 9 处缺少：i");
});
