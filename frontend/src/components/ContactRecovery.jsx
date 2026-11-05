import React, {useEffect, useState} from 'react';
import {CONTACT_LOOKUPS_CHANGED, pendingVisibleContactLookups, retryVisibleContactLookup} from '../lib/contacts.js';

export default function ContactRecovery() {
  const [lookups, setLookups] = useState(pendingVisibleContactLookups);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    const refresh = () => setLookups(pendingVisibleContactLookups());
    window.addEventListener(CONTACT_LOOKUPS_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    refresh();
    return () => {
      window.removeEventListener(CONTACT_LOOKUPS_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const retry = async (scope) => {
    if (busy) return;
    setBusy(scope); setError(''); setNote('');
    try {
      const result = await retryVisibleContactLookup(scope);
      setNote(result.failed.length ? '已找到反馈目标词；接触仍有待确认记录，依据尚不完整。' : '反馈接触已确认。');
    } catch (cause) {setError('反馈接触尚未确认：' + cause.message);}
    finally {setBusy(''); setLookups(pendingVisibleContactLookups());}
  };
  if (!lookups.length && !note) return null;
  return <aside aria-label="反馈接触恢复" className="save-state">
    {lookups.length > 0 && <p>有反馈展示的接触依据尚未确认。</p>}
    {lookups.map(lookup => <div key={lookup.scope}>
      {lookup.source === 'scene' && typeof lookup.text === 'string' ?
        <button className="btn btn-ghost btn-small" disabled={Boolean(busy)} onClick={() => retry(lookup.scope)}>继续确认反馈接触</button> :
        <p>旧接触记录缺少反馈内容，接触依据仍不完整，请回到原反馈继续确认。</p>}
    </div>)}
    {busy && <p role="status">正在确认反馈接触…</p>}
    {error && <p role="alert">{error}</p>}
    {note && <p role="status">{note}</p>}
  </aside>;
}
