import React, {useEffect, useRef, useState} from 'react';
import {api} from '../lib/api.js';
import {loadPending, savePending, clearPending} from '../lib/learning.js';
import {recordContact, recordVisibleCards} from '../lib/contacts.js';
import {speak} from '../lib/tts.js';
import {useLearningAttempt} from '../hooks/useLearningAttempt.js';

const CREATION_SCOPE = 'scene:drinks';
const CONTEXT_PREFIX = 'ec.context.';
const verdictLabel = item => item.skipped ? '显式跳过' : ({accepted: '规则认可', rejected: '规则明确不满足', unknown: '未判定（未收录或有歧义）'}[item.verdict] || '待作答');

function Preparation({preparation}) {
  if (!preparation) return null;
  return <div className="lesson-progress" aria-label="词汇准备状态">
    <p>{preparation.message}</p>
    {preparation.targets.map(target => <p key={target.revision.identity}>
      {target.meaning}：{target.ready ? '独立回忆已有证据' : '暂无独立回忆依据'}
    </p>)}
    {!!preparation.missing_words.length && <p>还有 {preparation.missing_words.length} 项任务词汇尚未进入词库；可先去单词本学习，也可继续挑战。</p>}
  </div>;
}

function Standard({text}) {
  const [error, setError] = useState('');
  const [speech, setSpeech] = useState('');
  const [retry, setRetry] = useState(0);
  const pendingAudio = useRef([]);
  const matchingCards = cards => {
    const words = new Set(text.toLowerCase().match(/[a-z]+/g) || []);
    return cards.filter(card => card.kind === 'word' && words.has(card.word.toLowerCase()));
  };
  const confirmAudio = async targets => {
    const results = await Promise.allSettled(targets.map(card => recordContact({cardId: card.id, revision: card.content_revision, source: 'scene', kind: 'answer_audio'})));
    pendingAudio.current = targets.filter((_, index) => results[index].status === 'rejected');
    return pendingAudio.current.length;
  };
  useEffect(() => {
    let live = true;
    api('/api/cards').then(async ({cards}) => {
      const targets = matchingCards(cards);
      const result = await recordVisibleCards(targets, 'scene');
      const failedAudio = await confirmAudio(pendingAudio.current);
      if (live) setError(result.failed.length || failedAudio ? '接触依据尚未确认，可继续确认接触' : '');
    }).catch(e => {if (live) setError('接触依据尚未确认：' + e.message);});
    return () => {live = false;};
  }, [text, retry]);
  return <div className="quiz-feedback">
    <p>标准表达（本轮按辅助记录）：{text}</p>
    <button className="btn btn-ghost btn-small" onClick={async () => {
      try {
        const {cards} = await api('/api/cards');
        const targets = matchingCards(cards);
        const mode = await speak(text, null, () => {
          pendingAudio.current = targets;
          confirmAudio(targets).then(failed => {if (failed) setError('音频接触依据尚未确认，可继续确认接触');});
        });
        setSpeech(mode === 'none' ? '语音暂不可用，文字与已存结果仍可使用。' : '已播放标准表达');
      } catch (e) {setError('朗读前的目标依据无法读取：' + e.message);}
    }}>朗读标准表达</button>
    {speech && <p role="status">{speech}</p>}
    {error && <p role="alert">{error}<button className="btn btn-ghost btn-small" onClick={() => setRetry(n => n + 1)}>继续确认接触</button></p>}
  </div>;
}

