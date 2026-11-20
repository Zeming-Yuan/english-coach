import React, {useEffect, useId, useRef, useState} from "react";
import {beginExpansionContactLookup, retryVisibleContactLookup} from "../lib/contacts.js";
import {speak} from "../lib/tts.js";

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
  const [contactError, setContactError] = useState("");
  const [audio, setAudio] = useState("idle");
  const example = sourceCard.word.trim().toLowerCase() === "apple" && sourceCard.meaning?.trim() === "苹果"
    ? appleExamples.find(entry => entry.word === row.word && entry.meaning === row.meaning)?.example
    : null;

  const confirmContact = kind => {
    const scope = beginExpansionContactLookup({card: sourceCard, row, source, kind});
    retryVisibleContactLookup(scope).catch(error => {
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
    {contactError && <p role="alert">{contactError}</p>}
    {audio === "failed" && <p role="status">朗读暂不可用，可继续查看</p>}
  </dialog>;
}
