import React, {useEffect, useRef, useState} from "react";
import UiIcon from "./UiIcon.jsx";
import {speak} from "../lib/tts.js";

export default function DemoLesson({lesson, onExit}) {
  const [answer, setAnswer] = useState(null);
  const [audioFailed, setAudioFailed] = useState(false);
  const heading = useRef(null);
  const audio = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    audio.current = controller;
    heading.current.focus();
    return () => controller.abort();
  }, []);

  const readAloud = async (text, button) => {
    setAudioFailed(false);
    const result = await speak(text, button, null, audio.current.signal);
    if (result === "none") setAudioFailed(true);
  };
  const listenButton = (text) => (
    <button type="button" className="speak-mini" aria-label={`朗读 ${text}`}
      onClick={event => readAloud(text, event.currentTarget)}>
      <UiIcon name="speaker" />
    </button>
  );

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>返回课程</button>
      </div>
      <p className="eyebrow">示范课 · 免 AI 配置</p>
      <h2 ref={heading} tabIndex={-1} className="page-title">{lesson.title}</h2>
      <h3 className="lesson-section">本课单词</h3>
      <div className="word-list">
        {lesson.words.map(word => (
          <div key={word.word} className="word-item lesson-word">
            <div className="word-main">
              <div className="word-item-word" lang="en">{word.word}</div>
              <div className="word-item-phonetic">{word.phonetic}</div>
              <div className="word-item-meaning">{word.meaning}</div>
            </div>
            {listenButton(word.word)}
          </div>
        ))}
      </div>
      <h3 className="lesson-section">对话</h3>
      <div className="bubble-list">
        {lesson.dialogue.map((line, index) => (
          <div key={index} className={`bubble ${index % 2 === 0 ? "bubble-a" : "bubble-b"}`}>
            <span className="spk">{line.speaker}</span>
            <div className="bubble-en" lang="en">{line.en} {listenButton(line.en)}</div>
            <div className="bubble-cn">{line.cn}</div>
          </div>
        ))}
      </div>
      {audioFailed && <p role="status">暂时无法朗读，仍可继续示例任务。</p>}
      <h3 className="lesson-section">示例任务</h3>
      <p>{lesson.task.prompt}</p>
      <div className="lesson-actions">
        {lesson.task.options.map(option => (
          <button key={option} className="btn btn-ghost" type="button" lang="en"
            aria-pressed={answer === option} onClick={() => setAnswer(option)}>
            {option}
          </button>
        ))}
      </div>
      <p role="status">{answer === null ? "" : answer === lesson.task.expected
        ? "示例任务已完成"
        : "见面可以用一句问候，再试一次。"}</p>
    </section>
  );
}
