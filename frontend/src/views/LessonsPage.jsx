import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { escapeHtml } from "../lib/utils.js";
import { recordVisibleCards } from "../lib/contacts.js";
import { recordPracticeContact } from "../lib/practiceContacts.js";
import {
  makePending,
  sendPending,
  savePending,
  loadPending,
  clearPending,
} from "../lib/learning.js";
import { useLearningAttempt } from "../hooks/useLearningAttempt.js";
import { showToast } from "../App.jsx";

function lessonProgressLabel(progress) {
  if (!progress) return "状态未记录";
  if (progress.status === "browsed") return "已浏览 · 待检查";
  if (progress.status === "weak") {
    return `待巩固（通过 ${progress.passed_count}/${progress.checked_count}）`;
  }
  if (progress.status === "passed") return "已通过本轮检查";
  if (progress.opened) {
    return progress.generated
      ? "已打开 · 待检查"
      : "已有内容 · 已打开 · 待检查";
  }
  if (!progress.generated) return "已有内容 · 状态未记录 · 待检查";
  return "待检查";
}

const NEXT_SCOPE = "next";
const NEXT_PREFIX = "ec.lessongen.";
const VIEW_PREFIX = "ec.lessonview.";

function pendingViewLevels() {
  try {
    const levels = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(VIEW_PREFIX)) {
        levels.push(key.slice(VIEW_PREFIX.length));
      }
    }
    return levels.sort((left, right) => Number(left) - Number(right));
  } catch {
    return [];
  }
}

/**
 * 课程学习视图：AI 20 级递进（音标启蒙→高频词→简单句→场景对话）。
 */
