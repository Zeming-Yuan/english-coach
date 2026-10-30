import React from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { fetchSpellPool, usePracticeSession } from "../lib/practiceSession.js";
import { showToast } from "../App.jsx";
import SpellingBoard from "../components/SpellingBoard.jsx";

/**
 * 混合练习视图：拼写/听写/选择随机交错。
 * 会话状态机在 usePracticeSession（判分/反馈/切题/统计）。
 */
export default function MixedPage({ onExit }) {
  const s = usePracticeSession({
    minItems: 3,
    speakListenOnNewItem: true,
    autoAdvanceMs: (correct) => (correct ? 900 : 1500),
    buildItems: async () => {
      const [listeningData, choiceData] = await Promise.all([
        api("/api/listening?limit=3"),
        api("/api/quiz/choice?limit=4"),
      ]);
      const result = [];
      // 听写
      (listeningData.questions || []).slice(0, 3).forEach((q) => result.push({ type: "listen", q }));
      // 选择
      (choiceData.questions || []).slice(0, 4).forEach((q) => result.push({ type: "choice", q }));
      // 拼写（随机抽 4 个，每轮不固定同一批）
      const spellPool = await fetchSpellPool();
      for (let i = spellPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [spellPool[i], spellPool[j]] = [spellPool[j], spellPool[i]];
      }
      spellPool
        .slice(0, 4)
        .forEach((c) => result.push({ type: "spell", q: { card_id: c.id, word: c.word, meaning: c.meaning } }));
      // 随机交错
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
  });
  const { phase, idx, item, q, total, feedback, stats, submit, skip, next, replay } = s;

  const typeName = (t) => (t === "listen" ? "听写" : t === "choice" ? "选择" : "拼写");

  const answer = async (value) => {
    try {
      await submit(value);
    } catch {
      showToast("网络错误，请重试");
    }
  };

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">题目不够，先去加几个词吧</div>;

  if (phase === "done") {
    const correct = stats.correct;
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎲</div>
          <h2>混合练习完成！</h2>
          <p className="done-detail">答对 {correct}/{total} 题（{total > 0 ? Math.round(correct / total * 100) : 0} 分）· 混合题型记忆更牢 🚀</p>
          {stats.wrongList.length > 0 && (
            <div className="quiz-wrong-list">
              <div className="quiz-wrong-title">❌ 错题回顾</div>
              {stats.wrongList.map((w, i) => (
                <div key={i} className="quiz-wrong-item">
                  <span className="quiz-wrong-meaning">{escapeHtml(w.item?.q?.meaning || "")}</span>
                  <span className="quiz-wrong-expected">{escapeHtml(w.expected)}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={replay}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!item || !q) return null;

  return (
    <section className="view view-practice">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
      </div>
      <div className="spelling-head">
        <span className="study-count">{idx + 1} / {total} · {typeName(item.type)}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      <div className="mixed-body">
        {/* 听写 */}
        {item.type === "listen" && (
          <>
            <div className="mixed-type-label">🎧 听发音选单词</div>
            <div className="listening-prompt">
              <button className="btn-speak-large" onClick={() => speak(q.word)}>🔊</button>
              <div className="listening-meaning">{escapeHtml(q.meaning)}</div>
            </div>
            <div className="listening-options">
              {q.options?.map((opt, i) => {
                let cls = "btn btn-ghost listening-option";
                if (feedback) {
                  if (i === q.correct_index) cls += " correct";
                  else if (i === feedback.userInput && !feedback.correct) cls += " wrong";
                }
                return <button key={i} className={cls} disabled={!!feedback} onClick={() => answer(i)}>{opt}</button>;
              })}
            </div>
          </>
        )}

        {/* 选择 */}
        {item.type === "choice" && (
          <>
            <div className="mixed-type-label">🤔 选意思</div>
            <div className="quiz-prompt">「{escapeHtml(q.prompt)}」是哪个单词？</div>
            <div className="quiz-options">
              {q.options?.map((opt) => {
                let cls = "quiz-option";
                if (feedback && opt === feedback.expected) cls += " correct";
                return (
                  <button key={opt} className={cls} disabled={!!feedback} onClick={() => answer(opt)}>
                    {opt}
                    <button className="quiz-option-speak" title="听发音" onClick={(e) => { e.stopPropagation(); speak(opt); }}>🔊</button>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* 拼写（共用 SpellingBoard：输满自动提交 / Enter / 实时红绿） */}
        {item.type === "spell" && (
          <>
            <div className="mixed-type-label">⌨️ 拼写</div>
            <div className="spelling-meaning">{escapeHtml(q.meaning)}</div>
            <SpellingBoard
              key={q.card_id}
              target={q.word}
              onSubmit={submit}
              disabled={!!feedback}
              placeholder="输入英文单词…"
            />
          </>
        )}

        {/* 反馈 */}
        {feedback && (
          <div className={`quiz-feedback ${feedback.correct ? "ok" : "err"}`}>
            {feedback.correct ? "✅ 正确！" : <>❌ 正确答案：<b className="right">{escapeHtml(feedback.expected)}</b></>}
          </div>
        )}

      </div>

      {/* 主操作：钉在首屏底部，不随内容滚动 */}
      <div className="practice-actions">
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? next : skip}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
