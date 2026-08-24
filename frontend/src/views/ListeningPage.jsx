import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { sfxSuccess, sfxFail } from "../lib/sfx.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 听写练习视图：播发音 → 4 选 1。
 */
export default function ListeningPage({ onExit }) {
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    api("/api/listening").then((d) => {
      if (d.questions.length === 0) { setPhase("empty"); return; }
      setQuestions(d.questions);
      setPhase("ready");
    }).catch(() => setPhase("empty"));
  }, []);

  const q = questions[idx];
  const total = questions.length;

  // 自动播放
  useEffect(() => {
    if (phase === "ready" && q) speak(q.word, null);
  }, [idx, phase, q?.word]);

  const selectOption = useCallback(async (i) => {
    if (!q || feedback) return;
    const ok = i === q.correct_index;
    if (ok) sfxSuccess(); else sfxFail();
    if (ok) setCorrect((c) => c + 1);
    setFeedback({ correct: ok, correctWord: q.word, selected: i });
    try {
      await api("/api/listening/score", {
        method: "POST",
        body: JSON.stringify({
          card_id: q.card_id,
          selected_index: i,
          correct_index: q.correct_index,
          rating: ok ? 3 : 1,
        }),
      });
    } catch {}
  }, [q, feedback]);

  const skip = useCallback(() => {
    if (!q) return;
    sfxFail();
    setFeedback({ correct: false, correctWord: q.word, selected: -1 });
  }, [q]);

  const next = useCallback(() => {
    setFeedback(null);
    if (idx + 1 < total) setIdx((i) => i + 1);
    else setDone(true);
  }, [idx, total]);

  useEffect(() => {
    if (feedback) {
      const t = setTimeout(next, 1800);
      return () => clearTimeout(t);
    }
  }, [feedback, next]);

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">今天没有需要听写的词</div>;
  if (done) {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎧</div>
          <h2>听写完成！</h2>
          <p className="done-detail">答对 {correct}/{total} 题（{Math.round(correct / total * 100)} 分）</p>
          <button className="btn btn-primary" onClick={() => { setIdx(0); setCorrect(0); setDone(false); setPhase("loading"); api("/api/listening").then((d) => { setQuestions(d.questions); setPhase("ready"); }); }}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!q) return null;

  return (
    <section className="view view-center">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
      </div>
      <div className="spelling-head">
        <span className="study-count">{idx + 1} / {total}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      <div className="listening-body">
        <div className="listening-prompt">
          <button className="btn-speak-large" title="播放发音" onClick={() => speak(q.word)}>🔊</button>
          <div className="listening-meaning">{escapeHtml(q.meaning)}</div>
          <div className="listening-hint">点喇叭听发音</div>
        </div>
        <div className="listening-options">
          {q.options?.map((opt, i) => {
            let cls = "btn btn-ghost listening-option";
            if (feedback) {
              if (i === q.correct_index) cls += " correct";
              else if (i === feedback.selected && !feedback.correct) cls += " wrong";
            }
            return (
              <button key={i} className={cls} disabled={!!feedback} onClick={() => selectOption(i)}>
                {opt}
              </button>
            );
          })}
        </div>
        {feedback && (
          <div className={`listening-feedback ${feedback.correct ? "ok" : "err"}`}>
            {feedback.correct ? "✅ 正确！" : `❌ 正确答案是：${feedback.correctWord}`}
          </div>
        )}
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? next : skip}>
          跳过这题 →
        </button>
      </div>
    </section>
  );
}
