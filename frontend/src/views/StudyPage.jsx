import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml, highlightWord, storageGet, storageSet } from "../lib/utils.js";
import { splitSentence } from "../lib/chunks.js";
import { showToast } from "../App.jsx";

// 意群角色中文标签（悬浮提示）
const ROLE_LABELS = { subject: "主语", predicate: "谓宾", adverbial: "状语" };
const roleLabel = (role) => (role && ROLE_LABELS[role]) || "意群";

/**
 * 闪卡学习视图。
 * queue: Card[] 待学习的卡
 * onExit: () => void 返回队列
 * onToQuiz: () => void 进测验
 */
export default function StudyPage({ queue, onExit, onToQuiz, onToMixed }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [graduated, setGraduated] = useState([]);
  const [answered, setAnswered] = useState(0);
  const [flipStartedAt, setFlipStartedAt] = useState(null);
  const [memoText, setMemoText] = useState(null);
  const cardRef = useRef(null);
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);
  // 中文翻译档位：auto=复习<3次显示，>=3次自动隐藏；on=常显；off=隐藏
  const [cnMode, setCnMode] = useState(() => storageGet("sentenceCnMode", "auto"));

  useEffect(() => {
    storageSet("sentenceCnMode", cnMode);
  }, [cnMode]);
  // 词查询状态（必须放在所有条件 return 之前，hook 顺序不能变）
  const [lookupWord, setLookupWord] = useState(null);
  const [lookupResult, setLookupResult] = useState(null);

  const total = queue.length;
  const card = idx < total ? queue[idx] : null;
  const isSentence = card?.kind === "sentence";

  // 智能默认：auto 模式下按复习次数渐进（card 定义后计算，避免 TDZ）
  const showSentenceCn =
    cnMode === "on" ||
    (cnMode === "auto" && (card?.review_count ?? 0) < 3);

  // 每张卡重置
  useEffect(() => {
    if (done || !card) return;
    setFlipped(false);
    setFlipStartedAt(Date.now());
    setMemoText(null);
    // 加载记忆法
    api(`/api/memos/${card.id}`).then((d) => setMemoText(d.content)).catch(() => {});
  }, [idx, done]);

  // 翻面（支持翻回）
  const flip = useCallback(() => {
    if (!card || exiting || done) return;
    setFlipped((f) => {
      const next = !f;
      if (next) {
        const elapsed = (Date.now() - (flipStartedAt || Date.now())) / 1000;
        if (elapsed < 2) {
          showToast("先自己回想一下这个词的含义，再翻面对照效果更好 ✍️");
        }
        speak(isSentence ? (card.example || card.word) : card.word, null);
      }
      return next;
    });
  }, [card, flipStartedAt, isSentence, exiting, done]);

  // 评分
  const rate = useCallback(async (rating) => {
    if (!card || done) return;
    const isLast = idx + 1 >= total;
    if (!isLast && exiting) return;

    const elapsed = (Date.now() - (flipStartedAt || Date.now())) / 1000;
    if (rating >= 3 && elapsed < 2) {
      showToast("这个评分是你回想后的吗？下次先想出声再翻面，记忆更准");
    }
    try {
      const resp = await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: card.id, rating }),
      });
      if (resp.graduated) setGraduated((g) => [...g, card.word]);
    } catch {}
    const nextAnswered = answered + 1;
    setAnswered(nextAnswered);

    if (isLast) {
      // 最后一张：直接完成
      setDone(true);
      return;
    }
    // 非最后一张：动画后进下一题
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setIdx((i) => i + 1);
    }, 320);
  }, [card, idx, total, flipStartedAt, exiting, done, answered]);

  // 完成态
  if (done) {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎉</div>
          <h2>今天的词都过了一遍</h2>
          <p className="done-detail">
            {graduated.length > 0 && `${graduated.length} 个词毕业了：${graduated.join("、")} — 例句已变成句子卡。`}
            {answered} 张卡已复习，明天的队列会按你的记忆自动安排。
          </p>
          <div className="done-actions">
            <button className="btn btn-primary" onClick={onToQuiz}>去做测验</button>
            {onToMixed && <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onToMixed}>🎲 再练一轮混合</button>}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>← 返回队列</button>
          </div>
        </div>
      </section>
    );
  }

  if (!card) return null;

  // 对话体句子：按 A:/B: 分行渲染为气泡
  const isDialog = isSentence && /^A:/m.test(card.example || "");
  const dialogLines = isDialog
    ? (card.example || "").split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
  const frontMain = isSentence ? highlightWord(card.example || card.word, card.word) : escapeHtml(card.word);
  const backMeaning = isSentence ? (card.example_cn || "") : (card.meaning || "");
  const backExample = !isSentence && card.example ? highlightWord(card.example, card.word) : "";
  const contexts = Array.isArray(card.contexts) ? card.contexts : [];

  // 意群切分：优先 AI chunks，兜底启发式。chunks 可能是 {text,role} 或纯字符串
  const chunkList = isSentence
    ? (Array.isArray(card.chunks) && card.chunks.length > 0
        ? card.chunks.map((ch) => typeof ch === "string" ? { text: ch, role: null } : ch)
        : splitSentence(card.example || "").map((t) => ({ text: t, role: null })))
    : [];

  const handleExampleWordClick = async (e, word) => {
    e.stopPropagation();
    const clean = word.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
    if (!clean || clean.length < 2) return;
    setLookupWord(clean);
    setLookupResult(null);
    try {
      const r = await api(`/api/lookup/${encodeURIComponent(clean)}`);
      setLookupResult(r);
    } catch {
      setLookupResult({ found: false });
    }
  };

  const renderClickableExample = (text) => {
    return text.split(/(\s+)/).map((tok, i) => {
      if (/^\s+$/.test(tok)) return tok;
      const clean = tok.replace(/[^a-zA-Z'-]/g, "").toLowerCase();
      if (clean.length > 1) {
        return <span key={i} className="example-clickable-word" onClick={(e) => handleExampleWordClick(e, tok)}>{tok}</span>;
      }
      return <span key={i}>{tok}</span>;
    });
  };

  return (
    <section className="view view-practice">
      <div className="study-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 退出</button>
        <span className="study-count">{idx + 1} / {total}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      <div className="scene">
        <div
          ref={cardRef}
          className={`card ${flipped ? "flipped" : ""} ${isSentence ? "card-tall" : ""} ${exiting ? (idx % 2 === 0 ? "leave-left" : "leave-right") : "enter"}`}
          onClick={flip}
          tabIndex={0}
          role="button"
          aria-label="点击翻面"
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && flip()}
        >
          <div className="card-face card-front">
            {isDialog ? (
              <div className="front-dialog">
                {dialogLines.map((line, i) => {
                  const isA = line.startsWith("A:");
                  const body = highlightWord(line.replace(/^[AB]:\s*/, ""), card.word);
                  return (
                    <div key={i} className={`dialog-line ${isA ? "dialog-a" : "dialog-b"}`}>
                      <span className="dialog-name">{isA ? "A" : "B"}</span>
                      <span className="dialog-text" dangerouslySetInnerHTML={{ __html: body }} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={`front-main ${isSentence ? "has-mark" : ""}`} dangerouslySetInnerHTML={{ __html: frontMain }} />
            )}
            <div className="front-phonetic">
              {isSentence ? card.word : (card.phonetic || "")}
              {isSentence && card.difficulty === "reading" &&
                <span className="diff-chip">📖 阅读句</span>}
            </div>
            {/* 句子卡：意群切分提示（初学友好）— 点击单块朗读，可跟读 */}
            {isSentence && chunkList.length > 1 && (
              <div className="front-chunks">
                {chunkList.map((ch, i) => (
                  <span
                    key={i}
                    className={`chunk ${ch.role ? `role-${ch.role}` : `chip-${i % 3}`}`}
                    title={`${roleLabel(ch.role)} · 点击朗读`}
                    onClick={(e) => { e.stopPropagation(); speak(ch.text); }}
                  >{ch.text}</span>
                ))}
              </div>
            )}
            {/* 句子卡：正面显示中文翻译（初学友好，可在设置关闭） */}
            {isSentence && showSentenceCn && card.example_cn && (
              <div className="front-sentence-cn">{card.example_cn}</div>
            )}
            <button className="speak-btn" title="朗读" onClick={(e) => { e.stopPropagation(); speak(isSentence ? (card.example || card.word) : card.word); }}>🔊</button>
            <span className="flip-hint">先回想 3 秒 · 点这翻面对照</span>
          </div>
          <div className="card-face card-back">
            <span className="flip-hint flip-hint-back">点这翻回正面</span>
            <div className="back-meaning">{backMeaning}</div>
            {backExample && (
              <div className="back-example-block">
                <div className="back-example">{renderClickableExample(card.example)}</div>
                {card.example_cn && <div className="back-example-cn">{card.example_cn}</div>}
                <button className="speak-mini" title="朗读例句" onClick={(e) => { e.stopPropagation(); speak(card.example); }}>🔊</button>
              </div>
            )}
            {/* 词查询浮层 */}
            {lookupWord && (
              <div className="back-lookup-panel" onClick={(e) => e.stopPropagation()}>
                <div className="back-lookup-head">
                  <b>{lookupWord}</b>
                  <button className="speak-mini" onClick={() => speak(lookupWord)}>🔊</button>
                  <button className="story-word-panel-close" onClick={() => { setLookupWord(null); setLookupResult(null); }}>✕</button>
                </div>
                {lookupResult?.phonetic && <div className="back-lookup-phonetic">{lookupResult.phonetic}</div>}
                <div className="back-lookup-meaning">{lookupResult?.meaning || (lookupResult?.found === false ? "暂无释义" : "查询中…")}</div>
              </div>
            )}
            {contexts.length > 0 && (
              <div className="bubble-list">
                {contexts.map((ctx, i) => (
                  <div key={i} className={`bubble ${i % 2 === 0 ? "bubble-a" : "bubble-b"}`}>
                    <div className="bubble-en">{ctx.en}</div>
                    <div className="bubble-cn">{ctx.cn}</div>
                  </div>
                ))}
              </div>
            )}
            {memoText && (
              <div className="back-memo">
                <div className="back-memo-label">🧠 你的记忆法</div>
                <div className="back-memo-content">
                  <span>{memoText}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 评分按钮：包裹层常驻占位（高度已在 CSS 预留），翻面后按钮永远在首屏 */}
      <div className="rating-area">
        {flipped && (
          <div className="rating-buttons">
            {[1, 2, 3, 4].map((r) => (
              <button key={r} className={`btn-rating rating-${r}`} onClick={() => rate(r)}>
                {r}
                <span className="rating-label">{r === 1 ? "忘了" : r === 2 ? "模糊" : r === 3 ? "记得" : "太简单"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
