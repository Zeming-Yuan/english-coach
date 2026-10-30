import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { makePending, sendPending } from "../lib/learning.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { usePracticeSession } from "../lib/practiceSession.js";
import SpellingBoard from "../components/SpellingBoard.jsx";

/** 选择题：一次提交保存并返回服务端判分；重试沿用同一 submission_id。 */
function attachChoiceSubmission(item, q) {
  let answerPending = null;
  let skipPending = null;

  item.judge = async (value) => {
    answerPending ??= makePending("/api/quiz/score", {
      answers: [
        {
          card_id: q.card_id,
          answer: value,
          question_token: q.question_token,
          source: "quiz",
          kind: q.type,
          assistance: [],
          skipped: false,
          submission_id: crypto.randomUUID(),
        },
      ],
    });
    const result = await sendPending(answerPending);
    const detail = result.details?.[0] || {};
    return {
      correct: detail.correct,
      expected: detail.expected,
      scheduled: detail.scheduled,
    };
  };

  item.skip = async () => {
    skipPending ??= makePending("/api/quiz/score", {
      answers: [
        {
          card_id: q.card_id,
          source: "quiz",
          kind: q.type,
          assistance: [],
          skipped: true,
          submission_id: crypto.randomUUID(),
        },
      ],
    });
    await sendPending(skipPending);
  };

  return item;
}

/**
 * 测验视图：cn2en / choice / fill / related，逐题判分。
 * 选择题与相关词题由服务端判分并保存确认后才反馈；输入题仍走既有流程。
 * 会话状态机在 usePracticeSession（判分/反馈/统计），这里只渲染题型 UI。
 */
