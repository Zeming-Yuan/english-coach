import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { speak } from "../lib/tts.js";
import { sfxSuccess, sfxFail } from "../lib/sfx.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * 混合练习视图：拼写/听写/选择随机交错。
 */
export default function MixedPage({ onExit }) {
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrongList, setWrongList] = useState([]);
  const [phase, setPhase] = useState("loading");
  const [feedback, setFeedback] = useState(null);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const [listeningData, quizData, todayData] = await Promise.all([
        api("/api/listening?limit=2"),
        api("/api/quiz?limit=6"),
        api("/api/today"),
      ]);
      const result = [];
      // 听写
      (listeningData.questions || []).slice(0, 2).forEach((q) => result.push({ type: "listen", q }));
      // 选择
      (quizData.questions || []).filter((q) => q.type === "choice").slice(0, 2).forEach((q) => result.push({ type: "choice", q }));
      // 拼写
      let spellPool = [...(todayData.error_cards || []), ...todayData.new_cards, ...todayData.due_cards].filter((c) => c.kind === "word");
      if (spellPool.length === 0) {
        const allData = await api("/api/cards");
        spellPool = allData.cards.filter((c) => c.kind === "word");
      }
      spellPool.slice(0, 2).forEach((c) => result.push({ type: "spell", q: { card_id: c.id, word: c.word, meaning: c.meaning } }));
      // 随机交错
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      if (result.length < 3) { setPhase("empty"); return; }
      setItems(result);
      setPhase("ready");
    } catch {
      setPhase("empty");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const item = items[idx];
  const total = items.length;
  const q = item?.q;

  useEffect(() => {
    if (phase === "ready" && item?.type === "listen" && q) speak(q.word, null);
  }, [idx, phase, item?.type, q?.word]);

  const typeName = (t) => t === "listen" ? "听写" : t === "choice" ? "选择" : "拼写";

  const submittedRef = useRef(false);

  const handleAnswer = useCallback(async (isCorrect, expected, userVal) => {
    if (feedback || submittedRef.current) return;
    submittedRef.current = true;
    if (isCorrect) sfxSuccess(); else sfxFail();
    if (isCorrect) setCorrect((c) => c + 1);
    if (!isCorrect) setWrongList((w) => [...w, { q, expected }]);
    setFeedback({ correct: isCorrect, expected });
    // 后端记录
    if (item.type === "listen") {
      api("/api/listening/score", {
        method: "POST",
        body: JSON.stringify({ card_id: q.card_id, selected_index: userVal, correct_index: q.correct_index, rating: isCorrect ? 3 : 1 }),
      }).catch(() => {});
    } else if (item.type === "choice") {
      api("/api/quiz/score", {
        method: "POST",
        body: JSON.stringify({ answers: [{ card_id: q.card_id, user_input: userVal }] }),
      }).catch(() => {});
    } else {
      api("/api/typing/check", {
        method: "POST",
        body: JSON.stringify({ card_id: q.card_id, user_input: userVal }),
      }).catch(() => {});
    }
  }, [feedback, item, q]);

  const nextItem = useCallback(() => {
    submittedRef.current = false;
    setFeedback(null);
    setInput("");
    setSelected(null);
    if (idx + 1 < total) setIdx((i) => i + 1);
    else setDone(true);
  }, [idx, total]);

  const skip = useCallback(() => {
    if (!q) return;
    const expected = q.word || (q.correct_index !== undefined ? q.options[q.correct_index] : "");
    handleAnswer(false, expected, -1);
  }, [q, handleAnswer]);

  // 拼写自动提交
  useEffect(() => {
    if (item?.type === "spell" && q && input.length === q.word.length && !feedback) {
      const t = setTimeout(() => handleAnswer(input.toLowerCase() === q.word.toLowerCase(), q.word, input), 300);
      return () => clearTimeout(t);
    }
  }, [input, item, q, feedback, handleAnswer]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (item?.type === "spell" && input.length > 0 && !feedback) {
        handleAnswer(input.toLowerCase() === q.word.toLowerCase(), q.word, input);
      } else if (feedback) {
        nextItem();
      }
    }
  }, [item, input, feedback, q, handleAnswer, nextItem]);

  if (phase === "loading") return <div className="story-empty">加载中…</div>;
  if (phase === "empty") return <div className="story-empty">题目不够，先去加几个词吧</div>;

  if (done) {
    return (
      <section className="view view-center">
        <div className="study-done">
          <div className="done-emoji">🎲</div>
          <h2>混合练习完成！</h2>
          <p className="done-detail">答对 {correct}/{total} 题（{total > 0 ? Math.round(correct / total * 100) : 0} 分）· 混合题型记忆更牢 🚀</p>
          {wrongList.length > 0 && (
            <div className="quiz-wrong-list">
              <div className="quiz-wrong-title">❌ 错题回顾</div>
              {wrongList.map((w, i) => (
                <div key={i} className="quiz-wrong-item">
                  <span className="quiz-wrong-meaning">{escapeHtml(w.q?.meaning || "")}</span>
                  <span className="quiz-wrong-expected">{escapeHtml(w.expected)}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => { setIdx(0); setCorrect(0); setWrongList([]); setDone(false); setPhase("loading"); load(); }}>再来一轮</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onExit}>回到队列</button>
        </div>
      </section>
    );
  }
  if (!item || !q) return null;

  // 拼写格子
  const spellBoxes = item.type === "spell" ? (() => {
    const boxes = [];
    for (let i = 0; i < q.word.length; i++) {
      const ch = i < input.length ? input[i] : "";
      const isC = ch && ch.toLowerCase() === q.word[i].toLowerCase();
      const isW = ch && !isC;
      boxes.push(<span key={i} className={`spelling-box ${isC ? "box-correct" : isW ? "box-wrong" : "box-pending"}`}>{ch || ""}</span>);
    }
    return boxes;
  })() : null;

  return (
    <section className="view view-center">
      <div className="page-head">
        <button className="btn btn-ghost btn-small" onClick={onExit}>← 返回</button>
      </div>
      <div className="spelling-head">
        <span className="study-count">{idx + 1} / {total} · {typeName(item.type)}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      <div className="mixed-body">
        {/* 听写 */}
        {item.type === "listen" && (
          <>
            <div className="mixed-type-label">🎧 听发音选单词</div>
            <div className="listening-prompt">
              <button className="btn-speak-large" onClick={() => speak(q.word)}>🔊</button>
              <div className="listening-meaning">{escapeHtml(q.meaning)}</div>
            </div>
            <div className="listening-options">
              {q.options?.map((opt, i) => {
                let cls = "btn btn-ghost listening-option";
                if (feedback) {
                  if (i === q.correct_index) cls += " correct";
                  else if (i === feedback.selected && !feedback.correct) cls += " wrong";
                }
                return <button key={i} className={cls} disabled={!!feedback} onClick={() => handleAnswer(i === q.correct_index, q.word, i)}>{opt}</button>;
              })}
            </div>
          </>
        )}

        {/* 选择 */}
        {item.type === "choice" && (
          <>
            <div className="mixed-type-label">🤔 选意思</div>
            <div className="quiz-prompt">「{escapeHtml(q.prompt)}」是哪个单词？</div>
            <div className="quiz-options">
              {q.options?.map((opt) => {
                let cls = "quiz-option";
                if (selected === opt) cls += " selected";
                if (feedback) {
                  if (opt === feedback.expected) cls += " correct";
                }
                return (
                  <button key={opt} className={cls} disabled={!!feedback} onClick={() => {
                    setSelected(opt);
                    api("/api/quiz/score", { method: "POST", body: JSON.stringify({ answers: [{ card_id: q.card_id, user_input: opt }] }) })
                      .then((r) => handleAnswer(r.details?.[0]?.correct || false, r.details?.[0]?.expected || opt, opt))
                      .catch(() => {});
                  }}>
                    {opt}
                    <button className="quiz-option-speak" title="听发音" onClick={(e) => { e.stopPropagation(); speak(opt); }}>🔊</button>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* 拼写 */}
        {item.type === "spell" && (
          <>
            <div className="mixed-type-label">⌨️ 拼写</div>
            <div className="spelling-meaning">{escapeHtml(q.meaning)}</div>
            <div className="spelling-word-display">{spellBoxes}</div>
            <input
              className="spelling-input"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, q.word.length))}
              onKeyDown={handleKeyDown}
              placeholder="输入英文单词…"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </>
        )}

        {/* 反馈 */}
        {feedback && (
          <div className={`quiz-feedback ${feedback.correct ? "ok" : "err"}`}>
            {feedback.correct ? "✅ 正确！" : <>❌ 正确答案：<b className="right">{escapeHtml(feedback.expected)}</b></>}
          </div>
        )}

        {/* 跳过 */}
        <button className="btn btn-ghost btn-small spelling-skip" onClick={feedback ? nextItem : skip}>
          {feedback ? "下一题 →" : "跳过这题 →"}
        </button>
      </div>
    </section>
  );
}
