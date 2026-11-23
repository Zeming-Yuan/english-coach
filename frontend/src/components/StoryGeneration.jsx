import { accountStorage } from "../lib/accountSession.js";
import React, {useEffect, useRef, useState} from "react";
import {api} from "../lib/api.js";

const KEY = "ec.story-generation";
function pendingRequest() {
  try {
    const data = JSON.parse(accountStorage.getItem(KEY));
    return data?.operation_id && typeof data.include_new_target === "boolean" ? data : null;
  } catch { return null; }
}

export function StoryQuality({story}) {
  if (!story.quality) return <p className="story-quality-empty">本篇暂无检查题</p>;
  const q = story.quality;
  const isStarter = story.mode === "starter";
  const hasCheck = Boolean(story.check_material);
  const checkBadgeTone = hasCheck ? "is-ok" : story.mode === "normal" ? "is-warn" : "is-muted";
  const checkBadgeText = hasCheck
    ? "理解题材料已校验保存。"
    : story.mode === "normal"
      ? "本篇暂无理解选择题；可检查可用目标词。"
      : "本篇暂无检查题";
  return (
    <div
      data-testid="story-quality"
      role="status"
      className={`ec-meta-card story-quality-card${isStarter ? " is-starter" : ""}`}
    >
      {isStarter && (
        <p className="sq-advisory">
          <span className="sq-advisory-dot" aria-hidden="true" />
          <span>{q.known_basis === "insufficient" ? "回忆依据不足：" : ""}先阅读已核对的入门材料，不添加词卡。</span>
        </p>
      )}
      <div className="sq-head">
        <p className="sq-title-line">
          <span className="sq-title">词形覆盖检查</span>
          <span className="sq-sep" aria-hidden="true"> · </span>
          <span className="sq-support">基础支撑词表 <code className="sq-code">{q.support_version}</code></span>
          <span className="sq-disclaimer">（教学材料，不代表个人掌握）</span>
        </p>
      </div>
      <div className="sq-metrics">
        {q.known_targets.length > 0 && (
          <p className="sq-chip sq-chip-known">
            <span className="sq-k">已有回忆依据的目标词：</span>
            <strong className="sq-v">{q.known_targets.join("、")}</strong>
          </p>
        )}
        <p className="sq-chip">
          <span className="sq-k">新目标：</span>
          <strong className="sq-v">{q.new_targets.join("、") || "无"}</strong>
        </p>
        <p className="sq-chip">
          <span className="sq-k">未覆盖词形：</span>
          <strong className="sq-v">{q.unknown_forms.join("、") || "无"}</strong>
        </p>
        <p className="sq-policy">新词不会自动加入词库。</p>
      </div>
      <div className="sq-foot">
        <span className="sq-caveat">词形覆盖不保证理解全文。</span>
        <span className={`sq-badge ${checkBadgeTone}`}>{checkBadgeText}</span>
      </div>
    </div>
  );
}

export default function StoryGeneration({onSaved, onStarter, starterAction}) {
  const [pending, setPending] = useState(pendingRequest);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState("");
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const remember = (value) => {
    setPending(value);
    try { value ? accountStorage.setItem(KEY, JSON.stringify(value)) : accountStorage.removeItem(KEY); }
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
  return <div className="story-generation">
    <label className="story-generation-consent">
      <input type="checkbox" checked={pending ? pending.include_new_target : consent} disabled={busy || !!pending} onChange={e => setConsent(e.target.checked)} />
      <span>同意加入最多一个新目标词（不自动加词）</span>
    </label>
    <div className="story-generation-actions">
      {!pending && <button className="btn btn-primary btn-small" onClick={generate}>生成新故事</button>}
      {starterAction}
    </div>
    {busy && <p role="status" className="ec-callout is-info is-compact">生成并确认保存中…</p>}
    {pending && !busy && <div className="story-generation-pending ec-callout is-err">
      <p role="alert">{error || "有一条待确认的故事生成，请继续确认。"}</p>
      <div className="save-state-actions">
        <button className="btn btn-primary btn-small" onClick={generate}>继续确认保存</button>
        <button className="btn btn-ghost btn-small" onClick={() => {remember(null); setError("");}}>放弃待确认生成</button>
      </div>
    </div>}
    {storageNote && <p role="note" className="ec-callout is-warn is-compact">{storageNote}</p>}
  </div>;
}