export default function QuizPage({ onExit }) {
  const s = usePracticeSession({
    buildItems: async () => {
      const questions = (await api("/api/quiz?limit=5")).questions;
      return questions.map((q) => {
        const item = { type: q.type, q };
        if (q.type === "choice" || q.type === "related") {
          attachChoiceSubmission(item, q);
        }
        return item;
      });
    },
    speakOnAnswer: true,
    autoAdvanceMs: null,
    // EC-05 只迁移输入题（cn2en/fill）；choice/related 留给 EC-06。
    typedAttempt: (item) =>
      item.type === "cn2en" || item.type === "fill"
        ? { source: "quiz", assistance: [] }
        : null,
  });
  const {
    phase, loadError, idx, item, q, total, feedback, stats, submit, skip, next, replay,
    saving, saveError, pendingResume, retry, resumePending,
  } = s;

  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [choiceError, setChoiceError] = useState(null);
  useEffect(() => {
    setSelected(null);
    setChoiceError(null);
  }, [idx]);

  const saveFailure = (error, retry) =>
    error?.status === 409
      ? {
          message: "题目已失效，本题尚未保存。请重新加载题目。",
          reload: true,
          retry,
        }
      : { message: "答案尚未确认保存，请重试。", reload: false, retry };

  // cn2en/fill 格子渲染（feedback 阶段显示正确答案）
  const renderBoxes = (typed, wordLen, expected = null) => {
    const boxes = [];
    for (let i = 0; i < wordLen; i++) {
      const ch = i < typed.length ? typed[i] : "";
      let cls = "spelling-box box-pending";
      if (expected) {
        // 反馈阶段：显示正确字母（绿色）
        cls = "spelling-box box-correct";
        boxes.push(<span key={i} className={cls}>{expected[i] || ""}</span>);
      } else if (ch) {
        cls = "spelling-box";
        boxes.push(<span key={i} className={cls}>{ch}</span>);
      } else {
        boxes.push(<span key={i} className={cls}>{""}</span>);
      }
    }
    return boxes;
  };

  // choice/related：点选项后点"确认"；保存成功后才显示服务端反馈。
  const confirmChoice = async () => {
    if (!q || !selected || submitting) return;
    setSubmitting(true);
    setChoiceError(null);
    try {
      await submit(selected);
    } catch (error) {
      setChoiceError(saveFailure(error, "answer"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (submitting) return;
    setSubmitting(true);
    setChoiceError(null);
    try {
      await skip();
    } catch (error) {
      setChoiceError(saveFailure(error, "skip"));
    } finally {
      setSubmitting(false);
    }
  };

  const retryChoice = () => {
    if (choiceError?.retry === "skip") handleSkip();
    else confirmChoice();
  };

  const reloadQuiz = () => {
    setChoiceError(null);
    setSelected(null);
    replay();
  };

  // cn2en/fill：SpellingBoard 输满自动提交入口（失败由组件内部解锁重试）
  const handleTypedSubmit = (userInput) => submit(userInput);

  // 结果页
  if (phase === "done") {
    const correctCount = total - stats.wrongList.length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <section className="view view-center">
        <div className="result-badge">{score === 100 ? "🏆" : score >= 80 ? "🌟" : score >= 60 ? "👍" : "🙂"}</div>
        <div className="result-score">
          <span className="big-number">{score}</span>
          <span className="big-label">分</span>
        </div>
        <div className="result-detail">
          {stats.wrongList.length === 0 ? (
            "全部答对！明天的复习不会再忘了 📚"
          ) : (
            <>
              答对 <span className="right">{correctCount}</span> / {total} 题。
              <div className="quiz-wrong-list">
                <div className="quiz-wrong-title">❌ 错题回顾</div>
                {stats.wrongList.map((w, i) => (
                  <div key={i} className="quiz-wrong-item" style={{ cursor: "pointer" }}>
                    <span className="quiz-wrong-meaning">{escapeHtml(w.item?.q?.prompt || "")}</span>
                    <span className="quiz-wrong-expected">{escapeHtml(w.expected)} ›</span>
                  </div>
                ))}
              </div>
              <div className="quiz-wrong-hint">这些词会出现在明天的复习队列里 📚</div>
            </>
          )}
        </div>
        <button className="btn btn-ghost" onClick={replay}>再测一次</button>
        <button className="btn btn-primary" onClick={onExit}>回到队列</button>
      </section>
    );
  }

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (loadError) {
    return (
      <section className="view view-center">
        <div role="alert" className="quiz-feedback err">题目加载失败，请重试。</div>
        <button className="btn btn-primary" onClick={replay}>重新加载</button>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>
          回到队列
        </button>
      </section>
    );
  }
  if (phase === "empty") return <div className="story-empty">题库是空的</div>;
  if (!q) return null;

  return (
    <section className="view view-practice">
      <div className="study-head">
        <span className="study-count">第 {idx + 1} / {total} 题</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      {pendingResume && !feedback && (
        <div className="spelling-hint">
          上次提交尚未确认保存
          <button className="btn btn-ghost btn-small" onClick={resumePending}>
            继续确认
          </button>
        </div>
      )}

      <div className="quiz-card">
        <div className="quiz-prompt">
          {q.type === "cn2en" && `「${q.prompt}」用英语怎么说？`}
          {q.type === "choice" && `「${q.prompt}」是哪个单词？`}
          {q.type === "fill" && `填空：${q.prompt}${q.hint ? `（${q.hint}）` : ""}`}
          {q.type === "related" && q.prompt}
        </div>

        {/* cn2en / fill：独立回忆输入，不显示目标词、长度格子或逐字正误 */}
        {(q.type === "cn2en" || q.type === "fill") && !feedback && (
          <SpellingBoard
            key={q.id}
            mode="independent"
            onSubmit={handleTypedSubmit}
            placeholder="输入英文单词…"
            disabled={saving}
          />
        )}

        {/* choice / related：选项（点选后确认，服务端判分） */}
        {(q.type === "choice" || q.type === "related") && !feedback && (
          <div className="quiz-options">
            {q.options?.map((opt) => (
              <div
                key={opt}
                role="button"
                tabIndex={0}
                className={`quiz-option ${selected === opt ? "selected" : ""}`}
                onClick={() => !submitting && !choiceError && setSelected(opt)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !submitting && !choiceError && setSelected(opt)
                }
              >
                {opt}
                <button
                  className="quiz-option-speak"
                  title="听发音"
                  onClick={(e) => { e.stopPropagation(); speak(opt); }}
                >🔊</button>
              </div>
            ))}
          </div>
        )}

        {submitting && <div className="quiz-feedback">保存中…</div>}

        {choiceError && (
          <div role="alert" className="quiz-feedback err">
            {choiceError.message}
            <div style={{ marginTop: 8 }}>
              {choiceError.reload ? (
                <button className="btn btn-primary btn-small" onClick={reloadQuiz}>
                  重新加载题目
                </button>
              ) : (
                <button className="btn btn-primary btn-small" onClick={retryChoice}>
                  重试保存
                </button>
              )}
            </div>
          </div>
        )}

        {/* 反馈 */}
        {feedback && (
          <>
            <div role="status" className="save-status">已保存</div>
            {/* 错题高亮正确字母 */}
            {!feedback.correct && (q.type === "cn2en" || q.type === "fill") && (
              <div className="spelling-word-display">
                {renderBoxes(feedback.userInput || "", q.word_length || feedback.expected.length, feedback.expected)}
              </div>
            )}
            <div className={`quiz-feedback ${feedback.correct ? "ok" : "err"}`}>
              {feedback.skipped ? (
                "已跳过：本题不计正误，也不排期。"
              ) : feedback.correct ? (
                "✅ 正确！"
              ) : (
                <>
                  {feedback.skipped && "已跳过 · "}
                  {feedback.userInput && <>❌ 你的答案：<b>{escapeHtml(feedback.userInput || "（空）")}</b><br /></>}
                  正确答案：<b className="right">{escapeHtml(feedback.expected || "")}</b>
                </>
              )}
            </div>
          </>
        )}
        {saveError && (q.type === "cn2en" || q.type === "fill") && (
          <div role="alert" className="quiz-feedback err">
            保存未确认：{saveError}
            <button className="btn btn-ghost btn-small" onClick={retry} disabled={saving}>
              重试保存
            </button>
          </div>
        )}

      </div>

      {/* 主操作：钉在首屏底部，不随题目内容滚动 */}
      <div className="practice-actions">
        {!feedback && (
          <>
            {(q.type === "choice" || q.type === "related") && (
              <button
                className="btn btn-primary btn-wide"
                onClick={confirmChoice}
                disabled={!selected || submitting || Boolean(choiceError)}
              >
                {submitting ? "保存中…" : "确认"}
              </button>
            )}
            <button
              className="btn btn-ghost btn-small"
              style={{ marginTop: 14, width: "100%", justifyContent: "center" }}
              onClick={handleSkip}
              disabled={submitting || Boolean(choiceError) || saving}
            >
              跳过这题 →
            </button>
          </>
        )}
        {feedback && (
          <button className="btn btn-primary btn-wide" onClick={next}>
            {idx >= total - 1 ? "查看结果" : "下一题 →"}
          </button>
        )}
      </div>
    </section>
  );
}
