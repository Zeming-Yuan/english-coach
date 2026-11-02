import React, {useEffect, useRef, useState} from "react";
import {api} from "../lib/api.js";
import {pendingContactIds, recordContact} from "../lib/contacts.js";
import {storageGet, storageSet} from "../lib/utils.js";

function RevealedAnswer({card, onRecorded}) {
  const [error, setError] = useState("");
  const ref = useRef(null);
  const confirm = () => recordContact({cardId: card.id, revision: card.content_revision, source: "spelling", kind: "answer_visible"})
    .then(() => {setError(""); onRecorded();})
    .catch(cause => setError(`接触依据不完整：${cause.message}`));
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      confirm();
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [card.id]);
  return <p ref={ref}>{card.word}{error && <span role="alert">{error}<button onClick={confirm}>继续确认接触</button></span>}</p>;
}

function Suggestion({advice, onStart, onRefresh}) {
  const [cards, setCards] = useState([]);
  const [error, setError] = useState("");
  const [revealing, setRevealing] = useState(false);
  const reveal = async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      const loaded = await Promise.all(advice.targets.map(target => api(`/api/cards/${target.card_id}`)));
      if (loaded.some((card, i) => card.content_revision.identity !== advice.targets[i].revision.identity || card.content_revision.version !== advice.targets[i].revision.version)) throw new Error("原目标已修订，请重新查看建议");
      setCards(loaded);
    } catch (cause) { setError(cause.message); }
    finally { setRevealing(false); }
  };
  return <article className="lesson-progress">
    <p>{advice.reason} · 依据 {advice.sample_count} 个样本</p>
    <p>{advice.window === "week" ? "一周回测" : advice.window === "day" ? "隔日回测" : "无提示输入"} · {advice.card_ids.length} 个词：{advice.prompts_cn.join("、")}</p>
    {!!advice.lesson_labels?.length && <p>相关课程：{advice.lesson_labels.join("、")}</p>}
    {error && <p role="alert">{error}</p>}
    {cards.map(card => <RevealedAnswer key={card.id} card={card} onRecorded={onRefresh} />)}
    <div className="save-state-actions">
      <button className="btn btn-primary btn-small" onClick={() => onStart(advice)} disabled={cards.length > 0 || revealing}>开始建议练习</button>
      {!cards.length && <button className="btn btn-ghost btn-small" disabled={revealing} onClick={reveal}>展开英文答案（会重算回测资格）</button>}
    </div>
  </article>;
}

export default function LearningAdvice({onStart}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [recoveryError, setRecoveryError] = useState("");
  const [saved, setSaved] = useState(() => storageGet("ec.advice.request", null));
  useEffect(() => {
    let cancelled = false;
    api("/api/learning/recommendations")
      .then(result => {if (!cancelled) {setData(result); setError("");}})
      .catch(cause => {if (!cancelled) setError(cause.message);});
    return () => {cancelled = true;};
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    const stored = storageGet("ec.advice.request", null);
    const reconcile = async () => {
      let original = null;
      if (stored) {
        try {original = await api(`/api/practice-sessions/${stored.id}`);}
        catch (cause) {if (cause.status !== 404) throw cause;}
      }
      if (original?.lifecycle === "active") return stored;
      const active = await api("/api/practice-sessions?purpose=targeted");
      return active.sessions[0] || stored;
    };
    reconcile().then(request => {
      if (!cancelled) {setSaved(request); setRecoveryError("");}
    }).catch(cause => {if (!cancelled) setRecoveryError(`原轮次读取失败：${cause.message}`);});
    return () => {cancelled = true;};
  }, [refresh]);
  const discard = () => {
    try {localStorage.removeItem("ec.advice.request");} catch {}
    setSaved(null);
    setRecoveryError("");
  };
  const start = advice => {
    const request = {id: crypto.randomUUID(), purpose: advice.purpose, window: advice.window, card_ids: advice.card_ids, targets: advice.targets, pending_contact_ids: pendingContactIds()};
    storageSet("ec.advice.request", request);
    onStart({...request, browserStored: storageGet("ec.advice.request", null)?.id === request.id});
  };
  if (data?.enabled === false) return null;
  return <section className="stats-section" data-testid="learning-advice">
    <h3>建议练习</h3>
    {error && <p role="alert">建议读取失败：{error}<button onClick={() => setRefresh(v => v + 1)}>重新读取建议</button></p>}
    {!data && !error && <p role="status">正在读取学习依据…</p>}
    {data?.message && <p role="status">{data.message}</p>}
    {recoveryError && <p role="alert">{recoveryError}<button onClick={() => setRefresh(v => v + 1)}>重新查找轮次</button></p>}
    {saved && <div className="save-state-actions">
      <button className="btn btn-ghost btn-small" onClick={() => onStart(saved)}>继续建议练习</button>
      <button className="btn btn-ghost btn-small" onClick={discard}>放弃原请求入口</button>
    </div>}
    {data?.suggestions.map(advice => <Suggestion key={advice.id + JSON.stringify(advice.targets)} advice={advice} onStart={start} onRefresh={() => setRefresh(v => v + 1)} />)}
  </section>;
}
