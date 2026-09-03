import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { sfxSuccess, sfxFail } from "../lib/sfx.js";
import { storageGet, storageSet } from "../lib/utils.js";
import SpellingBoard from "../components/SpellingBoard.jsx";

/**
 * 拼写练习视图（Qwerty 风格 + 渐褪提示三档）。
 * singleCard: 如果传入，只测这一个词（从单词详情页"测这个词"跳转）
 */
export default function SpellingPage({ onExit, singleCard }) {
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [difficulty, setDifficulty] = useState(() => storageGet("spellingDiff", 2));
  const [feedback, setFeedback] = useState(null);
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState("loading");
  const inputRef = useRef(null);

  useEffect(() => {
    // 单词详情页跳转：只测一个词
    if (singleCard) {
      setQueue([singleCard]);
      setPhase("ready");
      return;
    }
    async function load() {
      try {
        const data = await api("/api/today");
        let pool = [...(data.error_cards || []), ...data.new_cards, ...data.due_cards].filter((c) => c.kind === "word");
        if (pool.length === 0) {
          const allData = await api("/api/cards");
          pool = allData.cards.filter((c) => c.kind === "word");
        }
        if (pool.length === 0) {
          setPhase("empty");
          return;
        }
        setQueue(pool);
        setPhase("ready");
      } catch {
        setPhase("empty");
      }
    }
    load();
  }, []);

  const card = queue[idx];
  const total = queue.length;

  useEffect(() => {
    if (phase === "ready" && card) {
      setFeedback(null);
    }
  }, [idx, phase, card?.id]);

  // 提交（SpellingBoard 输满自动触发/Enter 触发；防重锁在组件内）
  const handleSubmit = useCallback(async (userInput) => {
    if (!card || feedback) return;
    let resp;
    try {
      resp = await api("/api/typing/check", {
        method: "POST",
        body: JSON.stringify({ card_id: card.id, user_input: userInput }),
      });
    } catch (e) {
      throw e; // 解锁组件，允许重试
    }
    const ok = resp.correct;
    if (ok) sfxSuccess(); else sfxFail();
    speak(card.word, null);
    setFeedback({ correct: ok, expected: card.word });
    if (ok) setCorrect((c) => c + 1);
    // FSRS
    api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ card_id: card.id, rating: ok ? 3 : 1 }),
    }).catch(() => {});
  }, [card, feedback]);

  const nextCard = useCallback(() => {
    setFeedback(null);
    if (idx + 1 < total) {
      setIdx((i) => i + 1);
    } else {
      setDone(true);
    }
  }, [idx, total]);

  // 反馈阶段 Enter → 下一题
  useEffect(() => {
    if (!feedback) return;
    const handler = (e) => {
      if (e.key === "Enter") { e.preventDefault(); nextCard(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [feedback, nextCard]);

  const skip = useCallback(() => {
    if (!card) return;
    // 跳过不判错，直接显示答案并前进
    speak(card.word, null);
    setFeedback({ correct: false, expected: card.word });
  }, [card]);

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">还没有单词，先去加词吧</div>;
  if (done) {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">⌨️</div>
          <h2>拼写完成！</h2>
          <p className="done-detail">拼对 {correct}/{total} 词（{Math.round(correct / total * 100)} 分）</p>
          <button className="btn btn-primary" onClick={() => { setIdx(0); setCorrect(0); setDone(false); setFeedback(null); }}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!card) return null;

  const diffLabels = { 1: "教过：首字母已提示", 2: "提示：空格数提醒", 3: "独立：完全靠自己" };

  return (
    <section className="view view-practice">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
      </div>
      <div className="spelling-head">
        <span className="study-count">{idx + 1} / {total}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      {/* 难度选择 */}
      <div className="spelling-difficulty">
        {[1, 2, 3].map((d) => (
          <button
            key={d}
            className={`diff-btn ${difficulty === d ? "diff-active" : ""}`}
            onClick={() => { setDifficulty(d); storageSet("spellingDiff", d); }}
          >
            {d === 1 ? "教过" : d === 2 ? "提示" : "独立"}
          </button>
        ))}
      </div>

      <div className="spelling-body">
        <div className="spelling-meaning">{card.meaning}</div>
        {card.phonetic && <div className="spelling-phonetic">{card.phonetic}</div>}
        <SpellingBoard
          key={card.id}
          target={card.word}
          onSubmit={handleSubmit}
          showFirstHint={difficulty === 1}
          disabled={!!feedback}
          inputRef={inputRef}
        />
        <div className="spelling-hint">输入上面的英文单词 · {diffLabels[difficulty]}</div>
        {feedback && (
          <div className={`spelling-feedback ${feedback.correct ? "ok" : "err"}`}>
            {feedback.correct ? "✅ 正确！" : `❌ 正确拼写：${feedback.expected}`}
          </div>
        )}
      </div>

      {/* 主操作：钉在首屏底部，不随内容滚动 */}
      <div className="practice-actions">
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? nextCard : skip}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
