import React, {useEffect, useId, useRef, useState} from "react";
import {beginExpansionContactLookup, retryVisibleContactLookup} from "../lib/contacts.js";
import {speak} from "../lib/tts.js";
import ExpansionAddition from "./ExpansionAddition.jsx";
import UiIcon from "./UiIcon.jsx";

const appleExamples = [
  {word: "apple juice", meaning: "苹果汁", example: "I'd like a glass of apple juice."},
  {word: "applesauce", meaning: "苹果酱", example: "We ate the pancakes with applesauce."},
  {word: "apply", meaning: "申请；应用", example: "She will apply for a job."},
  {word: "apply", meaning: "申请", example: "She will apply for a job."},
];

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i].toLowerCase() === b[i].toLowerCase()) i += 1;
  return i;
}

function renderLookalikeContrast(sourceWord, sourceMeaning, targetWord, targetMeaning) {
  const prefix = commonPrefixLength(sourceWord, targetWord);
  if (prefix >= 2 && prefix < Math.min(sourceWord.length, targetWord.length)) {
    return (
      <div className="why-contrast">
        <span>
          {sourceWord.slice(0, prefix)}
          <span className="diff-mark">{sourceWord.slice(prefix)}</span>
          {sourceMeaning ? <span className="cn-gloss"> {sourceMeaning}</span> : null}
        </span>
        <span aria-hidden="true">↔</span>
        <span>
          {targetWord.slice(0, prefix)}
          <span className="diff-mark">{targetWord.slice(prefix)}</span>
          <span className="cn-gloss"> {targetMeaning}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="why-contrast">
      <span>{sourceWord}{sourceMeaning ? <span className="cn-gloss"> {sourceMeaning}</span> : null}</span>
      <span aria-hidden="true">↔</span>
      <span><span className="diff-mark">{targetWord}</span><span className="cn-gloss"> {targetMeaning}</span></span>
    </div>
  );
}

function buildWhyComparison(sourceCard, row) {
  const sourceWord = (sourceCard.word || "").trim();
  const sourceMeaning = (sourceCard.meaning || "").trim();
  const targetWord = (row.word || "").trim();
  const targetMeaning = (row.meaning || "").trim();

  if (row.kind === "lookalike") {
    return {
      contrast: renderLookalikeContrast(sourceWord, sourceMeaning, targetWord, targetMeaning),
      desc: `拼写与 ${sourceWord} 相近但词源与词义不同，对比查看避免看混。`,
    };
  }
  if (row.kind === "compound") {
    return {
      contrast: (
        <div className="why-contrast">
          <span>{sourceWord}{sourceMeaning ? <span className="cn-gloss"> {sourceMeaning}</span> : null}</span>
          <span aria-hidden="true">→</span>
          <span><span className="diff-mark">{targetWord}</span><span className="cn-gloss"> {targetMeaning}</span></span>
        </div>
      ),
      desc: `由已学词 ${sourceWord} 组合而成的常见搭配或合成词。`,
    };
  }
  return {
    contrast: (
      <div className="why-contrast">
        <span>{sourceWord}</span>
        <span aria-hidden="true">→</span>
        <span><span className="diff-mark">{targetWord}</span><span className="cn-gloss"> {targetMeaning}</span></span>
      </div>
    ),
    desc: `与 ${sourceWord} 相关的${row.label || "扩展"}词条，按需要加入单词本。`,
  };
}

export default function ExpansionPreview({sourceCard, row, source, closeLabel, onClose, onOpenCard, studySessionId}) {
  const labelId = useId();
  const dialog = useRef(null);
  const active = useRef(false);
  const dragState = useRef({dragging: false, pointerId: null, startY: 0, startTime: 0, dy: 0});
  const [contactError, setContactError] = useState("");
  const [audio, setAudio] = useState("idle");
  const example = sourceCard.word.trim().toLowerCase() === "apple" && sourceCard.meaning?.trim() === "苹果"
    ? appleExamples.find(entry => entry.word === row.word && entry.meaning === row.meaning)?.example
    : null;
  const why = buildWhyComparison(sourceCard, row);

  const confirmContact = kind => {
    const scope = beginExpansionContactLookup({card: sourceCard, row, source, kind});
    retryVisibleContactLookup(scope).then(({unrecorded}) => {
      if (active.current && unrecorded.length) {
        setContactError("接触依据不完整：目标词已删除或修改，请重新查看。");
      }
    }).catch(error => {
      if (active.current) setContactError(`接触依据不完整：${error.message}`);
    });
  };

  useEffect(() => {
    const panel = dialog.current;
    active.current = true;
    panel.showModal();
    confirmContact("answer_visible");
    return () => {
      active.current = false;
      panel.close();
    };
  }, []);

  const listen = async () => {
    setAudio("loading");
    const mode = await speak(row.word, null, () => {
      confirmContact("answer_audio");
    });
    if (active.current) setAudio(mode === "none" ? "failed" : "idle");
  };

  const close = () => {
    dialog.current.close();
    onClose();
  };

  const handlePointerDown = (event) => {
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    if (event.target.closest("button")) return;
    const panel = dialog.current;
    if (!panel) return;
    dragState.current = {
      dragging: true,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: performance.now(),
      dy: 0,
    };
    panel.classList.add("is-dragging");
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  };

  const handlePointerMove = (event) => {
    const drag = dragState.current;
    const panel = dialog.current;
    if (!drag.dragging || event.pointerId !== drag.pointerId || !panel) return;
    const rawDy = event.clientY - drag.startY;
    drag.dy = rawDy < 0 ? (rawDy * 260 * 0.5) / (260 + 0.5 * Math.abs(rawDy)) : rawDy;
    panel.style.transform = `translateY(${drag.dy}px)`;
  };

  const handlePointerEnd = (event) => {
    const drag = dragState.current;
    const panel = dialog.current;
    if (!drag.dragging || event.pointerId !== drag.pointerId || !panel) return;
    drag.dragging = false;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    panel.classList.remove("is-dragging");
    panel.style.transform = "";
    const elapsed = Math.max(1, performance.now() - drag.startTime);
    if (drag.dy > 100 || drag.dy / elapsed > 0.11) {
      close();
    }
  };

  return <dialog ref={dialog} className="expansion-preview" aria-labelledby={labelId}
    onCancel={event => {event.preventDefault(); close();}}>
    <div
      className="expansion-sheet-drag-zone"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className="expansion-sheet-handle" aria-hidden="true" />
      <div className="expansion-preview-head">
        <span className="expansion-origin-pill">{row.label} · 来自 {sourceCard.word}</span>
        <button type="button" className="btn btn-ghost btn-small expansion-close-btn" onClick={close}>{closeLabel}</button>
      </div>
    </div>
    <div className="expansion-preview-body">
      <div className="expansion-why-box">
        {why.contrast}
        <div className="why-desc">{why.desc}</div>
      </div>

      <div className="expansion-preview-hero">
        <h2 id={labelId}>{row.word}</h2>
        <button type="button" className="btn btn-ghost btn-small expansion-speak-pill" onClick={listen} disabled={audio === "loading"}>
          {audio === "loading" ? (
            <span className="eq-bars" aria-hidden="true"><i /><i /><i /></span>
          ) : (
            <UiIcon name="speaker" size={16} />
          )}
          <span>{audio === "loading" ? "载入朗读…" : "试听"}</span>
        </button>
      </div>

      <p className="expansion-preview-meaning">{row.label} · {row.meaning}</p>

      {example && (
        <div className="expansion-preview-example">
          <p lang="en">{example}</p>
        </div>
      )}

      {sourceCard.content_revision && <ExpansionAddition card={sourceCard} row={row}
        studySessionId={studySessionId} openCard={onOpenCard && (id => {
          close();
          onOpenCard(id);
        })} />}

      {contactError && <p role="alert" className="inline-notice is-err is-shaking">{contactError}</p>}
      {audio === "failed" && <p role="status" className="inline-notice is-warn">朗读暂不可用，可继续查看</p>}
    </div>
  </dialog>;
}
