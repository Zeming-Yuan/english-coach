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
      setNote(result.failed.length ? '已找到接触目标词；接触仍有待确认记录，依据尚不完整。' : result.unrecorded.length ? '部分接触目标已删除或修订，该次接触未记录；请重新查看当前内容。' : '接触核对已完成。');
    } catch (cause) {setError('接触尚未确认：' + cause.message);}
    finally {setBusy(''); setLookups(pendingVisibleContactLookups());}
  };
  if (!lookups.length && !note) return null;
  return <aside aria-label="接触恢复" className="save-state ec-banner is-warn">
    {lookups.length > 0 && <p>有应用内接触的依据尚未确认。</p>}
    <div className="ec-banner-list">
      {lookups.map(lookup => <div key={lookup.scope}>
        {lookup.expansion ?
          <button className="btn btn-ghost btn-small" disabled={Boolean(busy)} onClick={() => retry(lookup.scope)}>继续确认扩展词接触</button> :
          lookup.source === 'scene' && typeof lookup.text === 'string' ?
          <button className="btn btn-ghost btn-small" disabled={Boolean(busy)} onClick={() => retry(lookup.scope)}>继续确认反馈接触</button> :
          <p className="ec-banner-subnote">旧接触记录缺少反馈内容，接触依据仍不完整，请回到原反馈继续确认。</p>}
      </div>)}
    </div>
    {busy && <p role="status" className="ec-callout is-info is-compact">正在确认接触…</p>}
    {error && <p role="alert" className="ec-callout is-err is-compact">{error}</p>}
    {note && <p role="status" className="ec-callout is-info is-compact">{note}</p>}
  </aside>;
}
