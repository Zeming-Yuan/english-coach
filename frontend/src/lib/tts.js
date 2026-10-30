/**
 * TTS 朗读（本地语音优先，在线兜底 + 设置页速度）。
 * 复用原 app.js TTS 逻辑。
 */

let ttsVoice = null;
let hasEnVoice = false;
const audioCache = new Map();

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
    if (btn) btn.classList.add("speaking");
    speakOnline(word, done, () => speakLocal(word, done));
  });
}

function speakOnline(word, done, fallback) {
  let audio = audioCache.get(word);
  if (!audio) {
    audio = new Audio(`/api/tts/audio/${encodeURIComponent(word)}`);
    audioCache.set(word, audio);
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    done("online");
  };
  const failed = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safetyTimeout);
    fallback();
  };
  // 安全超时：Chrome 短文本可能不触发 onended
  const safetyTimeout = setTimeout(finish, Math.max(word.length * 150, 3000));
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
