import test from "node:test";
import assert from "node:assert/strict";
import {highlightWord} from "./utils.js";

test("highlighting matches words without corrupting escaped markup or entities", () => {
  assert.equal(highlightWord("red & blue amp <lt>", "amp"), "red &amp; blue <mark>amp</mark> &lt;lt&gt;");
  assert.equal(highlightWord("red & blue amp <lt>", "lt"), "red &amp; blue amp &lt;<mark>lt</mark>&gt;");
  assert.equal(highlightWord('<img onerror="alert(1)">', "img"), '&lt;<mark>img</mark> onerror=&quot;alert(1)&quot;&gt;');
});
