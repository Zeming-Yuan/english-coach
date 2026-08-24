import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 课程学习视图：AI 20 级递进（音标启蒙→高频词→简单句→场景对话）。
 */
export default function LessonsPage({ onExit }) {
  const [lessons, setLessons] = useState([]);
  const [nextLevel, setNextLevel] = useState(1);
  const [isDone, setIsDone] = useState(false);
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api("/api/lessons").then((d) => {
      setLessons(d.lessons);
      setNextLevel(d.next_level);
      setIsDone(d.is_done);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openLesson = async (level, generate = false) => {
    try {
      if (generate) {
        setGenerating(true);
        const lesson = await api("/api/lessons/next", { method: "POST" });
        setActiveLesson(lesson);
        setLessons((prev) => [...prev, lesson]);
        setNextLevel(lesson.level + 1);
        if (lesson.level >= 20) setIsDone(true);
      } else {
        const lesson = await api(`/api/lessons/${level}`);
        setActiveLesson(lesson);
      }
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast-detail", { detail: { msg: "课程加载失败：" + e.message } }));
    } finally {
      setGenerating(false);
    }
  };

  const nextLesson = async () => {
    if (nextLevel > 20) {
      setActiveLesson(null);
      return;
    }
    await openLesson(nextLevel, true);
  };

  if (loading) return <div className="story-empty">加载中…</div>;

  // 课程学习页
  if (activeLesson) {
    return <LessonDetail lesson={activeLesson} onBack={() => setActiveLesson(null)} onNext={nextLesson} />;
  }

  // 课程列表
  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
        <h2 className="page-title">课程</h2>
      </div>

      {/* 当前进度 */}
      <div className="lesson-entry" style={{ marginBottom: 16 }}>
        <div className="lesson-entry-body">
          <div className="lesson-entry-label">
            {isDone ? "全部完成 🎓" : `已完成 ${lessons.length}/20 课`}
          </div>
          <div className="lesson-entry-title">
            {isDone ? "20 级课程全部完成！" : lessons.length > 0 ? `第 ${lessons[lessons.length - 1].level} 课 · ${lessons[lessons.length - 1].title}` : "开始零基础课程"}
          </div>
          <div className="lesson-entry-sub">
            {isDone ? "继续用队列/故事巩固吧" : `下一课：第 ${nextLevel} 课`}
          </div>
        </div>
        {!isDone && (
          <button
            className="btn btn-primary btn-small"
            disabled={generating}
            onClick={() => openLesson(nextLevel, true)}
          >
            {generating ? "生成中…" : lessons.length === 0 ? "开始" : "继续 →"}
          </button>
        )}
      </div>

      {/* 已学课程列表 */}
      {lessons.length > 0 && (
        <>
          <h3 className="lesson-section">已学课程</h3>
          {[...lessons].reverse().map((l) => (
            <div key={l.id} className="lesson-list-item" onClick={() => openLesson(l.level)}>
              <div className="lesson-list-item-main">
                <div className="lesson-list-item-title">第 {l.level} 课 · {escapeHtml(l.title)}</div>
                <div className="lesson-list-item-sub">{(l.content.dialogue || []).length} 句对话</div>
              </div>
              <span className="story-delete-lesson">›</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/* ============ 课程学习详情 ============ */
function LessonDetail({ lesson, onBack, onNext }) {
  const [mastered, setMastered] = useState(new Set());
  const L = lesson;
  const words = L.content.words || [];
  const dialogue = L.content.dialogue || [];
  const tips = L.content.tips || [];

  const markMastered = async (word, cardId) => {
    if (!cardId) return;
    try {
      await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ card_id: cardId, rating: 3 }),
      });
      setMastered((s) => new Set(s).add(word));
    } catch {}
  };

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
      </div>
      <p className="eyebrow">第 {L.level} 课</p>
      <h2 className="page-title">{escapeHtml(L.title)}</h2>

      {tips.length > 0 && (
        <div className="lesson-tips">{tips.join("；")}</div>
      )}

      <h3 className="lesson-section">本课单词 · 点 ✓ 标记已掌握</h3>
      <div className="word-list">
        {words.map((w, i) => (
          <div key={i} className={`word-item lesson-word ${mastered.has(w.word) ? "word-mastered" : ""}`}>
            <div className="word-main">
              <div className="word-item-word">{escapeHtml(w.word)}</div>
              <div className="word-item-phonetic">{escapeHtml(w.phonetic || "")}</div>
              <div className="word-item-meaning">{escapeHtml(w.meaning || "")}</div>
            </div>
            <button className="speak-mini" title="朗读" onClick={(e) => { e.stopPropagation(); speak(w.word); }}>🔊</button>
            <button
              className="lesson-master-btn"
              title="记住了"
              onClick={(e) => { e.stopPropagation(); markMastered(w.word, L.card_ids?.[w.word]); }}
            >✓</button>
          </div>
        ))}
      </div>

      <h3 className="lesson-section">对话 · 点句子听发音</h3>
      <div className="bubble-list">
        {dialogue.map((line, i) => (
          <div
            key={i}
            className={`bubble ${i % 2 === 0 ? "bubble-a" : "bubble-b"} lesson-dialogue-row`}
            onClick={() => speak(line.en)}
          >
            <span className="spk">{escapeHtml(line.speaker)}</span>
            <div className="bubble-en">{escapeHtml(line.en)}</div>
            <div className="bubble-cn">{escapeHtml(line.cn)}</div>
          </div>
        ))}
      </div>

      <div className="lesson-actions">
        <button className="btn btn-primary btn-wide" onClick={onNext}>
          ✅ 学完本课，进入下一课
        </button>
      </div>
    </section>
  );
}
