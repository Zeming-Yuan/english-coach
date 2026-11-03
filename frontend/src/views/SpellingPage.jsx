import UiIcon from "../components/UiIcon.jsx";
import React, { useEffect, useRef, useState } from "react";
import { storageGet, storageSet } from "../lib/utils.js";
import {
  assistanceFor as storedAssistance,
  clearAssistance,
  markAssistance,
} from "../lib/assistance.js";
import { fetchSpellPool, usePracticeSession } from "../lib/practiceSession.js";
import { recordPracticeContact } from "../lib/practiceContacts.js";
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
const difficultyAssistance = (difficulty) =>
  ASSISTANCE_BY_DIFFICULTY[difficulty] || [];

export default function SpellingPage({ onExit, singleCard }) {
  // 默认独立回忆：只有用户主动选择提示才降级为辅助练习。
  const [difficulty, setDifficulty] = useState(() => storageGet("spellingDiff", 3));
  const [assistance, setAssistance] = useState(() =>
    difficultyAssistance(storageGet("spellingDiff", 3)),
  );
  const [resumeNotice, setResumeNotice] = useState("");
  const inputRef = useRef(null);

  const s = usePracticeSession({
    speakOnAnswer: true,
    autoAdvanceMs: null,
    onAnswerAudio: (item) =>
      recordPracticeContact({
        cardId: item.q.card_id,
        revision: item.q.content_revision,
        source: "spelling",
        kind: "answer_audio",
      }),
    typedAttempt: () => ({ source: "spelling", assistance }),
    buildItems: async () => {
      if (singleCard) {
        return [{ type: "spell", q: { ...singleCard, card_id: singleCard.id } }];
      }
      const pool = await fetchSpellPool();
      return pool.map((c) => ({
        type: "spell",
        q: { ...c, card_id: c.id, word: c.word, meaning: c.meaning },
      }));
    },
  });
  const {
    phase, idx, q, total, feedback, stats, submit, skip, next, replay,
    saving, saveError, pendingResume, retry, resumePending,
  } = s;

  const itemId = q ? `${q.card_id}:spell` : null;

  // 新题读取已保存的提示；难度档是显式提示请求，也并入本题。
  useEffect(() => {
    if (!q) return;
    setAssistance(
      Array.from(
        new Set([
          ...storedAssistance("spelling", itemId),
          ...difficultyAssistance(difficulty),
        ]),
      ).sort(),
    );
    setResumeNotice("");
  }, [idx, q?.card_id, difficulty]);

  const chooseDifficulty = (d) => {
    setDifficulty(d);
    storageSet("spellingDiff", d);
    if (!itemId) return;
    // 已请求的辅助保持到本题结束，切回独立也不会撤销。
    let next = assistance;
    for (const kind of difficultyAssistance(d)) {
      next = markAssistance("spelling", itemId, kind);
    }
    setAssistance(next);
  };

  // 反馈显示正确答案后才算一次答案接触；答对只显示用户自己的输入，不算展示答案。
  useEffect(() => {
    if (!feedback || !q) return;
    clearAssistance("spelling", `${q.card_id}:spell`);
    if (feedback.correct === true) return;
    recordPracticeContact({
      cardId: q.card_id,
      revision: q.content_revision,
      source: "spelling",
      kind: "answer_visible",
    });
  }, [feedback, q?.card_id]);

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">还没有单词，先去加词吧</div>;
  if (phase === "done") {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji"><UiIcon name="done" size={40} /></div>
          <h2>拼写完成！</h2>
          <p className="done-detail">拼对 {stats.correct}/{total} 词（{Math.round(stats.correct / total * 100)} 分）</p>
          <button className="btn btn-primary" onClick={replay}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!q) return null;

  const independent = assistance.length === 0;
  const savedCount = idx + (feedback ? 1 : 0);
  const feedbackState = feedback
    ? (feedback.skipped ? "skipped" : feedback.correct ? "correct" : "incorrect")
    : saving ? "saving" : saveError ? "uncertain" : "idle";
  const diffLabels = {
    1: "提示首字母：本题按带提示记录，不更新排期",
    2: "提示长度 / 逐字反馈：本题按带提示记录，不更新排期",
    3: "独立回忆：提交前不显示答案、长度或逐字正误",
  };

  return (
    <section className="view view-practice qwerty-spelling">
      <div className="page-head qwerty-spelling-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
        <h1>拼写练习</h1>
        <span className="study-count">已保存 {savedCount} / {total}</span>
      </div>
      <div className="progress-track" role="progressbar" aria-label="本轮已保存" aria-valuemin={0} aria-valuemax={total} aria-valuenow={savedCount}>
        <div className="progress-fill" style={{ width: `${(savedCount / total) * 100}%` }} />
      </div>

      {/* 难度选择：仅主动选择提示/格子才计为辅助 */}
      <div className="spelling-difficulty">
        {[3, 2, 1].map((d) => (
          <button
            key={d}
            className={`diff-btn ${difficulty === d ? "diff-active" : ""}`}
            onClick={() => chooseDifficulty(d)}
            aria-pressed={difficulty === d}
          >
            {d === 1 ? "提示首字母" : d === 2 ? "提示长度" : "独立回忆"}
          </button>
        ))}
      </div>

      <div className="spelling-body">
        <span className="qwerty-prompt-label">根据释义，写出英文</span>
        <div className="spelling-meaning">{q.meaning}</div>
        {!independent && q.phonetic && <div className="spelling-phonetic">{q.phonetic}</div>}
        <SpellingBoard
          key={q.card_id}
          mode={independent ? "independent" : "assisted"}
          target={independent ? null : q.word}
          onSubmit={submit}
          showFirstHint={assistance.includes("first_letter")}
          disabled={!!feedback || saving}
          inputRef={inputRef}
          variant="qwerty"
          formId="spelling-answer-form"
          feedbackState={feedbackState}
          placeholder="点击这里，直接输入"
        />
        <div className="spelling-hint">
          {assistance.length > 0
            ? "本题已使用提示，仍按辅助记录"
            : diffLabels[difficulty]}
        </div>
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
              ? " · 拼写正确"
              : ` · ${feedback.skipped ? "已跳过" : "正确拼写"}：${feedback.expected}`}
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
        {!feedback && <button type="submit" form="spelling-answer-form" className="btn btn-primary qwerty-submit" disabled={saving}>
          {saving ? "正在确认…" : "提交答案"}
          {!saving && <kbd aria-hidden="true">Enter</kbd>}
        </button>}
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? next : skip} disabled={saving}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
