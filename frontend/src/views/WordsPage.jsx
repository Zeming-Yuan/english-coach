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
    return <WordDetail cardId={detail} onBack={() => setDetail(null)} allCards={filtered} setDetail={setDetail} />;
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

/* ============ 单词详情子组件 ============ */
function WordDetail({ cardId, onBack, allCards, setDetail }) {
  const [c, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  // 找到当前词在列表中的位置，支持上/下一个导航
  const currentIndex = allCards ? allCards.findIndex((x) => x.id === cardId) : -1;
  const prevCard = allCards && currentIndex > 0 ? allCards[currentIndex - 1] : null;
  const nextCard = allCards && currentIndex < allCards.length - 1 ? allCards[currentIndex + 1] : null;

  useEffect(() => {
    setLoading(true);
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
              <div className="word-detail-word" style={{ fontSize: 18 }}>{c.example || c.word}</div>
              <button className="speak-btn" title="朗读" onClick={() => speak(c.example || c.word)}>🔊</button>
            </div>
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

      {/* 复习历史可视化时间线 */}
      {c.review_history?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 className="lesson-section">复习历史</h3>
          <div className="timeline">
            {[...c.review_history].reverse().map((r, i) => {
              const date = r.last_review ? new Date(r.last_review).toLocaleDateString() : "-";
              const ratingNames = { 1: "忘了", 2: "模糊", 3: "记得", 4: "太简单" };
              const stateNames = { 0: "新词", 1: "学习中", 2: "重学", 3: "熟练" };
              const label = r.rating ? ratingNames[r.rating] : stateNames[r.state] || "复习";
              const ratingClass = r.rating ? `tl-rating-${r.rating}` : `tl-state-${r.state}`;
              const isLast = i === c.review_history.length - 1;
              return (
                <div key={i} className={`tl-item ${isLast ? "tl-latest" : ""}`}>
                  <div className={`tl-dot ${ratingClass}`} />
                  {i < c.review_history.length - 1 && <div className={`tl-line ${ratingClass}`} />}
                  <div className="tl-content">
                    <span className="tl-label">{label}</span>
                    <span className="tl-date">{date} · 第 {r.review_count} 次</span>
                  </div>
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
