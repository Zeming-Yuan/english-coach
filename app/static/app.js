/* EnglishCoach 前端逻辑：队列 → 学习 → 测验 → 结果 + 单词本/加词/故事 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ============ 状态 ============ */
const state = {
  queue: [],
  idx: 0,
  flipped: false,
  answered: 0,
  graduated: [],
  questions: [],
  qIdx: 0,
  answers: [],
  currentNav: "queue",
};

/* ============ API ============ */
async function api(path, opts = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try { detail = (await resp.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return resp.json();
}

/* ============ 音效（Web Audio API，零延迟） ============ */
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

function sfxSuccess() {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  playTone(523, 0.12, now);        // C5
  playTone(659, 0.15, now + 0.1);  // E5
  playTone(784, 0.2, now + 0.18);  // G5
}

function sfxFail() {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  playTone(330, 0.15, now, "triangle");        // E4
  playTone(262, 0.25, now + 0.12, "triangle"); // C4
}

/* ============ TTS 朗读（本地语音优先，在线兜底） ============ */
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

function speak(text, btn) {
  // 先cancel掉可能残留的本地语音（不然旧声音继续播，和新音频重叠）
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  // 默认走在线标准音频（Dictionary API，发音正确统一）；
  // 无网络/无音频时才 fallback 到 speechSynthesis（可能中文音，但总比没声强）
  speakOnline(text, btn, () => speakLocal(text, btn));
}

/* 本地兜底：Web Speech API（断网时才用，发音可能不准） */
function speakLocal(text, btn) {
  if (!("speechSynthesis" in window) || !hasEnVoice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  if (ttsVoice) u.voice = ttsVoice;
  u.onstart = () => btn && btn.classList.add("speaking");
  u.onend = () => btn && btn.classList.remove("speaking");
  u.onerror = () => btn && btn.classList.remove("speaking");
  speechSynthesis.speak(u);
}

/* 在线兜底：走同源 /api/tts/{word}（后端代理 Dictionary API），
   audio 元素加载跨域音频不受 CORS 限制 */
/* 在线兜底：后端代理同源音频字节流（/api/tts/audio/{word}），
   不直连外部 mp3，规避代理/CORS/网络策略问题 */
function speakOnline(text, btn, fallback) {
  const word = text.trim().toLowerCase();
  btn && btn.classList.add("speaking");
  const done = () => btn && btn.classList.remove("speaking");
  const fail = () => { done(); console.log("[tts] 音频播放失败，兜底本地", word); fallback && fallback(); };
  console.log("[tts] 播放在线音频", `/api/tts/audio/${encodeURIComponent(word)}`);
  const audio = new Audio(`/api/tts/audio/${encodeURIComponent(word)}`);
  audio.onended = done;
  audio.onerror = fail;
  audio.play().catch(fail);
}

/* 预合成：列表加载时提前暖缓存，点击按钮即秒播（限前 50 防并发爆炸） */
function prewarmTts(words) {
  words.slice(0, 50).forEach((w) => {
    fetch(`/api/tts/audio/${encodeURIComponent(w)}/preload`).catch(() => {});
  });
}

/* ============ 视图切换 ============ */
function show(viewId) {
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.id !== viewId;
  }
  const inFlow = viewId === "view-study" || viewId === "view-quiz";
  $("#topbar-progress").hidden = !inFlow;

  // 底部导航高亮（隐藏学习/测验/结果/故事阅读时的入口状态）
  const navTabs = {
    "view-queue": "queue",
    "view-words": "words",
    "view-stories": "stories",
    "view-add": "add",
  };
  if (navTabs[viewId]) {
    setNav(navTabs[viewId]);
  }
  // 学习/测验/结果/故事阅读时导航置灰（显示但不可点，防止误退）
  $("#bottom-nav").classList.toggle("nav-locked", !navTabs[viewId] && viewId !== "view-study");
}

function setNav(nav) {
  state.currentNav = nav;
  $$(".nav-item").forEach((el) => {
    el.classList.toggle("nav-active", el.dataset.nav === nav);
  });
}

/* ============ 队列页 ============ */
async function loadToday() {
  const data = await api("/api/today");
  state.lastToday = data; // 供目标环计算
  $("#stat-new").textContent = data.new_cards.length;
  $("#stat-due").textContent = data.due_cards.length;

  // 错词入口（错误增强效应：优先重现）
  const errorCount = (data.error_cards || []).length;
  const errorEntry = $("#error-entry");
  if (errorCount > 0) {
    errorEntry.hidden = false;
    $("#error-entry-count").textContent = errorCount;
  } else {
    errorEntry.hidden = true;
  }

  // 队列 & 引导逻辑
  const isEmpty =
    data.new_cards.length === 0 && data.due_cards.length === 0 && errorCount === 0;
  $("#welcome-box").hidden = !isEmpty;
  $("#btn-start-study").hidden = isEmpty;
  $("#btn-start-quiz").hidden = isEmpty;
  $("#btn-start-listening").hidden = isEmpty;
  $("#btn-start-spelling").hidden = isEmpty;

  // 今日统计
  try {
    const stats = await api("/api/stats");
    $("#stat-reviewed").textContent = stats.reviewed_today;
    $("#stat-total").textContent = stats.total_cards;
    const streakEl = $("#stat-streak");
    if (stats.streak > 0) {
      $("#stat-streak-num").textContent = stats.streak;
      streakEl.hidden = false;
    } else {
      streakEl.hidden = true;
    }
    // 晚间提醒：20 点后还没学 → 睡眠巩固提示
    const hour = new Date().getHours();
    const needStudy = stats.reviewed_today === 0;
    $("#evening-reminder").hidden = !(hour >= 20 && needStudy);

    // 今日目标环：目标 = 队列总量，已学 = 今日复习次数
    updateGoalRing(stats);
  } catch {}
  return data;
}

// 今日目标环（P0-2）
function updateGoalRing(stats) {
  const data = state.lastToday || {};
  const target = (data.error_cards?.length || 0) + (data.new_cards?.length || 0) + (data.due_cards?.length || 0);
  const done = stats.reviewed_today || 0;
  const ring = $("#goal-ring-wrap");
  if (target === 0) {
    ring.hidden = true;
    return;
  }
  ring.hidden = false;
  const pct = Math.min(1, done / target);
  const deg = Math.round(pct * 360);
  $("#goal-ring").style.background =
    `conic-gradient(var(--mint) ${deg}deg, #EBEDF0 ${deg}deg)`;
  $("#goal-num").textContent = done;
  $("#goal-total").textContent = `/ ${target}`;
  if (done >= target) {
    $("#goal-title").textContent = "今日目标达成 🎉";
    $("#goal-sub").textContent = "明天再见，先休息大脑";
  } else {
    $("#goal-title").textContent = pct === 0 ? "今日目标" : "继续加油";
    $("#goal-sub").textContent = `还剩 ${target - done} 张`;
  }
}

$("#btn-start-study").addEventListener("click", async () => {
  const data = await loadToday();
  // 错词优先（错误增强效应），再新词/到期卡
  state.queue = [...data.error_cards || [], ...data.new_cards, ...data.due_cards];
  state.idx = 0;
  state.answered = 0;
  state.graduated = [];
  if (state.queue.length === 0) return;
  show("view-study");
  renderCard();
});

$("#btn-start-quiz").addEventListener("click", async () => {
  try {
    await startQuiz();
  } catch (e) {
    toast("还没法测验：" + e.message);
  }
});

$("#btn-goto-add").addEventListener("click", () => show("view-add"));

/* ============ 学习页 ============ */
function renderCard() {
  const card = state.queue[state.idx];
  state.flipped = false;
  state.flipStartedAt = Date.now(); // JOL：记录正面停留起点
  $("#study-card").classList.remove("flipped", "leave-left", "leave-right", "enter");
  void $("#study-card").offsetWidth;
  $("#study-card").classList.add("enter");

  const frontMain = $("#front-main");
  const frontPhonetic = $("#front-phonetic");
  if (card.kind === "sentence") {
    frontMain.innerHTML = highlightWord(card.example || card.word, card.word);
    frontMain.classList.add("has-mark");
    frontPhonetic.textContent = card.word;
  } else {
    frontMain.textContent = card.word;
    frontMain.classList.remove("has-mark");
    frontPhonetic.textContent = card.phonetic || "";
  }

  $("#back-meaning").textContent =
    card.kind === "sentence" ? (card.example_cn || "") : (card.meaning || "");
  if (card.kind === "sentence" || !card.example) {
    $("#back-example").textContent = "";
  } else {
    $("#back-example").innerHTML = highlightWord(card.example, card.word);
  }

  const bubbles = $("#back-contexts");
  bubbles.innerHTML = "";
  if (Array.isArray(card.contexts) && card.contexts.length > 0) {
    card.contexts.forEach((ctx, i) => {
      const side = i % 2 === 0 ? "bubble-a" : "bubble-b";
      const el = document.createElement("div");
      el.className = `bubble ${side}`;
      el.innerHTML = `<div class="bubble-en">${escapeHtml(ctx.en)}</div>` +
        `<div class="bubble-cn">${escapeHtml(ctx.cn)}</div>`;
      bubbles.appendChild(el);
    });
  }

  // 记忆法区域重置（翻面时加载）
  $("#back-memo").hidden = true;
  $("#back-memo-text").textContent = "";

  updateProgress();
  $("#rating-area").hidden = true;
  $("#study-done").hidden = true;
  $("#study-card").hidden = false;
}

// 加载并展示用户记忆法（自我解释效应）
async function loadCardMemo(cardId) {
  try {
    const data = await api(`/api/memos/${cardId}`);
    const memoBox = $("#back-memo");
    if (data.content) {
      $("#back-memo-text").textContent = data.content;
      memoBox.hidden = false;
    } else {
      memoBox.hidden = true;
    }
  } catch {}
}

// 编辑记忆法
async function editCardMemo() {
  const card = state.queue[state.idx];
  const current = $("#back-memo-text").textContent || "";
  const input = prompt("怎么写这个单词记得更牢？（谐音/联想/小故事）\n直接放弃按取消：", current);
  if (input === null) return;
  const text = input.trim();
  try {
    if (text) {
      await api(`/api/memos/${card.id}`, {
        method: "PUT",
        body: JSON.stringify({ content: text }),
      });
      $("#back-memo-text").textContent = text;
      $("#back-memo").hidden = false;
      toast("记忆法已保存，下次复习会展示 🧠");
    }
  } catch (e) {
    toast("保存失败：" + e.message);
  }
}

function highlightWord(text, word) {
  if (!text) return "";
  const escaped = escapeHtml(text);
  const wordEsc = escapeHtml(word);
  const idx = escaped.toLowerCase().indexOf(wordEsc.toLowerCase());
  if (idx === -1) return escaped;
  return (
    escaped.slice(0, idx) +
    `<mark>${escaped.slice(idx, idx + wordEsc.length)}</mark>` +
    escaped.slice(idx + wordEsc.length)
  );
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateProgress() {
  const total = state.queue.length;
  $("#study-count").textContent = `${Math.min(state.idx + 1, total)} / ${total}`;
  $("#study-progress").style.width = `${(state.idx / total) * 100}%`;
  $("#topbar-count").textContent = `${state.idx + 1} / ${total}`;
  $("#topbar-fill").style.width = `${(state.idx / total) * 100}%`;
}

function flip() {
  const frontElapsed = (Date.now() - state.flipStartedAt) / 1000;
  state.flipped = !state.flipped;
  $("#study-card").classList.toggle("flipped", state.flipped);
  $("#rating-area").hidden = !state.flipped;
  // 翻到背面时自动播一次发音（单词/例句），不用手动点 🔊
  if (state.flipped) {
    const card = state.queue[state.idx];
    const text = card.kind === "sentence"
      ? (card.example || card.word)
      : card.word;
    // JOL 元认知引导：翻面太快（没自问自答）给温和提醒
    if (frontElapsed < 2) {
      toast("先自己回想一下这个词的含义，再翻面对照效果更好 ✍️");
    }
    state.flipElapsed = frontElapsed; // 供评分时校准
    speak(text, null);
    // 翻面时加载记忆法
    loadCardMemo(card.id);
  }
}

$("#study-card").addEventListener("click", flip);
$("#study-card").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flip();
  }
});

