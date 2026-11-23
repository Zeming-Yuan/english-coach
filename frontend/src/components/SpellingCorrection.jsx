import React, {useLayoutEffect, useRef, useState} from "react";
import {recordPracticeContact} from "../lib/practiceContacts.js";
import {spellingDifference, spellingDiffParts} from "../lib/spellingFeedback.js";
import {speak} from "../lib/tts.js";
import UiIcon from "./UiIcon.jsx";

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

  const parts = spellingDiffParts(typed, expected);
  const difference = spellingDifference(typed, expected);
  const missingOnly = !parts.equal && !parts.typed.changed && Boolean(parts.expected.changed);

  return (
    <div className="spelling-correction">
      <div className={`sc-compare ${showExpected ? "" : "sc-compare--single"}`}>
        <div className="sc-row sc-row-typed">
          你的拼写：
          <b className="sc-word sc-word-typed">
            {parts.equal ? (
              typed
            ) : (
              <>
                {parts.typed.prefix}
                {parts.typed.changed ? (
                  <mark className="sc-hl-typed">{parts.typed.changed}</mark>
                ) : missingOnly ? (
                  <span className="sc-missing-slot" aria-hidden="true" />
                ) : null}
                {parts.typed.suffix}
              </>
            )}
          </b>
        </div>
        {showExpected && (
          <div className="sc-row sc-row-expected">
            正确拼写：
            <b className="sc-word sc-word-expected">
              {parts.equal ? (
                expected
              ) : (
                <>
                  {parts.expected.prefix}
                  {parts.expected.changed && (
                    <mark className="sc-hl-expected">{parts.expected.changed}</mark>
                  )}
                  {parts.expected.suffix}
                </>
              )}
            </b>
          </div>
        )}
      </div>
      <div className="sc-footer">
        {difference && (
          <div className="sc-diff">
            <span className="sc-diff-dot" aria-hidden="true" />
            <span className="sc-diff-text">{difference}</span>
          </div>
        )}
        <div className="sc-audio-wrap">
          <button className="btn btn-ghost btn-small sc-audio-btn" type="button" onClick={listen}>
            <UiIcon name="speaker" size={15} />
            <span>听正确发音</span>
          </button>
          {audioFailed && <span role="status" className="sc-audio-status">朗读暂不可用</span>}
        </div>
      </div>
    </div>
  );
}
