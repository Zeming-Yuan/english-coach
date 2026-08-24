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

/* 预合成：列表加载时提前暖缓存，点击按钮即秒播 */
function prewarmTts(words) {
  words.forEach((w) => {
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
  $("#stat-new").textContent = data.new_cards.length;
  $("#stat-due").textContent = data.due_cards.length;

  // 队列 & 引导逻辑
  const isEmpty = data.new_cards.length === 0 && data.due_cards.length === 0;
  $("#welcome-box").hidden = !isEmpty;
  $("#btn-start-study").hidden = isEmpty;
  $("#btn-start-quiz").hidden = isEmpty;

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
  } catch {}
  return data;
}

$("#btn-start-study").addEventListener("click", async () => {
  const data = await loadToday();
  state.queue = [...data.new_cards, ...data.due_cards];
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

  updateProgress();
  $("#rating-area").hidden = true;
  $("#study-done").hidden = true;
  $("#study-card").hidden = false;
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
  state.flipped = !state.flipped;
  $("#study-card").classList.toggle("flipped", state.flipped);
  $("#rating-area").hidden = !state.flipped;
  // 翻到背面时自动播一次发音（单词/例句），不用手动点 🔊
  if (state.flipped) {
    const card = state.queue[state.idx];
    const text = card.kind === "sentence"
      ? (card.example || card.word)
      : card.word;
    speak(text, null);
  }
}

$("#study-card").addEventListener("click", flip);
$("#study-card").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    flip();
  }
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

$("#btn-to-quiz").addEventListener("click", async () => {
  try {
    await startQuiz();
  } catch (e) {
    toast("还没法测验：" + e.message);
  }
});

/* ============ 测验 ============ */
async function startQuiz() {
  const data = await api("/api/quiz?limit=5");
  if (data.questions.length === 0) {
    throw new Error("题库是空的");
  }
  state.questions = data.questions;
  state.qIdx = 0;
  state.answers = [];
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
    const input = document.createElement("input");
    input.className = "quiz-input";
    input.placeholder = "输入英文单词";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
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
      b.textContent = opt;
      b.addEventListener("click", () => {
        opts.querySelectorAll(".quiz-option").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
      });
      opts.appendChild(b);
    });
    card.appendChild(opts);
    body.appendChild(card);
    state._pending = () =>
      opts.querySelector(".selected")?.textContent || "";
  } else if (q.type === "fill") {
    prompt.textContent = `填空：${q.prompt}`;
    card.appendChild(prompt);
    const input = document.createElement("input");
    input.className = "quiz-input";
    input.placeholder = "填缺的词";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
    });
    card.appendChild(input);
    body.appendChild(card);
    setTimeout(() => input.focus(), 50);
    state._pending = () => input.value.trim();
  }

  $("#btn-quiz-next").hidden = state.qIdx >= total - 1;
  $("#btn-quiz-submit").hidden = state.qIdx < total - 1;
}

$("#btn-quiz-next").addEventListener("click", () => {
  state.answers.push({ card_id: state.questions[state.qIdx].card_id, user_input: state._pending() });
  state.qIdx += 1;
  renderQuestion();
});

$("#btn-quiz-submit").addEventListener("click", async () => {
  state.answers.push({ card_id: state.questions[state.qIdx].card_id, user_input: state._pending() });
  const data = await api("/api/quiz/score", {
    method: "POST",
    body: JSON.stringify({ answers: state.answers }),
  });
  showResult(data);
});

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
  $("#detail-badges").innerHTML = badges.join("");

  // 释义
  $("#detail-meaning").textContent = c.kind === "sentence" ? (c.example_cn || "") : (c.meaning || "");

  // 例句
  const exampleEl = $("#detail-example");
  if (c.example && c.kind !== "sentence") {
    exampleEl.innerHTML = `<span class="example-en">${escapeHtml(c.example)}</span>`;
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
    listeningCorrect++;
    btn.classList.add("correct");
    $("#listening-feedback").textContent = "✅ 正确！";
    $("#listening-feedback").className = "listening-feedback ok";
  } else {
    btn.classList.add("wrong");
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

// 返回按钮
$("#btn-back-listening").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

$("#btn-listening-back").addEventListener("click", async () => {
  show("view-queue");
  await loadToday();
});

/* ============ 学习统计 ============ */
async function openStats() {
  try {
    const [statsData, historyData] = await Promise.all([
      api("/api/stats"),
      api("/api/stats/history?days=90"),
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
  const cal = $("#calendar-heatmap");
  cal.innerHTML = "";

  // 找最大复习数（用于颜色分级）
  const maxReviews = Math.max(1, ...days.map((d) => d.reviews));

  // 按周排列（7 行 × N 列）
  // 先找到第一天是周几
  const firstDate = new Date(days[0].date + "T00:00:00");
  const firstDayOfWeek = firstDate.getDay(); // 0=日

  // 填充空白天（让第一列对齐）
  for (let i = 0; i < firstDayOfWeek; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-cell cal-empty";
    cal.appendChild(empty);
  }

  // 每天一个格子
  days.forEach((d) => {
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    const level = getHeatLevel(d.reviews, maxReviews);
    cell.classList.add(`cal-level-${level}`);
    cell.title = `${d.date}: ${d.reviews} 次复习`;
    cal.appendChild(cell);
  });
}

function getHeatLevel(reviews, max) {
  if (reviews === 0) return 0;
  const ratio = reviews / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  return 3;
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
        `<br><span class="warn">明天开始它们会出现在队列里</span>`;
      $("#add-input").value = "";
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
  // 原文分词（先不转义，HTML 转义放在每个 token 输出时做一次）
  $("#story-read-content").innerHTML =
    s.content.split(/\s+/).map((tok) => {
      const clean = tok.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
      const isTarget = s.words.some((w) => w.word.toLowerCase() === clean);
      if (isTarget) {
        const word = s.words.find((w) => w.word.toLowerCase() === clean);
        return `<span class="sw" data-word="${escapeHtml(word.word)}">${escapeHtml(tok)}</span>`;
      }
      return escapeHtml(tok);
    }).join(" ") +
    `<div class="story-tap-tip">👆 点击绿色词查看释义 / 朗读</div>`;

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
      <button class="speak-mini" title="朗读">🔊</button>`;
    item.querySelector(".speak-mini").addEventListener("click", () =>
      speak(w.word, item.querySelector(".speak-mini"))
    );
    // 点击词标记已掌握（评分 3=记得）
    item.addEventListener("click", async () => {
      const cardId = L.card_ids?.[w.word];
      if (!cardId) return;
      try {
        await api("/api/reviews", {
          method: "POST",
          body: JSON.stringify({ card_id: cardId, rating: 3 }),
        });
        item.classList.add("word-mastered");
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