// 记忆法编辑按钮（阻止冒泡到翻面）
$("#btn-back-memo-edit").addEventListener("click", (e) => {
  e.stopPropagation();
  editCardMemo();
});

// 发音：正面单词 / 背面例句
$("#btn-speak-front").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = state.queue[state.idx];
  const text = card.kind === "sentence" ? (card.example || card.word) : card.word;
  speak(text, $("#btn-speak-front"));
});
$("#btn-speak-example").addEventListener("click", (e) => {
  e.stopPropagation();
  const card = state.queue[state.idx];
  const text = card.example || card.word;
  speak(text, $("#btn-speak-example"));
});

async function rate(rating) {
  const card = state.queue[state.idx];
  const r = $("#study-card");
  r.classList.add(rating <= 2 ? "leave-left" : "leave-right");
  try {
    const resp = await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ card_id: card.id, rating }),
    });
    if (resp.graduated) state.graduated.push(card.word);
    // JOL 校准：没自问就翻面却评"记得/太简单"→ 提醒元认知
    if (rating >= 3 && state.flipElapsed < 2) {
      toast("这个评分是你回想后的吗？下次先想出声再翻面，记忆更准");
    }
  } catch (e) {
    console.error("评分提交失败", e);
  }
  state.answered += 1;
  await new Promise((res) => setTimeout(res, 320));
  state.idx += 1;
  if (state.idx < state.queue.length) {
    renderCard();
  } else {
    finishStudy();
  }
}

$$(".btn-rating").forEach((btn) => {
  btn.addEventListener("click", () => rate(Number(btn.dataset.rating)));
});

function finishStudy() {
  $("#study-card").hidden = true;
  $("#rating-area").hidden = true;
  $("#study-done").hidden = false;
  $("#topbar-progress").hidden = true;

  const bits = [];
  if (state.graduated.length > 0) {
    bits.push(`${state.graduated.length} 个词毕业了：${state.graduated.join("、")} — 例句已变成句子卡`);
  }
  bits.push(`${state.answered} 张卡已复习，明天的队列会按你的记忆自动安排`);
  $("#done-detail").textContent = bits.join("。") + "。";
}

// 错词复习入口：仅错词进入学习流（错误增强效应）
$("#btn-error-study").addEventListener("click", async () => {
  const data = await api("/api/today");
  state.queue = data.error_cards || [];
  if (state.queue.length === 0) {
    toast("错词已经清空，太棒了 🎉");
    await loadToday();
    return;
  }
  state.idx = 0;
  state.answered = 0;
  state.graduated = [];
  show("view-study");
  renderCard();
});

// 退出学习流程
$("#btn-exit-study").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

$("#btn-to-quiz").addEventListener("click", async () => {
  try {
    await startQuiz();
  } catch (e) {
    toast("还没法测验：" + e.message);
  }
});

// 完成页：再练一轮混合
$("#btn-to-mixed").addEventListener("click", () => {
  startMixed();
});

/* ============ 测验 ============ */
// 测验格子实时反馈（复用拼写练习逻辑，但不自动提交）
function renderQuizBoxes(input, display) {
  // 从 prompt 里推断目标词长度（格子数 = 已有格子数）
  const boxes = display.querySelectorAll(".spelling-box");
  if (boxes.length === 0) return; // 还没初始化
  const targetLen = boxes.length;
  const typed = input.value.toLowerCase().slice(0, targetLen);

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    box.className = "spelling-box";
    if (i < typed.length) {
      box.textContent = typed[i];
      box.classList.add("box-pending");
      box.style.color = "var(--ink)";
    } else {
      box.textContent = "";
      box.classList.add("box-pending");
      box.style.color = "";
    }
  }
  // 截断多余字符
  if (input.value.length > targetLen) {
    input.value = input.value.slice(0, targetLen);
  }
}

async function startQuiz() {
  const data = await api("/api/quiz?limit=5");
  if (data.questions.length === 0) {
    throw new Error("题库是空的");
  }
  state.questions = data.questions;
  state.qIdx = 0;
  state.wrongList = []; // 错题记录
  show("view-quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.qIdx];
  const total = state.questions.length;
  $("#quiz-count").textContent = `第 ${state.qIdx + 1} / ${total} 题`;
  $("#topbar-count").textContent = `测验 ${state.qIdx + 1}/${total}`;
  $("#topbar-fill").style.width = `${(state.qIdx / total) * 100}%`;

  const body = $("#quiz-body");
  body.innerHTML = "";
  const card = document.createElement("div");
  card.className = "quiz-card";

  const prompt = document.createElement("div");
  prompt.className = "quiz-prompt";

  if (q.type === "cn2en") {
    prompt.textContent = `「${q.prompt}」用英语怎么说？`;
    card.appendChild(prompt);
    const display = document.createElement("div");
    display.className = "spelling-word-display";
    for (let i = 0; i < (q.word_length || 5); i++) {
      const box = document.createElement("span");
      box.className = "spelling-box box-pending";
      display.appendChild(box);
    }
    card.appendChild(display);
    const input = document.createElement("input");
    input.className = "spelling-input";
    input.placeholder = `输入英文单词（${q.word_length || "?"} 个字母）`;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => renderQuizBoxes(input, display));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("#btn-quiz-submit").click(); }
    });
    card.appendChild(input);
    body.appendChild(card);
    setTimeout(() => input.focus(), 50);
    state._pending = () => input.value.trim();
  } else if (q.type === "choice") {
    prompt.textContent = `「${q.prompt}」是哪个单词？`;
    card.appendChild(prompt);
    const opts = document.createElement("div");
    opts.className = "quiz-options";
    q.options.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "quiz-option";
      b.dataset.value = opt;
      b.textContent = opt;
      b.addEventListener("click", () => {
        opts.querySelectorAll(".quiz-option").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
      });
      // 选项发声按钮（点击只发音不选中）
      const spk = document.createElement("button");
      spk.className = "quiz-option-speak";
      spk.textContent = "🔊";
      spk.title = "听发音";
      spk.addEventListener("click", (e) => {
        e.stopPropagation();
        speak(opt, spk);
      });
      b.appendChild(spk);
      opts.appendChild(b);
    });
    card.appendChild(opts);
    body.appendChild(card);
    state._pending = () => opts.querySelector(".selected")?.textContent || "";
  } else if (q.type === "fill") {
    prompt.textContent = `填空：${q.prompt}${q.hint ? `（${q.hint}）` : ""}`;
    card.appendChild(prompt);
    const display = document.createElement("div");
    display.className = "spelling-word-display";
    for (let i = 0; i < (q.word_length || 5); i++) {
      const box = document.createElement("span");
      box.className = "spelling-box box-pending";
      display.appendChild(box);
    }
    card.appendChild(display);
    const input = document.createElement("input");
    input.className = "spelling-input";
    input.placeholder = `填缺的词（${q.word_length || "?"} 个字母）`;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => renderQuizBoxes(input, display));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("#btn-quiz-submit").click(); }
    });
    card.appendChild(input);
    body.appendChild(card);
    setTimeout(() => input.focus(), 50);
    state._pending = () => input.value.trim();
  }

  // 显示"确认"按钮
  $("#btn-quiz-submit").hidden = false;
  $("#btn-quiz-submit").textContent = "确认";
  $("#btn-quiz-submit").disabled = false;
  $("#btn-quiz-skip").hidden = false;
}

