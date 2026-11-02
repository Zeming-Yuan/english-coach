import React, {useRef, useState} from 'react';
import {api} from '../lib/api.js';
import {loadPending, savePending, clearPending} from '../lib/learning.js';
import PracticePage from '../views/PracticePage.jsx';

// Keep the original text outside the practice tree. Showing it requires a saved help marker.
export default function StoryCheck({story, onCreated, children}) {
  const scope = `story-check:${story.version_id}`;
  const prefix = 'ec.context.';
  const pending = useRef(loadPending(scope, prefix)?.payload || null);
  const [sessionId, setSessionId] = useState(story.check_session_id || null);
  const [checking, setChecking] = useState(Boolean(story.check_session_id) && !pending.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const start = async (fresh = false) => {
    if (busy) return;
    if (sessionId && !fresh && !pending.current) {setChecking(true); return;}
    const body = pending.current || {id: crypto.randomUUID(), purpose: 'story_check', story_id: story.id, version_id: story.version_id};
    pending.current = body;
    if (!savePending(scope, {path: '/api/practice-sessions', payload: body}, prefix)) setNote('浏览器未保存轮次标识；刷新后请重新核对已保存的检查。');
    setBusy(true); setError('');
    try {
      const run = await api('/api/practice-sessions', {method: 'POST', body: JSON.stringify(body)});
      clearPending(scope, prefix); pending.current = null;
      setSessionId(run.id); setChecking(true);
      onCreated?.(run.id);
    } catch (e) {setError('检查尚未确认保存：' + e.message);}
    finally {setBusy(false);}
  };
  const review = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const run = await api(`/api/practice-sessions/${sessionId}`);
      for (const item of run.items.filter(i => ['pending', 'stale'].includes(i.status))) {
        // Stale/deleted contexts permit returning to the text but cannot accept new answers.
        if (!item.stale) await api(`/api/practice-sessions/${sessionId}/items/${item.id}/assistance`, {method: 'POST', body: JSON.stringify({kind: 'answer_visible'})});
      }
      setChecking(false);
    } catch (e) {setError('回看帮助尚未确认保存：' + e.message);}
    finally {setBusy(false);}
  };
  return <>
    {error && <p role="alert">{error}</p>}
    {note && <p role="note">{note}</p>}
    {busy && <p role="status">正在确认保存…</p>}
    {pending.current && !busy && <div className="save-state-actions">
      <button className="btn btn-primary" onClick={() => start()}>继续确认保存</button>
      <button className="btn btn-ghost" onClick={() => {
        clearPending(scope, prefix); pending.current = null; setError('');
        setNote('已放弃待确认创建；已保存的数据不会删除。');
      }}>放弃待确认创建</button>
    </div>}
    {checking ? <PracticePage key={sessionId} sessionId={sessionId} storyCheck onExit={review} onRestart={() => start(true)} /> : <>
      {children}
      {story.checks_enabled !== false && !pending.current && <button className="btn btn-primary" disabled={busy} onClick={() => start()}>
        {sessionId ? '返回检查' : '读后检查'}
      </button>}
    </>}
  </>;
}
