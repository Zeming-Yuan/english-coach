/**
 * 音效（Web Audio API，零延迟）。
 */

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, startTime, type = "sine") {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function sfxSuccess() {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  playTone(523, 0.12, now); // C5
  playTone(659, 0.15, now + 0.1); // E5
  playTone(784, 0.2, now + 0.18); // G5
}

export function sfxFail() {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  playTone(330, 0.15, now, "triangle"); // E4
  playTone(262, 0.25, now + 0.12, "triangle"); // C4
}
