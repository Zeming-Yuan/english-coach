/**
 * TTS 朗读（本地语音优先，在线兜底 + 设置页速度）。
 * 复用原 app.js TTS 逻辑。
 */

let ttsVoice = null;
let hasEnVoice = false;
const audioCache = new Map();
const failedAudio = new Set();
const activeAudio = new WeakMap();

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

/**
 * 朗读（TTS 在线 + 本地兜底）。
 * @param {string} word
 * @param {HTMLElement|null} btn - 发音时加 .speaking 样式
 * @returns {Promise<"online"|"local"|"none">} 实际使用的发音来源；调用方可提示降级
 */
export function speak(word, btn = null) {
  if (!word) return Promise.resolve("none");
  if (hasSpeech) speechSynthesis.cancel();

  return new Promise((resolve) => {
    let settled = false;
    const done = (mode) => {
      if (settled) return;
      settled = true;
      if (btn) btn.classList.remove("speaking");
      resolve(mode);
    };
    speakOnline(word, done, () => speakLocal(word, done));
    if (btn && !settled) btn.classList.add("speaking");
  });
}

function speakOnline(word, done, fallback) {
  let audio = audioCache.get(word);
  if (!audio) {
    // Browsers can retain a failed 200/empty media resource beyond the Audio
    // object. A retry gets a fresh resource URL; the server word cache remains.
    const retry = failedAudio.has(word) ? `?retry=${crypto.randomUUID()}` : "";
    audio = new Audio(`/api/tts/audio/${encodeURIComponent(word)}${retry}`);
    audioCache.set(word, audio);
  }
  // Replaying a cached element retires its previous caller first. Settling
  // that caller must neither mutate this new playback nor start a late voice.
  activeAudio.get(audio)?.();
  let finished = false;
  const cancel = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    if (activeAudio.get(audio) === cancel) activeAudio.delete(audio);
    done("none");
  };
  activeAudio.set(audio, cancel);
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    failedAudio.delete(word);
    if (activeAudio.get(audio) === cancel) activeAudio.delete(audio);
    done("online");
  };
  const failed = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    if (activeAudio.get(audio) === cancel) activeAudio.delete(audio);
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
  // A timeout is not evidence that audio played. Only a real ended state
  // may confirm online completion; stalled/failed streams use the fallback.
  const safetyTimeout = setTimeout(() => {
    if (audio.ended) finish();
    else failed();
  }, Math.max(word.length * 150, 3000));
  audio.onended = finish;
  audio.onerror = failed;
  audio.currentTime = 0;
  audio.play().catch(failed);
}

function speakLocal(word, done) {
  if (!hasSpeech || !hasEnVoice || typeof SpeechSynthesisUtterance === "undefined") {
    done("none");
    return;
  }
  const u = new SpeechSynthesisUtterance(word);
  let finished = false;
  const finish = (mode) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done(mode);
  };
  // 无音频设备时浏览器可能既不触发 onend 也不触发 onerror。
  const timer = setTimeout(() => finish("none"), Math.max(word.length * 150, 1500));
  u.lang = "en-US";
  u.rate = _ttsRate;
  if (ttsVoice) u.voice = ttsVoice;
  u.onend = () => finish("local");
  u.onerror = () => finish("none");
  speechSynthesis.speak(u);
}

/**
 * 预合成暖缓存（列表加载时调用）。
 */
export function prewarmTts(words) {
  words.slice(0, 50).forEach((w) => {
    fetch(`/api/tts/audio/${encodeURIComponent(w)}/preload`).catch(() => {});
  });
}
