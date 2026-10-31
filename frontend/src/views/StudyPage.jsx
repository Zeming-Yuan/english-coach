import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { loadPending } from "../lib/learning.js";
import { cleanToken, escapeHtml, highlightWord, storageGet, storageSet } from "../lib/utils.js";
import { splitSentence } from "../lib/chunks.js";
import { useWordLookup } from "../lib/wordLookup.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";
import ChunkChips from "../components/ChunkChips.jsx";
import RatingButtons from "../components/RatingButtons.jsx";

/**
 * 闪卡学习视图。
 * queue: Card[] 待学习的卡
 * onExit: () => void 返回队列
 * onToQuiz: () => void 进测验
 */
export default function StudyPage({ queue, session, onProgress, onAbort, onExit, onToQuiz, onToMixed }) {
  const [standaloneIdx, setStandaloneIdx] = useState(0);
  const idx = session ? session.index : standaloneIdx;
  const [flipped, setFlipped] = useState(false);
  const [graduated, setGraduated] = useState([]);
  const [standaloneAnswered, setStandaloneAnswered] = useState(0);
  const answered = session ? session.index : standaloneAnswered;
  const [flipStartedAt, setFlipStartedAt] = useState(null);
  const [memoText, setMemoText] = useState(null);
  const cardRef = useRef(null);
  const [exiting, setExiting] = useState(false);
  const [standaloneDone, setStandaloneDone] = useState(false);
  const done = session ? session.complete === true : standaloneDone;
  // 中文翻译档位：auto=复习<3次显示，>=3次自动隐藏；on=常显；off=隐藏
  const [cnMode, setCnMode] = useState(() => storageGet("sentenceCnMode", "auto"));
  // 每日主队列复用固定会话 ID；专项自评使用独立 ID。
  const [sessionId] = useState(() => session?.id || crypto.randomUUID());
  const attempt = useLearningAttempt("study");

  // A home recovery already in flight can finish after this screen mounts.
  // The daily session owns progress; discard the hook's stale pending copy only
  // after the shared pending record has actually been resolved.
  useEffect(() => {
    if (session && !loadPending("study")) attempt.clear();
  }, [session?.id, idx, attempt.clear]);

  useEffect(() => {
    storageSet("sentenceCnMode", cnMode);
  }, [cnMode]);
  // 词查询状态（必须放在所有条件 return 之前，hook 顺序不能变）
  const { word: lookupWord, result: lookupResult, open: handleExampleWordClick, close: closeLookup } = useWordLookup();

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

  // 只有服务端确认保存才推进；失败停留当前题并保留同一提交标识。
  const advance = useCallback(() => {
    if (session) {
      setFlipped(false);
      onProgress(card.id);
      return;
    }
    setStandaloneAnswered((n) => n + 1);
    if (idx + 1 >= total) {
      // 最后一张：直接完成
      setStandaloneDone(true);
      return;
    }
    // 非最后一张：动画后进下一题
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setStandaloneIdx((i) => i + 1);
    }, 320);
  }, [idx, total, session, onProgress, card]);

  const rate = useCallback(async (rating) => {
    if (!card || done || exiting) return;
    if (attempt.phase === "saving" || attempt.phase === "failed") return;
    const isLast = idx + 1 >= total;
    if (!isLast && exiting) return;

    const elapsed = (Date.now() - (flipStartedAt || Date.now())) / 1000;
    if (rating >= 3 && elapsed < 2) {
      showToast("这个评分是你回想后的吗？下次先想出声再翻面，记忆更准");
    }
    try {
      const result = await attempt.submit("/api/reviews", {
        card_id: card.id,
        rating,
        source: "study",
        kind: "self_rating",
        session_id: sessionId,
        stage: session ? "main" : "standalone",
      });
      if (result.committed !== true) return;
      if (result.newly_graduated) setGraduated((g) => [...g, card.word]);
      attempt.clear();
      advance();
    } catch {
      // 失败保留当前题与待确认请求，由 role=alert 提供继续确认/放弃。
    }
  }, [card, idx, total, flipStartedAt, exiting, done, attempt, sessionId, advance]);

  const retrySave = useCallback(async () => {
    try {
      const result = await attempt.retry();
      if (result.committed !== true) return;
      attempt.clear();
      if (!card || result.card_id !== card.id) {
        showToast("已确认保存上一条学习记录");
        return;
      }
      if (result.newly_graduated) setGraduated((g) => [...g, card.word]);
      advance();
    } catch {}
  }, [attempt, card, advance]);

  // 完成态
  if (done) {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎉</div>
          <h2>{session ? "本轮主队列已保存" : "今天的词都过了一遍"}</h2>
          <p className="done-detail">
            {graduated.length > 0 && `${graduated.length} 个词毕业了：${graduated.join("、")} — 例句已变成句子卡。`}
            {session ? `${answered} 张卡已保存，可返回查看剩余到期任务。` : `${answered} 张卡已复习，明天的队列会按你的记忆自动安排。`}
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

  // 意群切分：优先 AI chunks，兜底启发式（渲染共用 ChunkChips）
  const chunkList = isSentence
    ? (Array.isArray(card.chunks) && card.chunks.length > 0
        ? card.chunks
        : splitSentence(card.example || "").map((t) => ({ text: t, role: null })))
    : [];

  const renderClickableExample = (text) => {
    return text.split(/(\s+)/).map((tok, i) => {
      if (/^\s+$/.test(tok)) return tok;
      const clean = cleanToken(tok);
      if (clean.length > 1) {
        return <span key={i} className="example-clickable-word" onClick={(e) => { e.stopPropagation(); handleExampleWordClick(tok); }}>{tok}</span>;
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
            {isSentence && (
              <ChunkChips chunks={chunkList} onSpeak={(t) => speak(t)} />
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
                  <b>{lookupWord.word}</b>
                  <button className="speak-mini" onClick={() => speak(lookupWord.word)}>🔊</button>
                  <button className="story-word-panel-close" onClick={closeLookup}>✕</button>
                </div>
                {lookupWord.phonetic && <div className="back-lookup-phonetic">{lookupWord.phonetic}</div>}
                <div className="back-lookup-meaning">{lookupWord.meaning || (lookupResult.status === "missing" ? "暂无释义" : "查询中…")}</div>
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
          <RatingButtons
            onRate={rate}
            disabled={attempt.phase === "saving" || attempt.phase === "failed"}
          />
        )}
        {attempt.phase === "saving" && (
          <p role="status" className="save-state">正在确认保存…</p>
        )}
        {attempt.phase === "failed" && (
          <div role="alert" className="save-state save-state-error">
            <p>{attempt.error}</p>
            <div className="save-state-actions">
              <button className="btn btn-primary btn-small" onClick={retrySave}>继续确认保存</button>
              <button className="btn btn-ghost btn-small" onClick={attempt.clear}>放弃这条待确认</button>
              {session && <button className="btn btn-ghost btn-small" onClick={() => { attempt.clear(); onAbort(); }}>退出本轮并重新加载</button>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
