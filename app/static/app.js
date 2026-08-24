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
async function loadWords() {
  const data = await api("/api/cards");
  const list = $("#word-list");
  list.innerHTML = "";

  if (data.cards.length === 0) {
    list.innerHTML = `<div class="story-empty">还没有卡片，先去「加词」添加第一个吧</div>`;
    return;
  }

  // 预热发音缓存：列表里的词都预先合成，点击即播
  prewarmTts(data.cards.map((c) => (c.kind === "sentence" ? (c.example || c.word) : c.word)));

  data.cards.forEach((c) => {
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
    item.querySelector(".speak-mini").addEventListener("click", () => {
      speak(c.kind === "sentence" ? (c.example || c.word) : c.word, item.querySelector(".speak-mini"));
    });
    list.appendChild(item);
  });
}

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

/* ============ 启动 ============ */
loadToday().catch((e) => console.error("加载今日队列失败", e));