function SceneRun({initial, onRestart, onExit}) {
  const scope = `scene:${initial.id}`;
  const restored = useRef(loadPending(scope));
  const [run, setRun] = useState(initial);
  const [index, setIndex] = useState(() => {
    const pendingItem = initial.items.findIndex(i => restored.current?.path.includes(i.id));
    if (pendingItem >= 0) return pendingItem;
    const next = initial.items.findIndex(i => !i.processed);
    return next < 0 ? 3 : next;
  });
  const [answer, setAnswer] = useState(restored.current?.payload.answer || '');
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');
  const [helpBusy, setHelpBusy] = useState(false);
  const attempt = useLearningAttempt(scope);
  const item = run.items[index];
  const blocked = attempt.phase === 'saving' || attempt.phase === 'failed' || helpBusy;
  const apply = result => {
    if (result.committed !== true) return;
    setRun(result.session);
    setFeedback(result);
    attempt.clear();
    restored.current = null;
    setError('');
  };
  const submit = async skipped => {
    if (blocked) return;
    if (!skipped && !answer.trim()) {setError('请继续输入答案，或显式跳过。'); return;}
    try {
      apply(await attempt.submit(`/api/practice-sessions/${run.id}/items/${item.id}/attempts`, {answer: skipped ? null : answer, skipped}));
    } catch {}
  };
  const help = async kind => {
    if (blocked) return;
    setHelpBusy(true); setError('');
    try {
      setRun(await api(`/api/practice-sessions/${run.id}/items/${item.id}/assistance`, {method: 'POST', body: JSON.stringify({kind})}));
    } catch (e) {setError('帮助尚未确认保存：' + e.message);}
    finally {setHelpBusy(false);}
  };
  return <section className="view" data-testid="scene-session">
    <button className="btn btn-ghost btn-small" onClick={onExit}>返回场景列表</button>
    <h2 className="page-title">{run.title} · 三轮文字任务</h2>
    <p>已处理 {run.counts.processed}/3 · 规则 {run.rule_version} · 内容修订 {run.content_revision}</p>
    {run.message && <p role="alert">{run.message}</p>}
    {error && <p role="alert">{error}</p>}
    {index === 3 ? <>
      <div className="lesson-progress" role="status">
        <h3>本次流程完成</h3>
        <p>{run.status === 'independent' ? '本场景独立通过' : '本场景尚未独立通过'}</p>
        <p>三轮首答全部规则认可且无帮助，才算独立通过；即时再练不替换首答。</p>
        <p>{run.application_verified ? '指定语境应用已有证据（仅对应列明的目标修订）' : '迁移能力尚未验证；缺少目标映射或照抄教学例句不证明新情境。'}</p>
        {run.items.map(i => <p key={i.id}>{i.position}. {i.prompt}：{verdictLabel(i)}{i.assistance.length ? ' · 辅助' : ''} · {i.answer || '未作答'}</p>)}
      </div>
      <button className="btn btn-primary" onClick={onRestart}>新开一轮</button>
    </> : <>
      <p>第 {index + 1}/3 轮 · 目标：{item.prompt}</p>
      <p className="lesson-progress">店员：{item.role}</p>
      {!!item.assistance.length && <p role="status">本轮已使用帮助，持续按辅助记录。</p>}
      {item.hint && <p role="status">提示：{item.hint}</p>}
      {item.standard && <Standard text={item.standard} />}
      {feedback ? <div className="quiz-feedback" role="status">
        <p>已保存 · {verdictLabel(feedback)}{feedback.first_response === false ? ' · 再练结果，首答不变' : ''}</p>
        <p>你的答案：{answer || '显式跳过'}</p>
        {run.items[index].correction && <p>{run.items[index].correction}</p>}
        <div className="save-state-actions">
          <button className="btn btn-primary" onClick={() => {setIndex(index + 1); setAnswer(''); setFeedback(null);}}>{index === 2 ? '查看结果' : '下一轮'}</button>
          {run.can_continue && <button className="btn btn-ghost" onClick={() => setFeedback(null)}>再练本轮</button>}
        </div>
      </div> : <>
        <label>你的答案<input className="spelling-input" aria-label="你的答案" value={answer} maxLength={2000} disabled={blocked || !run.can_continue} onChange={e => setAnswer(e.target.value)} /></label>
        <div className="save-state-actions">
          <button className="btn btn-primary" disabled={blocked || !run.can_continue} onClick={() => submit(false)}>提交答案</button>
          <button className="btn btn-ghost" disabled={blocked || !run.can_continue} onClick={() => submit(true)}>跳过本轮</button>
          <button className="btn btn-ghost" disabled={blocked || !run.can_continue} onClick={() => help('hint')}>任务提示</button>
          <button className="btn btn-ghost" disabled={blocked || !run.can_continue} onClick={() => help('answer_visible')}>查看标准表达</button>
        </div>
      </>}
      {attempt.phase === 'saving' && <p role="status">正在确认保存…</p>}
      {helpBusy && <p role="status">正在确认帮助…</p>}
      {attempt.phase === 'failed' && <div role="alert">
        <p>{attempt.error}</p>
        <button className="btn btn-primary" onClick={async () => {try {apply(await attempt.retry());} catch {}}}>继续确认保存</button>
        <button className="btn btn-ghost" onClick={async () => {
          attempt.clear(); restored.current = null;
          try {const saved = await api(`/api/practice-sessions/${run.id}`); setRun(saved); const next = saved.items.findIndex(i => !i.processed); setIndex(next < 0 ? 3 : next); setAnswer(''); setFeedback(null);} catch (e) {setError(e.message);}
        }}>放弃这条待确认</button>
      </div>}
    </>}
    {!run.can_continue && <button className="btn btn-primary" disabled={blocked} onClick={onRestart}>新开一轮</button>}
  </section>;
}

