import test from "node:test";
import assert from "node:assert/strict";
import {parseAddWords} from "./addWords.js";

test("manual input keeps a phrase whole or splits batch separators", () => {
  assert.deepEqual(parseAddWords(" apple  juice ", "phrase"), ["apple  juice"]);
  assert.deepEqual(parseAddWords("apple juice", "batch"), ["apple", "juice"]);
  assert.deepEqual(parseAddWords(" Apple, apple，JUICE\njuice ", "batch"), ["Apple", "JUICE"]);
  assert.deepEqual(parseAddWords("   ", "phrase"), []);
});

test("pasted English ligatures share the same preview identity as plain spelling", () => {
  assert.deepEqual(parseAddWords("ﬂower flower OFFICE oﬃce", "batch"), ["ﬂower", "OFFICE"]);
  assert.deepEqual(parseAddWords("STRAẞE strasse ı I", "batch"), ["STRAẞE", "ı", "I"]);
});
