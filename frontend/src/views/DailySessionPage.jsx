import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import StudyPage from "./StudyPage.jsx";
import SpellingBoard from "../components/SpellingBoard.jsx";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { clearPending, loadPending } from "../lib/learning.js";

/** Daily orchestration only; main progress and attempt commits keep their existing owners. */
export default function DailySessionPage({ session, onSessionChange, onFinish, ...studyProps }) {
  const attempt = useLearningAttempt("reinforcement");
  const mounted = useRef(false);
  const readSequence = useRef(0);
  const recoveryVersion = useRef(studyProps.recoveryVersion);
  const activeSessionId = useRef(session.id);
  activeSessionId.current = session.id;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readSequence.current += 1; };
  }, [session.id]);
  const ownsSession = () => mounted.current && activeSessionId.current === session.id;
  const ownsRead = (request) => ownsSession() && request === readSequence.current;
  const [questions, setQuestions] = useState(null);
  const [assisted, setAssisted] = useState(false);
  useEffect(() => { setAssisted(false); }, [questions?.[0]?.card_id]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const finish = useCallback(async () => {
    if (!ownsSession()) return;
    const request = ++readSequence.current;
    setLoading(true); setError(""); setQuestions(null);
    onSessionChange({phase: "summary"});
    try {
      const saved = await api(`/api/sessions/${session.id}/summary`);
      if (ownsRead(request)) setSummary(saved);
    } catch (e) { if (ownsRead(request)) setError(`结果加载失败：${e.message}`); }
    finally { if (ownsRead(request)) setLoading(false); }
  }, [session, onSessionChange]);
  const load = async () => {
    if (!ownsSession()) return;
    const request = ++readSequence.current;
    setLoading(true); setError(""); setQuestions(null);
    try {
      if (session.phase === "summary") { await finish(); return; }
      const data = await api(`/api/sessions/${session.id}/reinforcement`);
      if (!ownsRead(request)) return;
      const ids = session.reinforcementCardIds ?? data.questions.map(q => q.card_id);
      if (!session.reinforcementCardIds) onSessionChange({reinforcementCardIds: ids});
      const available = data.questions.filter(q => ids.includes(q.card_id));
      setQuestions(available);
      if (!available.length && !loadPending("reinforcement")) await finish();
    } catch (e) { if (ownsRead(request)) setError(`巩固加载失败：${e.message}`); }
    finally { if (ownsRead(request)) setLoading(false); }
  };
  useEffect(() => {
    if (!session.complete) return;
    if (!loadPending("reinforcement")) attempt.clear();
    load();
  }, [session.id, session.complete]);
  useEffect(() => {
    if (recoveryVersion.current === studyProps.recoveryVersion) return;
    recoveryVersion.current = studyProps.recoveryVersion;
    // Only reconcile this unresolved hook copy after its own pending is gone.
    // Other scopes finishing must not clear feedback or an answer being typed.
    if (!session.complete || attempt.phase !== "failed" || loadPending("reinforcement")) return;
    attempt.clear();
    load();
  }, [studyProps.recoveryVersion]);
  const submit = async (answer) => {
    const question = questions?.[0];
    if (!question || attempt.phase !== "idle") return;
    await attempt.submit("/api/typing/check", {
      card_id: question.card_id, kind: "typed", user_input: answer,
      source: "reinforcement", session_id: session.id, stage: "reinforcement", assistance: assisted ? ["first_letter", "length", "live_feedback"] : [],
    });
    if (ownsSession()) clearPending("reinforcement");
  };
  const retry = async () => {
    try { await attempt.retry(); if (ownsSession()) clearPending("reinforcement"); } catch {}
  };
  const next = async () => {
    attempt.clear();
    await load();
  };
  if (!session.complete) return <StudyPage {...studyProps} session={session} />;
  if (summary) return <section className="view view-center"><div className="study-done">
    <h2>本轮学习结果</h2>
    <p className="done-detail">{summary.counts.completed_cards} 张卡已保存并排期；主队列 {summary.counts.main} 次，巩固 {summary.counts.reinforcement} 次；跳过 {summary.counts.skipped} 次。</p>
    {[["retrieval", "独立提取"], ["assisted", "辅助练习"], ["recognition", "识别练习"], ["self_report", "自评"]].map(([key, label]) => <p key={key}>{label}：{summary.metrics[key].count ? `${summary.metrics[key].successes} / ${summary.metrics[key].count}` : "暂无数据"}</p>)}
    <p>仍需复习：{summary.weak_words.map(w => w.word).join("、") || "本轮暂无薄弱词"}</p>
    <p>{summary.next_due ? `已有排期：${summary.next_due}` : "暂无排期，可稍后返回队列继续学习"}</p>
    <button className="btn btn-primary" onClick={onFinish}>← 返回队列</button>
    <button className="btn btn-ghost" onClick={() => { onFinish(); studyProps.onToQuiz(); }}>去做测验</button>
  </div></section>;
  return <section className="view view-practice">
    <h2>本轮巩固</h2>
    {loading && <p role="status">正在读取已保存结果…</p>}
    {error && <div role="alert">{error}<button className="btn btn-primary" onClick={load}>重试加载</button></div>}
    {questions?.length > 0 && attempt.phase !== "saved" && <>
      <p>本轮最多三题，可直接结束。</p>
      <div className="spelling-meaning">{questions[0].meaning}</div>
      <button className="btn btn-ghost" disabled={attempt.phase !== "idle" || loading} onClick={() => setAssisted(true)}>提示首字母</button>
      <p>{assisted ? "带提示练习，不更新排期" : "独立回忆：提交前不显示答案、长度或逐字正误"}</p>
      <SpellingBoard key={questions[0].card_id} mode={assisted ? "assisted" : "independent"} target={assisted ? questions[0].word : null} showFirstHint={assisted} onSubmit={submit} disabled={attempt.phase !== "idle" || loading} />
    </>}
    {attempt.phase === "saved" && <>
      <p role="status">{attempt.result.correct === true ? "已保存：答对" : attempt.result.correct === false ? `已保存：答错，正确拼写：${attempt.result.expected}` : "已保存：已跳过"}</p>
      <button className="btn btn-primary" onClick={next}>{questions?.some(q => q.card_id !== attempt.result.card_id) ? "下一题 →" : "查看本轮结果"}</button>
    </>}
    {attempt.phase === "saving" && <p role="status">正在确认保存…</p>}
    {attempt.phase === "failed" && <div role="alert">{attempt.error}<button className="btn btn-primary" onClick={retry}>继续确认保存</button><button className="btn btn-ghost" onClick={() => { attempt.clear(); studyProps.onAbort(); }}>退出本轮并重新加载</button></div>}
    <button className="btn btn-ghost" disabled={loading || attempt.phase !== "idle"} onClick={finish}>跳过本轮巩固</button>
    <button className="btn btn-ghost" onClick={studyProps.onExit}>← 退出</button>
  </section>;
}
