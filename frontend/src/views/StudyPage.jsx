import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { sfxSuccess, sfxFail } from "../lib/sfx.js";
import { escapeHtml, highlightWord } from "../lib/utils.js";
import { showToast } from "../App.jsx";

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
  const [showMemoInput, setShowMemoInput] = useState(false);
  const cardRef = useRef(null);
  const [exiting, setExiting] = useState(false);

  const card = queue[idx];
  const total = queue.length;
  const isSentence = card?.kind === "sentence";

  // 每张卡重置
  useEffect(() => {
    setFlipped(false);
    setFlipStartedAt(Date.now());
    setMemoText(null);
    setShowMemoInput(false);
    // 加载记忆法
    if (card) {
      api(`/api/memos/${card.id}`).then((d) => setMemoText(d.content)).catch(() => {});
    }
  }, [idx, card?.id]);

  // 翻面
  const flip = useCallback(() => {
    if (!card || exiting) return;
    const elapsed = (Date.now() - (flipStartedAt || Date.now())) / 1000;
    setFlipped(true);
    // JOL 提醒
    if (elapsed < 2) {
      showToast("先自己回想一下这个词的含义，再翻面对照效果更好 ✍️");
    }
    // 自动发音
    const text = isSentence ? (card.example || card.word) : card.word;
    speak(text, null);
  }, [card, flipStartedAt, isSentence, exiting]);

  // 评分
  const rate = useCallback(async (rating) => {
    if (!card || exiting) return;
    setExiting(true);
    const elapsed = (Date.now() - (flipStartedAt || Date.now())) / 1000;
    // JOL 校准
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
    setAnswered((a) => a + 1);
    // 动画延迟后进下一题
    setTimeout(() => {
      setExiting(false);
      if (idx + 1 < total) {
        setIdx((i) => i + 1);
      } else {
        // 完成
        setIdx(total); // 触发完成态
      }
    }, 320);
  }, [card, idx, total, flipStartedAt, exiting]);

  // 完成态
  if (idx >= total) {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎉</div>
          <h2>今天的词都过了一遍</h2>
          <p className="done-detail">
            {graduated.length > 0 && `${graduated.length} 个词毕业了：${graduated.join("、")} — 例句已变成句子卡。`}
            {answered} 张卡已复习，明天的队列会按你的记忆自动安排。
          </p>
          <button className="btn btn-primary" onClick={onToQuiz}>去做测验</button>
          {onToMixed && <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onToMixed}>🎲 再练一轮混合</button>}
        </div>
      </section>
    );
  }

  if (!card) return null;

  const frontMain = isSentence ? highlightWord(card.example || card.word, card.word) : escapeHtml(card.word);
  const backMeaning = isSentence ? (card.example_cn || "") : (card.meaning || "");
  const backExample = !isSentence && card.example ? highlightWord(card.example, card.word) : "";
  const contexts = Array.isArray(card.contexts) ? card.contexts : [];

  return (
    <section className="view">
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
          className={`card ${flipped ? "flipped" : ""} ${exiting ? (card && idx % 2 === 0 ? "leave-left" : "leave-right") : "enter"}`}
          onClick={flip}
          tabIndex={0}
          role="button"
          aria-label="点击翻面"
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && flip()}
        >
          <div className="card-face card-front">
            <div className={`front-main ${isSentence ? "has-mark" : ""}`} dangerouslySetInnerHTML={{ __html: frontMain }} />
            <div className="front-phonetic">{isSentence ? card.word : (card.phonetic || "")}</div>
            <button className="speak-btn" title="朗读" style={{ position: "absolute", top: 14, right: 16 }} onClick={(e) => { e.stopPropagation(); speak(isSentence ? (card.example || card.word) : card.word); }}>🔊</button>
            <span className="flip-hint">先回想 3 秒 · 点这翻面对照</span>
          </div>
          <div className="card-face card-back">
            <div className="back-meaning">{backMeaning}</div>
            {backExample && <div className="back-example" dangerouslySetInnerHTML={{ __html: backExample }} />}
            {card.example && <button className="speak-btn" title="朗读例句" style={{ position: "absolute", top: 14, right: 16 }} onClick={(e) => { e.stopPropagation(); speak(card.example); }}>🔊</button>}
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

      {/* 评分按钮 */}
      <div className={`rating-area ${flipped ? "" : ""}`} style={{ display: flipped ? "block" : "none" }}>
        <div className="rating-buttons">
          {[1, 2, 3, 4].map((r) => (
            <button key={r} className={`btn-rating rating-${r}`} onClick={() => rate(r)}>
              {r}
              <span className="rating-label">{r === 1 ? "忘了" : r === 2 ? "模糊" : r === 3 ? "记得" : "太简单"}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
