import test from "node:test";
import assert from "node:assert/strict";
import {sfxSuccess, sfxFail} from "./sfx.js";

test("unavailable audio never interrupts an answer's success or failure path", () => {
  globalThis.window = {AudioContext: class {constructor() {throw new Error("no device");}}};
  try {
    assert.doesNotThrow(() => sfxSuccess());
    assert.doesNotThrow(() => sfxFail());
  } finally {delete globalThis.window;}
});
