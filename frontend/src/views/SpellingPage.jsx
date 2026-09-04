import React, { useRef, useState } from "react";
import { storageGet, storageSet } from "../lib/utils.js";
import { fetchSpellPool, usePracticeSession } from "../lib/practiceSession.js";
import SpellingBoard from "../components/SpellingBoard.jsx";

/**
 * 拼写练习视图（Qwerty 风格 + 渐褪提示三档）。
 * singleCard: 如果传入，只测这一个词（从单词详情页"测这个词"跳转）
 * 会话状态机在 usePracticeSession（拼写例外：答对/答错也算一次复习，fsrsOnSpell）。
 */
export default function SpellingPage({ onExit, singleCard }) {
  const [difficulty, setDifficulty] = useState(() => storageGet("spellingDiff", 2));
  const inputRef = useRef(null);

  const s = usePracticeSession({
    fsrsOnSpell: true,
    speakOnAnswer: true,
    autoAdvanceMs: null,
    buildItems: async () => {
      if (singleCard) {
        return [{ type: "spell", q: { card_id: singleCard.id, word: singleCard.word, meaning: singleCard.meaning } }];
      }
      const pool = await fetchSpellPool();
      return pool.map((c) => ({ type: "spell", q: { card_id: c.id, word: c.word, meaning: c.meaning } }));
    },
  });
  const { phase, idx, q, total, feedback, stats, submit, skip, next, replay } = s;

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">还没有单词，先去加词吧</div>;
  if (phase === "done") {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">⌨️</div>
          <h2>拼写完成！</h2>
          <p className="done-detail">拼对 {stats.correct}/{total} 词（{Math.round(stats.correct / total * 100)} 分）</p>
          <button className="btn btn-primary" onClick={replay}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!q) return null;

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
        <div className="spelling-meaning">{q.meaning}</div>
        {q.phonetic && <div className="spelling-phonetic">{q.phonetic}</div>}
        <SpellingBoard
          key={q.card_id}
          target={q.word}
          onSubmit={submit}
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
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? next : skip}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