// 跳过这题：视为空答案判错
$("#btn-quiz-skip").addEventListener("click", () => {
  state._quizSkipped = true;
  $("#btn-quiz-submit").click();
});

// 确认答案 → 判对错 → 显示反馈 → 下一题/查看结果
$("#btn-quiz-submit").addEventListener("click", async () => {
  const btn = $("#btn-quiz-submit");
  if (btn.dataset.phase === "next") {
    // 已看完反馈，进入下一题
    btn.dataset.phase = "";
    state.qIdx++;
    if (state.qIdx >= state.questions.length) {
      showQuizResult();
    } else {
      renderQuestion();
    }
    return;
  }

  // 第一次点击：判对错（跳过时视为空答案判错）
  const q = state.questions[state.qIdx];
  const userInput = state._quizSkipped ? "" : state._pending();
  state._quizSkipped = false;
  btn.disabled = true;

  // 调后端判分
  let result;
  try {
    result = await api("/api/typing/check", {
      method: "POST",
      body: JSON.stringify({ card_id: q.card_id, user_input: userInput }),
    });
  } catch (e) {
    toast("判分失败：" + e.message);
    btn.disabled = false;
    return;
  }

  const correct = result.correct;
  if (correct) {
    sfxSuccess();
  } else {
    sfxFail();
    state.wrongList.push({ question: q, user_input: userInput, expected: result.expected });
  }
  // 播正确答案发音（拼写/听写已有，测验补上）
  speak(result.expected, null);

  // 显示反馈
  const body = $("#quiz-body");
  const feedback = document.createElement("div");
  feedback.className = `quiz-feedback ${correct ? "ok" : "err"}`;
  if (correct) {
    feedback.textContent = "✅ 正确！";
  } else {
    feedback.innerHTML = `❌ 你的答案：<b>${escapeHtml(userInput || "（空）")}</b><br>正确答案：<b class="right">${escapeHtml(result.expected)}</b>`;
  }
  body.appendChild(feedback);

  // 高亮格子（如果有的话）
  const boxes = body.querySelectorAll(".spelling-box");
  if (boxes.length > 0 && !correct) {
    const expected = result.expected.toLowerCase();
    boxes.forEach((box, i) => {
      box.className = "spelling-box box-correct";
      box.textContent = expected[i] || "";
    });
  }

  // 禁用输入
  const input = body.querySelector(".spelling-input");
  if (input) { input.disabled = true; input.oninput = null; }
  body.querySelectorAll(".quiz-option").forEach((b) => {
    b.disabled = true;
    if (b.dataset.value === result.expected) b.classList.add("correct");
  });

  // 按钮变"下一题"或"查看结果"
  const isLast = state.qIdx >= state.questions.length - 1;
  btn.textContent = isLast ? "查看结果" : "下一题 →";
  btn.disabled = false;
  btn.dataset.phase = "next";
  // 判分后输入已被禁用、焦点丢失——挂一个文档级 Enter：再按回车 = 下一题
  document.removeEventListener("keydown", quizEnterNext);
  document.addEventListener("keydown", quizEnterNext);
});

// 文档级回车：判分后（phase=next）再按回车进下一题
function quizEnterNext(e) {
  const btn = $("#btn-quiz-submit");
  if (e.key === "Enter" && btn && btn.dataset.phase === "next" && !$("#view-quiz").hidden) {
    e.preventDefault();
    document.removeEventListener("keydown", quizEnterNext);
    btn.click();
  }
}

// 测验结果（汇总错题）
function showQuizResult() {
  const total = state.questions.length;
  const wrongCount = state.wrongList.length;
  const correctCount = total - wrongCount;
  const score = Math.round((correctCount / total) * 100);

  show("view-result");
  let badge = "🙂";
  if (score === 100) badge = "🏆";
  else if (score >= 80) badge = "🌟";
  else if (score >= 60) badge = "👍";
  $("#result-badge").textContent = badge;
  $("#result-number").textContent = score;

  const el = $("#result-detail");
  if (wrongCount === 0) {
    el.innerHTML = "全部答对！明天的复习不会再忘了 📚";
  } else {
    let html = `答对 <span class="right">${correctCount}</span> / ${total} 题。<br><br>`;
    html += `<div class="quiz-wrong-list">`;
    html += `<div class="quiz-wrong-title">❌ 错题回顾</div>`;
    state.wrongList.forEach((w, i) => {
      const q = w.question;
      const meaning = q.prompt || "";
      html += `<div class="quiz-wrong-item" data-wrong-idx="${i}" style="cursor:pointer">`;
      html += `<span class="quiz-wrong-meaning">${escapeHtml(meaning)}</span>`;
      html += `<span class="quiz-wrong-expected">${escapeHtml(w.expected)} ›</span>`;
      html += `</div>`;
    });
    html += `</div>`;
    html += `<div class="quiz-wrong-hint">这些词会出现在明天的复习队列里 📚</div>`;
    el.innerHTML = html;
  }
}

/* ============ 结果页 ============ */
function showResult(data) {
  show("view-result");
  const num = data.score;
  $("#result-number").textContent = num;
  let badge = "🙂";
  if (num === 100) badge = "🏆";
  else if (num >= 80) badge = "🌟";
  else if (num >= 60) badge = "👍";
  $("#result-badge").textContent = badge;

  const wrong = data.details.filter((d) => !d.correct);
  const el = $("#result-detail");
  if (wrong.length === 0) {
    el.innerHTML = "全部答对！明天的复习不会再忘了 📚";
  } else {
    el.innerHTML = `答对 <span class="right">${data.correct}</span> / ${data.total} 题。` +
      `没答对的：<span class="wrong">${wrong.map((d) => escapeHtml(d.expected)).join("、")}</span>，` +
      "它们会出现在明天的队列里。";
  }
}

// 错题项点击 → 进单词详情
$("#result-detail").addEventListener("click", async (e) => {
  const item = e.target.closest(".quiz-wrong-item");
  if (item) {
    const w = state.wrongList[parseInt(item.dataset.wrongIdx)];
    if (w) openWordDetail(w.question.card_id);
  }
});

$("#btn-back-queue").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

/* ============ 单词本 ============ */
let allCards = []; // 缓存全量卡片

async function loadWords() {
  const data = await api("/api/cards");
  allCards = data.cards;
  renderWordList(allCards);
  buildAlphaNav(allCards);
}

function renderWordList(cards) {
  const list = $("#word-list");
  list.innerHTML = "";

  if (cards.length === 0) {
    list.innerHTML = `<div class="story-empty">还没有卡片，先去「加词」添加第一个吧</div>`;
    $("#word-search-count").textContent = "";
    return;
  }

  // 预热发音
  prewarmTts(cards.map((c) => (c.kind === "sentence" ? (c.example || c.word) : c.word)));

  // 按首字母分组
  let currentLetter = "";
  cards.forEach((c) => {
    const firstChar = (c.word || "").charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";
    if (letter !== currentLetter) {
      currentLetter = letter;
      const header = document.createElement("div");
      header.className = "word-letter-header";
      header.id = `letter-${letter}`;
      header.textContent = letter;
      list.appendChild(header);
    }

    const item = document.createElement("div");
    item.className = "word-item";
    const badges = [];
    badges.push(c.kind === "sentence" ? '<span class="badge badge-sentence">句子</span>' : '<span class="badge badge-word">词</span>');
    if (c.graduated) badges.push('<span class="badge badge-graduated">毕业</span>');
    if (c.error_count > 0) badges.push(`<span class="badge badge-error">错词 ×${c.error_count}</span>`);

    item.innerHTML = `
      <div class="word-main">
        <div class="word-item-word">${escapeHtml(c.word)}${badges.join("")}</div>
        ${c.phonetic || c.kind === "sentence" ? `<div class="word-item-phonetic">${escapeHtml(c.phonetic || "")}${c.kind === "sentence" ? "句子卡" : ""}</div>` : ""}
        <div class="word-item-meaning">${escapeHtml(c.kind === "sentence" ? (c.example_cn || c.example || "") : (c.meaning || ""))} · 复习 ${c.review_count} 次</div>
      </div>
      <button class="speak-mini" title="朗读">🔊</button>
    `;
    // 点发音
    item.querySelector(".speak-mini").addEventListener("click", (e) => {
      e.stopPropagation();
      speak(c.kind === "sentence" ? (c.example || c.word) : c.word, item.querySelector(".speak-mini"));
    });
    // 长按/右键快速查阅
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showQuickPeek(c, e);
    });
    // 点击进详情
    item.addEventListener("click", () => openWordDetail(c.id));
    list.appendChild(item);
  });
}

