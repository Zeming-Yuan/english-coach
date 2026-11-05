import test from "node:test";
import assert from "node:assert/strict";

test("normal online playback outlives the startup watchdog until ended", async (t) => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  const audios = [];
  globalThis.window = {};
  globalThis.Audio = class {
    constructor() {this.currentTime = 0; this.ended = false; audios.push(this);}
    play() {return Promise.resolve();}
    pause() {}
    removeAttribute() {}
    load() {}
  };
  try {
    const {speak} = await import("./tts.js?online-watchdog");
    let result;
    const speaking = speak("hello").then(value => {result = value; return value;});
    await Promise.resolve();
    audios[0].currentTime = 3;
    t.mock.timers.tick(3001);
    await Promise.resolve();
    assert.equal(result, undefined);
    audios[0].ended = true;
    audios[0].onended();
    assert.equal(await speaking, "online");
  } finally {delete globalThis.Audio; delete globalThis.window;}
});

test("started local speech waits for its end instead of a text-length deadline", async (t) => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  let utterance;
  const speech = {getVoices: () => [{lang: "en-US", localService: true}], cancel() {}, speak(value) {utterance = value; value.onstart();}};
  globalThis.window = {speechSynthesis: speech};
  globalThis.speechSynthesis = speech;
  globalThis.SpeechSynthesisUtterance = class {};
  globalThis.Audio = class {
    constructor() {this.currentTime = 0;}
    play() {return Promise.reject(new Error("offline"));}
    pause() {}
    removeAttribute() {}
    load() {}
  };
  try {
    const {speak, setTtsRate} = await import("./tts.js?local-watchdog");
    setTtsRate(0.7);
    let result;
    const speaking = speak("hello").then(value => {result = value; return value;});
    await Promise.resolve(); await Promise.resolve();
    assert.ok(utterance);
    t.mock.timers.tick(5000);
    await Promise.resolve();
    assert.equal(result, undefined);
    utterance.onend();
    assert.equal(await speaking, "local");
  } finally {
    delete globalThis.Audio; delete globalThis.window;
    delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance;
  }
});

test("stalled online audio still settles instead of hanging the learning UI", async (t) => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  globalThis.window = {};
  globalThis.Audio = class {
    constructor() {this.currentTime = 0; this.ended = false;}
    play() {return Promise.resolve();}
    pause() {}
    removeAttribute() {}
    load() {}
  };
  try {
    const {speak} = await import("./tts.js?stalled-watchdog");
    const speaking = speak("hello");
    await Promise.resolve();
    t.mock.timers.tick(3001);
    assert.equal(await speaking, "none");
  } finally {delete globalThis.Audio; delete globalThis.window;}
});
