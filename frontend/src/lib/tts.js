import { accountFetch } from "./accountSession.js";
import {randomUUID} from "./utils.js";
/**
 * TTS 朗读（本地语音优先，在线兜底 + 设置页速度）。
 * 复用原 app.js TTS 逻辑。
 */

let ttsVoice = null;
let hasEnVoice = false;
const audioCache = new Map();
const failedAudio = new Set();

// 同一时刻只允许一个在线音频；新朗读先停掉上一段，避免两句交叉。
let currentAudio = null;
let cancelCurrentAudio = null;

function stopOnlineAudio() {
  const cancel = cancelCurrentAudio;
  const audio = currentAudio;
  cancelCurrentAudio = null;
  currentAudio = null;
  if (cancel) cancel();
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

// 本地语音同样只保留一段；被新朗读打断时返回 canceled。
let cancelLocalSpeech = null;

function stopLocalAudio() {
  const cancel = cancelLocalSpeech;
  cancelLocalSpeech = null;
  if (cancel) cancel();
}

const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;

function pickVoice() {
  if (!hasSpeech) {
    ttsVoice = null;
    hasEnVoice = false;
    return;
  }
  const voices = speechSynthesis.getVoices();
  ttsVoice =
    voices.find((v) => v.lang === "en-US" && v.localService) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null;
  hasEnVoice = voices.some((v) => v.lang.startsWith("en"));
}

if (hasSpeech) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

// 发音速度（设置页可调）
let _ttsRate = 0.9;
export function setTtsRate(rate) {
  _ttsRate = rate;
}

function notifyStarted(onStarted) {
  if (!onStarted) return;
  try {
    onStarted();
  } catch {
    // 接触回调失败不能打断朗读本身。
  }
}

/**
 * 朗读（TTS 在线 + 本地兜底）。
 * @param {string} word
 * @param {HTMLElement|null} btn - 发音时加 .speaking 样式
 * @param {Function|null} onStarted - 实际开始播放时回调；预热、下载与失败不回调
 * @returns {Promise<"online"|"local"|"none"|"canceled">} 实际使用的发音来源；
 *   canceled 表示被新的朗读打断，调用方不应提示失败
 */
export function speak(word, btn = null, onStarted = null) {
  if (!word) return Promise.resolve("none");
  stopOnlineAudio();
  stopLocalAudio();
  if (hasSpeech) speechSynthesis.cancel();

  return new Promise((resolve) => {
    let settled = false;
    const done = (mode) => {
      if (settled) return;
      settled = true;
      if (btn) btn.classList.remove("speaking");
      resolve(mode);
    };
    speakOnline(word, done, () => speakLocal(word, done, onStarted), onStarted);
    if (btn && !settled) btn.classList.add("speaking");
  });
}

function speakOnline(word, done, fallback, onStarted) {
  let audio = audioCache.get(word);
  if (!audio) {
    // Browsers can retain a failed 200/empty media resource beyond the Audio
    // object. A retry gets a fresh resource URL; the server word cache remains.
    const retry = failedAudio.has(word) ? `?retry=${randomUUID()}` : "";
    audio = new Audio(`/api/tts/audio/${encodeURIComponent(word)}${retry}`);
    audioCache.set(word, audio);
  }
  let finished = false;
  // 只有当前播放能清空全局指针，避免旧回调误停新音频。
  const release = () => {
    if (currentAudio === audio) {
      currentAudio = null;
      cancelCurrentAudio = null;
    }
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    release();
    done("canceled");
  };
  currentAudio = audio;
  cancelCurrentAudio = cancel;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    failedAudio.delete(word);
    release();
    done("online");
  };
  const failed = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    release();
    failedAudio.add(word);
    if (audioCache.get(word) === audio) audioCache.delete(word);
    // Stop the failed request so it cannot start speaking after the fallback.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    fallback();
  };
  // The watchdog measures lack of progress, not the total speaking duration.
  // Slow speech and long sentences can legitimately outlive one interval.
  const timeoutMs = Math.max(word.length * 150, 3000);
  let lastPosition = 0;
  const checkProgress = () => {
    if (audio.ended) finish();
    else if (audio.currentTime > lastPosition) {
      lastPosition = audio.currentTime;
      safetyTimeout = setTimeout(checkProgress, timeoutMs);
    } else failed();
  };
  let safetyTimeout = setTimeout(checkProgress, timeoutMs);
  audio.onended = finish;
  audio.onerror = failed;
  audio.currentTime = 0;
  let started = false;
  const begin = () => {
    if (finished || started) return;
    started = true;
    notifyStarted(onStarted);
  };
  audio.play().then(begin).catch(failed);
}

function speakLocal(word, done, onStarted) {
  if (!hasSpeech || !hasEnVoice || typeof SpeechSynthesisUtterance === "undefined") {
    done("none");
    return;
  }
  const u = new SpeechSynthesisUtterance(word);
  let finished = false;
  const release = () => {
    if (cancelLocalSpeech === cancel) cancelLocalSpeech = null;
  };
  const finish = (mode) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    release();
    done(mode);
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    release();
    done("canceled");
  };
  cancelLocalSpeech = cancel;
  const fail = () => {
    finish("none");
    speechSynthesis.cancel();
  };
  // Some voices report boundaries sparsely. Allow the whole text at the
  // selected rate between progress events; an advancing voice renews the lease.
  const stallMs = Math.max(15000, word.length * 400 / _ttsRate);
  let timer = setTimeout(fail, Math.max(word.length * 150, 1500));
  const watchProgress = () => {
    clearTimeout(timer);
    timer = setTimeout(fail, stallMs);
  };
  let lastBoundary = -1;
  u.lang = "en-US";
  u.rate = _ttsRate;
  if (ttsVoice) u.voice = ttsVoice;
  u.onstart = () => {
    if (!finished) {
      watchProgress();
      notifyStarted(onStarted);
    }
  };
  u.onboundary = (event) => {
    if (!finished && event.charIndex > lastBoundary) {
      lastBoundary = event.charIndex;
      watchProgress();
    }
  };
  u.onend = () => finish("local");
  u.onerror = () => finish("none");
  speechSynthesis.speak(u);
}

/**
 * 预合成暖缓存（列表加载时调用）。
 */
const prewarmQueue = [];
const warmingWords = new Set();
let prewarming = 0;

function drainPrewarm() {
  // Keep same-origin connections available for reading and saving learning.
  while (prewarming < 2 && prewarmQueue.length) {
    const word = prewarmQueue.shift();
    prewarming += 1;
    accountFetch(`/api/tts/audio/${encodeURIComponent(word)}/preload`)
      .catch(() => {})
      .finally(() => {
        warmingWords.delete(word);
        prewarming -= 1;
        drainPrewarm();
      });
  }
}

export function prewarmTts(words) {
  for (const word of words.slice(0, 50)) {
    if (warmingWords.has(word)) continue;
    warmingWords.add(word);
    prewarmQueue.push(word);
  }
  drainPrewarm();
}