export default function ScenePage({onExit}) {
  const pending = useRef(loadPending(CREATION_SCOPE, CONTEXT_PREFIX)?.payload || null);
  const [catalog, setCatalog] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    api('/api/scenes').then(data => {if (live.current) setCatalog(data);}).catch(e => {if (live.current) setError(e.message);});
    return () => {live.current = false;};
  }, []);
  const start = async (fresh = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const existing = catalog?.scenes[0].session_id;
      let saved;
      if (existing && !fresh && !pending.current) saved = await api(`/api/practice-sessions/${existing}`);
      else {
        const body = pending.current || {id: crypto.randomUUID(), purpose: 'scene', scene_id: 'drinks'};
        pending.current = body;
        if (!savePending(CREATION_SCOPE, {path: '/api/practice-sessions', payload: body}, CONTEXT_PREFIX)) setNote('浏览器未保存轮次标识；刷新后请核对已存场景。');
        saved = await api('/api/practice-sessions', {method: 'POST', body: JSON.stringify(body)});
        clearPending(CREATION_SCOPE, CONTEXT_PREFIX); pending.current = null;
      }
      if (live.current) {setRun(saved); setCatalog(data => ({...data, scenes: data.scenes.map(s => ({...s, session_id: saved.id}))}));}
    } catch (e) {if (live.current) setError('场景尚未确认保存：' + e.message);}
    finally {if (live.current) setBusy(false);}
  };
  if (run) return <SceneRun key={run.id} initial={run} onRestart={() => start(true)} onExit={() => setRun(null)} />;
  return <section className="view">
    <button className="btn btn-ghost btn-small" onClick={onExit}>返回队列</button>
    <h2 className="page-title">场景练习</h2>
    {error && <p role="alert">{error}</p>}
    {note && <p role="note">{note}</p>}
    {busy && <p role="status">正在确认保存…</p>}
    {catalog?.scenes.map(scene => <article key={scene.id} className="lesson-progress">
      <h3>{scene.title} · 约三轮 · 文字输入</h3>
      {scene.task_goal.map(goal => <p key={goal}>{goal}</p>)}
      <Preparation preparation={scene.preparation} />
      {(catalog.enabled || scene.session_id) && <button className="btn btn-primary" disabled={busy || !!pending.current} onClick={() => start()}>买饮品</button>}
    </article>)}
    {pending.current && <div className="save-state-actions">
      <button className="btn btn-primary" disabled={busy} onClick={() => start()}>继续确认保存</button>
      <button className="btn btn-ghost" disabled={busy} onClick={async () => {clearPending(CREATION_SCOPE, CONTEXT_PREFIX); pending.current = null; setError(''); setCatalog(await api('/api/scenes'));}}>放弃待确认创建</button>
    </div>}
  </section>;
}