// A-Z 侧边栏
function buildAlphaNav(cards) {
  const nav = $("#alpha-nav");
  nav.innerHTML = "";
  const letters = new Set();
  cards.forEach((c) => {
    const ch = (c.word || "").charAt(0).toUpperCase();
    letters.add(/[A-Z]/.test(ch) ? ch : "#");
  });
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((L) => {
    const btn = document.createElement("button");
    btn.className = "alpha-btn";
    btn.textContent = L;
    if (!letters.has(L)) btn.classList.add("alpha-disabled");
    btn.addEventListener("click", () => {
      const target = document.getElementById(`letter-${L}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(btn);
  });
}

// 搜索
$("#word-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    renderWordList(allCards);
    buildAlphaNav(allCards);
    $("#word-search-count").textContent = "";
    return;
  }
  const filtered = allCards.filter(
    (c) =>
      (c.word || "").toLowerCase().includes(q) ||
      (c.meaning || "").toLowerCase().includes(q) ||
      (c.example_cn || "").toLowerCase().includes(q)
  );
  renderWordList(filtered);
  buildAlphaNav(filtered);
  $("#word-search-count").textContent = `${filtered.length} 个结果`;
});

// 快速查阅浮层
let qpCard = null;
function showQuickPeek(card, event) {
  qpCard = card;
  $("#qp-word").textContent = card.word;
  $("#qp-phonetic").textContent = card.phonetic || "";
  $("#qp-meaning").textContent = card.kind === "sentence" ? (card.example_cn || "") : (card.meaning || "");
  const exEl = $("#qp-example");
  if (card.example && card.kind !== "sentence") {
    exEl.textContent = card.example;
    exEl.hidden = false;
  } else {
    exEl.hidden = true;
  }
  const peek = $("#quick-peek");
  peek.hidden = false;
  // 定位：靠近点击处
  const rect = peek.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 12);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 12);
  peek.style.left = x + "px";
  peek.style.top = y + "px";
}

// 关闭快速查阅（点别处）
document.addEventListener("click", (e) => {
  if (!$("#quick-peek").hidden && !$("#quick-peek").contains(e.target)) {
    $("#quick-peek").hidden = true;
    qpCard = null;
  }
});

// 快速查阅 - 发音
$("#qp-speak").addEventListener("click", () => {
  if (qpCard) speak(qpCard.word, $("#qp-speak"));
});

// 快速查阅 - 查看详情
$("#qp-detail").addEventListener("click", () => {
  if (qpCard) {
    $("#quick-peek").hidden = true;
    openWordDetail(qpCard.id);
    qpCard = null;
  }
});

/* ============ 单词详情 ============ */
let detailCard = null;

async function openWordDetail(cardId) {
  try {
    detailCard = await api(`/api/cards/${cardId}`);
    renderWordDetail();
    show("view-word-detail");
  } catch (e) {
    toast("加载详情失败：" + e.message);
  }
}

function renderWordDetail() {
  const c = detailCard;
  $("#detail-word").textContent = c.word;
  $("#detail-phonetic").textContent = c.phonetic || "";

  // 标签
  const badges = [];
  badges.push(c.kind === "sentence" ? '<span class="badge badge-sentence">句子</span>' : '<span class="badge badge-word">词</span>');
  if (c.graduated) badges.push('<span class="badge badge-graduated">毕业</span>');
  if (c.error_count > 0) badges.push(`<span class="badge badge-error">错词 ×${c.error_count}</span>`);
  $("#detail-badges").innerHTML = badges.join("");

  // 释义
  $("#detail-meaning").textContent = c.kind === "sentence" ? (c.example_cn || "") : (c.meaning || "");

  // 例句
  const exampleEl = $("#detail-example");
  if (c.example && c.kind !== "sentence") {
    $("#detail-example-text").textContent = c.example;
    exampleEl.hidden = false;
  } else {
    exampleEl.hidden = true;
  }

  // 对话气泡
  const ctxEl = $("#detail-contexts");
  ctxEl.innerHTML = "";
  if (c.contexts && c.contexts.length > 0) {
    c.contexts.forEach((ctx, i) => {
      const side = i % 2 === 0 ? "bubble-a" : "bubble-b";
      ctxEl.innerHTML += `<div class="bubble ${side}"><div class="bubble-en">${escapeHtml(ctx.en)}</div><div class="bubble-cn">${escapeHtml(ctx.cn)}</div></div>`;
    });
    ctxEl.hidden = false;
  } else {
    ctxEl.hidden = true;
  }

  // 讲解
  const explEl = $("#detail-explanation");
  if (c.explanation) {
    explEl.textContent = c.explanation;
    explEl.hidden = false;
  } else {
    explEl.hidden = true;
  }

  // 状态卡
  $("#detail-review-count").textContent = c.review_count;
  const stateNames = { 0: "新词", 1: "学习中", 2: "重新学习", 3: "已毕业" };
  const latestState = c.review_history.length > 0 ? (c.graduated ? 3 : 1) : 0;
  $("#detail-state").textContent = c.graduated ? "已毕业 ✅" : (c.review_count > 0 ? "学习中" : "新词");
  $("#detail-next-due").textContent = c.next_due ? new Date(c.next_due).toLocaleDateString() : "-";

  // 记忆法
  const memoBox = $("#detail-memo");
  const memoText = $("#detail-memo-text");
  if (c.memo) {
    memoText.textContent = c.memo;
    memoBox.hidden = false;
  } else {
    memoBox.hidden = true;
  }

  // 复习历史
  const historySection = $("#detail-history-section");
  const historyEl = $("#detail-history");
  historyEl.innerHTML = "";
  if (c.review_history.length > 0) {
    c.review_history.forEach((r) => {
      const date = r.last_review ? new Date(r.last_review).toLocaleDateString() : "-";
      const ratingNames = { 1: "忘了", 2: "模糊", 3: "记得", 4: "太简单" };
      historyEl.innerHTML += `<div class="history-row"><span class="history-date">${date}</span><span class="history-count">第 ${r.review_count} 次</span></div>`;
    });
    historySection.hidden = false;
  } else {
    historySection.hidden = true;
  }
}

// 发音按钮
$("#detail-speak").addEventListener("click", () => {
  if (detailCard) speak(detailCard.word, $("#detail-speak"));
});

// 例句发音
$("#detail-example-speak").addEventListener("click", (e) => {
  e.stopPropagation();
  if (detailCard && detailCard.example) {
    speak(detailCard.example, $("#detail-example-speak"));
  }
});

// 评分按钮
$$("#detail-rating-area .btn-rating").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!detailCard) return;
    const rating = parseInt(btn.dataset.rating);
    try {
      const resp = await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: detailCard.id, rating }),
      });
      // 刷新详情
      detailCard = await api(`/api/cards/${detailCard.id}`);
      renderWordDetail();
      toast(resp.graduated ? "🎓 这个词毕业了！" : "✅ 已记录");
    } catch (e) {
      toast("提交失败：" + e.message);
    }
  });
});

// 详情页编辑记忆法
$("#btn-detail-memo-edit").addEventListener("click", async () => {
  if (!detailCard) return;
  const current = $("#detail-memo-text").textContent || "";
  const input = prompt("怎么写这个单词记得更牢？（谐音/联想/小故事）\n直接放弃按取消：", current);
  if (input === null) return;
  const text = input.trim();
  try {
    if (text) {
      await api(`/api/memos/${detailCard.id}`, {
        method: "PUT",
        body: JSON.stringify({ content: text }),
      });
      detailCard.memo = text;
      $("#detail-memo-text").textContent = text;
      $("#detail-memo").hidden = false;
      toast("记忆法已保存 🧠");
    }
  } catch (e) {
    toast("保存失败：" + e.message);
  }
});

// 返回按钮
$("#btn-back-words").addEventListener("click", async () => {
  show("view-words");
  await loadWords();
});

/* ============ 听写练习 ============ */
let listeningQuestions = [];
let listeningIdx = 0;
let listeningCorrect = 0;

async function startListening() {
  try {
    const data = await api("/api/listening");
    if (data.questions.length === 0) {
      toast("今天没有需要听写的词");
      return;
    }
    listeningQuestions = data.questions;
    listeningIdx = 0;
    listeningCorrect = 0;
    show("view-listening");
    renderListeningQuestion();
  } catch (e) {
    toast("加载听写失败：" + e.message);
  }
}

function renderListeningQuestion() {
  const q = listeningQuestions[listeningIdx];
  $("#listening-count").textContent = `${listeningIdx + 1} / ${listeningQuestions.length}`;
  $("#listening-progress-fill").style.width = `${((listeningIdx) / listeningQuestions.length) * 100}%`;
  $("#listening-meaning").textContent = q.meaning;
  $("#listening-feedback").textContent = "";
  $("#listening-feedback").className = "listening-feedback";

  // 选项
  const optEl = $("#listening-options");
  optEl.innerHTML = "";
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost listening-option";
    btn.textContent = opt;
    btn.addEventListener("click", () => handleListeningAnswer(i, btn));
    optEl.appendChild(btn);
  });

  // 自动播放发音
  speak(q.word, null);
}

async function handleListeningAnswer(selected, btn) {
  const q = listeningQuestions[listeningIdx];
  const correct = selected === q.correct_index;

  // 禁用所有选项
  $$("#listening-options .listening-option").forEach((b) => {
    b.disabled = true;
    if (b.textContent === q.word) {
      b.classList.add("correct");
    }
  });

  if (correct) {
    sfxSuccess();
    listeningCorrect++;
    if (btn) btn.classList.add("correct");
    $("#listening-feedback").textContent = "✅ 正确！";
    $("#listening-feedback").className = "listening-feedback ok";
  } else {
    sfxFail();
    if (btn) btn.classList.add("wrong");
    $("#listening-feedback").textContent = `❌ 正确答案是：${q.word}`;
    $("#listening-feedback").className = "listening-feedback err";
  }

  // 提交 FSRS 评分
  try {
    await api("/api/listening/score", {
      method: "POST",
      body: JSON.stringify({
        card_id: q.card_id,
        selected_index: selected,
        correct_index: q.correct_index,
        rating: correct ? 3 : 1,
      }),
    });
  } catch {}

  // 2 秒后下一题
  setTimeout(() => {
    listeningIdx++;
    if (listeningIdx >= listeningQuestions.length) {
      showListeningDone();
    } else {
      renderListeningQuestion();
    }
  }, 1500);
}

function showListeningDone() {
  $("#listening-body").hidden = true;
  $("#listening-done").hidden = false;
  $("#listening-progress-fill").style.width = "100%";
  const total = listeningQuestions.length;
  const pct = Math.round((listeningCorrect / total) * 100);
  $("#listening-result").textContent = `答对 ${listeningCorrect}/${total} 题（${pct} 分）`;
}

// 入口按钮
$("#btn-start-listening").addEventListener("click", startListening);

// 再来一轮
$("#btn-listening-again").addEventListener("click", () => {
  $("#listening-body").hidden = false;
  $("#listening-done").hidden = true;
  startListening();
});

// 播音按钮
$("#listening-speak").addEventListener("click", () => {
  if (listeningQuestions[listeningIdx]) {
    speak(listeningQuestions[listeningIdx].word, $("#listening-speak"));
  }
});

// 跳过这题（不记得就跳过，显示答案）
$("#btn-listening-skip").addEventListener("click", () => {
  if (!listeningQuestions.length) return;
  const q = listeningQuestions[listeningIdx];
  const wrongIdx = (q.correct_index + 1) % q.options.length;
  handleListeningAnswer(wrongIdx, null);
});

// 返回按钮
$("#btn-back-listening").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

$("#btn-listening-back").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

/* ============ 混合练习（交错 Interleaving） ============ */
let mixedQueue = [];
let mixedIdx = 0;
let mixedCorrect = 0;

async function startMixed() {
  try {
    // 并发拉三份数据：听写题 / 测验选择题 / 队列词卡
    const [listeningData, quizData, todayData] = await Promise.all([
      api("/api/listening?limit=2"),
      api("/api/quiz?limit=6"),
      api("/api/today"),
    ]);

    const items = [];
    // 听写题 ×2
    (listeningData.questions || []).slice(0, 2).forEach((q) => {
      items.push({ type: "listen", q });
    });
    // 选择题 ×2（从测验里抽 choice 类型）
    (quizData.questions || []).filter((q) => q.type === "choice").slice(0, 2).forEach((q) => {
      items.push({ type: "choice", q });
    });
    // 拼写 ×2（今日队列词，队列空时降级全库——与拼写练习一致）
    let spellPool = [...(todayData.error_cards || []), ...todayData.new_cards, ...todayData.due_cards]
      .filter((c) => c.kind === "word");
    if (spellPool.length === 0) {
      const allData = await api("/api/cards");
      spellPool = allData.cards.filter((c) => c.kind === "word");
    }
    spellPool.slice(0, 2).forEach((c) => {
      items.push({ type: "spell", q: { card_id: c.id, word: c.word, meaning: c.meaning } });
    });

    if (items.length < 3) {
      toast("题目不够，先去加几个词吧");
      return;
    }

    // 随机交错（Fisher-Yates）
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }

    mixedQueue = items;
    mixedIdx = 0;
    mixedCorrect = 0;
    show("view-mixed");
    renderMixedQuestion();
  } catch (e) {
    toast("加载混合练习失败：" + e.message);
  }
}

function renderMixedQuestion() {
  const item = mixedQueue[mixedIdx];
  const total = mixedQueue.length;
  $("#mixed-count").textContent = `${mixedIdx + 1} / ${total} · ${typeName(item.type)}`;
  $("#mixed-progress").style.width = `${(mixedIdx / total) * 100}%`;

  const body = $("#mixed-body");
  body.innerHTML = "";

  if (item.type === "listen") {
    renderMixedListen(item, body);
  } else if (item.type === "choice") {
    renderMixedChoice(item, body);
  } else {
    renderMixedSpell(item, body);
  }

  // 跳过这题
  const skipBtn = document.createElement("button");
  skipBtn.className = "btn btn-ghost btn-small spelling-skip";
  skipBtn.textContent = "跳过这题 →";
  skipBtn.addEventListener("click", () => skipMixedQuestion(item));
  body.appendChild(skipBtn);
}

// 混合-跳过：跳过 = 判错（错误增强），显示答案后下一题
function skipMixedQuestion(item) {
  const expected = item.q.word || (item.q.correct_index !== undefined ? item.q.options[item.q.correct_index] : "");
  sfxFail();
  if (expected) {
    mixedFeedback(item, document.body, false, expected, null);
  } else {
    const fb = document.createElement("div");
    fb.className = "quiz-feedback err";
    fb.textContent = "⏭ 已跳过（算作答错，会巩固）";
    $("#mixed-body").appendChild(fb);
  }
  // 提交错误记录（错误增强）
  if (item.type === "listen" && item.q.correct_index !== undefined) {
    const wrongIdx = (item.q.correct_index + 1) % item.q.options.length;
    api("/api/listening/score", {
      method: "POST",
      body: JSON.stringify({
        card_id: item.q.card_id, selected_index: wrongIdx,
        correct_index: item.q.correct_index, rating: 1,
      }),
    }).catch(() => {});
  } else if (item.type === "choice") {
    api("/api/quiz/score", {
      method: "POST",
      body: JSON.stringify({ answers: [{ card_id: item.q.card_id, user_input: "" }] }),
    }).catch(() => {});
  } else if (item.type === "spell") {
    api("/api/typing/check", {
      method: "POST",
      body: JSON.stringify({ card_id: item.q.card_id, user_input: "" }),
    }).catch(() => {});
  }
  setTimeout(() => mixedNext(item), 1500);
}

function typeName(t) {
  return t === "listen" ? "听写" : t === "choice" ? "选择" : "拼写";
}

/* --- 混合-听写（播放发音 → 4 选 1） --- */
function renderMixedListen(item, body) {
  const q = item.q;
  body.innerHTML = `
    <div class="mixed-type-label">🎧 听发音选单词</div>
    <div class="listening-prompt">
      <button id="mixed-listen-speak" class="btn-speak-large" title="播放发音">🔊</button>
      <div class="listening-meaning" style="color:var(--muted);font-size:14px;font-weight:600">点上面喇叭听发音</div>
    </div>
    <div class="listening-options" id="mixed-listen-options"></div>
  `;
  const optEl = $in(body, "#mixed-listen-options");
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost listening-option";
    btn.textContent = opt;
    btn.addEventListener("click", async () => {
      const correct = i === q.correct_index;
      if (correct) { sfxSuccess(); } else { sfxFail(); }
      mixedCorrect += correct ? 1 : 0;
      mixedFeedback(item, body, correct, q.word, i);
      try {
        await api("/api/listening/score", {
          method: "POST",
          body: JSON.stringify({
            card_id: q.card_id, selected_index: i,
            correct_index: q.correct_index, rating: correct ? 3 : 1,
          }),
        });
      } catch {}
      setTimeout(() => mixedNext(item), 1400);
    });
    optEl.appendChild(btn);
  });
  // 自动播放
  speak(q.word, null);
  $("#mixed-listen-speak").addEventListener("click", () => speak(q.word, $("#mixed-listen-speak")));
}

/* --- 混合-选择（中文释义 → 选英文单词） --- */
function renderMixedChoice(item, body) {
  const q = item.q;
  body.innerHTML = `
    <div class="mixed-type-label">🤔 选意思</div>
    <div class="quiz-prompt">「${escapeHtml(q.prompt)}」是哪个单词？</div>
    <div class="quiz-options" id="mixed-choice-options"></div>
  `;
  const optEl = $in(body, "#mixed-choice-options");
  q.options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.dataset.value = opt;
    btn.textContent = opt;
    // 选项发声（点击只发音不选中）
    const spk = document.createElement("button");
    spk.className = "quiz-option-speak";
    spk.textContent = "🔊";
    spk.title = "听发音";
    spk.addEventListener("click", (e) => {
      e.stopPropagation();
      speak(opt, spk);
    });
    btn.appendChild(spk);
    btn.addEventListener("click", async () => {
      // 走服务端判分（choice 题正确答案在服务端）
      let result = null;
      try {
        result = await api("/api/quiz/score", {
          method: "POST",
          body: JSON.stringify({ answers: [{ card_id: q.card_id, user_input: opt }] }),
        });
      } catch {}
      const isCorrect = result?.details?.[0]?.correct || false;
      const expected = result?.details?.[0]?.expected || opt;
      if (isCorrect) { sfxSuccess(); } else { sfxFail(); }
      mixedCorrect += isCorrect ? 1 : 0;
      mixedFeedback(item, body, isCorrect, expected, null);
      setTimeout(() => mixedNext(item), 1400);
    });
    optEl.appendChild(btn);
  });
}

/* --- 混合-拼写（释义 → 输入） --- */
function renderMixedSpell(item, body) {
  const q = item.q;
  body.innerHTML = `
    <div class="mixed-type-label">⌨️ 拼写</div>
    <div class="spelling-meaning">${escapeHtml(q.meaning || "")}</div>
    <div class="spelling-word-display" id="mixed-spell-display"></div>
    <input id="mixed-spell-input" class="spelling-input" type="text" placeholder="输入英文单词…"
      autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
  `;
  const input = $in(body, "#mixed-spell-input");
  const display = $in(body, "#mixed-spell-display");
  const target = q.word;
  for (let i = 0; i < target.length; i++) {
    const box = document.createElement("span");
    box.className = "spelling-box box-pending";
    display.appendChild(box);
  }
  input.oninput = () => {
    const typed = input.value.toLowerCase().slice(0, target.length);
    const boxes = display.querySelectorAll(".spelling-box");
    for (let i = 0; i < boxes.length; i++) {
      boxes[i].className = "spelling-box";
      if (i < typed.length) {
        boxes[i].textContent = target[i];
        boxes[i].classList.add(typed[i] === target[i].toLowerCase() ? "box-correct" : "box-wrong");
      } else {
        boxes[i].classList.add("box-pending");
        boxes[i].textContent = "";
      }
    }
    if (typed.length === target.length) {
      setTimeout(() => { if (!item.submitted) submitMixedSpell(item); }, 300);
    }
  };
  // 回车提交
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.value.trim().length > 0 && !item.submitted) {
        submitMixedSpell(item);
      }
    }
  };
  setTimeout(() => input.focus(), 100);
}

async function submitMixedSpell(item) {
  if (item.submitted) return; // 防重入（回车+自动双触发、连按回车）
  item.submitted = true;
  const input = $in(document, "#mixed-spell-input");
  const q = item.q;
  const typed = input.value.trim();
  input.oninput = null;
  input.onkeydown = null;
  let resp;
  try {
    resp = await api("/api/typing/check", {
      method: "POST",
      body: JSON.stringify({ card_id: q.card_id, user_input: typed }),
    });
  } catch {
    return;
  }
  const correct = resp.correct;
  if (correct) { sfxSuccess(); } else { sfxFail(); }
  mixedCorrect += correct ? 1 : 0;
  mixedFeedback(item, document.body, correct, q.word, typed);
  setTimeout(() => mixedNext(item), 1400);
}

/* --- 混合-统一反馈 --- */
function mixedFeedback(item, container, correct, expectedText, userText) {
  const body = $("#mixed-body");
  const fb = document.createElement("div");
  fb.className = `quiz-feedback ${correct ? "ok" : "err"}`;
  if (correct) {
    fb.textContent = "✅ 正确！";
  } else {
    fb.innerHTML = `❌ 正确答案：<b class="right">${escapeHtml(expectedText)}</b>`;
  }
  body.appendChild(fb);
  // 正确答案高亮显示
  const options = body.querySelectorAll(".listening-option, .quiz-option");
  options.forEach((b) => {
    b.disabled = true;
    if (b.dataset.value === expectedText || b.textContent === expectedText) {
      b.classList.add("correct");
    }
  });
}

function mixedNext(item) {
  mixedIdx++;
  if (mixedIdx >= mixedQueue.length) {
    showMixedDone();
  } else {
    renderMixedQuestion();
  }
}

function showMixedDone() {
  $("#mixed-body").innerHTML = "";
  $("#mixed-done").hidden = false;
  $("#mixed-progress").style.width = "100%";
  const total = mixedQueue.length;
  const pct = Math.round((mixedCorrect / total) * 100);
  $("#mixed-result").textContent = `答对 ${mixedCorrect}/${total} 题（${pct} 分）· 混合题型记忆更牢 🚀`;
}

// 入口
$("#btn-start-mixed").addEventListener("click", startMixed);

// 再来一轮
$("#btn-mixed-again").addEventListener("click", () => {
  $("#mixed-done").hidden = true;
  startMixed();
});

// 返回
$("#btn-back-mixed").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});
$("#btn-mixed-back").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

// 辅助：在容器内查找（避免 body 级 ID 冲突）
function $in(container, sel) {
  return container.querySelector(sel);
}

/* ============ 拼写练习（Qwerty 风格 + 渐褪提示） ============ */
let spellingQueue = [];
let spellingIdx = 0;
let spellingCorrect = 0;
let spellingDiff = 2; // 默认"提示"档；1=教过(首字母) 2=提示(空格数) 3=独立(自由)

// 恢复上次难度
try {
  const saved = parseInt(localStorage.getItem("spellingDiff") || "2");
  if (saved >= 1 && saved <= 3) spellingDiff = saved;
} catch {}

// 难度按钮
$$("#spelling-difficulty .diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    spellingDiff = parseInt(btn.dataset.diff);
    try { localStorage.setItem("spellingDiff", String(spellingDiff)); } catch {}
    updateSpellingDiffUI();
    renderSpellingWord();
  });
});

function updateSpellingDiffUI() {
  $$("#spelling-difficulty .diff-btn").forEach((btn) => {
    btn.classList.toggle("diff-active", parseInt(btn.dataset.diff) === spellingDiff);
  });
}
updateSpellingDiffUI();

async function startSpelling() {
  const data = await api("/api/today");
  spellingQueue = [...data.new_cards, ...data.due_cards].filter((c) => c.kind === "word");
  // 今日队列为空时，从全库取词
  if (spellingQueue.length === 0) {
    const allData = await api("/api/cards");
    spellingQueue = allData.cards.filter((c) => c.kind === "word");
  }
  if (spellingQueue.length === 0) {
    toast("还没有单词，先去加词吧");
    return;
  }
  spellingIdx = 0;
  spellingCorrect = 0;
  show("view-spelling");
  renderSpellingWord();
}

function renderSpellingWord() {
  const card = spellingQueue[spellingIdx];
  const target = card.word;
  const input = $("#spelling-input");

  $("#spelling-count").textContent = `${spellingIdx + 1} / ${spellingQueue.length}`;
  $("#spelling-progress").style.width = `${(spellingIdx / spellingQueue.length) * 100}%`;
  $("#spelling-meaning").textContent = card.meaning || "";
  $("#spelling-phonetic").textContent = card.phonetic || "";
  $("#spelling-feedback").textContent = "";
  $("#spelling-feedback").className = "spelling-feedback";

  const diffLabels = { 1: "教过：首字母已提示", 2: "提示：空格数提醒", 3: "独立：完全靠自己" };
  $("#spelling-hint").textContent = `输入上面的英文单词 · ${diffLabels[spellingDiff]}`;

  // 渲染占位格子（难度1 显示首字母提示）
  const display = $("#spelling-word-display");
  display.innerHTML = "";
  for (let i = 0; i < target.length; i++) {
    const box = document.createElement("span");
    box.className = "spelling-box";
    box.dataset.index = i;
    if (spellingDiff === 1 && i === 0) {
      box.textContent = target[0];
      box.classList.add("box-correct");
      box.style.color = "var(--muted)";
    } else {
      box.classList.add("box-pending");
    }
    display.appendChild(box);
  }

  // 清空输入并聚焦
  input.value = "";
  setTimeout(() => input.focus(), 100);

  // 监听输入
  input.oninput = () => handleSpellingInput(card);
  // 回车立即提交判定（不等字数输满）
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.value.length > 0) {
        input.oninput = null;
        checkSpelling(card);
      }
    }
  };
}

function handleSpellingInput(card) {
  const input = $("#spelling-input");
  const target = card.word.toLowerCase();
  const typed = input.value.toLowerCase().slice(0, target.length); // 截断多余字符
  const boxes = $$("#spelling-word-display .spelling-box");

  // 逐字校验
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    box.className = "spelling-box";
    if (i < typed.length) {
      if (typed[i] === target[i]) {
        box.classList.add("box-correct");
        box.textContent = card.word[i];
      } else {
        box.classList.add("box-wrong");
        box.textContent = card.word[i]; // 显示正确字母（红色）
      }
    } else {
      box.textContent = "";
      box.classList.add("box-pending");
    }
  }

  // 全部输入完自动检查
  if (typed.length === target.length && input.value.length >= target.length) {
    input.value = typed; // 截断多余
    setTimeout(() => checkSpelling(card), 300);
  }
}

async function checkSpelling(card) {
  const input = $("#spelling-input");
  const typed = input.value.toLowerCase();
  const target = card.word.toLowerCase();
  const correct = typed === target;

  if (correct) spellingCorrect++;

  // 禁用输入
  input.oninput = null;
  input.onkeydown = null;

  // 反馈
  const fb = $("#spelling-feedback");
  if (correct) {
    sfxSuccess();
    fb.textContent = "✅ 正确！";
    fb.className = "spelling-feedback ok";
    speak(card.word, null);
  } else {
    sfxFail();
    fb.textContent = `❌ 正确拼写：${card.word}`;
    fb.className = "spelling-feedback err";
    // 显示全部正确字母
    const boxes = $$("#spelling-word-display .spelling-box");
    boxes.forEach((box, i) => {
      box.className = "spelling-box box-correct";
      box.textContent = card.word[i];
    });
    speak(card.word, null);
  }

  // FSRS 评分
  try {
    await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ card_id: card.id, rating: correct ? 3 : 1 }),
    });
  } catch {}

  // 1.5 秒后下一题
  setTimeout(() => {
    spellingIdx++;
    if (spellingIdx >= spellingQueue.length) {
      showSpellingDone();
    } else {
      renderSpellingWord();
    }
  }, 1800);
}

function showSpellingDone() {
  $("#spelling-body").hidden = true;
  $("#spelling-done").hidden = false;
  $("#spelling-progress").style.width = "100%";
  const total = spellingQueue.length;
  const pct = Math.round((spellingCorrect / total) * 100);
  $("#spelling-result").textContent = `拼对 ${spellingCorrect}/${total} 词（${pct} 分）`;
}

// 入口
$("#btn-start-spelling").addEventListener("click", startSpelling);

// 再来一轮
$("#btn-spelling-again").addEventListener("click", () => {
  $("#spelling-body").hidden = false;
  $("#spelling-done").hidden = true;
  startSpelling();
});

// 跳过这题
$("#btn-spelling-skip").addEventListener("click", () => {
  if (!spellingQueue.length) return;
  const card = spellingQueue[spellingIdx];
  const input = $("#spelling-input");
  input.oninput = null;
  input.onkeydown = null;
  input.value = "";
  checkSpelling(card); // 空值→判错→显示答案
});

// 返回
$("#btn-back-spelling").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});
$("#btn-spelling-back").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

/* ============ 学习统计 ============ */
async function openStats() {
  try {
    const [statsData, historyData] = await Promise.all([
      api("/api/stats"),
      api("/api/stats/history?days=365"),
    ]);

    // 数字卡片
    $("#stats-total").textContent = statsData.total_cards;
    $("#stats-graduated").textContent = statsData.graduated;
    $("#stats-streak-val").textContent = statsData.streak;
    $("#stats-today-val").textContent = statsData.reviewed_today;

    // 日历热力图
    renderCalendar(historyData.days);

    show("view-stats");
  } catch (e) {
    toast("加载统计失败：" + e.message);
  }
}

function renderCalendar(days) {
  const host = $("#cal-heatmap");
  host.innerHTML = "";
  if (days.length === 0) return;

  const maxReviews = Math.max(1, ...days.map((d) => d.reviews));
  const map = {};
  days.forEach((d) => { map[d.date] = d; });

  // GitHub 精确结构：周=（列，0=起始对齐周日），行=周一~周日（index 0=周日）
  const firstDate = new Date(days[0].date + "T00:00:00");
  const firstDow = firstDate.getDay(); // 0=周日
  // 补空位
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  days.forEach((d) => cells.push(d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = cells.length / 7;

  // CSS grid 布局：首列 26px 标签列 + weeks 列数据；行 0=月份，1-7=周日..周六
  host.style.gridTemplateColumns = `26px repeat(${weeks}, 1fr)`;
  host.style.gridTemplateRows = "18px repeat(7, 14px)";

  const monthNames = ["", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  // 行 0：月份标签（每列首个有效日期的月份）
  let lastMonth = -1;
  for (let col = 0; col < weeks; col++) {
    const firstDay = cells[col * 7];
    if (firstDay) {
      const m = parseInt(firstDay.date.split("-")[1]);
      if (m !== lastMonth) {
        const lab = document.createElement("div");
        lab.className = "cal-month-label";
        lab.textContent = monthNames[m];
        lab.style.gridRow = "1";
        lab.style.gridColumn = String(col + 2);
        host.appendChild(lab);
        lastMonth = m;
      }
    }
  }

  // 行 1-7：星期标签（一/三/五 对应行 1=周一,3=周三,5=周五）
  const weekLabels = { 1: "一", 3: "三", 5: "五" };
  for (let row = 1; row <= 7; row++) {
    if (weekLabels[row]) {
      const lab = document.createElement("span");
      lab.className = "cal-weekday-label";
      lab.textContent = weekLabels[row];
      lab.style.gridRow = String(row + 1);
      lab.style.gridColumn = "1";
      host.appendChild(lab);
    }
  }

  // 数据格子：gridRow = 行(1-7), gridColumn = col+2
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const d = cells[col * 7 + row];
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (!d) {
        cell.classList.add("cal-empty");
      } else {
        cell.classList.add(`cal-l${getHeatLevel(d.reviews, maxReviews)}`);
        cell.title = `${d.date}：${d.reviews} 次复习`;
        // 今天的格子高亮（深色边框"今天"）
        if (d.date === todayStr()) {
          cell.classList.add("cal-today");
          cell.title = `${d.date}：${d.reviews} 次复习 · 就是今天`;
        }
      }
      cell.style.gridRow = String(row + 2);
      cell.style.gridColumn = String(col + 2);
      host.appendChild(cell);
    }
  }
}

function getHeatLevel(reviews, max) {
  if (reviews === 0) return 0;
  const ratio = reviews / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  return 3;
}

// 本地日期 YYYY-MM-DD（含今天标记用）
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 入口：点击统计区域
$("#today-stats").addEventListener("click", openStats);

// 返回按钮
$("#btn-back-stats").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

/* ============ 加词 ============ */
$("#btn-add-generate").addEventListener("click", async () => {
  const raw = $("#add-input").value.trim();
  if (!raw) {
    $("#add-result").innerHTML = '<span class="err">先输入一些单词吧</span>';
    return;
  }
  const words = raw.split(/[,，\s]+/).filter(Boolean).slice(0, 20);
  const btn = $("#btn-add-generate");
  btn.disabled = true;
  $("#add-result").innerHTML = '<span class="loading">AI 生成中，请稍候…</span>';
  try {
    const data = await api("/api/cards/generate", {
      method: "POST",
      body: JSON.stringify({ words }),
    });
    if (data.generated > 0) {
      $("#add-result").innerHTML =
        `<span class="ok">✅ 生成 ${data.generated} 张卡：${data.cards.map((c) => escapeHtml(c.word)).join("、")}</span>` +
        (data.skipped > 0 ? `<br><span class="warn">${data.skipped} 个已存在跳过</span>` : "") +
        `<br><span class="warn">这些词已经进入你的词库，明天会按记忆安排复习</span>` +
        `<div class="learn-now-row"><button id="btn-learn-now" class="btn btn-primary btn-small">🕐 马上学一学（不等到明天）</button></div>`;
      $("#add-input").value = "";

      // 立即学一学：把刚生成的卡直接进闪卡学习流
      $("#btn-learn-now").addEventListener("click", () => {
        state.queue = data.cards;
        state.idx = 0;
        state.answered = 0;
        state.graduated = [];
        show("view-study");
        renderCard();
      });
    } else {
      $("#add-result").innerHTML = '<span class="warn">这些词都已经在单词本里了</span>';
    }
  } catch (e) {
    $("#add-result").innerHTML = `<span class="err">生成失败：${escapeHtml(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
});

/* ============ 故事 ============ */
async function loadStories() {
  try {
    const data = await api("/api/stories");
    const list = $("#story-list");
    list.innerHTML = "";
    if (data.stories.length === 0) {
      list.innerHTML = `<div class="story-empty">还没有故事。「生成新故事」会用你学过的词编一篇</div>`;
      return;
    }
    data.stories.forEach((s) => {
      const el = document.createElement("button");
      el.className = "story-item";
      el.innerHTML = `
        <div class="story-item-title">${escapeHtml(s.title)}</div>
        <div class="story-item-meta">${s.words.length} 个词 · ${escapeHtml(s.content.slice(0, 40))}…</div>
      `;
      el.addEventListener("click", () => openStory(s.id));
      list.appendChild(el);
    });
  } catch (e) {
    toast("加载故事失败：" + e.message);
  }
}

$("#btn-new-story").addEventListener("click", async () => {
  const btn = $("#btn-new-story");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    await api("/api/stories/generate", { method: "POST" });
    await loadStories();
    toast("新故事生成好了！");
  } catch (e) {
    toast("生成失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "生成新故事";
  }
});

async function openStory(id) {
  const s = await api(`/api/stories/${id}`);
  show("view-story-read");
  $("#story-read-title").textContent = s.title;
  // 按句拆分渲染：句子点击整句朗读，词点击保持弹卡
  const renderTokens = (sentText) =>
    sentText.split(/\s+/).map((tok) => {
      const clean = tok.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
      const isTarget = s.words.some((w) => w.word.toLowerCase() === clean);
      if (isTarget) {
        const word = s.words.find((w) => w.word.toLowerCase() === clean);
        return `<span class="sw" data-word="${escapeHtml(word.word)}">${escapeHtml(tok)}</span>`;
      }
      return escapeHtml(tok);
    }).join(" ");

  const sentences = s.content.match(/[^.!?]+[.!?]*\s*/g) || [s.content];
  $("#story-read-content").innerHTML =
    sentences.map((sent, i) =>
      `<span class="story-sentence" data-sid="${i}">${renderTokens(sent)}</span>`
    ).join("") +
    `<div class="story-tap-tip">👆 点击句子整句朗读 · 点击绿词查看释义</div>`;

  $("#story-read-words").innerHTML = "";
  s.words.forEach((w) => {
    const row = document.createElement("div");
    row.className = "story-word-row";
    row.innerHTML = `<b>${escapeHtml(w.word)}</b> <span>${escapeHtml(w.phonetic || "")}</span> <span>${escapeHtml(w.meaning || "")}</span>`;
    $("#story-read-words").appendChild(row);
  });

  $$(".sw", $("#story-read-content")).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const word = el.dataset.word;
      el.classList.add("tapped");
      openWordModal(word, s);
    });
  });
  // 句子整句朗读（词点击已 stopPropagation，不会冲突）
  $$(".story-sentence", $("#story-read-content")).forEach((el) => {
    el.addEventListener("click", () => {
      const text = el.textContent.trim();
      if (text) speak(text, el);
    });
  });
}

$("#btn-back-stories").addEventListener("click", () => show("view-stories"));

/* ============ 故事点词：弹卡 + 评分 ============ */
let modalCard = null;

function openWordModal(word, story) {
  const card = story.words.find((w) => w.word.toLowerCase() === word.toLowerCase());
  if (!card) return;
  modalCard = card;
  $("#word-modal").hidden = false;
  $("#modal-word").textContent = card.word;
  $("#modal-phonetic").textContent = card.phonetic || "";
  $("#modal-meaning").textContent = card.meaning || "";
  $("#modal-example").textContent = "";
  $("#modal-feedback").textContent = "";
  $("#modal-feedback").className = "modal-feedback";
}

$("#modal-speak").addEventListener("click", () => {
  if (modalCard) speak(modalCard.word, $("#modal-speak"));
});

// 评分：复用 /api/reviews（与学习页同一套 FSRS）
$$(".modal-rating .btn-rating").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!modalCard) return;
    const rating = Number(btn.dataset.rating);
    const fb = $("#modal-feedback");
    // 评分按钮点击时闪现按下的反馈
    btn.style.transform = "scale(0.92)";
    setTimeout(() => (btn.style.transform = ""), 150);
    try {
      const resp = await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: modalCard.id, rating }),
      });
      fb.className = "modal-feedback ok";
      fb.textContent = resp.graduated
        ? `✅ 已记录！这个词毕业了，例句变成句子卡`
        : `✅ 已记录，下次复习：${new Date(resp.next_due).toLocaleDateString()}`;
      speak(modalCard.word, null);
    } catch (e) {
      fb.className = "modal-feedback";
      fb.textContent = "提交失败：" + e.message;
    }
  });
});

