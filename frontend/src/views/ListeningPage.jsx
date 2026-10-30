import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { makePending, sendPending } from "../lib/learning.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 听写练习视图：播发音 → 4 选 1。
 * 服务端按签名题目上下文判分；保存确认后才反馈，失败保留选择与提交标识。
 * 识别题只记事件与错词，不更新 FSRS 排期。
 */
export default function ListeningPage({ onExit }) {
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("loading"); // loading | error | empty | ready | done
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [audioHint, setAudioHint] = useState("");
  const [stats, setStats] = useState({ correct: 0, wrong: 0, skipped: 0 });
  const pendingRef = useRef(null);
  const skipPendingRef = useRef(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setFeedback(null);
    setError(null);
    setSelected(null);
    setIndex(0);
    setStats({ correct: 0, wrong: 0, skipped: 0 });
    pendingRef.current = null;
    skipPendingRef.current = null;
    try {
      const data = await api("/api/listening");
      const list = data.questions || [];
      setQuestions(list);
      setPhase(list.length ? "ready" : "empty");
    } catch {
      setQuestions([]);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const q = questions[index] || null;
  const total = questions.length;

  const play = useCallback(
    async (announce) => {
      if (!q?.word) return;
      const mode = await speak(q.word);
      if (!announce) return;
      if (mode === "online") setAudioHint("");
      else if (mode === "local") {
        setAudioHint("在线发音不可用，已使用本地语音；也可直接看释义选择答案。");
      } else {
        setAudioHint("发音不可用，可直接根据释义选择答案。");
      }
    },
    [q?.word]
  );

  // 进入新题自动发音；失败只影响发音提示，不影响作答。
  useEffect(() => {
    if (phase === "ready" && q?.word) play(false);
  }, [phase, index, q?.word, play]);

  const handleFailure = (cause, retry) => {
    if (cause && cause.status === 409) {
      setError({
        message: "题目已失效，本题尚未保存。请重新加载题目。",
        reload: true,
        retry,
      });
    } else {
      setError({
        message: "答案尚未确认保存，请重试。",
        reload: false,
        retry,
      });
    }
  };

  const submitAnswer = async (option) => {
    if (!q || feedback || saving) return;
    setSaving(true);
    setError(null);
    pendingRef.current ??= makePending("/api/listening/score", {
      card_id: q.card_id,
      question_token: q.question_token,
      answer: option,
      source: "listening",
      kind: "choice",
      assistance: [],
      skipped: false,
    });
    try {
      const result = await sendPending(pendingRef.current);
      setFeedback({
        correct: result.correct,
        correctWord: result.correct_word,
        selected: option,
        skipped: false,
      });
      setStats((s) =>
        result.correct
          ? { ...s, correct: s.correct + 1 }
          : { ...s, wrong: s.wrong + 1 }
      );
    } catch (cause) {
      handleFailure(cause, "answer");
    } finally {
      setSaving(false);
    }
  };

  const choose = (option) => {
    if (saving || feedback || error) return;
    setSelected(option);
    submitAnswer(option);
  };

  const skipQuestion = async () => {
    if (!q || feedback || saving) return;
    setSaving(true);
    setError(null);
    skipPendingRef.current ??= makePending("/api/listening/score", {
      card_id: q.card_id,
      source: "listening",
      kind: "choice",
      assistance: [],
      skipped: true,
    });
    try {
      await sendPending(skipPendingRef.current);
      setFeedback({
        correct: null,
        correctWord: q.word,
        selected: null,
        skipped: true,
      });
      setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    } catch (cause) {
      handleFailure(cause, "skip");
    } finally {
      setSaving(false);
    }
  };

  const retry = () => {
    if (error?.retry === "skip") skipQuestion();
    else submitAnswer(selected);
  };

  const next = () => {
    if (!feedback) return;
    setFeedback(null);
    setError(null);
    setSelected(null);
    pendingRef.current = null;
    skipPendingRef.current = null;
    if (index + 1 >= total) setPhase("done");
    else setIndex((current) => current + 1);
  };

  if (phase === "loading") return <div className="story-empty">加载中…</div>;

  if (phase === "error") {
    return (
      <section className="view view-center">
        <div role="alert" className="quiz-feedback err">
          题目加载失败，请重试。
        </div>
        <button className="btn btn-primary" onClick={load}>重新加载</button>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>
          返回
        </button>
      </section>
    );
  }

  if (phase === "empty") {
    return <div className="story-empty">今天没有需要听写的词</div>;
  }

  if (phase === "done") {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎧</div>
          <h2>听写完成！</h2>
          <p className="done-detail">
            答对 {stats.correct} / {total} 题，跳过 {stats.skipped} 题
          </p>
          <button className="btn btn-primary" onClick={load}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>
            回到队列
          </button>
        </div>
      </section>
    );
  }

  if (!q) return null;

  const locked = Boolean(feedback) || saving || Boolean(error);

  return (
    <section className="view view-practice">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
      </div>
      <div className="spelling-head">
        <span className="study-count">{index + 1} / {total}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <div className="listening-body">
        <div className="listening-prompt">
          <button
            className="btn-speak-large"
            title="播放发音"
            onClick={() => play(true)}
          >
            🔊
          </button>
          <div className="listening-meaning">{escapeHtml(q.meaning)}</div>
          <div className="listening-hint">{audioHint || "点喇叭听发音"}</div>
        </div>
        <div className="listening-options">
          {q.options?.map((opt, optionIndex) => {
            let cls = "btn btn-ghost listening-option";
            if (feedback) {
              if (opt === feedback.correctWord) cls += " correct";
              else if (opt === feedback.selected && !feedback.correct) cls += " wrong";
            } else if (selected === opt) {
              cls += " selected";
            }
            return (
              <button
                key={optionIndex}
                className={cls}
                disabled={locked}
                onClick={() => choose(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {saving && <div className="listening-feedback">保存中…</div>}
        {error && (
          <div role="alert" className="listening-feedback err">
            {error.message}
            <div style={{ marginTop: 8 }}>
              {error.reload ? (
                <button className="btn btn-primary btn-small" onClick={load}>
                  重新加载题目
                </button>
              ) : (
                <button className="btn btn-primary btn-small" onClick={retry}>
                  重试保存
                </button>
              )}
            </div>
          </div>
        )}
        {feedback && (
          <div role="status" className="save-status">已保存</div>
        )}
        {feedback && (
          <div className={`listening-feedback ${feedback.correct ? "ok" : "err"}`}>
            {feedback.skipped
              ? "已跳过：本题不计正误，也不排期。"
              : feedback.correct
                ? "✅ 正确！"
                : `❌ 正确答案是：${feedback.correctWord}`}
          </div>
        )}
      </div>

      {/* 主操作：钉在首屏底部，不随内容滚动 */}
      <div className="practice-actions">
        <button
          className="btn btn-ghost btn-small spelling-skip"
          disabled={saving || Boolean(error)}
          onClick={feedback ? next : skipQuestion}
        >
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
