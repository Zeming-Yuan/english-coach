import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { sfxSuccess, sfxFail } from "../lib/sfx.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 测验视图：cn2en / choice / fill，逐题判分。
 */
export default function QuizPage({ onExit }) {
  const [questions, setQuestions] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [phase, setPhase] = useState("loading"); // loading | input | feedback | result
  const [feedback, setFeedback] = useState(null);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api("/api/quiz?limit=5").then((d) => {
      setQuestions(d.questions);
      setPhase("input");
    }).catch(() => setPhase("empty"));
  }, []);

  const q = questions[qIdx];
  const total = questions.length;

  // cn2en/fill 格子渲染（feedback 阶段显示正确答案）
  const renderBoxes = (typed, wordLen, expected = null) => {
    const boxes = [];
    for (let i = 0; i < wordLen; i++) {
      const ch = i < typed.length ? typed[i] : "";
      let cls = "spelling-box box-pending";
      if (expected) {
        // 反馈阶段：显示正确字母（绿色）
        cls = "spelling-box box-correct";
        boxes.push(<span key={i} className={cls}>{expected[i] || ""}</span>);
      } else if (ch) {
        cls = "spelling-box";
        boxes.push(<span key={i} className={cls}>{ch}</span>);
      } else {
        boxes.push(<span key={i} className={cls}>{""}</span>);
      }
    }
    return boxes;
  };

  // 确认答案
  const confirmAnswer = useCallback(async () => {
    if (!q) return;
    const userInput = q.type === "choice" ? (selected || "") : input.trim();
    setPhase("feedback");

    // related 类型：直接比较答案
    if (q.type === "related") {
      const correct = userInput.toLowerCase() === (q.answer || "").toLowerCase();
      if (correct) sfxSuccess(); else sfxFail();
      speak(q.answer, null);
      setFeedback({ correct, expected: q.answer, userInput });
      if (!correct) {
        setWrongList((w) => [...w, { question: q, user_input: userInput, expected: q.answer }]);
      }
      return;
    }

    let result;
    try {
      result = await api("/api/typing/check", {
        method: "POST",
        body: JSON.stringify({ card_id: q.card_id, user_input: userInput }),
      });
    } catch {
      return;
    }

    const correct = result.correct;
    if (correct) sfxSuccess(); else sfxFail();
    speak(result.expected, null);

    setFeedback({
      correct,
      expected: result.expected,
      userInput,
    });

    if (!correct) {
      setWrongList((w) => [...w, { question: q, user_input: userInput, expected: result.expected }]);
    }
  }, [q, input, selected]);

  // 下一题
  const nextQuestion = useCallback(() => {
    setFeedback(null);
    setInput("");
    setSelected(null);
    if (qIdx + 1 < total) {
      setQIdx((i) => i + 1);
      setPhase("input");
    } else {
      setPhase("result");
    }
  }, [qIdx, total]);

  // Enter 键（输入阶段挂在 input，反馈阶段挂在 document）
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (phase === "input") confirmAnswer();
      else if (phase === "feedback") nextQuestion();
    }
  }, [phase, confirmAnswer, nextQuestion]);

  // 反馈阶段文档级 Enter
  useEffect(() => {
    if (phase !== "feedback") return;
    const handler = (e) => {
      if (e.key === "Enter") { e.preventDefault(); nextQuestion(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [phase, nextQuestion]);

  // 跳过
  const skipQuestion = useCallback(() => {
    if (!q) return;
    setFeedback({ correct: false, expected: q.word || "", userInput: "", skipped: true });
    setWrongList((w) => [...w, { question: q, user_input: "", expected: q.word || "" }]);
    setPhase("feedback");
  }, [q]);

  // 结果页
  if (phase === "result") {
    const correctCount = total - wrongList.length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <section className="view view-center">
        <div className="result-badge">{score === 100 ? "🏆" : score >= 80 ? "🌟" : score >= 60 ? "👍" : "🙂"}</div>
        <div className="result-score">
          <span className="big-number">{score}</span>
          <span className="big-label">分</span>
        </div>
        <div className="result-detail">
          {wrongList.length === 0 ? (
            "全部答对！明天的复习不会再忘了 📚"
          ) : (
            <>
              答对 <span className="right">{correctCount}</span> / {total} 题。
              <div className="quiz-wrong-list">
                <div className="quiz-wrong-title">❌ 错题回顾</div>
                {wrongList.map((w, i) => (
                  <div key={i} className="quiz-wrong-item" style={{ cursor: "pointer" }}>
                    <span className="quiz-wrong-meaning">{escapeHtml(w.question?.prompt || "")}</span>
                    <span className="quiz-wrong-expected">{escapeHtml(w.expected)} ›</span>
                  </div>
                ))}
              </div>
              <div className="quiz-wrong-hint">这些词会出现在明天的复习队列里 📚</div>
            </>
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => { setQIdx(0); setWrongList([]); setPhase("loading"); api("/api/quiz?limit=5").then((d) => { setQuestions(d.questions); setPhase("input"); }).catch(() => setPhase("empty")); }}>
          再测一次
        </button>
        <button className="btn btn-primary" onClick={onExit}>回到队列</button>
      </section>
    );
  }

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">题库是空的</div>;
  if (!q) return null;

  return (
    <section className="view view-practice">
      <div className="study-head">
        <span className="study-count">第 {qIdx + 1} / {total} 题</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(qIdx / total) * 100}%` }} />
      </div>

      <div className="quiz-card">
        <div className="quiz-prompt">
          {q.type === "cn2en" && `「${q.prompt}」用英语怎么说？`}
          {q.type === "choice" && `「${q.prompt}」是哪个单词？`}
          {q.type === "fill" && `填空：${q.prompt}${q.hint ? `（${q.hint}）` : ""}`}
          {q.type === "related" && q.prompt}
        </div>

        {/* cn2en / fill：格子 + 输入 */}
        {(q.type === "cn2en" || q.type === "fill") && phase === "input" && (
          <>
            <div className="spelling-word-display">
              {renderBoxes(input, q.word_length || 5)}
            </div>
            <input
              ref={inputRef}
              className="spelling-input"
              name="quiz-answer"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, q.word_length || 5))}
              onKeyDown={handleKeyDown}
              placeholder={`输入英文单词（${q.word_length || "?"} 个字母）`}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </>
        )}

        {/* choice：选项 */}
        {q.type === "choice" && phase === "input" && (
          <div className="quiz-options">
            {q.options?.map((opt) => (
              <div
                key={opt}
                role="button"
                tabIndex={0}
                className={`quiz-option ${selected === opt ? "selected" : ""}`}
                onClick={() => setSelected(opt)}
                onKeyDown={(e) => e.key === "Enter" && setSelected(opt)}
              >
                {opt}
                <button
                  className="quiz-option-speak"
                  title="听发音"
                  onClick={(e) => { e.stopPropagation(); speak(opt); }}
                >🔊</button>
              </div>
            ))}
          </div>
        )}

        {/* related：词族题（输入答案） */}
        {q.type === "related" && phase === "input" && (
          <>
            <div className="spelling-word-display">
              {renderBoxes(input, (q.answer || "").length || 5)}
            </div>
            <input
              ref={inputRef}
              className="spelling-input"
              name="quiz-answer"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入相关词…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </>
        )}

        {/* 反馈 */}
        {phase === "feedback" && feedback && (
          <>
            {/* 错题高亮正确字母 */}
            {!feedback.correct && (q.type === "cn2en" || q.type === "fill") && (
              <div className="spelling-word-display">
                {renderBoxes(feedback.userInput || "", q.word_length || feedback.expected.length, feedback.expected)}
              </div>
            )}
            <div className={`quiz-feedback ${feedback.correct ? "ok" : "err"}`}>
              {feedback.correct ? (
                "✅ 正确！"
              ) : (
                <>
                  {feedback.userInput && <>❌ 你的答案：<b>{escapeHtml(feedback.userInput || "（空）")}</b><br /></>}
                  正确答案：<b className="right">{escapeHtml(feedback.expected)}</b>
                </>
              )}
            </div>
          </>
        )}

      </div>

      {/* 主操作：钉在首屏底部，不随题目内容滚动 */}
      <div className="practice-actions">
        {phase === "input" && (
          <>
            <button className="btn btn-primary btn-wide" onClick={confirmAnswer} disabled={q.type === "choice" && !selected}>
              确认
            </button>
            <button className="btn btn-ghost btn-small" style={{ marginTop: 14, width: "100%", justifyContent: "center" }} onClick={skipQuestion}>
              跳过这题 →
            </button>
          </>
        )}
        {phase === "feedback" && (
          <button className="btn btn-primary btn-wide" onClick={nextQuestion}>
            {qIdx >= total - 1 ? "查看结果" : "下一题 →"}
          </button>
        )}
      </div>
    </section>
  );
}
