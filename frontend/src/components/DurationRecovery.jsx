import React, {useEffect, useState} from "react";
import {pendingDurations, saveDuration, discardDuration} from "../lib/durations.js";

export default function DurationRecovery() {
  const [rows, setRows] = useState(pendingDurations);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setRows(pendingDurations());
    window.addEventListener("durations-changed", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("durations-changed", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  if (!rows.length) return null;
  return <aside role="alert" data-testid="duration-recovery">
    <p>答案保存流程不受影响；{rows.length} 条主动时长尚未确认；仅服务端已保存时长用于估算。可继续确认或放弃时长；浏览器存储不可用时刷新可能丢失。</p>
    <button disabled={busy} onClick={async () => {
      setBusy(true);
      try { for (const row of rows) await saveDuration(row); }
      finally { setBusy(false); }
    }}>继续确认时长</button>
    <button disabled={busy} onClick={() => rows.forEach(row => discardDuration(row.sample_id))}>放弃时长记录</button>
  </aside>;
}
