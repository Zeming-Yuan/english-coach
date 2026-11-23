import React, {useEffect, useState} from "react";
import {api} from "../lib/api.js";
import PracticePage from "./PracticePage.jsx";

export default function AdvicePracticePage({request, onExit, onNormal}) {
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    const create = async () => {
      try {return await api(`/api/practice-sessions/${request.id}`);}
      catch (cause) {if (cause.status !== 404) throw cause;}
      return api("/api/practice-sessions", {method: "POST", body: JSON.stringify(request)});
    };
    create().then(data => {if (!cancelled) setSessionId(data.id);})
      .catch(cause => {if (!cancelled) setError(cause.message || "建议练习创建失败");});
    return () => {cancelled = true;};
  }, [request, retry]);
  if (sessionId) return <PracticePage key={sessionId} sessionId={sessionId} onExit={onExit} onNormal={onNormal} onRestart={onExit} advice browserStored={request.browserStored} />;
  return <section className="view">
    <h2>建议练习</h2>
    {request.browserStored === false && <p role="note" className="ec-callout is-warn is-compact">浏览器未保存轮次标识；创建未确认时刷新可能丢失，请先确认创建。</p>}
    {error ? <div role="alert" className="ec-callout is-err ec-callout-inline"><span>{error}</span><button className="btn btn-primary btn-small" onClick={() => setRetry(v => v + 1)}>继续确认创建</button></div> : <p role="status" className="ec-callout is-info is-compact">正在确认原目标…</p>}
    <div className="save-state-actions">
      <button className="btn btn-ghost" onClick={onExit}>返回建议</button>
    </div>
  </section>;
}
