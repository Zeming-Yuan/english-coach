import React, {useEffect, useState} from "react";
import {api} from "../lib/api.js";
import {pendingContactIds} from "../lib/contacts.js";
import {storageGet, storageSet} from "../lib/utils.js";
import PracticePage from "./PracticePage.jsx";

export default function DelayedCheckPage({window, onExit, onNormal}) {
  const key = `ec.delayed.${window}`;
  const [request, setRequest] = useState(() => storageGet(key, null));
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    if (!request) {
      api(`/api/practice-sessions?purpose=delayed_check&window=${window}`)
        .then(data => {
          if (cancelled) return;
          if (data.sessions[0]) setSessionId(data.sessions[0].id);
          else setRequest({id: crypto.randomUUID(), purpose: "delayed_check", window, pending_contact_ids: pendingContactIds()});
        })
        .catch(cause => { if (!cancelled) setError(cause.message || "回测加载失败"); });
      return () => { cancelled = true; };
    }
    storageSet(key, request);
    api(`/api/practice-sessions/${request.id}`)
      .catch(cause => {
        if (cause.status !== 404) throw cause;
        return api("/api/practice-sessions", {method: "POST", body: JSON.stringify(request)});
      })
      .then(data => { if (!cancelled) setSessionId(data.id); })
      .catch(cause => { if (!cancelled) setError(cause.message || "回测创建失败"); });
    return () => { cancelled = true; };
  }, [request, retry, key]);
  if (sessionId) return <PracticePage key={sessionId} sessionId={sessionId} onExit={onExit} onNormal={onNormal} onRestart={() => {
    setSessionId(null);
    setRequest({id: crypto.randomUUID(), purpose: "delayed_check", window, pending_contact_ids: pendingContactIds()});
  }} />;
  return <section className="view">
    <h2>{window === "week" ? "一周回测" : "隔日回测"}</h2>
    {error ? <div role="alert">{error}<button className="btn btn-primary" onClick={() => setRetry(v => v + 1)}>继续确认创建</button></div> : <p role="status">正在确认回测轮次…</p>}
    <button className="btn btn-ghost" onClick={onExit}>返回统计</button>
  </section>;
}
