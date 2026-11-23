import assert from "node:assert/strict";
import test from "node:test";
import {spellingDifference, spellingDiffParts} from "./spellingFeedback.js";

test("spelling feedback keeps a matching suffix aligned across missing and extra letters", () => {
  assert.equal(spellingDifference("dig", "dog"), "第 2 个字母：i → o");
  assert.equal(spellingDifference("dg", "dog"), "第 2 处缺少：o");
  assert.equal(spellingDifference("dogs", "dog"), "第 4 处多写：s");
  assert.equal(spellingDifference("DOG", "dog"), "");
  assert.equal(spellingDifference("apple juce", "apple juice"), "第 9 处缺少：i");
});

test("spellingDiffParts splits prefix, changed span, and suffix cleanly", () => {
  assert.deepEqual(spellingDiffParts("dig", "dog"), {
    equal: false,
    start: 1,
    typed: { prefix: "d", changed: "i", suffix: "g" },
    expected: { prefix: "d", changed: "o", suffix: "g" },
  });
  assert.deepEqual(spellingDiffParts("baa", "banana"), {
    equal: false,
    start: 2,
    typed: { prefix: "ba", changed: "", suffix: "a" },
    expected: { prefix: "ba", changed: "nan", suffix: "a" },
  });
  assert.deepEqual(spellingDiffParts("dogs", "dog"), {
    equal: false,
    start: 3,
    typed: { prefix: "dog", changed: "s", suffix: "" },
    expected: { prefix: "dog", changed: "", suffix: "" },
  });
  assert.deepEqual(spellingDiffParts("DOG", "dog"), {
    equal: true,
    start: 3,
    typed: { prefix: "DOG", changed: "", suffix: "" },
    expected: { prefix: "DOG", changed: "", suffix: "" },
  });
});
