import React, { useState, useEffect, useRef } from "react";
import { api } from "../lib/api.js";
import { speak, prewarmTts } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { showToast } from "../App.jsx";

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

  useEffect(() => {
    api("/api/cards").then((d) => {
      setAllCards(d.cards);
      prewarmTts(d.cards.map((c) => c.kind === "sentence" ? (c.example || c.word) : c.word));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = query
    ? allCards.filter((c) =>
        (c.word || "").toLowerCase().includes(query) ||
        (c.meaning || "").toLowerCase().includes(query) ||
        (c.example_cn || "").toLowerCase().includes(query)
      )
    : allCards;

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
    return <WordDetail cardId={detail} onBack={() => setDetail(null)} />;
  }

  // 点击关闭快速查阅
  const closePeek = () => { setQuickPeek(null); };

  return (
    <section className="view">
      <div className="page-head">
        <h2 className="page-title">单词本</h2>
      </div>
      <div className="word-search-bar">
        <input className="word-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单词或释义…" />
        {query && <span className="word-search-count">{filtered.length} 个结果</span>}
      </div>
      <div className="word-list-wrap">
        <div className="word-list">
          {filtered.length === 0 && <div className="story-empty">还没有卡片，先去「加词」添加第一个吧</div>}
          {grouped.map((g, i) => {
            if (g.type === "header") {
              return <div key={i} className="word-letter-header" id={`letter-${g.letter}`}>{g.letter}</div>;
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
                  <div className="word-item-word">
                    {escapeHtml(c.word)}
                    {badges.map((b, j) => <span key={j} className={`badge ${b === "句子" ? "badge-sentence" : b === "毕业" ? "badge-graduated" : b.startsWith("错词") ? "badge-error" : "badge-word"}`}>{b}</span>)}
                  </div>
                  {c.phonetic && <div className="word-item-phonetic">{escapeHtml(c.phonetic)}</div>}
                  <div className="word-item-meaning">{escapeHtml(c.kind === "sentence" ? (c.example_cn || c.example || "") : (c.meaning || ""))} · 复习 {c.review_count} 次</div>
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
            <span className="qp-word">{quickPeek.word}</span>
            <button className="speak-mini" onClick={() => speak(quickPeek.word)}>🔊</button>
          </div>
          {quickPeek.phonetic && <div className="qp-phonetic">{quickPeek.phonetic}</div>}
          <div className="qp-meaning">{quickPeek.meaning}</div>
          {quickPeek.example && <div className="qp-example">{quickPeek.example}</div>}
          <button className="btn btn-ghost btn-small" style={{ marginTop: 8 }} onClick={() => { setDetail(quickPeek.id); setQuickPeek(null); }}>查看详情 →</button>
        </div>
      )}

      {/* 点击关闭浮层 */}
      {quickPeek && <div style={{ position: "fixed", inset: 0, zIndex: 149 }} onClick={closePeek} />}
    </section>
  );
}

/* ============ 单词详情子组件 ============ */
function WordDetail({ cardId, onBack }) {
  const [c, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/cards/${cardId}`).then((d) => { setCard(d); setLoading(false); }).catch(() => setLoading(false));
  }, [cardId]);

  const rateCard = async (rating) => {
    try {
      await api("/api/reviews", { method: "POST", body: JSON.stringify({ card_id: c.id, rating }) });
      const updated = await api(`/api/cards/${c.id}`);
      setCard(updated);
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

  const regenerate = async () => {
    try {
      const updated = await api(`/api/cards/${c.id}/regenerate`, { method: "POST" });
      setCard(updated);
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

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
      </div>
      <div className="word-detail-card">
        <div className="word-detail-header">
          <div className="word-detail-word">{c.word}</div>
          <button className="speak-btn" title="朗读" onClick={() => speak(c.word)}>🔊</button>
        </div>
        {c.phonetic && <div className="word-detail-phonetic">{c.phonetic}</div>}
        <div className="word-detail-badges">
          <span className={`badge ${c.kind === "sentence" ? "badge-sentence" : "badge-word"}`}>{c.kind === "sentence" ? "句子" : "词"}</span>
          {c.graduated && <span className="badge badge-graduated">毕业</span>}
          {c.error_count > 0 && <span className="badge badge-error">错词×{c.error_count}</span>}
          {c.is_hard && <span className="badge badge-error">⭕ 困难词</span>}
        </div>
        <div className="word-detail-meaning">{c.kind === "sentence" ? (c.example_cn || "") : (c.meaning || "")}</div>
        {c.example && c.kind !== "sentence" && (
          <div className="word-detail-example">
            <span>{c.example}</span>
            <button className="speak-mini" title="朗读例句" onClick={() => speak(c.example)}>🔊</button>
            <button className="memo-edit-btn" title="换一个例句" onClick={regenerate}>🔄</button>
          </div>
        )}
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
        {c.explanation && <div className="word-detail-explanation">{c.explanation}</div>}
        {c.memo && (
          <div className="word-detail-memo">
            <span className="word-detail-memo-label">🧠 我的记忆法</span>
            <span>{c.memo}</span>
            <button className="memo-edit-btn" onClick={editMemo}>✏️</button>
          </div>
        )}
      </div>

      {/* 状态卡 */}
      <div className="word-detail-status">
        <div className="status-item"><span className="status-label">复习次数</span><span className="status-value">{c.review_count}</span></div>
        <div className="status-item"><span className="status-label">状态</span><span className="status-value">{c.graduated ? "已毕业 ✅" : c.review_count > 0 ? "学习中" : "新词"}</span></div>
        <div className="status-item"><span className="status-label">下次复习</span><span className="status-value">{c.next_due ? new Date(c.next_due).toLocaleDateString() : "-"}</span></div>
      </div>

      {/* 复习历史 */}
      {c.review_history?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 className="lesson-section">复习历史</h3>
          <div className="detail-history">
            {c.review_history.map((r, i) => {
              const date = r.last_review ? new Date(r.last_review).toLocaleDateString() : "-";
              const ratingNames = { 1: "忘了", 2: "模糊", 3: "记得", 4: "太简单" };
              const stateNames = { 0: "新词", 1: "学习中", 2: "重学", 3: "熟练" };
              const label = r.rating ? ratingNames[r.rating] : stateNames[r.state] || "复习";
              const kind = r.rating ? `rating-${r.rating}` : `state-${r.state}`;
              return (
                <div key={i} className="history-row">
                  <span className="history-date">{date}</span>
                  <span className={`history-rating ${kind}`}>{label}</span>
                  <span className="history-count">第 {r.review_count} 次</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 评分 */}
      <div className="rating-area" style={{ marginTop: 20 }}>
        <div className="rating-buttons">
          {[1, 2, 3, 4].map((r) => (
            <button key={r} className={`btn-rating rating-${r}`} onClick={() => rateCard(r)}>
              {r}<span className="rating-label">{r === 1 ? "忘了" : r === 2 ? "模糊" : r === 3 ? "记得" : "太简单"}</span>
            </button>
          ))}
        </div>
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
