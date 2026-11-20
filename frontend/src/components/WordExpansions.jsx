import React, {useEffect, useRef, useState} from "react";
import {api} from "../lib/api.js";
import ExpansionPreview from "./ExpansionPreview.jsx";

const GROUPS = [
  ["family", "同词族"], ["affix", "同词缀"], ["compound", "复合词"],
  ["synonym", "近义词"], ["lookalike", "形近词"], ["legacy", "相关词"],
];
const validWord = row => row && typeof row.word === "string" && row.word.trim() &&
  typeof row.meaning === "string" && row.meaning.trim();
const typedWord = row => validWord(row) && GROUPS.some(([kind]) => kind !== "legacy" && row.kind === kind);

export default function WordExpansions({card, onUpdate, onConflict, source = "card_detail", onClose, onOpenCard, studySessionId}) {
  const [selection, setSelection] = useState(null);
  const trigger = useRef(null);
  const closePreview = () => {
    setSelection(null);
    if (onClose) onClose();
    else trigger.current?.focus();
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const rows = Array.isArray(card.related_words) ? card.related_words.filter(row => row && typeof row === "object") : [];
  const formation = rows.filter(row => row.kind === "formation" && typeof row.text === "string" && row.text.trim());
  const groups = GROUPS.map(([kind, label]) => ({kind, label, words: rows.filter(row =>
    (kind === "legacy" ? !row.kind : row.kind === kind) &&
    validWord(row),
  )})).filter(group => group.words.length);
  const complete = groups.some(group => group.kind !== "legacy");

  const generate = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/cards/${card.id}/expansions`, {
        method: "POST",
        ...(card.content_revision ? {body: JSON.stringify(card.content_revision)} : {}),
      });
      if (!active.current) return;
      if (!Array.isArray(result?.related_words) || !result.related_words.some(typedWord)) throw new Error("返回内容不完整，请重试");
      if (result.content_revision && (
        result.content_revision.identity !== card.content_revision?.identity ||
        result.content_revision.version !== card.content_revision?.version
      )) {
        await onConflict();
        if (active.current) setError("词卡内容已变化，请查看最新内容后重试");
        return;
      }
      onUpdate(result.related_words);
    } catch (cause) {
      if (!active.current) return;
      if (cause?.status === 409) await onConflict();
      if (active.current) setError(cause?.status === 409 ? "词卡内容已变化，请查看最新内容后重试" : `补全失败：${cause.message}`);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  const renderGroup = group => <div className="related-words-box" key={group.kind}>
    <h3 className="related-words-label">{group.label}</h3>
    <div className="related-words-list">{group.words.map((row, index) => <button type="button"
      key={index} className="related-word-chip" onClick={event => {
        trigger.current = event.currentTarget;
        setSelection({...row, label: group.label});
      }}>
      {row.word}<span className="related-word-meaning">{row.meaning}</span>
    </button>)}</div>
  </div>;

  return <section className="word-expansions" aria-label="构词与扩展">
    <h2 className="word-section-title">构词与扩展</h2>
    {formation.length > 0 && <div className="word-formation">
      <h3 className="related-words-label">构词拆解</h3>
      {formation.map((row, index) => <p key={index}>{row.text}</p>)}
    </div>}
    {(onClose ? groups.slice(0, 2) : groups).map(renderGroup)}
    {onClose && groups.length > 2 && <details>
      <summary>查看其他扩展</summary>
      {groups.slice(2).map(renderGroup)}
    </details>}
    {onClose && <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>收起扩展</button>}
    {selection && <ExpansionPreview sourceCard={card} row={selection} source={source}
      closeLabel={onClose ? "返回原词卡" : "关闭扩展词"} onClose={closePreview}
      onOpenCard={onOpenCard} studySessionId={studySessionId} />}
    {error && <p role="alert" className="inline-detail-error">{error}</p>}
    {!complete && <button type="button" className="btn btn-ghost btn-small" onClick={generate} disabled={busy}>
      {busy ? "补全中…" : error ? "重试补全扩展词" : "补全扩展词"}
    </button>}
  </section>;
}
