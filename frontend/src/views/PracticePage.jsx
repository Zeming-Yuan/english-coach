import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";

const STATUS_LABELS = {
  passed: "通过",
  weak: "待巩固",
  incomplete: "未完成",
  unavailable: "不可用",
};

const ITEM_LABELS = {
  pending: "待作答",
  passed: "通过",
  weak: "待巩固",
  skipped: "已跳过",
  stale: "内容已修订",
};

function PracticeItemForm({ session, item, onSession, onFeedback }) {
  const attempt = useLearningAttempt(`practice:${session.id}:${item.id}`);
  const [answer, setAnswer] = useState("");
  const [helping, setHelping] = useState(false);

  const finish = (result) => {
    if (!result || result.committed !== true) return;
    attempt.clear();
    onSession(result.session);
    onFeedback({
      itemId: item.id,
      correct: result.correct,
      expected: result.expected,
      skipped: result.skipped,
    });
  };

  const submit = async (skipped = false) => {
    if (!skipped && !answer.trim()) return;
    try {
      finish(
        await attempt.submit(
          `/api/practice-sessions/${session.id}/items/${item.id}/attempts`,
          skipped ? { skipped: true } : { answer: answer.trim() },
        ),
      );
    } catch {}
  };

  const retry = async () => {
    try {
      finish(await attempt.retry());
    } catch {}
  };

  const requestHelp = async () => {
    if (helping) return;
    setHelping(true);
    try {
      const next = await api(
        `/api/practice-sessions/${session.id}/items/${item.id}/assistance`,
        { method: "POST", body: JSON.stringify({ kind: "first_letter" }) },
      );
      onSession(next);
    } catch (error) {
      showToast("提示保存失败：" + (error?.message || error));
    } finally {
      setHelping(false);
    }
  };

  return (
    <div className="practice-item">
      <div className="spelling-meaning">{item.prompt}</div>
      {item.hint?.kind === "first_letter" && (
        <p role="status" className="spelling-hint">
          首字母：{item.hint.value}（本题按辅助记录）
        </p>
      )}
      <input
        className="spelling-input"
        name="practice-answer"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        placeholder="输入英文单词…"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={attempt.phase === "saving" || attempt.phase === "failed"}
      />
      <div className="practice-actions">
        <button
          className="btn btn-ghost btn-small"
          onClick={requestHelp}
          disabled={helping || attempt.phase === "saving"}
        >
          提示首字母
        </button>
        <button
          className="btn btn-primary btn-small"
          onClick={() => submit()}
          disabled={!answer.trim() || attempt.phase === "saving" || attempt.phase === "failed"}
        >
          提交
        </button>
        <button
          className="btn btn-ghost btn-small"
          onClick={() => submit(true)}
          disabled={attempt.phase === "saving" || attempt.phase === "failed"}
        >
          跳过这题
        </button>
      </div>
      {attempt.phase === "saving" && <p role="status">正在确认保存…</p>}
      {attempt.phase === "failed" && (
        <div role="alert" className="save-state save-state-error">
          <p>{attempt.error}</p>
          <div className="save-state-actions">
            <button className="btn btn-primary btn-small" onClick={retry}>
              继续确认保存
            </button>
            <button className="btn btn-ghost btn-small" onClick={attempt.clear}>
              放弃这条待确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PracticePage({ sessionId, onExit, onRestart }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [retryItemId, setRetryItemId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/api/practice-sessions/${sessionId}`)
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause?.message || "练习轮次加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const activeItem = useMemo(
    () => session?.items.find((item) => item.status === "pending") || null,
    [session],
  );
  const staleItem = useMemo(
    () => session?.items.find((item) => item.status === "stale") || null,
    [session],
  );
  const retryItem = useMemo(
    () => session?.items.find((item) => item.id === retryItemId) || null,
    [session, retryItemId],
  );
  const processed = session?.items.filter((item) => item.status !== "pending" && item.status !== "stale") || [];
  const showSummary = session && session.items.length > 0 && !activeItem && !staleItem;

  const restart = (weakOnly) => {
    if (session?.lesson_id) onRestart(session.lesson_id, weakOnly);
  };

  return (
    <section className="view view-practice" data-testid="practice-session">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>
          ← 返回课程
        </button>
        <h2 className="page-title">本课短测</h2>
      </div>
      {loading && <div className="story-empty">加载中…</div>}
      {error && (
        <div role="alert" className="quiz-feedback err">
          {error}
          <button className="btn btn-ghost btn-small" onClick={onExit}>
            返回课程
          </button>
        </div>
      )}
      {session && (
        <>
          <div className="study-count">
            状态：{STATUS_LABELS[session.status] || session.status}
            {session.counts?.total
              ? ` · 已处理 ${session.counts.processed}/${session.counts.total}`
              : ""}
          </div>
          {session.message && <p role="status">{session.message}</p>}
          {processed.length > 0 && (
            <ul className="practice-results">
              {processed.map((item) => (
                <li key={item.id}>
                  {item.prompt} · {ITEM_LABELS[item.status] || item.status}
                  {item.expected ? ` · 正确拼写：${item.expected}` : ""}
                </li>
              ))}
            </ul>
          )}
          {staleItem && (
            <div role="alert" className="quiz-feedback err">
              题目内容已修订，旧结果不再适用于当前内容。
              <button className="btn btn-primary btn-small" onClick={() => restart(false)}>
                新开一轮
              </button>
            </div>
          )}
          {activeItem && !feedback && !retryItem && (
            <PracticeItemForm
              key={activeItem.id}
              session={session}
              item={activeItem}
              onSession={setSession}
              onFeedback={setFeedback}
            />
          )}
          {retryItem && !feedback && (
            <PracticeItemForm
              key={`${retryItem.id}-retry`}
              session={session}
              item={retryItem}
              onSession={setSession}
              onFeedback={setFeedback}
            />
          )}
          {feedback && (
            <div className={`quiz-feedback ${feedback.correct ? "ok" : "err"}`}>
              <p role="status">
                {feedback.skipped
                  ? `已跳过${feedback.expected ? ` · 正确拼写：${feedback.expected}` : ""}`
                  : feedback.correct
                    ? "✅ 正确！"
                    : `❌ 待巩固${feedback.expected ? ` · 正确拼写：${feedback.expected}` : ""}`}
              </p>
              <div className="save-state-actions">
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => {
                    setFeedback(null);
                    setRetryItemId(null);
                  }}
                >
                  {activeItem ? "下一题" : "查看结果"}
                </button>
                {feedback.correct !== true && (
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      setFeedback(null);
                      setRetryItemId(feedback.itemId);
                    }}
                  >
                    再试一次
                  </button>
                )}
              </div>
            </div>
          )}
          {showSummary && (
            <div className="study-done">
              <h3>本课短测：{STATUS_LABELS[session.status] || session.status}</h3>
              <p>
                共 {session.counts.total} 题 · 通过 {session.counts.passed} · 待巩固{" "}
                {session.counts.weak + session.counts.skipped}
                {session.counts.stale ? ` · 已修订 ${session.counts.stale}` : ""}
              </p>
              <p>只有全部实际题目首答无提示正确才算通过；本结果只说明所测内容。</p>
              <div className="save-state-actions">
                {session.counts.weak + session.counts.skipped > 0 && (
                  <button className="btn btn-primary btn-small" onClick={() => restart(true)}>
                    只练薄弱项
                  </button>
                )}
                <button className="btn btn-ghost btn-small" onClick={() => restart(false)}>
                  新开一轮
                </button>
                <button className="btn btn-ghost btn-small" onClick={onExit}>
                  返回课程
                </button>
              </div>
            </div>
          )}
          {!session.items.length && !showSummary && (
            <button className="btn btn-ghost" onClick={onExit}>
              返回课程
            </button>
          )}
        </>
      )}
    </section>
  );
}
