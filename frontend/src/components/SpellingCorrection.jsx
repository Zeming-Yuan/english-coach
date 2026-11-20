import React, {useLayoutEffect, useRef, useState} from "react";
import {recordPracticeContact} from "../lib/practiceContacts.js";
import {spellingDifference} from "../lib/spellingFeedback.js";
import {speak} from "../lib/tts.js";

export default function SpellingCorrection({typed, expected, cardId, revision, source, showExpected = true}) {
  const playback = useRef(null);
  const [audioFailed, setAudioFailed] = useState(false);
  useLayoutEffect(() => () => playback.current?.abort(), [cardId, revision, expected, source]);

  const listen = async (event) => {
    playback.current?.abort();
    const controller = new AbortController();
    playback.current = controller;
    setAudioFailed(false);
    const mode = await speak(expected, event.currentTarget, () => {
      if (!controller.signal.aborted) {
        recordPracticeContact({cardId, revision, source, kind: "answer_audio"});
      }
    }, controller.signal);
    if (!controller.signal.aborted && mode === "none") setAudioFailed(true);
  };

  const difference = spellingDifference(typed, expected);
  return <div style={{overflowWrap: "anywhere"}}>
    <div>你的拼写：<b>{typed}</b></div>
    {showExpected && <div>正确拼写：<b>{expected}</b></div>}
    {difference && <div>{difference}</div>}
    <button className="btn btn-ghost btn-small" type="button" onClick={listen}>听正确发音</button>
    {audioFailed && <span role="status">朗读暂不可用</span>}
  </div>;
}
