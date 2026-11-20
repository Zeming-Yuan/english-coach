import React, {useEffect, useRef, useState} from "react";
import {api} from "../lib/api.js";
import {
  clearAdditionPending, confirmAddition, createAdditionPending, expiredAddition,
  loadAdditionPending, saveAdditionPending, watchExpansionAdditions,
} from "../lib/expansionAdditions.js";

function useConfirmation() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [temporary, setTemporary] = useState(false);
  const submit = async pending => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setTemporary(!saveAdditionPending(pending));
    try {
      setResult(await confirmAddition(pending));
    } catch (cause) {
      setError(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return {submit, busy, result, error, temporary};
}

const SpinnerIcon = () => (
  <svg className="btn-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const CheckDrawIcon = () => (
  <svg className="check-svg" width="20" height="20" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle className="check-draw-circle" cx="128" cy="128" r="96" />
    <polyline className="check-draw-tick" points="88 136 112 160 168 104" />
  </svg>
);

function AdditionFeedback({state, openCard, recovery = false}) {
  if (state.result) {
    const toneClass = !state.result.available
      ? "inline-notice is-warn"
      : recovery || state.result.created
      ? "inline-notice is-ok"
      : "inline-notice is-warn";
    return <div className={toneClass}>
      <div className="inline-notice-ok-row">
        {state.result.available && (recovery || state.result.created) && <CheckDrawIcon />}
        <p role="status">{!state.result.available ? "本次加入已保存，目标词卡后来已删除。" :
          recovery ? "已确认加入" : state.result.created ? "已加入学习" : "已找到已有词卡"}</p>
      </div>
      {state.result.linkStored === false && <p>词卡已保存，浏览器未能保留本轮的词卡链接。</p>}
      {state.result.available && openCard && <button type="button" className="btn btn-ghost btn-small"
        onClick={() => openCard(state.result.card_id)}>
        {state.result.created ? "打开词卡" : "打开已有词卡"}
      </button>}
    </div>;
  }
  return <>
    {state.error && <p role="alert" className="inline-notice is-err is-shaking">{expiredAddition(state.error) ? "来源或扩展词已变化，请重新查看。" :
      `加入待确认：${state.error.message}`}</p>}
    {state.temporary && <p role="status" className="inline-notice is-warn">浏览器无法保存待确认请求，请在本页核对后再刷新。</p>}
  </>;
}

export default function ExpansionAddition({card, row, studySessionId, openCard}) {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api("/api/expansion-additions", {signal: controller.signal})
      .then(result => setEnabled(result?.enabled !== false))
      .catch(error => { if (error.name !== "AbortError") setEnabled(true); });
    return () => controller.abort();
  }, []);
  const [pending, setPending] = useState(null);
  const confirmation = useConfirmation();
  const submit = () => {
    const next = pending || createAdditionPending(card, row, studySessionId);
    setPending(next);
    void confirmation.submit(next);
  };
  const expired = expiredAddition(confirmation.error);
  return <div className="expansion-addition">
    {enabled === true && !confirmation.result && !expired && <button type="button"
      className={`btn btn-primary btn-small expansion-add-btn${confirmation.busy ? " is-loading" : ""}`}
      onClick={submit} disabled={confirmation.busy}>
      {confirmation.busy && <SpinnerIcon />}
      {confirmation.busy ? "正在确认加入…" : pending ? "继续确认加入" : "加入学习"}
    </button>}
    <AdditionFeedback state={confirmation} openCard={openCard} />
    {expired && <button type="button" className="btn btn-ghost btn-small"
      onClick={() => clearAdditionPending(pending.command.operation_id)}>放弃失效请求</button>}
  </div>;
}

export function ExpansionAdditionRecovery({openCard}) {
  const [pending, setPending] = useState(loadAdditionPending);
  const [confirmed, setConfirmed] = useState([]);
  useEffect(() => watchExpansionAdditions(() => setPending(loadAdditionPending())), []);
  const rows = [...pending, ...confirmed.filter(row =>
    !pending.some(item => item.command.operation_id === row.command.operation_id))];
  if (!rows.length) return null;
  return <aside aria-label="扩展词加入确认" className="save-state expansion-recovery-list">
    {rows.map(row => <RecoveryItem key={row.command.operation_id} pending={row}
      openCard={openCard} keep={() => setConfirmed(current =>
        current.some(item => item.command.operation_id === row.command.operation_id) ? current : [...current, row])}
      dismiss={() => {
        setConfirmed(current => current.filter(item => item.command.operation_id !== row.command.operation_id));
        clearAdditionPending(row.command.operation_id);
      }} />)}
  </aside>;
}

function RecoveryItem({pending, keep, dismiss, openCard}) {
  const state = useConfirmation();
  return <div className="recovery-item">
    {!state.result && <p>「{pending.command.target.word}」的加入待确认</p>}
    <AdditionFeedback state={state} recovery openCard={id => openCard(id, pending.study_session_id)} />
    <div className="recovery-actions">
      {!state.result && !expiredAddition(state.error) && <button type="button"
        className={`btn btn-primary btn-small${state.busy ? " is-loading" : ""}`}
        disabled={state.busy} onClick={() => {keep(); void state.submit(pending);}}>继续确认加入</button>}
      <button type="button" className="btn btn-ghost btn-small" disabled={state.busy} onClick={dismiss}>
        {state.result ? "关闭确认" : "放弃待确认加入"}
      </button>
    </div>
  </div>;
}
