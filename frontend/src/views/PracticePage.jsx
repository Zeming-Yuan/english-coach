import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { pendingContactIds, refreshPendingContacts } from "../lib/contacts.js";
import { usePracticeAnswerContact } from "../hooks/usePracticeAnswerContact.js";
import { loadPending } from "../lib/learning.js";
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

const choiceItem = item => item.kind === "reading_choice" || item.kind === "expansion_choice";
const contactSource = purpose => purpose === "story_check" ? "story" :
  purpose === "lesson_check" ? "lesson" : purpose === "expansion" ? "quiz" : "spelling";

function PracticeResult({item, delayed, source}) {
  const ref = usePracticeAnswerContact(item, Boolean(item.expected) && !item.stale, source);
  return <li ref={ref}>
    {item.prompt} · {ITEM_LABELS[item.status] || item.status}
    {delayed && ` · ${item.window === "week" ? "一周回测" : item.window === "day" ? "隔日回测" : "其他间隔"} · ${item.integrity === "confirmed" ? "依据已确认" : "依据不完整"}`}
    {item.stale ? " · 内容已修订，历史结果" : item.expected ? ` · ${choiceItem(item) ? "正确选项" : "正确拼写"}：${item.expected}` : ""}
    {item.explanation && <p>{item.explanation}</p>}
  </li>;
}

