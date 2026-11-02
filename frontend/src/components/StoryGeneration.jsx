import React, {useEffect, useRef, useState} from "react";
import {api} from "../lib/api.js";

const KEY = "ec.story-generation";
function pendingRequest() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return data?.operation_id && typeof data.include_new_target === "boolean" ? data : null;
  } catch { return null; }
}

export function StoryQuality({story}) {
  if (!story.quality) return <p>本篇暂无检查题</p>;
  const q = story.quality;
  return <div data-testid="story-quality" role="status" style={{fontSize: 14, lineHeight: 1.7, margin: "12px 0"}}>
    {story.mode === "starter" && <p>{q.known_basis === "insufficient" ? "回忆依据不足：" : ""}先阅读已核对的入门材料，不添加词卡。</p>}
    <p>词形覆盖检查 · 基础支撑词表 {q.support_version}（教学材料，不代表个人掌握）</p>
    {q.known_targets.length > 0 && <p>已有回忆依据的目标词：{q.known_targets.join("、")}</p>}
    <p>新目标：{q.new_targets.join("、") || "无"}；未覆盖词形：{q.unknown_forms.join("、") || "无"}。新词不会自动加入词库。</p>
    <p>词形覆盖不保证理解全文。{story.check_material ? "理解题材料已校验保存，读后作答入口待开放。" : "本篇暂无检查题"}</p>
  </div>;
}

export default function StoryGeneration({onSaved, onStarter}) {
  const [pending, setPending] = useState(pendingRequest);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState("");
  const [starterError, setStarterError] = useState("");
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const remember = (value) => {
    setPending(value);
    try { value ? localStorage.setItem(KEY, JSON.stringify(value)) : localStorage.removeItem(KEY); }
    catch { setStorageNote("待确认操作仅保存在内存，刷新后请核对故事列表。"); }
  };
  const generate = async () => {
    if (saving.current) return;
    saving.current = true;
    const body = pending || {operation_id: crypto.randomUUID(), include_new_target: consent};
    remember(body);
    setBusy(true); setError("");
    try {
      const story = await api("/api/stories/generate", {method: "POST", body: JSON.stringify(body)});
      if (!alive.current) return;
      remember(null);
      if (story.mode === "starter") onStarter(story);
      else await onSaved(story);
    } catch (e) {
      if (!alive.current) return;
      setError(`生成尚未确认：${e.message}。已有故事保留。`);
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return <div>
    <label><input type="checkbox" checked={pending ? pending.include_new_target : consent} disabled={busy || !!pending} onChange={e => setConsent(e.target.checked)} />同意加入最多一个新目标词（不自动加词）</label>
    {!pending && <button className="btn btn-primary btn-small" onClick={generate}>生成新故事</button>}
    {busy && <p role="status">生成并确认保存中…</p>}
    {pending && !busy && <div>
      <p role="alert">{error || "有一条待确认的故事生成，请继续确认。"}</p>
      <button className="btn btn-primary btn-small" onClick={generate}>继续确认保存</button>
      <button className="btn btn-ghost btn-small" onClick={() => {remember(null); setError("");}}>放弃待确认生成</button>
    </div>}
    {storageNote && <p role="note">{storageNote}</p>}
    {starterError && <p role="alert">{starterError}</p>}
    <button className="btn btn-ghost btn-small" onClick={async () => {
      setStarterError("");
      try { const story = await api("/api/stories/starter"); if (alive.current) onStarter(story); }
      catch (e) { if (alive.current) setStarterError("读取入门材料失败：" + e.message); }
    }}>阅读入门材料</button>
  </div>;
}
