import React, {useEffect, useRef, useState} from "react";
import {api} from "../lib/api.js";

/** One pending generation per original; selection changes fence late responses. */
export default function StoryVersions({story, enabled, onSelect, onSaved, children}) {
  const root = story.parent_version_id || story.version_id;
  const key = `ec.story-simplification.${root}`;
  const [pending, setPending] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const selection = useRef(0);
  const saving = useRef(false);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false; selection.current += 1;};}, []);
  const remember = value => {
    setPending(value);
    try {value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key);}
    catch {setNote("待确认操作仅保存在内存，刷新后请核对故事列表。");}
  };
  const choose = id => {selection.current += 1; onSelect(id);};
  const simplify = async () => {
    if (saving.current) return;
    saving.current = true;
    const request = selection.current;
    const body = pending || {operation_id: crypto.randomUUID(), version_id: root, story_id: story.id};
    remember(body); setBusy(true); setError("");
    try {
      const sourceId = story.versions?.find(v => v.version_id === body.version_id)?.story_id || body.story_id;
      const result = await api(`/api/stories/${sourceId}/simplify`, {method: "POST", body: JSON.stringify({operation_id: body.operation_id, version_id: body.version_id})});
      if (!alive.current) return;
      remember(null);
      onSaved(result);
      if (selection.current === request) onSelect(result.id);
    } catch (e) {
      if (alive.current) setError(`简化尚未确认：${e.message}。已有版本保留。`);
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const versions = story.versions || [];
  const original = versions.find(v => v.mode === "normal");
  return <>
    {story.version_id && story.mode !== "starter" && <div className="story-version-controls" style={{padding: "12px 0"}}>
      <p data-testid="story-check-status">{story.mode === "short" ? "简化版" : "原版"} · 未检查</p>
      {original && <button className="btn btn-ghost btn-small" onClick={() => choose(original.story_id)}>查看原版</button>}
      {versions.filter(v => v.mode === "short").map((v, index) => <button className="btn btn-ghost btn-small" key={v.version_id} onClick={() => choose(v.story_id)}>查看简化版{index ? ` ${index + 1}` : ""}</button>)}
      {enabled && story.mode === "normal" && !pending && !versions.some(v => v.mode === "short") && <button className="btn btn-primary btn-small" onClick={simplify}>更简单</button>}
      {busy && <p role="status">简化并确认保存中…</p>}
      {pending && !busy && <div role="alert"><p>{error || "有一条待确认的简化，请继续确认。"}</p>
        {enabled && <button className="btn btn-primary btn-small" onClick={simplify}>继续确认保存</button>}
        <button className="btn btn-ghost btn-small" onClick={() => {remember(null); setError("");}}>放弃待确认简化</button>
      </div>}
      {note && <p role="note">{note}</p>}
    </div>}
    {children}
  </>;
}
