import React, { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api.js";
import { speak, prewarmTts } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";
import ChunkChips from "../components/ChunkChips.jsx";
import RatingButtons from "../components/RatingButtons.jsx";

/**
 * 单词本视图：搜索/A-Z/快速查阅/详情/编辑/删除/记忆法/换例句/困难词。
 */
export default function WordsPage({ onBack }) {
  const [allCards, setAllCards] = useState([]);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quickPeek, setQuickPeek] = useState(null);
  const [peekPos, setPeekPos] = useState({ x: 0, y: 0 });
  const [tab, setTab] = useState("words"); // words | sentences

  useEffect(() => {
    api("/api/cards").then((d) => {
      setAllCards(d.cards);
      prewarmTts(d.cards.map((c) => c.kind === "sentence" ? (c.example || c.word) : c.word));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // 数据加载时就预分成两组并按字母排序，切换 tab 只是引用不同的数组
  const { wordsCards, sentenceCards } = useMemo(() => {
    const wc = [], sc = [];
    for (const c of allCards) {
      if (c.kind === "sentence") sc.push(c);
      else wc.push(c);  // kind 为 word / undefined / null 统一归入词汇
    }
    const byWord = (a, b) => (a.word || "").localeCompare(b.word || "", "en", { sensitivity: "base" });
    wc.sort(byWord);
    sc.sort(byWord);
    return { wordsCards: wc, sentenceCards: sc };
  }, [allCards]);

  const tabCards = tab === "words" ? wordsCards : sentenceCards;

  // 搜索：按字段相关性加权排序
  // 权重：word完全匹配(0) < word前缀(1) < word包含(2) < meaning匹配(3) < 例句翻译匹配(4)
  const filtered = query
    ? tabCards
        .filter((c) =>
          (c.word || "").toLowerCase().includes(query) ||
          (c.meaning || "").toLowerCase().includes(query) ||
          (c.example_cn || "").toLowerCase().includes(query)
        )
        .sort((a, b) => searchRank(a, query) - searchRank(b, query))
    : tabCards;

  // 按首字母分组
  const grouped = [];
  let currentLetter = "";
  filtered.forEach((c) => {
    const ch = (c.word || "").charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(ch) ? ch : "#";
    if (letter !== currentLetter) {
      currentLetter = letter;
      grouped.push({ type: "header", letter });
    }
    grouped.push({ type: "card", card: c });
  });

  // A-Z 导航
  const usedLetters = new Set(grouped.filter((g) => g.type === "header").map((g) => g.letter));

  if (loading) return <div className="story-empty">加载中…</div>;

  // 详情页
  if (detail) {
    return <WordDetail key={detail} cardId={detail} onBack={() => setDetail(null)} allCards={filtered} setDetail={setDetail} />;
  }

  // 点击关闭快速查阅
  const closePeek = () => { setQuickPeek(null); };

  return (
    <section className="view">
      <div className="page-head">
        <h2 className="page-title">单词本</h2>
        <div className="word-tabs">
          <button className={`word-tab ${tab === "words" ? "word-tab-active" : ""}`} onClick={() => setTab("words")}>📖 词汇</button>
          <button className={`word-tab ${tab === "sentences" ? "word-tab-active" : ""}`} onClick={() => setTab("sentences")}>📝 句子</button>
        </div>
      </div>
      <div className="word-search-bar">
        <input className="word-search-input" name="word-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单词或释义…" />
        {query && <span className="word-search-count">{filtered.length} 个结果</span>}
      </div>
      <div className="word-list-wrap">
        {/* key 含 query：搜索词变化时强制重建列表，避免 React diff 残留旧DOM */}
        <div className="word-list" key={`${tab}-${query}`}>
          {filtered.length === 0 && <div className="story-empty">还没有卡片，先去「加词」添加第一个吧</div>}
          {grouped.map((g, i) => {
            if (g.type === "header") {
              // 字母头 key 必须与卡片 key 空间隔离，否则冲突导致 diff 错乱
              return <div key={`h-${g.letter}`} className="word-letter-header" id={`letter-${g.letter}`}>{g.letter}</div>;
            }
            const c = g.card;
            const badges = [];
            badges.push(c.kind === "sentence" ? "句子" : "词");
            if (c.graduated) badges.push("毕业");
            if (c.error_count > 0) badges.push(`错词×${c.error_count}`);
            return (
              <div key={c.id} className="word-item" onClick={() => setDetail(c.id)} onContextMenu={(e) => {
                e.preventDefault();
                setQuickPeek(c);
                setPeekPos({ x: Math.min(e.clientX, window.innerWidth - 280), y: Math.min(e.clientY, window.innerHeight - 200) });
              }}>
                <div className="word-main">
                  {c.kind === "sentence" ? (
                    <>
                      <div className="word-item-word">
                        {escapeHtml(c.example || c.word)}
                        {badges.map((b, j) => <span key={j} className={`badge ${b === "句子" ? "badge-sentence" : b === "毕业" ? "badge-graduated" : b.startsWith("错词") ? "badge-error" : "badge-word"}`}>{b}</span>)}
                      </div>
                      <div className="word-item-meaning">{escapeHtml(c.example_cn || "")} · 复习 {c.review_count} 次</div>
                    </>
                  ) : (
                    <>
                      <div className="word-item-word">
                        {escapeHtml(c.word)}
                        {badges.map((b, j) => <span key={j} className={`badge ${b === "句子" ? "badge-sentence" : b === "毕业" ? "badge-graduated" : b.startsWith("错词") ? "badge-error" : "badge-word"}`}>{b}</span>)}
                      </div>
                      {c.phonetic && <div className="word-item-phonetic">{escapeHtml(c.phonetic)}</div>}
                      <div className="word-item-meaning">{escapeHtml(c.meaning || "")} · 复习 {c.review_count} 次</div>
                    </>
                  )}
                </div>
                <button className="speak-mini" title="朗读" onClick={(e) => { e.stopPropagation(); speak(c.kind === "sentence" ? (c.example || c.word) : c.word); }}>🔊</button>
              </div>
            );
          })}
        </div>
        <nav className="alpha-nav">
          {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((L) => (
            <button key={L} className={`alpha-btn ${!usedLetters.has(L) ? "alpha-disabled" : ""}`} onClick={() => {
              const el = document.getElementById(`letter-${L}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>{L}</button>
          ))}
        </nav>
      </div>

      {/* 快速查阅浮层 */}
      {quickPeek && (
        <div className="quick-peek" style={{ left: peekPos.x, top: peekPos.y }}>
          <div className="quick-peek-head">
            <span className="qp-word">{quickPeek.kind === "sentence" ? (quickPeek.example || quickPeek.word) : quickPeek.word}</span>
            <button className="speak-mini" onClick={() => speak(quickPeek.kind === "sentence" ? (quickPeek.example || quickPeek.word) : quickPeek.word)}>🔊</button>
          </div>
          {quickPeek.kind !== "sentence" && quickPeek.phonetic && <div className="qp-phonetic">{quickPeek.phonetic}</div>}
          <div className="qp-meaning">{quickPeek.kind === "sentence" ? (quickPeek.example_cn || "") : (quickPeek.meaning || "")}</div>
          {quickPeek.kind !== "sentence" && quickPeek.example && <div className="qp-example">{quickPeek.example}</div>}
          <button className="btn btn-ghost btn-small" style={{ marginTop: 8 }} onClick={() => { setDetail(quickPeek.id); setQuickPeek(null); }}>查看详情 →</button>
        </div>
      )}

      {/* 点击关闭浮层 */}
      {quickPeek && <div style={{ position: "fixed", inset: 0, zIndex: 149 }} onClick={closePeek} />}
    </section>
  );
}

/* ============ 搜索相关性排名 ============ */
function searchRank(card, query) {
  const q = query.toLowerCase();
  const word = (card.word || "").toLowerCase();
  const meaning = (card.meaning || "").toLowerCase();
  const exampleCn = (card.example_cn || "").toLowerCase();
  if (word === q) return 0;
  if (word.startsWith(q)) return 1;
  if (word.includes(q)) return 2;
  if (meaning.includes(q)) return 3;
  if (exampleCn.includes(q)) return 4;
  return 5; // 其他字段（不该出现）
}

/* ============ 学习事件展示 ============ */
const SOURCE_LABELS = {
  study: "队列闪卡",
  lesson: "课程",
  story: "故事",
  card_detail: "词卡详情",
  spelling: "拼写",
  quiz: "测验",
  listening: "听力",
  mixed: "混合",
  reinforcement: "巩固",
  legacy: "未分类",
};
const KIND_LABELS = {
  self_rating: "自评",
  typed: "拼写/填空",
  choice: "选择",
  related: "相关词",
};
const RATING_LABELS = { 1: "忘了", 2: "模糊", 3: "记得", 4: "太简单" };
const ASSISTANCE_LABELS = {
  first_letter: "首字母",
  length: "字母数",
  live_feedback: "逐字反馈",
  answer_audio: "答案发音",
  answer_visible: "提前显示答案",
};

function eventResult(event) {
  if (event.skipped) return "跳过";
  if (event.kind === "self_rating") {
    return RATING_LABELS[event.self_rating] || "自评";
  }
  if (event.correct === true) return "答对";
  if (event.correct === false) return "答错";
  return "结果未知";
}

function LearningEventRow({ event }) {
  const assistance = (event.assistance || []).map(
    (item) => ASSISTANCE_LABELS[item] || item,
  );
  const when = event.occurred_at
    ? new Date(event.occurred_at).toLocaleString()
    : event.learning_day;
  return (
    <div className="tl-item tl-latest" data-testid="learning-event">
      <div className={`tl-dot tl-rating-${event.self_rating || 3}`} />
      <div className="tl-content">
        <span className="tl-label">
          {SOURCE_LABELS[event.source] || event.source} ·{" "}
          {KIND_LABELS[event.kind] || event.kind} · {eventResult(event)}
        </span>
        <span className="tl-date">
          {when}
          {event.scheduled ? " · 已更新排期" : " · 未更新排期"}
          {assistance.length > 0 ? ` · 提示：${assistance.join("、")}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ============ 单词详情子组件 ============ */
function WordDetail({ cardId, onBack, allCards, setDetail }) {
  const [c, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const attempt = useLearningAttempt("card_detail:" + cardId);

  // 找到当前词在列表中的位置，支持上/下一个导航
  const currentIndex = allCards ? allCards.findIndex((x) => x.id === cardId) : -1;
  const prevCard = allCards && currentIndex > 0 ? allCards[currentIndex - 1] : null;
  const nextCard = allCards && currentIndex < allCards.length - 1 ? allCards[currentIndex + 1] : null;

  useEffect(() => {
    setLoading(true);
    api(`/api/cards/${cardId}`).then((d) => { setCard(d); setLoading(false); }).catch(() => setLoading(false));
  }, [cardId]);

  const rateCard = async (rating) => {
    if (!c || attempt.phase === "saving" || attempt.phase === "failed") return;
    try {
      const result = await attempt.submit("/api/reviews", {
        card_id: c.id,
        rating,
        source: "card_detail",
        kind: "self_rating",
        stage: "standalone",
      });
      if (result.committed !== true) return;
      attempt.clear();
      try {
        setCard(await api(`/api/cards/${c.id}`));
      } catch {}
    } catch {}
  };

  const retryRating = async () => {
    try {
      const result = await attempt.retry();
      if (result.committed !== true) return;
      attempt.clear();
      try {
        setCard(await api(`/api/cards/${result.card_id}`));
      } catch {}
    } catch {}
  };

  const toggleHard = async () => {
    try {
      const r = await api(`/api/cards/${c.id}/hard`, { method: "POST" });
      setCard({ ...c, is_hard: r.is_hard });
    } catch {}
  };

  const deleteCard = async () => {
    if (!window.confirm(`删除「${c.word}」？复习记录/记忆法/错词都会一并删除。`)) return;
    try {
      await api(`/api/cards/${c.id}`, { method: "DELETE" });
      onBack();
    } catch {}
  };

  const [pendingExample, setPendingExample] = useState(null);

  const regenerate = async () => {
    try {
      // 保存旧例句用于对比
      const oldExample = c.example;
      const oldExampleCn = c.example_cn;
      const oldExplanation = c.explanation;
      const updated = await api(`/api/cards/${c.id}/regenerate`, { method: "POST" });
      // 如果新例句和旧的不同，显示对比让用户选择
      if (updated.example && updated.example !== oldExample) {
        setPendingExample({ old: { example: oldExample, example_cn: oldExampleCn, explanation: oldExplanation }, new: updated });
      } else {
        setCard(updated);
      }
    } catch (e) {
      showToast("换例句失败：" + e.message, "重试", regenerate);
    }
  };

  const editMeaning = async () => {
    const v = prompt("编辑释义：", c.meaning || "");
    if (v === null) return;
    try {
      const updated = await api(`/api/cards/${c.id}`, { method: "PUT", body: JSON.stringify({ meaning: v.trim() }) });
      setCard(updated);
    } catch {}
  };

  const editMemo = async () => {
    const current = c.memo || "";
    const v = prompt("怎么写这个单词记得更牢？（谐音/联想/小故事）", current);
    if (v === null) return;
    try {
      await api(`/api/memos/${c.id}`, { method: "PUT", body: JSON.stringify({ content: v.trim() }) });
      setCard({ ...c, memo: v.trim() });
    } catch {}
  };

  if (loading) return <div className="story-empty">加载中…</div>;
  if (!c) return <div className="story-empty">加载失败</div>;

  const contexts = Array.isArray(c.contexts) ? c.contexts : [];

  // 讲解三要素分行（用 | 分隔）
  const explanationParts = c.explanation ? c.explanation.split("|").map((s) => s.trim()).filter(Boolean) : [];

  // 掌握度百分比（基于 review_count 和 graduated）
  const masteryPct = c.graduated ? 100 : Math.min(90, c.review_count * 15);

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
        {/* 上/下一个词导航 */}
        <div className="detail-nav">
          {prevCard && <button className="btn btn-ghost btn-small" onClick={() => setDetail(prevCard.id)}>← 上一个</button>}
          {nextCard && <button className="btn btn-ghost btn-small" onClick={() => setDetail(nextCard.id)}>下一个 →</button>}
        </div>
      </div>

      <div className="word-detail-card">
        {c.kind === "sentence" ? (
          <>
            <div className="word-detail-header">
              <div className="word-detail-word word-detail-sentence">{c.example || c.word}</div>
              <button className="speak-btn" title="朗读" onClick={() => speak(c.example || c.word)}>🔊</button>
            </div>
            {c.difficulty === "reading" && <span className="diff-chip">📖 阅读句</span>}
            {/* 意群切分（初学辅助）— 点击单块朗读，可跟读 */}
            <ChunkChips chunks={c.chunks} onSpeak={(t) => speak(t)} style={{ marginTop: 10 }} />
          </>
        ) : (
          <>
            <div className="word-detail-header">
              <div className="word-detail-word">{c.word}</div>
              <button className="speak-btn" title="朗读" onClick={() => speak(c.word)}>🔊</button>
            </div>
            {c.phonetic && <div className="word-detail-phonetic">{c.phonetic}</div>}
          </>
        )}
        <div className="word-detail-badges">
          <span className={`badge ${c.kind === "sentence" ? "badge-sentence" : "badge-word"}`}>{c.kind === "sentence" ? "句子" : "词"}</span>
          {c.graduated && <span className="badge badge-graduated">毕业</span>}
          {c.error_count > 0 && <span className="badge badge-error">错词×{c.error_count}</span>}
          {c.is_hard && <span className="badge badge-error">⭕ 困难词</span>}
        </div>

        {/* 掌握度进度条 */}
        <div className="mastery-bar-wrap">
          <div className="mastery-bar" style={{ width: `${masteryPct}%` }} />
          <span className="mastery-label">{masteryPct}% 掌握</span>
        </div>

        <div className="word-detail-meaning">{c.kind === "sentence" ? (c.example_cn || "") : (c.meaning || "")}</div>

        {/* 例句（或换例句对比） */}
        {pendingExample ? (
          <div className="example-compare">
            <div className="example-compare-label">旧例句：</div>
            <div className="example-compare-old">{pendingExample.old.example}</div>
            <div className="example-cn">{pendingExample.old.example_cn}</div>
            <div className="example-compare-label" style={{ marginTop: 10 }}>新例句：</div>
            <div className="example-compare-new">{pendingExample.new.example}</div>
            <div className="example-cn">{pendingExample.new.example_cn}</div>
            {pendingExample.new.explanation && (
              <div className="explanation-box" style={{ marginTop: 8 }}>
                {pendingExample.new.explanation.split("|").map((s, i) => (
                  <div key={i} className="exp-line"><span className="exp-tag">{["📖 用法", "🔗 搭配", "⚠️ 易错"][i] || ""}</span>{s.trim()}</div>
                ))}
              </div>
            )}
            <div className="example-compare-actions">
              <button className="btn btn-ghost btn-small" onClick={() => {
                // 保留旧的：把新例句写回去（但用户选旧的，所以不更新）
                setPendingExample(null);
              }}>保留旧的</button>
              <button className="btn btn-primary btn-small" onClick={() => {
                // 用新的：更新卡片
                setCard({ ...c, example: pendingExample.new.example, example_cn: pendingExample.new.example_cn, explanation: pendingExample.new.explanation || c.explanation });
                setPendingExample(null);
                showToast("✅ 已换新例句");
              }}>用新的</button>
            </div>
          </div>
        ) : (
          <>
            {/* 词卡：显示例句 */}
            {c.example && c.kind !== "sentence" && (
              <div className="word-detail-example">
                <span>{c.example}</span>
                <button className="speak-mini" title="朗读例句" onClick={() => speak(c.example)}>🔊</button>
                <button className="memo-edit-btn" title="换一个例句" onClick={regenerate}>🔄</button>
              </div>
            )}
            {c.example_cn && c.kind !== "sentence" && (
              <div className="example-cn">{c.example_cn}</div>
            )}
            {/* 句子卡：例句已在头部显示，这里显示中文翻译 */}
            {c.kind === "sentence" && c.example_cn && (
              <div className="example-cn" style={{ fontSize: 15, marginTop: 4 }}>{c.example_cn}</div>
            )}
          </>
        )}

        {/* 讲解三要素 */}
        {explanationParts.length > 0 && (
          <div className="explanation-box">
            {explanationParts.length >= 1 && <div className="exp-line"><span className="exp-tag">📖 用法</span>{explanationParts[0]}</div>}
            {explanationParts.length >= 2 && <div className="exp-line"><span className="exp-tag">🔗 搭配</span>{explanationParts[1]}</div>}
            {explanationParts.length >= 3 && <div className="exp-line"><span className="exp-tag">⚠️ 易错</span>{explanationParts[2]}</div>}
          </div>
        )}

        {/* 记忆法（前置到醒目位置） */}
        {c.memo ? (
          <div className="word-detail-memo">
            <span className="word-detail-memo-label">🧠 我的记忆法</span>
            <span>{c.memo}</span>
            <button className="memo-edit-btn" onClick={editMemo}>✏️</button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-small" style={{ marginTop: 10 }} onClick={editMemo}>🧠 写个记忆法</button>
        )}

        {/* 对话体语境 */}
        {contexts.length > 0 && (
          <div className="bubble-list" style={{ marginTop: 14 }}>
            {contexts.map((ctx, i) => (
              <div key={i} className={`bubble ${i % 2 === 0 ? "bubble-a" : "bubble-b"}`}>
                <div className="bubble-en">{ctx.en}</div>
                <div className="bubble-cn">{ctx.cn}</div>
              </div>
            ))}
          </div>
        )}

        {/* 词族/近义词 */}
        {Array.isArray(c.related_words) && c.related_words.length > 0 && (
          <div className="related-words-box">
            <div className="related-words-label">🔗 相关词</div>
            <div className="related-words-list">
              {c.related_words.map((rw, i) => (
                <span key={i} className="related-word-chip" title={rw.meaning}>
                  {rw.word}
                  <span className="related-word-meaning">{rw.meaning}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 状态卡 */}
      <div className="word-detail-status">
        <div className="status-item"><span className="status-label">复习次数</span><span className="status-value">{c.review_count}</span></div>
        <div className="status-item"><span className="status-label">状态</span><span className="status-value">{c.graduated ? "已毕业 ✅" : c.review_count > 0 ? "学习中" : "新词"}</span></div>
        <div className="status-item"><span className="status-label">下次复习</span><span className="status-value">{c.next_due ? new Date(c.next_due).toLocaleDateString() : "-"}</span></div>
      </div>

      {/* 自测按钮（句子卡不适合拼写测试，隐藏） */}
      {c.kind !== "sentence" && (
        <button className="btn btn-primary btn-wide" style={{ marginTop: 12 }} onClick={() => {
          // 跳转到拼写练习，只测这一个词
          window.dispatchEvent(new CustomEvent("quiz-single-word", { detail: { card: c } }));
          onBack();
        }}>📝 测这个词</button>
      )}

      {/* 学习记录：只展示真实追加事件；旧基线不伪装成作答 */}
      {(c.history_incomplete || c.learning_events?.length > 0 || c.memory_state) && (
      <div style={{ marginTop: 16 }}>
        <h3 className="lesson-section">学习记录</h3>
        {c.history_incomplete && (
          <div className="story-empty" style={{ textAlign: "left", fontSize: 13 }}>
            部分历史记录不完整：升级前或未分类的旧评分无法逐次还原；下方展示已记录的新事件与最后可知活动。
            {c.memory_state?.last_review && (
              <div>
                最后可知活动：
                {new Date(c.memory_state.last_review).toLocaleString()} · 累计{" "}
                {c.memory_state.review_count} 次
              </div>
            )}
          </div>
        )}
        {c.learning_events?.length > 0 ? (
          <div className="timeline">
            {[...c.learning_events].reverse().map((event) => (
              <LearningEventRow key={event.event_id} event={event} />
            ))}
          </div>
        ) : c.memory_state ? (
          <div className="story-empty">
            升级前累计复习 {c.memory_state.review_count} 次
            {c.memory_state.last_review
              ? ` · 最后可知活动 ${new Date(c.memory_state.last_review).toLocaleDateString()}`
              : ""}
          </div>
        ) : null}
      </div>
      )}

      {/* 评分 */}
      <div className="rating-area" style={{ marginTop: 20 }}>
        <RatingButtons
          onRate={rateCard}
          disabled={attempt.phase === "saving" || attempt.phase === "failed"}
        />
        {attempt.phase === "saving" && (
          <p role="status" className="save-state">正在确认保存…</p>
        )}
        {attempt.phase === "failed" && (
          <div role="alert" className="save-state save-state-error">
            <p>{attempt.error}</p>
            <div className="save-state-actions">
              <button className="btn btn-primary btn-small" onClick={retryRating}>继续确认保存</button>
              <button className="btn btn-ghost btn-small" onClick={attempt.clear}>放弃这条待确认</button>
            </div>
          </div>
        )}
      </div>

      {/* 管理操作 */}
      <div className="detail-actions">
        <button className={`btn btn-ghost btn-small ${c.is_hard ? "hard-active" : ""}`} onClick={toggleHard}>⭕ 困难词</button>
        <button className="btn btn-ghost btn-small" onClick={editMemo}>🧠 记忆法</button>
        <button className="btn btn-ghost btn-small" onClick={editMeaning}>✏️ 编辑</button>
        <button className="btn btn-ghost btn-small danger" onClick={deleteCard}>🗑 删除</button>
      </div>
    </section>
  );
}
