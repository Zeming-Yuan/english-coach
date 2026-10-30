import React, { useEffect, useRef, useState } from "react";
import { storageGet, storageSet } from "../lib/utils.js";
import { fetchSpellPool, usePracticeSession } from "../lib/practiceSession.js";
import SpellingBoard from "../components/SpellingBoard.jsx";

/**
 * 拼写练习视图（Qwerty 风格 + 渐褪提示三档）。
 * singleCard: 如果传入，只测这一个词（从单词详情页"测这个词"跳转）
 * 独立回忆不显示目标词、长度格子、首字母或逐字正误；请求任一提示后本题按带提示记录。
 * 判分、事件与排期由 /api/typing/check 一次提交完成，页面不再另发 reviews。
 */
const ASSISTANCE_BY_DIFFICULTY = {
  1: ["first_letter", "length", "live_feedback"],
  2: ["length", "live_feedback"],
  3: [],
};
const assistanceFor = (difficulty) => ASSISTANCE_BY_DIFFICULTY[difficulty] || [];

export default function SpellingPage({ onExit, singleCard }) {
  // 默认独立回忆：只有用户主动选择提示才降级为辅助练习。
  const [difficulty, setDifficulty] = useState(() => storageGet("spellingDiff", 3));
  const [assistance, setAssistance] = useState(() => assistanceFor(difficulty));
  const [resumeNotice, setResumeNotice] = useState("");
  const inputRef = useRef(null);

  const s = usePracticeSession({
    speakOnAnswer: true,
    autoAdvanceMs: null,
    typedAttempt: () => ({ source: "spelling", assistance }),
    buildItems: async () => {
      if (singleCard) {
        return [{ type: "spell", q: { card_id: singleCard.id, word: singleCard.word, meaning: singleCard.meaning } }];
      }
      const pool = await fetchSpellPool();
      return pool.map((c) => ({ type: "spell", q: { card_id: c.id, word: c.word, meaning: c.meaning } }));
    },
  });
  const {
    phase, idx, q, total, feedback, stats, submit, skip, next, replay,
    saving, saveError, pendingResume, retry, resumePending,
  } = s;

  // 新题重置提示标记；当前难度为辅助档时，新题仍以该档开始。
  useEffect(() => {
    setAssistance(assistanceFor(difficulty));
    setResumeNotice("");
  }, [idx]);

  const chooseDifficulty = (d) => {
    setDifficulty(d);
    storageSet("spellingDiff", d);
    // 已请求的辅助保持到本题结束，切回独立也不会撤销。
    setAssistance((prev) => Array.from(new Set([...prev, ...assistanceFor(d)])));
  };

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

  const independent = difficulty === 3;
  const diffLabels = {
    1: "提示首字母：本题按带提示记录，不更新排期",
    2: "提示长度 / 逐字反馈：本题按带提示记录，不更新排期",
    3: "独立回忆：提交前不显示答案、长度或逐字正误",
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

      {/* 难度选择：仅主动选择提示/格子才计为辅助 */}
      <div className="spelling-difficulty">
        {[1, 2, 3].map((d) => (
          <button
            key={d}
            className={`diff-btn ${difficulty === d ? "diff-active" : ""}`}
            onClick={() => chooseDifficulty(d)}
          >
            {d === 1 ? "提示首字母" : d === 2 ? "提示长度" : "独立回忆"}
          </button>
        ))}
      </div>

      <div className="spelling-body">
        <div className="spelling-meaning">{q.meaning}</div>
        {q.phonetic && <div className="spelling-phonetic">{q.phonetic}</div>}
        <SpellingBoard
          key={q.card_id}
          mode={independent ? "independent" : "assisted"}
          target={independent ? null : q.word}
          onSubmit={submit}
          showFirstHint={difficulty === 1}
          disabled={!!feedback || saving}
          inputRef={inputRef}
        />
        <div className="spelling-hint">输入上面的英文单词 · {diffLabels[difficulty]}</div>
        {pendingResume && !feedback && (
          <div className="spelling-hint">
            上次提交尚未确认保存
            <button
              className="btn btn-ghost btn-small"
              onClick={async () => {
                const result = await resumePending();
                if (result) setResumeNotice("上次提交已保存");
              }}
            >
              继续确认
            </button>
          </div>
        )}
        {resumeNotice && <div className="spelling-hint" role="status">{resumeNotice}</div>}
        {feedback && (
          <div className={`spelling-feedback ${feedback.correct ? "ok" : "err"}`}>
            <span role="status">已保存</span>
            {" "}
            {feedback.correct
              ? "✅ 正确！"
              : `${feedback.skipped ? "已跳过" : "❌ 正确拼写"}：${feedback.expected}`}
          </div>
        )}
        {saveError && (
          <div role="alert" className="spelling-feedback err">
            保存未确认：{saveError}
            <button className="btn btn-ghost btn-small" onClick={retry} disabled={saving}>
              重试保存
            </button>
          </div>
        )}
      </div>

      {/* 主操作：钉在首屏底部，不随内容滚动 */}
      <div className="practice-actions">
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? next : skip} disabled={saving}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
