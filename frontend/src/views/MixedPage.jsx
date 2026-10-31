import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { fetchSpellPool } from "../lib/practiceSession.js";
import { makePending, sendPending } from "../lib/learning.js";
import SpellingBoard from "../components/SpellingBoard.jsx";

// 队列上下文随唯一待确认请求保存；不交给只恢复单个结果的全局自评恢复条。
const PENDING_KEY = "ec.mixed.pending";
let memoryPending = null;
function loadMixedPending() {
  if (memoryPending) return memoryPending;
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
  } catch {
    return null;
  }
}
function saveMixedPending(record) {
  memoryPending = record;
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
const pendingId = (record) =>
  record?.pending.payload.answers?.[0]?.submission_id ??
  record?.pending.payload.submission_id;
function clearMixedPending(expected) {
  // A response may belong to an older mounted page; never erase another answer.
  if (expected && pendingId(loadMixedPending()) !== pendingId(expected))
    return false;
  memoryPending = null;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
  return true;
}
const shuffle = (list) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

/** 混合入口只编排题型；判分、事件、错词和排期均由同类题的服务端提交完成。 */
export default function MixedPage({ onExit }) {
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("loading");
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [storageWarning, setStorageWarning] = useState("");
  const [assistance, setAssistance] = useState([]);
  const [audioHint, setAudioHint] = useState("");
  const [stats, setStats] = useState({ correct: 0, skipped: 0, wrongList: [] });
  const pendingRef = useRef(null);
  const mountedRef = useRef(false);
  const requestRef = useRef(null);
  const busyRef = useRef(false);
  const advancedRef = useRef(new Set());
  const item = items[idx];
  const q = item?.q;
  const total = items.length;

  const load = useCallback(async () => {
    requestRef.current = null;
    busyRef.current = false;
    setSaving(false);
    setPhase("loading");
    setFeedback(null);
    setError(null);
    setAudioHint("");
    setAssistance([]);
    advancedRef.current = new Set();
    const saved = loadMixedPending();
    if (saved) {
      pendingRef.current = saved;
      setItems(saved.items);
      setIdx(saved.idx);
      setStats(saved.stats);
      setAssistance(saved.assistance);
      setError({ message: "上次提交尚未确认保存，请继续确认。" });
      setPhase("ready");
      return;
    }
    pendingRef.current = null;
    setIdx(0);
    setStats({ correct: 0, skipped: 0, wrongList: [] });
    try {
      const [listening, choice, pool] = await Promise.all([
        api("/api/listening?limit=3"),
        api("/api/quiz/choice?limit=4"),
        fetchSpellPool(),
      ]);
      const list = shuffle([
        ...(listening.questions || []).map((q) => ({ type: "listen", q })),
        ...(choice.questions || []).map((q) => ({ type: "choice", q })),
        ...shuffle(pool)
          .slice(0, 4)
          .map((c) => ({
            type: "spell",
            q: { card_id: c.id, word: c.word, meaning: c.meaning },
          })),
      ]);
      setItems(list);
      setPhase(list.length ? "ready" : "empty");
    } catch {
      setPhase("error");
    }
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      requestRef.current = null;
    };
  }, [load]);

  const play = useCallback(async (word) => {
    const mode = await speak(word);
    setAudioHint(
      mode === "online"
        ? ""
        : mode === "local"
          ? "在线发音不可用，已使用本地语音。"
          : "发音不可用，可根据释义继续作答。",
    );
  }, []);
  useEffect(() => {
    if (phase === "ready" && item?.type === "listen") play(q.word);
  }, [phase, idx, item?.type, q?.word, play]);

  // 同一题的按钮、Enter 与自动计时共享推进门闩。
  const next = useCallback(() => {
    if (!mountedRef.current || !feedback || advancedRef.current.has(idx))
      return;
    advancedRef.current.add(idx);
    setFeedback(null);
    setError(null);
    setAssistance([]);
    setAudioHint("");
    if (idx + 1 >= items.length) setPhase("done");
    else setIdx(idx + 1);
  }, [feedback, idx, items.length]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(next, feedback.correct ? 900 : 1500);
    const enter = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    document.addEventListener("keydown", enter);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", enter);
    };
  }, [feedback, next]);

  const send = async (record) => {
    if (!mountedRef.current || busyRef.current || pendingRef.current !== record)
      return;
    const request = {};
    requestRef.current = request;
    const ownsRequest = () =>
      mountedRef.current && requestRef.current === request;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await sendPending(record.pending);
      if (!ownsRequest()) return;
      const result =
        record.pending.path === "/api/quiz/score"
          ? response.details[0]
          : response;
      if (result?.committed !== true) throw new Error("保存尚未确认");
      if (!clearMixedPending(record)) return;
      setStorageWarning("");
      pendingRef.current = null;
      setFeedback({
        ...result,
        skipped: record.skipped,
        userInput: record.value,
      });
      setStats((s) =>
        result.correct
          ? { ...s, correct: s.correct + 1 }
          : record.skipped
            ? { ...s, skipped: s.skipped + 1 }
            : {
                ...s,
                wrongList: [
                  ...s.wrongList,
                  {
                    meaning: item.q.meaning || item.q.prompt,
                    expected: result.expected,
                  },
                ],
              },
      );
    } catch (cause) {
      if (!ownsRequest()) return;
      setError({
        message:
          cause.status === 409
            ? "题目已失效，本题尚未保存，请重新加载题目。"
            : cause.status === 404
              ? "词卡已删除，本题无法保存，请重新加载题目。"
              : "答案尚未确认保存，请重试。",
        reload: cause.status === 409 || cause.status === 404,
      });
    } finally {
      if (ownsRequest()) {
        requestRef.current = null;
        busyRef.current = false;
        setSaving(false);
      }
    }
  };
  const answer = (value, skipped = false) => {
    if (!item || feedback || error || busyRef.current || pendingRef.current)
      return;
    const typed = item.type === "spell";
    const command = makePending("", {
      card_id: q.card_id,
      source: "mixed",
      stage: "standalone",
      kind: typed ? "typed" : "choice",
      assistance,
      skipped,
      ...(typed
        ? { user_input: skipped ? "" : value }
        : { answer: skipped ? null : value, question_token: q.question_token }),
    }).payload;
    const path = typed
      ? "/api/typing/check"
      : item.type === "listen"
        ? "/api/listening/score"
        : "/api/quiz/score";
    const record = {
      pending: {
        path,
        payload: item.type === "choice" ? { answers: [command] } : command,
      },
      items,
      idx,
      stats,
      assistance,
      value,
      skipped,
    };
    pendingRef.current = record;
    if (!saveMixedPending(record))
      setStorageWarning("本次操作尚未确认保存；刷新后可能需要重新核对");
    return send(record);
  };
  const reload = () => {
    clearMixedPending();
    pendingRef.current = null;
    load();
  };
  const locked = saving || !!feedback || !!error;

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "error")
    return (
      <div className="story-empty">
        <div role="alert">题目加载失败，请重试。</div>
        <button onClick={load}>重新加载</button>
        <button onClick={onExit}>返回</button>
      </div>
    );
  if (phase === "empty")
    return (
      <div className="story-empty">
        没有可练习的题目，先去加词吧<button onClick={onExit}>返回</button>
      </div>
    );
  if (phase === "done")
    return (
      <section className="view view-center">
        <div className="study-done">
          <h2>混合练习完成！</h2>
          <p>
            答对 {stats.correct}/{total} 题 · 跳过 {stats.skipped} 题
          </p>
          {stats.wrongList.map((w, i) => (
            <div key={i}>
              {w.meaning}：{w.expected}
            </div>
          ))}
          <button className="btn btn-primary" onClick={load}>
            再来一轮
          </button>
          <button className="btn btn-ghost" onClick={onExit}>
            回到队列
          </button>
        </div>
      </section>
    );
  if (!q) return null;
  return (
    <section className="view view-practice">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>
          ← 返回
        </button>
      </div>
      <div className="spelling-head">
        <span className="study-count">
          {idx + 1} / {total} ·{" "}
          {item.type === "spell"
            ? "拼写"
            : item.type === "listen"
              ? "听写"
              : "选择"}
        </span>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${(idx / total) * 100}%` }}
        />
      </div>
      <div className="mixed-body">
        {item.type === "spell" ? (
          <>
            <div className="spelling-meaning">{q.meaning}</div>
            <div className="spelling-difficulty">
              <button
                className="diff-btn"
                disabled={locked}
                onClick={() =>
                  setAssistance((a) =>
                    Array.from(
                      new Set([
                        ...a,
                        "first_letter",
                        "length",
                        "live_feedback",
                      ]),
                    ),
                  )
                }
              >
                提示首字母
              </button>
              <button
                className="diff-btn"
                disabled={locked}
                onClick={() =>
                  setAssistance((a) =>
                    Array.from(new Set([...a, "length", "live_feedback"])),
                  )
                }
              >
                提示长度
              </button>
              <span>独立回忆；请求提示后本题不排期</span>
            </div>
            <SpellingBoard
              key={idx}
              mode={assistance.length ? "assisted" : "independent"}
              target={assistance.length ? q.word : null}
              showFirstHint={assistance.includes("first_letter")}
              disabled={locked}
              onSubmit={answer}
            />
          </>
        ) : (
          <>
            <div
              className={
                item.type === "listen" ? "listening-prompt" : "quiz-prompt"
              }
            >
              {item.type === "listen" && (
                <button
                  className="btn-speak-large"
                  onClick={() => play(q.word)}
                >
                  🔊
                </button>
              )}
              {q.meaning || q.prompt}
            </div>
            {audioHint && <div className="listening-hint">{audioHint}</div>}
            <div
              data-testid={`mixed-${item.type}`}
              className={
                item.type === "listen" ? "listening-options" : "quiz-options"
              }
            >
              {q.options.map((opt) => (
                <div key={opt} style={{ position: "relative" }}>
                  <button
                    className={`${item.type === "listen" ? "btn btn-ghost listening-option" : "quiz-option"}${feedback?.expected === opt ? " correct" : ""}`}
                    style={{ width: "100%" }}
                    disabled={locked}
                    onClick={() => answer(opt)}
                  >
                    {opt}
                  </button>
                  {item.type === "choice" && (
                    <button
                      className="quiz-option-speak"
                      aria-label={`听发音：${opt}`}
                      title="听发音"
                      disabled={locked}
                      onClick={() => play(opt)}
                    >
                      🔊
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {saving && <div>保存中…</div>}
        {storageWarning && <div role="alert">{storageWarning}</div>}
        {error && (
          <div role="alert">
            {error.message}
            {error.reload ? (
              <button onClick={reload}>重新加载题目</button>
            ) : (
              <button
                disabled={saving}
                onClick={() => send(pendingRef.current)}
              >
                {loadMixedPending() ? "继续确认 / 重试保存" : "重试保存"}
              </button>
            )}
          </div>
        )}
        {feedback && (
          <div
            role="status"
            className={`quiz-feedback ${feedback.correct ? "ok" : "err"}`}
          >
            已保存 ·{" "}
            {feedback.skipped
              ? "已跳过，本题不计正误，也不排期"
              : feedback.correct
                ? "✅ 正确！"
                : `正确答案：${feedback.expected}`}
          </div>
        )}
      </div>
      <div className="practice-actions">
        <button
          className="btn btn-ghost btn-small spelling-skip"
          disabled={saving || !!error}
          onClick={feedback ? next : () => answer(null, true)}
        >
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