function PracticeItemForm({ session, item, onSession, onFeedback }) {
  const scope = `practice:${session.id}:${item.id}`;
  const attempt = useLearningAttempt(scope, refreshPendingContacts);
  const hintContactRef = usePracticeAnswerContact(item, Boolean(item.hint), contactSource(session.purpose));
  const [answer, setAnswer] = useState(() => loadPending(scope)?.payload.answer || "");
  const [helping, setHelping] = useState(false);
  const reading = session.purpose === "story_check";
  const choice = choiceItem(item);
  const expansionChoice = item.kind === "expansion_choice";
  const visibleOptionsRef = usePracticeAnswerContact(item, expansionChoice && !item.stale, "quiz", 1);

  const finish = (result) => {
    if (!result || result.committed !== true) return;
    attempt.clear();
    onSession(result.session);
    onFeedback({
      itemId: item.id,
      correct: result.correct,
      expected: result.expected,
      skipped: result.skipped,
      explanation: result.session?.items?.find(row => row.id === item.id)?.explanation,
    });
  };

  const submit = async (skipped = false, selected = answer) => {
    if (!skipped && !selected.trim()) return;
    try {
      finish(
        await attempt.submit(
          `/api/practice-sessions/${session.id}/items/${item.id}/attempts`,
          {
            ...(skipped ? {skipped: true} : {answer: selected.trim()}),
            ...(session.purpose === "delayed_check" ? {pending_contact_ids: pendingContactIds()} : {}),
            ...(session.purpose === "expansion" ? {expansion_target_id: item.card_id} : {}),
          },
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

  const options = choice && item.options.map(option => <button key={option} className="btn btn-ghost" disabled={attempt.phase === "saving" || attempt.phase === "failed"} onClick={() => {setAnswer(option); submit(false, option);}}>{option}</button>);

  return (
    <div className="practice-item">
      {reading && <h3>{choice ? "阅读理解" : "词汇输入"}</h3>}
      <div className="spelling-meaning">{item.prompt}</div>
      {reading && item.assistance.length > 0 && <p role="note">本题已使用帮助，按辅助记录，不排期。</p>}
      {expansionChoice ? <div className="practice-expansion-options" ref={visibleOptionsRef}>{options}</div> : options}
      {session.purpose === "delayed_check" && <p role="status">距应用内上次记录：{item.gap_seconds == null ? "依据不完整" : `${Number((item.gap_seconds / 3600).toFixed(2))} 小时`} · 发题依据已冻结，提交时复核</p>}
      {item.hint?.kind === "first_letter" && (
        <p ref={hintContactRef} role="status" className="spelling-hint">
          首字母：{item.hint.value}（本题按辅助记录）
        </p>
      )}
      {!choice && <input
        className="spelling-input"
        name="practice-answer"
        aria-label={reading ? "你的答案" : "英文答案"}
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
      />}
      <div className="practice-actions">
        {!choice && <>
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
          {reading ? "提交答案" : "提交"}
        </button>
        </>}
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
            <button className="btn btn-ghost btn-small" onClick={() => {
              attempt.clear();
              // Pending storage changed; reselect from the saved server results.
              onSession({...session});
            }}>
              放弃这条待确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PracticePage({ sessionId, onExit, onRestart, onNormal, advice = false, browserStored = true, storyCheck = false, backLabel = null, expansionRequest = null }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [retryItemId, setRetryItemId] = useState(null);
  const [createRequest] = useState(expansionRequest);
  const [readVersion, setReadVersion] = useState(0);
  const contextual = session?.purpose === "expansion" || createRequest?.purpose === "expansion";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const read = async () => {
      try {
        return await api(`/api/practice-sessions/${sessionId}`);
      } catch (cause) {
        if (cause.status !== 404 || !createRequest) throw cause;
        const {inMemory, ...command} = createRequest;
        return api("/api/practice-sessions", {method: "POST", body: JSON.stringify(command)});
      }
    };
    read().then((data) => {
        if (!Array.isArray(data?.items) || data.items.some(item => !item || typeof item.id !== "string" || typeof item.status !== "string")) {
          throw new Error("练习数据不完整，请返回重新加载");
        }
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
  }, [sessionId, createRequest, readVersion]);

  const activeItem = useMemo(
    () => session?.lifecycle !== "unavailable"
      ? ((storyCheck || contextual) && session?.items.find(item => loadPending(`practice:${session.id}:${item.id}`))) ||
        session?.items.find(item => item.status === "pending") || null
      : null,
    [session, storyCheck, contextual],
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
  const showSummary = session && session.lifecycle !== "unavailable" && session.items.length > 0 && !activeItem && !staleItem && !feedback && !retryItem;

  const restart = (weakOnly) => {
    if (contextual) return onRestart?.();
    if (storyCheck) return onRestart();
    if (advice) return onExit();
    if (session?.purpose === "delayed_check") onRestart();
    else if (session?.lesson_id) onRestart(session.lesson_id, weakOnly);
  };

  const delayed = session?.purpose === "delayed_check";
  const title = contextual ? "语境练习" : storyCheck ? "读后检查" : delayed ? (session.window === "week" ? "一周回测" : "隔日回测") : session?.purpose === "targeted" ? "专项练习" : "本课短测";
  const back = backLabel || (storyCheck ? "回看原文" : advice ? "返回建议" : delayed ? "返回统计" : "返回课程");
  const feedbackItem = session?.items.find(item => item.id === feedback?.itemId);
  const feedbackContactRef = usePracticeAnswerContact(feedbackItem, Boolean(feedback?.expected) && feedback?.correct !== true, contactSource(session?.purpose));

  return (
    <section className="view view-practice" data-testid="practice-session">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>
          ← {back}
        </button>
        <h2 className="page-title">{title}</h2>
      </div>
      {browserStored === false && <p role="note">浏览器未保存轮次标识；刷新后请从建议区继续已保存的轮次。</p>}
      {createRequest?.inMemory && <p role="note">浏览器未保存练习创建请求，请先确认创建再刷新。</p>}
      {loading && <div className="story-empty">加载中…</div>}
      {error && (
        <div role="alert" className="quiz-feedback err">
          {error}
          {createRequest && <button className="btn btn-primary btn-small" onClick={() => setReadVersion(version => version + 1)}>
            继续确认创建
          </button>}
          <button className="btn btn-ghost btn-small" onClick={onExit}>
            {back}
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
          {storyCheck && <p>故事版本：{session.version_id} · 实际 {session.counts.total} 题 · 即时检查不算延迟保持</p>}
          {session.message && <p role="status">{session.message}</p>}
          {processed.length > 0 && (!(storyCheck || contextual) || showSummary) && (
            <ul className="practice-results">
              {processed.map((item) => (
                <PracticeResult key={item.id} item={item} delayed={delayed} source={contactSource(session.purpose)} />
              ))}
            </ul>
          )}
          {staleItem && (
            <div role="alert" className="quiz-feedback err">
              题目内容已修订，旧结果不再适用于当前内容。
              {(!contextual || onRestart) && <button className="btn btn-primary btn-small" onClick={() => restart(false)}>
                新开一轮
              </button>}
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
              <p ref={feedbackContactRef} role="status">
                {feedback.skipped
                  ? `已跳过${feedback.expected ? ` · ${contextual ? "正确选项" : "正确拼写"}：${feedback.expected}` : ""}`
                  : feedback.correct
                    ? "✅ 正确！已保存"
                    : `❌ 待巩固${feedback.expected ? ` · ${contextual ? "正确选项" : "正确拼写"}：${feedback.expected}` : ""}`}
              </p>
              {feedback.explanation && <p>{feedback.explanation}</p>}
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
                {!contextual && !storyCheck && feedback.correct !== true && (
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
              <h3>{title}：{delayed ? "已处理" : STATUS_LABELS[session.status] || session.status}</h3>
              <p>
                共 {session.counts.total} 题 · 通过 {session.counts.passed} · 待巩固{" "}
                {session.counts.weak + session.counts.skipped}
                {session.counts.stale ? ` · 已修订 ${session.counts.stale}` : ""}
              </p>
              {storyCheck && <p>阅读识别 {session.reading_checks.recognition_count} · 词汇独立 {session.reading_checks.independent_count} · 辅助 {session.reading_checks.assisted_count}</p>}
              <p>{contextual ? "这是本次语境识别结果，答案选择不改变排期。" : storyCheck ? "即时正确只说明本次检查，不代表延迟保持；理解选择不排期。" : delayed ? "首测按词、学习日和实际窗口保留；辅助与跳过单列，重试不替换首测。" : "只有全部实际题目首答无提示正确才算通过；本结果只说明所测内容。"}</p>
              <div className="save-state-actions">
                {!contextual && !storyCheck && !delayed && session.counts.weak + session.counts.skipped > 0 && (
                  <button className="btn btn-primary btn-small" onClick={() => restart(true)}>
                    只练薄弱项
                  </button>
                )}
                {(!contextual || onRestart) && <button className="btn btn-ghost btn-small" onClick={() => restart(false)}>
                  新开一轮
                </button>}
                <button className="btn btn-ghost btn-small" onClick={onExit}>
                  {back}
                </button>
              </div>
            </div>
          )}
          {delayed && <button className="btn btn-ghost" onClick={onNormal}>普通练习</button>}
          {delayed && !session.items.length && <button className="btn btn-primary" onClick={() => restart(false)}>重新查找候选</button>}
          {!session.items.length && <p role="status">本轮没有可练习的题目，请返回重新选择。</p>}
          {!session.items.length && !showSummary && (
            <button className="btn btn-ghost" onClick={onExit}>
              {back}
            </button>
          )}
        </>
      )}
    </section>
  );
}
