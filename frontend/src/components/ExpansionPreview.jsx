import React, {useEffect, useId, useRef, useState} from "react";
import {api} from "../lib/api.js";
import {speak} from "../lib/tts.js";
import {recordPracticeContact} from "../lib/practiceContacts.js";

const appleExamples = [
  {word: "apple juice", meaning: "苹果汁", example: "I'd like a glass of apple juice."},
  {word: "applesauce", meaning: "苹果酱", example: "We ate the pancakes with applesauce."},
  {word: "apply", meaning: "申请；应用", example: "She will apply for a job."},
  {word: "apply", meaning: "申请", example: "She will apply for a job."},
];

export default function ExpansionPreview({sourceCard, row, source, closeLabel, onClose}) {
  const labelId = useId();
  const dialog = useRef(null);
  const active = useRef(false);
  const target = useRef(null);
  const [audio, setAudio] = useState("idle");
  const example = sourceCard.word.trim().toLowerCase() === "apple" && sourceCard.meaning?.trim() === "苹果"
    ? appleExamples.find(entry => entry.word === row.word && entry.meaning === row.meaning)?.example
    : null;

  useEffect(() => {
    const panel = dialog.current;
    panel.showModal();
    return () => panel.close();
  }, []);

  useEffect(() => {
    let current = true;
    active.current = true;
    api("/api/cards").then(({cards}) => {
      if (!current || !dialog.current?.open) return;
      const card = cards.find(card => card.kind === "word" &&
        card.word.trim().toLowerCase() === row.word.trim().toLowerCase() &&
        card.meaning?.trim() === row.meaning.trim());
      if (!card) return;
      target.current = card;
      recordPracticeContact({cardId: card.id, revision: card.content_revision, source, kind: "answer_visible"});
    }).catch(() => {});
    return () => {
      current = false;
      active.current = false;
    };
  }, [row, source]);

  const listen = async () => {
    setAudio("loading");
    const card = target.current;
    const mode = await speak(row.word, null, () => {
      if (active.current && card) {
        recordPracticeContact({cardId: card.id, revision: card.content_revision, source, kind: "answer_audio"});
      }
    });
    if (active.current) setAudio(mode === "none" ? "failed" : "idle");
  };

  const close = () => {
    dialog.current.close();
    onClose();
  };

  return <dialog ref={dialog} className="expansion-preview" aria-labelledby={labelId}
    onCancel={event => {event.preventDefault(); close();}}>
    <h2 id={labelId}>{row.word}</h2>
    <p>{row.label} · {row.meaning}</p>
    {example && <p lang="en">{example}</p>}
    <div className="expansion-actions">
      <button type="button" className="btn btn-ghost btn-small" onClick={listen} disabled={audio === "loading"}>
        {audio === "loading" ? "载入朗读…" : "试听"}
      </button>
      <button type="button" className="btn btn-ghost btn-small" onClick={close}>{closeLabel}</button>
    </div>
    {audio === "failed" && <p role="status">朗读暂不可用，可继续查看</p>}
  </dialog>;
}