export default function LessonsPage({ onExit }) {
  const [lessons, setLessons] = useState([]);
  const [nextLevel, setNextLevel] = useState(1);
  const [isDone, setIsDone] = useState(false);
  const [counts, setCounts] = useState({
    total: 0,
    generated: 0,
    opened: 0,
    browsed: 0,
    unrecorded: 0,
  });
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasNextPending, setHasNextPending] = useState(() =>
    Boolean(loadPending(NEXT_SCOPE, NEXT_PREFIX)),
  );
  const [viewPending, setViewPending] = useState(pendingViewLevels);
  useEffect(() => {
    if (!activeLesson) setViewPending(pendingViewLevels());
  }, [activeLesson]);

  const loadLessons = useCallback(
    () =>
      api("/api/lessons").then((d) => {
        setLessons(d.lessons);
        setNextLevel(d.next_level);
        setIsDone(d.is_done);
        setCounts(d.counts || {});
        return d;
      }),
    [],
  );

  useEffect(() => {
    loadLessons()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadLessons]);

  const openLesson = async (level) => {
    try {
      const lesson = await api(`/api/lessons/${level}`);
      setActiveLesson(lesson);
    } catch (e) {
      showToast("课程加载失败：" + e.message, "重试");
    }
  };

  const nextLesson = async () => {
    if (generating) return;
    if (isDone || nextLevel > 20) {
      setActiveLesson(null);
      return;
    }
    setGenerating(true);
    // 生成前保存稳定 operation_id；响应丢失后重试不会跳级或重复生成。
    let pending = loadPending(NEXT_SCOPE, NEXT_PREFIX);
    if (!pending) {
      pending = {
        path: "/api/lessons/next",
        payload: { operation_id: crypto.randomUUID() },
      };
      savePending(NEXT_SCOPE, pending, NEXT_PREFIX);
      setHasNextPending(true);
    }
    try {
      const lesson = await sendPending(pending);
      clearPending(NEXT_SCOPE, NEXT_PREFIX);
      setHasNextPending(false);
      setActiveLesson(lesson);
      await loadLessons().catch(() => {});
    } catch (error) {
      setHasNextPending(true);
      showToast(
        "生成尚未确认：" + (error?.message || error),
        "重试",
        nextLesson,
      );
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="story-empty">加载中…</div>;

  // 课程学习页
  if (activeLesson) {
    return (
      <LessonDetail
        key={activeLesson.id}
        lesson={activeLesson}
        onBack={() => setActiveLesson(null)}
        onNext={nextLesson}
        onViewed={loadLessons}
        generating={generating}
      />
    );
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
            {isDone ? "20 课已全部生成" : `已生成 ${counts.generated ?? lessons.length}/20 课`}
          </div>
          <div className="lesson-entry-title">
            {isDone
              ? "20 课已全部生成 · 尚无短测，待检查"
              : lessons.length > 0
                ? `第 ${lessons[lessons.length - 1].level} 课 · ${lessons[lessons.length - 1].title}`
                : "开始零基础课程"}
          </div>
          <div className="lesson-entry-sub">
            已打开 {counts.opened ?? 0} 课 · 已浏览 {counts.browsed ?? 0} 课
            {counts.old_content ? ` · 旧内容 ${counts.old_content} 课` : ""}
            {counts.unrecorded ? ` · 状态未记录 ${counts.unrecorded} 课` : ""}
            {isDone ? " · 可随时回顾" : ` · 下一课：第 ${nextLevel} 课`}
          </div>
        </div>
        {!isDone && (
          <button
            className="btn btn-primary btn-small"
            data-testid="open-lessons"
            disabled={generating}
            onClick={nextLesson}
          >
            {generating ? "生成中…" : lessons.length === 0 ? "开始" : "继续 →"}
          </button>
        )}
      </div>

      {hasNextPending && (
        <div role="status" className="lesson-entry">
          上次生成尚未确认保存
          <button
            className="btn btn-ghost btn-small"
            disabled={generating}
            onClick={nextLesson}
          >
            继续确认生成
          </button>
        </div>
      )}

      {viewPending.length > 0 && (
        <div role="status" className="lesson-entry">
          有课程浏览尚未确认：第 {viewPending.join("、")} 课
          <button
            className="btn btn-ghost btn-small"
            onClick={() => openLesson(Number(viewPending[0]))}
          >
            继续确认
          </button>
        </div>
      )}

      {/* 已学课程列表 */}
      {lessons.length > 0 && (
        <>
          <h3 className="lesson-section">已生成课程</h3>
          {[...lessons].reverse().map((l) => (
            <div key={l.id} className="lesson-list-item" onClick={() => openLesson(l.level)}>
              <div className="lesson-list-item-main">
                <div className="lesson-list-item-title">第 {l.level} 课 · {escapeHtml(l.title)}</div>
                <div className="lesson-list-item-sub">
                  {(l.content.dialogue || []).length} 句对话 ·{" "}
                  {lessonProgressLabel(l.learning_progress)}
                </div>
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
function LessonDetail({ lesson, onBack, onNext, onViewed, generating }) {
  const [mastered, setMastered] = useState(new Set());
  const [revealed, setRevealed] = useState(new Set());
  const [guesses, setGuesses] = useState({});
  const L = lesson;
  const viewedScope = String(L.level);
  const viewPrefix = "ec.lessonview.";
  const [pendingView, setPendingView] = useState(() =>
    loadPending(viewedScope, viewPrefix),
  );
  const [viewed, setViewed] = useState(() =>
    pendingView
      ? { phase: "failed", error: "尚未确认保存；请继续确认保存或明确放弃" }
      : { phase: "idle", error: null },
  );
  const [progress, setProgress] = useState(L.learning_progress || {});
  const goal = L.goal || "本课主题";

  // 打开课程是独立于生成/浏览的状态；失败不阻断阅读。
  useEffect(() => {
    let cancelled = false;
    api(`/api/lessons/${L.level}/opened`, { method: "POST" })
      .then((data) => {
        if (cancelled || !data.learning_progress) return;
        setProgress((prev) =>
          prev.status === "browsed" ? prev : data.learning_progress,
        );
        onViewed?.();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [L.level]);

  const sendViewed = async (pending) => {
    setViewed({ phase: "saving", error: null });
    try {
      const result = await sendPending(pending);
      if (result.committed !== true) throw new Error("尚未确认保存");
      clearPending(viewedScope, viewPrefix);
      setPendingView(null);
      if (result.learning_progress) setProgress(result.learning_progress);
      onViewed?.();
      setViewed({ phase: "saved", error: null });
    } catch (error) {
      setViewed({
        phase: "failed",
        error: "尚未确认保存：" + (error?.message || error),
      });
    }
  };
  const markViewed = async () => {
    if (viewed.phase === "saving" || viewed.phase === "failed") return;
    const pending = makePending(`/api/lessons/${L.level}/viewed`, {
      revision: L.content_revision,
    });
    setPendingView(pending);
    savePending(viewedScope, pending, viewPrefix);
    await sendViewed(pending);
  };
  const retryViewed = async () => {
    const pending =
      pendingView || loadPending(viewedScope, viewPrefix);
    if (!pending) {
      setViewed({ phase: "idle", error: null });
      return;
    }
    setPendingView(pending);
    await sendViewed(pending);
  };
  const abandonViewed = () => {
    clearPending(viewedScope, viewPrefix);
    setPendingView(null);
    setViewed({ phase: "idle", error: null });
  };
  const words = L.words || L.content.words || [];
  const dialogue = L.dialogue || L.content.dialogue || [];
  const tips = L.content.tips || [];

  const revealWord = (word) => {
    setRevealed((s) => new Set(s).add(word));
    const target = words.find((entry) => entry.word === word);
    if (target?.content_revision) {
      recordPracticeContact({
        cardId: target.id,
        revision: target.content_revision,
        source: "lesson",
        kind: "answer_visible",
      });
    }
  };

  // 只有真正进入视口的目标词/对话句才算接触；预取与未展示不算。
  const seenContacts = useRef(new Set());
  useEffect(() => {
    seenContacts.current = new Set();
    if (typeof IntersectionObserver === "undefined") return;
    const record = (ids) => {
      const fresh = Array.from(new Set(ids)).filter(
        (id) => !seenContacts.current.has(id),
      );
      if (fresh.length === 0) return;
      fresh.forEach((id) => seenContacts.current.add(id));
      const targets = fresh
        .map((id) => words.find((word) => word.id === id))
        .filter((word) => word?.content_revision);
      recordVisibleCards(targets, "lesson").then(({ failed, retryable }) => {
        if (failed.length === 0) return;
        failed.forEach((target) => seenContacts.current.delete(target.id));
        const message = `接触依据不完整：${failed.length} 个目标词`;
        if (retryable.length === 0) {
          showToast(message);
          return;
        }
        showToast(message, "重试", () =>
          record(retryable.map((target) => target.id)),
        );
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const raw = entry.target.dataset.contactIds;
          if (raw) ids.push(...raw.split(",").map(Number).filter(Boolean));
        }
        record(ids);
      },
      {threshold: 0.5},
    );
    document
      .querySelectorAll("[data-contact-ids]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [lesson.id]);

  const contactAudio = (text, ids) =>
    speak(text, null, () => {
      for (const id of ids || []) {
        const target = words.find((word) => word.id === id);
        if (target?.content_revision) {
          recordPracticeContact({
            cardId: id,
            revision: target.content_revision,
            source: "lesson",
            kind: "answer_audio",
          });
        }
      }
    });

  return (
    <section className="view">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onBack}>← 返回</button>
      </div>
      <p className="eyebrow">第 {L.level} 课</p>
      <h2 className="page-title">{escapeHtml(L.title)}</h2>
      <p className="lesson-goal" data-testid="lesson-goal">
        本课目标：{goal}
      </p>
      <div className="lesson-progress" data-testid="lesson-progress">
        <span>学习状态：{lessonProgressLabel(progress)}</span>
        <span>
          短测：
          {progress.checked_count
            ? `通过 ${progress.passed_count}/${progress.checked_count} 题`
            : "尚无（待检查）"}
        </span>
      </div>

      {tips.length > 0 && (
        <div className="lesson-tips">{tips.join("；")}</div>
      )}

      <h3 className="lesson-section">本课单词 · 先猜意思，再揭晓</h3>
      <div className="word-list">
        {words.map((w, i) => {
          const isRevealed = revealed.has(w.word);
          const isMastered = mastered.has(w.word);
          return (
            <div key={i} className={`word-item lesson-word ${isMastered ? "word-mastered" : ""}`}>
              <div className="word-main" style={{ flex: 1 }}>
                <div className="word-item-word">{escapeHtml(w.word)}</div>
                <div className="word-item-phonetic">{escapeHtml(w.phonetic || "")}</div>
                {!isRevealed ? (
                  /* 预测试：先猜 */
                  <div className="pretest-row">
                    <input
                      className="pretest-input"
                      name={`pretest-${w.word}`}
                      placeholder="猜一下这个词的意思…"
                      value={guesses[w.word] || ""}
                      onChange={(e) => setGuesses((g) => ({ ...g, [w.word]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") revealWord(w.word); }}
                    />
                    <button className="btn btn-ghost btn-small pretest-btn" onClick={() => revealWord(w.word)}>
                      {guesses[w.word] ? "揭晓" : "猜不到"}
                    </button>
                  </div>
                ) : (
                  /* 揭晓后 */
                  <>
                    <div className="word-item-meaning">{escapeHtml(w.meaning || "")}</div>
                    {guesses[w.word] && guesses[w.word] !== w.meaning && (
                      <div className="pretest-guess">你的猜测：{escapeHtml(guesses[w.word])}</div>
                    )}
                  </>
                )}
              </div>
              <button type="button" className="speak-mini" title="朗读" onClick={(e) => { e.stopPropagation(); contactAudio(w.word, [w.id]); }}>🔊</button>
              {isRevealed && (
                <LessonMastery
                  cardId={L.card_ids?.[w.word]}
                  onMastered={() => setMastered((s) => new Set(s).add(w.word))}
                />
              )}
            </div>
          );
        })}
      </div>

      <div data-testid="content-contact-status" className="story-tap-tip">
        应用内接触：本课目标词按实际显示记录
      </div>

      <h3 className="lesson-section">对话 · 点句子听发音</h3>
      <div className="bubble-list">
        {dialogue.map((line, i) => (
          <div
            key={i}
            data-contact-ids={(line.visible_card_ids || []).join(",")}
            className={`bubble ${i % 2 === 0 ? "bubble-a" : "bubble-b"} lesson-dialogue-row`}
            onClick={() => contactAudio(line.en, line.visible_card_ids)}
          >
            <span className="spk">{escapeHtml(line.speaker)}</span>
            <div className="bubble-en">{escapeHtml(line.en)}</div>
            <div className="bubble-cn">{escapeHtml(line.cn)}</div>
          </div>
        ))}
      </div>

      <div className="lesson-actions">
        <button
          className="btn btn-primary btn-wide"
          onClick={markViewed}
          disabled={viewed.phase === "saving" || viewed.phase === "failed"}
        >
          内容已看完
        </button>
        {viewed.phase === "saving" && (
          <p role="status" className="save-state">正在确认浏览状态…</p>
        )}
        {viewed.phase === "failed" && (
          <div role="alert" className="save-state save-state-error">
            <p>{viewed.error}</p>
            <div className="save-state-actions">
              <button className="btn btn-primary btn-small" onClick={retryViewed}>
                继续确认保存
              </button>
              <button className="btn btn-ghost btn-small" onClick={abandonViewed}>
                放弃这条待确认
              </button>
            </div>
          </div>
        )}
        <button
          className="btn btn-ghost btn-wide"
          style={{ marginTop: 8 }}
          onClick={onNext}
          disabled={generating}
        >
          {generating ? "生成中…" : "稍后检查，继续下一课"}
        </button>
      </div>
    </section>
  );
}

/* 课程内显式评分：保存确认后才标记已掌握，失败可继续确认同一提交。 */
function LessonMastery({ cardId, onMastered }) {
  const attempt = useLearningAttempt("lesson:" + cardId);

  if (!cardId) return null;

  const finish = (result) => {
    if (result.committed !== true) return;
    attempt.clear();
    onMastered();
  };

  const submit = async () => {
    if (attempt.phase === "saving" || attempt.phase === "failed") return;
    try {
      finish(await attempt.submit("/api/reviews", {
        card_id: cardId,
        rating: 3,
        source: "lesson",
        kind: "self_rating",
        stage: "standalone",
      }));
    } catch {}
  };

  const retry = async () => {
    try {
      finish(await attempt.retry());
    } catch {}
  };

  return (
    <div className="lesson-mastery">
      <button
        className="lesson-master-btn"
        title="记住了"
        data-testid="rate-good"
        disabled={attempt.phase === "saving" || attempt.phase === "failed"}
        onClick={(e) => { e.stopPropagation(); submit(); }}
      >✓</button>
      {attempt.phase === "failed" && (
        <div role="alert" className="save-state save-state-error">
          <p>{attempt.error}</p>
          <div className="save-state-actions">
            <button className="btn btn-primary btn-small" onClick={retry}>继续确认保存</button>
            <button className="btn btn-ghost btn-small" onClick={attempt.clear}>放弃这条待确认</button>
          </div>
        </div>
      )}
    </div>
  );
}
