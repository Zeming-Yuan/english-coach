import React, {useCallback, useEffect, useRef, useState} from 'react';
import {api} from '../lib/api.js';
import {recordContact} from '../lib/contacts.js';
import {speak} from '../lib/tts.js';

function VocabularyWord({entry, onStale}) {
  const [revealed, setRevealed] = useState(false);
  const [failedContacts, setFailedContacts] = useState([]);
  const [speech, setSpeech] = useState('');
  const audio = useRef(null);
  const meaning = useRef(null);
  const active = useRef(false);
  const confirming = useRef(new Set());

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      audio.current?.abort();
    };
  }, []);

  const confirmContact = useCallback(async kind => {
    if (!active.current || !entry.card_id || confirming.current.has(kind)) return;
    confirming.current.add(kind);
    try {
      await recordContact({
        cardId: entry.card_id,
        revision: entry.content_revision,
        source: 'scene',
        kind,
      });
      if (active.current) setFailedContacts(failed => failed.filter(value => value !== kind));
    } catch (e) {
      if (!active.current) return;
      if (e.retryable === false) onStale();
      else setFailedContacts(failed => failed.includes(kind) ? failed : [...failed, kind]);
    } finally {
      confirming.current.delete(kind);
    }
  }, [entry, onStale]);

  useEffect(() => {
    if (!revealed || !entry.card_id) return;
    let inViewport = false;
    let displayed = false;
    const confirmVisible = () => {
      if (displayed || !inViewport || document.visibilityState !== 'visible') return;
      displayed = true;
      confirmContact('answer_visible');
    };
    const observer = new IntersectionObserver(entries => {
      inViewport = entries.some(item => item.isIntersecting && item.intersectionRatio === 1);
      confirmVisible();
    }, {threshold: 1});
    observer.observe(meaning.current);
    document.addEventListener('visibilitychange', confirmVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', confirmVisible);
    };
  }, [revealed, entry.card_id, confirmContact]);

  const playWord = async () => {
    audio.current?.abort();
    const controller = new AbortController();
    audio.current = controller;
    setSpeech('');
    const mode = await speak(entry.word, null, () => {
      if (!controller.signal.aborted) confirmContact('answer_audio');
    }, controller.signal);
    if (controller.signal.aborted || mode === 'canceled') return;
    setSpeech(mode === 'none' ? '语音暂不可用，可以继续学习。' : '已播放词汇');
  };

  return <article className="lesson-progress">
    <h3 lang="en">{entry.word}</h3>
    <p>{entry.card_id ? '已在词库' : '未入词库'}</p>
    {revealed ? <>
      <p ref={meaning}>{entry.meaning}</p>
      {entry.example && <p lang="en">{entry.example}</p>}
    </> : <button className="btn btn-primary" onClick={() => setRevealed(true)}>查看释义</button>}
    <button className="btn btn-ghost btn-small" onClick={playWord}>朗读词汇</button>
    {speech && <p role="status">{speech}</p>}
    {failedContacts.length > 0 && <div role="alert">
      <p>接触依据尚未确认。</p>
      <button className="btn btn-ghost" onClick={() => failedContacts.forEach(confirmContact)}>继续确认接触</button>
    </div>}
  </article>;
}

export default function SceneVocabulary({sceneId, title, onExit}) {
  const backButton = useRef(null);
  const [words, setWords] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {backButton.current?.focus();}, []);
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/scenes/${sceneId}/vocabulary`, {signal: controller.signal}).then(result => {
      if (controller.signal.aborted) return;
      if (result.scene_id !== sceneId) throw new Error('场景已变化，请重新读取用词。');
      setWords(result.words);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [sceneId, loadAttempt]);

  const reload = () => {
    setError('');
    setWords(null);
    setIndex(0);
    setLoadAttempt(value => value + 1);
  };

  const onStale = useCallback(() => {
    setWords(null);
    setError('词卡已删除或修订，请重新读取本场景用词。');
  }, []);

  const entry = words?.[index];
  return <section className="view scene-page scene-catalog" data-testid="scene-vocabulary">
    <button ref={backButton} className="btn btn-ghost btn-small scene-back" onClick={onExit}>返回{title}</button>
    <h2 className="page-title scene-title">{title} · 词汇准备</h2>
    {error ? <div role="alert">
      <p>{error}</p>
      <button className="btn btn-ghost" onClick={reload}>重新读取用词</button>
    </div> : words === null ? <p role="status">正在读取场景用词…</p>
      : !entry ? <p>这个场景暂时没有准备词汇。</p>
        : <>
          <p className="scene-meta" role="status">第 {index + 1}/{words.length} 词</p>
          <VocabularyWord key={entry.word} entry={entry} onStale={onStale} />
          <div className="save-state-actions">
            <button className="btn btn-ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一词</button>
            <button className="btn btn-ghost" disabled={index + 1 === words.length} onClick={() => setIndex(index + 1)}>下一词</button>
          </div>
        </>}
  </section>;
}
