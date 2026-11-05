import React, {useEffect, useRef, useState} from 'react';
import {api} from '../lib/api.js';
import {clearPending, loadPending, savePending} from '../lib/learning.js';
import {beginVisibleContactLookup, retryVisibleContactLookup} from '../lib/contacts.js';

const PREFIX = 'ec.feedback.';

export default function SceneFeedback({session, item}) {
  return <ItemFeedback key={`${session.id}:${session.content_hash}:${item.id}:${item.attempt_id}`} session={session} item={item} />;
}

function ItemFeedback({session, item}) {
  const scope = `${session.id}:${item.id}`;
  const pending = useRef(loadPending(scope, PREFIX));
  const [data, setData] = useState(item.feedback || null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [retry, setRetry] = useState(0);
  const [contactError, setContactError] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [contactRetry, setContactRetry] = useState(0);
  const element = useRef(null);
  const confirmed = useRef(new Set());

  useEffect(() => {
    let live = true;
    if (data) {clearPending(scope, PREFIX); return;}
    const body = pending.current?.payload || {operation_id: crypto.randomUUID()};
    const path = `/api/practice-sessions/${session.id}/items/${item.id}/feedback`;
    pending.current = {path, payload: body};
    if (!savePending(scope, pending.current, PREFIX)) setNote('反馈标识暂未保存在浏览器中；已存首答仍可读取。');
    setError('');
    api(path, {method: 'POST', body: JSON.stringify(body)}).then(result => {
      if (!live) return;
      if (result.session_id !== session.id || result.item_id !== item.id || result.attempt_id !== item.attempt_id || result.content_hash !== session.content_hash) {
        throw new Error('反馈所属题目或版本已变化，请重新读取场景。');
      }
      setData(result); clearPending(scope, PREFIX);
    }).catch(e => {if (live) setError('反馈尚未确认：' + e.message);});
    return () => {live = false;};
  }, [scope, retry]);

  useEffect(() => {
    if (!data || !element.current) return;
    let live = true;
    let visible = false;
    let started = false;
    const confirm = async () => {
      if (!live || !visible || document.visibilityState !== 'visible' || started) return;
      started = true;
      const lookupScope = beginVisibleContactLookup(`scene-feedback:${scope}`, {source: 'scene', text: data.text, confirmed: [...confirmed.current]});
      try {
        const result = await retryVisibleContactLookup(lookupScope);
        const {targets} = result;
        targets.filter(card => !result.failed.includes(card) && !result.unrecorded.includes(card)).forEach(card => confirmed.current.add(card.content_revision.identity));
        if (live) {
          setContactError(result.failed.length ? '反馈接触依据尚未确认，可继续确认接触。' : '');
          setContactNote(result.unrecorded.length ? '部分反馈目标已删除或修订，该次接触未记录；请重新查看当前内容。' : '');
        }
      } catch (e) {if (live) setContactError('反馈接触依据尚未确认：' + e.message);}
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio === 1);
      confirm();
    }, {threshold: 1});
    observer.observe(element.current);
    document.addEventListener('visibilitychange', confirm);
    return () => {live = false; observer.disconnect(); document.removeEventListener('visibilitychange', confirm);};
  }, [data, contactRetry]);

  return <div className="quiz-feedback" data-testid="scene-feedback">
    <p role="status">首答角色反馈 · {data ? (data.origin === 'model' ? '模型回应' : '核对模板') : '正在生成，可继续下一轮'}</p>
    {data && <p ref={element}>{data.text}</p>}
    {(data?.correction || (!data && item.correction)) && <p>{data?.correction || item.correction}</p>}
    {note && <p role="note">{note}</p>}
    {contactNote && <p role="note">{contactNote}</p>}
    {error && <p role="alert">{error}<button className="btn btn-ghost btn-small" onClick={() => setRetry(n => n + 1)}>重试反馈</button></p>}
    {contactError && <p role="alert">{contactError}<button className="btn btn-ghost btn-small" onClick={() => setContactRetry(n => n + 1)}>继续确认接触</button></p>}
  </div>;
}