// 关闭：点遮罩
$$("[data-close]").forEach((el) => {
  el.addEventListener("click", () => {
    $("#word-modal").hidden = true;
    modalCard = null;
  });
});

/* ============ 底部导航 ============ */
$$(".nav-item").forEach((el) => {
  el.addEventListener("click", async () => {
    if ($("#bottom-nav").classList.contains("nav-locked")) return;
    const nav = el.dataset.nav;
    if (nav === "queue") { show("view-queue"); await loadToday(); }
    else if (nav === "words") { show("view-words"); await loadWords(); }
    else if (nav === "stories") { show("view-stories"); await loadStories(); }
    else if (nav === "add") { show("view-add"); }
  });
});

/* ============ Toast ============ */
function toast(msg) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ============ 课程 ============ */
let currentLesson = null;

async function loadLessonEntry() {
  try {
    const data = await api("/api/lessons");
    const entry = $("#lesson-entry");
    const btn = $("#btn-open-lesson");
    if (data.is_done) {
      entry.hidden = false;
      $("#lesson-entry-title").textContent = "20 级课程全部完成！🎓";
      $("#lesson-entry-sub").textContent = "继续用队列/故事巩固吧";
      btn.textContent = "回顾";
      btn.onclick = () => {
        const last = data.lessons[data.lessons.length - 1];
        openLesson(last.level);
      };
      return;
    }
    if (data.lessons.length === 0) {
      entry.hidden = false;
      $("#lesson-entry-title").textContent = "开始零基础课程";
      $("#lesson-entry-sub").textContent = "从第 1 课开始，AI 带你循序渐进";
      btn.textContent = "开始";
      btn.onclick = () => openLesson(data.next_level, true);
      return;
    }
    const last = data.lessons[data.lessons.length - 1];
    entry.hidden = false;
    $("#lesson-entry-title").textContent = `第 ${last.level} 课 · ${last.title}`;
    $("#lesson-entry-sub").textContent = `已完成 ${data.lessons.length}/20 课 · 下一课：${data.next_level}`;
    btn.textContent = "继续 →";
    btn.onclick = () => openLesson(last.level);
  } catch {
    $("#lesson-entry").hidden = true;
    $("#btn-open-lesson").hidden = true;
  }
}

