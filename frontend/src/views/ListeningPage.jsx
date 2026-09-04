import React from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { usePracticeSession } from "../lib/practiceSession.js";

/**
 * 听写练习视图：播发音 → 4 选 1。
 * 会话状态机在 usePracticeSession（听写答案 = 一次复习，进 FSRS）。
 */
export default function ListeningPage({ onExit }) {
  const s = usePracticeSession({
    speakListenOnNewItem: true,
    autoAdvanceMs: () => 1800,
    buildItems: async () =>
      (await api("/api/listening")).questions.map((q) => ({ type: "listen", q })),
  });
  const { phase, idx, item, q, total, feedback, stats, submit, skip, next, replay } = s;

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">今天没有需要听写的词</div>;
  if (phase === "done") {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎧</div>
          <h2>听写完成！</h2>
          <p className="done-detail">答对 {stats.correct}/{total} 题（{total > 0 ? Math.round(stats.correct / total * 100) : 0} 分）</p>
          <button className="btn btn-primary" onClick={replay}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!q) return null;

  const selectOption = (i) => {
    submit(i).catch(() => {});
  };

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
              else if (i === feedback.userInput && !feedback.correct) cls += " wrong";
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
            {feedback.correct ? "✅ 正确！" : `❌ 正确答案是：${feedback.expected}`}
          </div>
        )}
      </div>

      {/* 主操作：钉在首屏底部，不随内容滚动 */}
      <div className="practice-actions">
        <button className="btn btn-ghost btn-small spelling-skip" disabled={!!feedback} onClick={feedback ? next : skip}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
