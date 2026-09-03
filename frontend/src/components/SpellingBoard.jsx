import React, { useState, useRef, useCallback, useEffect } from "react";

/**
 * 拼写共享组件：格子 + 输入框 + 输满自动提交。
 *
 * 三处复用：拼写练习（SpellingPage，难度档）/ 测验（QuizPage）/ 混合练习（MixedPage）。
 * 一致交互：输满 300ms 自动提交、Enter 立即提交、提交前防重锁、提交失败可重试。
 * 父级用 key 换新题即可重置（内部 value 随 key 重建）。
 *
 * props:
 * - target: 目标词。有值 → 逐字母实时红/绿着色 + 首字母提示；null → 只显示占位格
 *   （测验的 cn2en/fill 题后端只下发 word_length 不下发单词本身，避免答案泄露）
 * - maxLength: target 为 null 时的格子数/提交长度判定
 * - onSubmit(text): 输满提交回调。父级判分/记录；返回 Promise 时 reject 会解锁组件允许重试
 * - showFirstHint: 显示目标词首字母（"教过"难度档）
 * - disabled: 提交后锁定输入
 * - placeholder / autoFocus / name / inputRef
 */
export default function SpellingBoard({
  target,
  maxLength: maxLenProp,
  onSubmit,
  showFirstHint = false,
  disabled = false,
  placeholder = "在这里输入英文单词…",
  autoFocus = true,
  name = "spelling-answer",
  inputRef,
}) {
  const maxLength = target ? target.length : Math.max(maxLenProp || 0, 0);
  const [value, setValue] = useState("");
  const submittedRef = useRef(false);

  const submit = useCallback(() => {
    if (disabled || submittedRef.current || maxLength === 0) return;
    if (value.length !== maxLength) return;
    submittedRef.current = true;
    const ret = onSubmit(value);
    if (ret?.catch) {
      ret.catch(() => {
        submittedRef.current = false; // 提交失败（如网络错）：解锁允许重试
      });
    }
  }, [value, maxLength, disabled, onSubmit]);

  // 输满自动提交（300ms 缓冲，等最后一个字母稳下来）
  useEffect(() => {
    if (maxLength > 0 && value.length === maxLength && !disabled) {
      const t = setTimeout(submit, 300);
      return () => clearTimeout(t);
    }
  }, [value, maxLength, disabled, submit]);

  const handleChange = (e) => {
    if (disabled) return;
    setValue(e.target.value.slice(0, maxLength));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.length > 0) submit();
    }
  };

  // 格子：有 target → 逐字母实时红绿；无 target → 占位（无法比对，不泄露答案）
  const boxes = [];
  for (let i = 0; i < maxLength; i++) {
    const ch = i < value.length ? value[i] : "";
    let cls = "spelling-box";
    if (target) {
      const isCorrect = ch && ch.toLowerCase() === target[i].toLowerCase();
      const isWrong = ch && !isCorrect;
      if (isCorrect) cls = "spelling-box box-correct";
      else if (isWrong) cls = "spelling-box box-wrong";
      else cls = "spelling-box box-pending";
    } else {
      cls = ch ? "spelling-box" : "spelling-box box-pending";
    }
    const hintCh = showFirstHint && !ch && i === 0 && target ? target[0] : "";
    boxes.push(
      <span key={i} className={cls} style={hintCh ? { color: "var(--muted)" } : {}}>
        {ch || hintCh || ""}
      </span>
    );
  }

  return (
    <>
      <div className="spelling-word-display">{boxes}</div>
      <input
        ref={inputRef}
        className="spelling-input"
        name={name}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
      />
    </>
  );
}