async function openLesson(level, generate = false) {
  try {
    if (generate) {
      $("#btn-open-lesson").textContent = "生成中…";
      currentLesson = await api("/api/lessons/next", { method: "POST" });
    } else {
      currentLesson = await api(`/api/lessons/${level}`);
    }
    renderLesson();
    show("view-lesson");
  } catch (e) {
    toast("课程加载失败：" + e.message);
  }
}

function renderLesson() {
  const L = currentLesson;
  $("#lesson-level").textContent = `第 ${L.level} 课`;
  $("#lesson-title").textContent = L.title;
  $("#lesson-tips").textContent = (L.content.tips || []).join("；");

  // 词表：点击评分（复用 /api/reviews），再点切换状态
  const wordsEl = $("#lesson-words");
  wordsEl.innerHTML = "";
  (L.content.words || []).forEach((w) => {
    const item = document.createElement("div");
    item.className = "word-item lesson-word";
    item.innerHTML = `
      <div class="word-main">
        <div class="word-item-word">${escapeHtml(w.word)}</div>
        <div class="word-item-phonetic">${escapeHtml(w.phonetic || "")}</div>
        <div class="word-item-meaning">${escapeHtml(w.meaning || "")}</div>
      </div>
      <button class="speak-mini" title="朗读">🔊</button>
      <button class="lesson-master-btn" title="记住了">✓</button>`;
    item.querySelector(".speak-mini").addEventListener("click", (e) => {
      e.stopPropagation();
      speak(w.word, item.querySelector(".speak-mini"));
    });
    // 确认式标记已掌握（评分 3=记得），与整行点击分离防误触
    item.querySelector(".lesson-master-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const cardId = L.card_ids?.[w.word];
      if (!cardId) return;
      try {
        await api("/api/reviews", {
          method: "POST",
          body: JSON.stringify({ card_id: cardId, rating: 3 }),
        });
        item.classList.add("word-mastered");
        toast(`✓ ${w.word} 已标记掌握`);
      } catch (e) {
        toast("记录失败");
      }
    });
    wordsEl.appendChild(item);
  });

  // 对话：点句子听发音
  const dlgEl = $("#lesson-dialogue");
  dlgEl.innerHTML = "";
  (L.content.dialogue || []).forEach((line, i) => {
    const row = document.createElement("div");
    const side = i % 2 === 0 ? "bubble-a" : "bubble-b";
    row.className = `bubble ${side} lesson-dialogue-row`;
    row.innerHTML = `<span class="spk">${escapeHtml(line.speaker)}</span>` +
      `<div class="bubble-en">${escapeHtml(line.en)}</div>` +
      `<div class="bubble-cn">${escapeHtml(line.cn)}</div>`;
    row.addEventListener("click", () => speak(line.en, row));
    dlgEl.appendChild(row);
  });
}

$("#btn-back-lesson").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
  await loadLessonEntry();
});

$("#btn-lesson-done").addEventListener("click", async () => {
  const btn = $("#btn-lesson-done");
  btn.disabled = true;
  btn.textContent = "生成下一课中…";
  try {
    currentLesson = await api("/api/lessons/next", { method: "POST" });
    renderLesson();
    toast(`🎉 第 ${currentLesson.level} 课开始！`);
  } catch (e) {
    toast("出错了：" + e.message);
    btn.disabled = false;
    btn.textContent = "✅ 学完本课，进入下一课";
  }
});

/* ============ 启动 ============ */
loadToday().catch((e) => console.error("加载今日队列失败", e));
loadLessonEntry().catch((e) => console.error("加载课程入口失败", e));
