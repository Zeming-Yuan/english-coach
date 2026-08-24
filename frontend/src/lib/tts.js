/**
 * TTS 朗读（本地语音优先，在线兜底 + 设置页速度）。
 * 复用原 app.js TTS 逻辑。
 */

let ttsVoice = null;
let hasEnVoice = false;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  ttsVoice =
    voices.find((v) => v.lang === "en-US" && v.localService) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null;
  hasEnVoice = voices.some((v) => v.lang.startsWith("en"));
}

if ("speechSynthesis" in window) {
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
 */
export function speak(word, btn = null) {
  if (!word) return;
  speechSynthesis.cancel();

  // 1. 在线音频
  const done = () => btn && btn.classList.remove("speaking");
  const fallback = () => speakLocal(word, done);
  if (btn) btn.classList.add("speaking");

  speakOnline(word, done, fallback);
}

function speakOnline(word, done, fallback) {
  const audio = new Audio(`/api/tts/audio/${encodeURIComponent(word)}`);
  audio.onended = done;
  audio.onerror = () => {
    done();
    fallback();
  };
  audio.play().catch(() => {
    done();
    fallback();
  });
}

function speakLocal(word, done) {
  if (!hasEnVoice) {
    done();
    return;
  }
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  u.rate = _ttsRate;
  if (ttsVoice) u.voice = ttsVoice;
  u.onend = done;
  u.onerror = done;
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
