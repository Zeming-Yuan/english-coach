/**
 * 练习会话模块：一次「练习会话」的完整状态机。
 *
 * 四视图（拼写/听写/测验/混合）共用同一套行为，视图只渲染题型 UI：
 * - 判分 + 答案效果（视图可为单题提供 item.judge / item.skip，由服务端保存并
 *   返回判分；否则走下方默认策略：拼写/选择/填空只记错词等）
 * - 反馈（音效 / 自动切题 / Enter 下一题 / 跳过）
 * - 统计（correct / wrongList —— 完成页数据在此，不在视图）
 *
 * item 形状：{ type: "listen"|"choice"|"spell"|"cn2en"|"fill"|"related", q: {...} }
 * q 字段由 buildItems 提供（各视图的题库接口不同）。
 * EC-06 起听写页使用独立的保存确认状态机；混合页迁移由 EC-07 负责。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api.js";
import { clearPending, loadPending, makePending, savePending, sendPending } from "./learning.js";
import { sfxFail, sfxSuccess } from "./sfx.js";
import { speak } from "./tts.js";

const TYPED_PENDING_SCOPE = "typed-attempt";

/** 本地归一化判分（与后端 scoring.normalize 语义一致：小写+去标点空白） */
export const norm = (s) => (s || "").toLowerCase().trim();

/** 今日队列 → 拼写池（错词/新词/到期卡，空则全库兜底）——三视图共用 */
export async function fetchSpellPool() {
  const data = await api("/api/today");
  let pool = [...(data.error_cards || []), ...data.new_cards, ...data.due_cards].filter(
    (c) => c.kind === "word"
  );
  if (pool.length === 0) {
    const allData = await api("/api/cards");
    pool = allData.cards.filter((c) => c.kind === "word");
  }
  return pool;
}

/** 一个答案的判分 + 记录效果（策略上文所述）。返回 {correct, expected}；网络错抛出。 */
async function judgeAnswer(item, value, fsrsOnSpell) {
  // 视图可为单题提供保存即判分的实现（EC-06 选择题）。
  if (typeof item.judge === "function") return item.judge(value);
  const q = item.q;
  switch (item.type) {
    case "listen": {
      const r = await api("/api/listening/score", {
        method: "POST",
        body: JSON.stringify({
          card_id: q.card_id,
          selected_index: value,
          correct_index: q.correct_index,
          rating: value === q.correct_index ? 3 : 1,
        }),
      });
      return { correct: r.correct, expected: r.correct_word };
    }
    case "spell": {
      const r = await api("/api/typing/check", {
        method: "POST",
        body: JSON.stringify({ card_id: q.card_id, user_input: value }),
      });
      if (fsrsOnSpell) {
        // 专属拼写练习例外：答对/答错也算一次复习（进 FSRS 并可触发毕业）
        api("/api/reviews", {
          method: "POST",
          body: JSON.stringify({ card_id: q.card_id, rating: r.correct ? 3 : 1 }),
        }).catch(() => {});
      }
      return { correct: r.correct, expected: r.expected };
    }
    case "choice":
    case "cn2en":
    case "fill": {
      const r = await api("/api/typing/check", {
        method: "POST",
        body: JSON.stringify({ card_id: q.card_id, user_input: value }),
      });
      return { correct: r.correct, expected: r.expected };
    }
    case "related":
      // related 答案在题面 q.answer（无独立判分接口）——本地判分
      return { correct: norm(value) === norm(q.answer), expected: q.answer };
    default:
      throw new Error(`未知题型: ${item.type}`);
  }
}

/**
 * @param {object} opts
 * @param {() => Promise<Item[]>} opts.buildItems 装配题目（题库接口不同，由视图提供）
 * @param {number} [opts.minItems=1] 题量不足视为 empty
 * @param {boolean} [opts.fsrsOnSpell=false] 专属拼写练习：拼写也写 FSRS（默认只记错词）
 * @param {(correct: boolean) => number | null} [opts.autoAdvanceMs=null] 反馈后自动切题延时；null=手动
 * @param {boolean} [opts.speakOnAnswer=false] 反馈后朗读正确答案
 * @param {boolean} [opts.speakListenOnNewItem=false] 进入听写题自动播发音
 * @param {boolean} [opts.enterToNext=true] 反馈阶段 Enter → 下一题
 */
export function usePracticeSession({
  buildItems,
  minItems = 1,
  fsrsOnSpell = false,
  autoAdvanceMs = null,
  speakOnAnswer = false,
  speakListenOnNewItem = false,
  enterToNext = true,
  typedAttempt = null,
}) {
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("loading"); // loading | empty | ready | done
  const [loadError, setLoadError] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [stats, setStats] = useState({ correct: 0, wrongList: [] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingResume, setPendingResume] = useState(() => loadPending(TYPED_PENDING_SCOPE));
  const submittedRef = useRef(false);
  const pendingRef = useRef(null);
  // 视图传入的函数可能每次渲染都是新引用：用 ref 保存最新值，效果只依赖状态
  const buildItemsRef = useRef(buildItems);
  buildItemsRef.current = buildItems;
  const autoAdvanceMsRef = useRef(autoAdvanceMs);
  autoAdvanceMsRef.current = autoAdvanceMs;
  const typedAttemptRef = useRef(typedAttempt);
  typedAttemptRef.current = typedAttempt;

  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(false);
    setFeedback(null);
    setIdx(0);
    setStats({ correct: 0, wrongList: [] });
    setSaving(false);
    setSaveError("");
    submittedRef.current = false;
    pendingRef.current = null;
    try {
      const list = await buildItemsRef.current();
      if (!list || list.length < minItems) {
        setItems([]);
        setPhase("empty");
        return;
      }
      setItems(list);
      setPhase("ready");
    } catch {
      setItems([]);
      setLoadError(true);
      setPhase("empty");
    }
  }, [minItems]);

  useEffect(() => {
    load();
  }, [load]);

  const item = items[idx] || null;
  const q = item?.q || null;
  const total = items.length;

  // 进入听写题自动播发音
  useEffect(() => {
    if (speakListenOnNewItem && phase === "ready" && item?.type === "listen" && q?.word) {
      speak(q.word, null);
    }
  }, [idx, phase, item?.type, q?.word, speakListenOnNewItem]);

  const advance = useCallback(() => {
    setFeedback(null);
    setSaving(false);
    setSaveError("");
    submittedRef.current = false;
    pendingRef.current = null;
    if (idx + 1 >= total) setPhase("done");
    else setIdx((i) => i + 1);
  }, [idx, total]);

  // 反馈后自动切题
  useEffect(() => {
    if (!feedback) return;
    const ms = autoAdvanceMsRef.current?.(feedback.correct);
    if (ms == null) return;
    const t = setTimeout(advance, ms);
    return () => clearTimeout(t);
  }, [feedback, advance]);

  // 反馈阶段 Enter → 下一题
  useEffect(() => {
    if (!enterToNext || !feedback) return;
    const handler = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enterToNext, feedback, advance]);

  /** 已确认保存后统一进入反馈与统计：只有 committed 的结果才会到这里。 */
  const applySaved = useCallback(
    (outcome, value, skipped = false) => {
      const correct = outcome.correct;
      if (correct) sfxSuccess();
      else sfxFail();
      if (speakOnAnswer && outcome.expected) speak(outcome.expected, null);
      setFeedback({
        correct,
        expected: outcome.expected,
        userInput: skipped ? null : value,
        skipped: !!skipped,
      });
      setStats((s) =>
        correct
          ? { ...s, correct: s.correct + 1 }
          : {
              ...s,
              wrongList: [
                ...s.wrongList,
                { item, userInput: skipped ? null : value, expected: outcome.expected },
              ],
            }
      );
    },
    [item, speakOnAnswer]
  );

  /** 输入题统一提交：发送前持久化 pending，同一 pending 重试不换标识。 */
  const sendTypedAttempt = useCallback(async (target, value, skipped, config) => {
    const key = `${config.source}:${target.type}:${target.q.card_id}`;
    let record = pendingRef.current;
    if (
      !record ||
      record.key !== key ||
      record.value !== value ||
      record.skipped !== skipped
    ) {
      record = {
        key,
        value,
        skipped,
        pending: makePending("/api/typing/check", {
          card_id: target.q.card_id,
          user_input: skipped ? "" : value,
          source: config.source,
          kind: "typed",
          assistance: config.assistance || [],
          skipped,
        }),
      };
      pendingRef.current = record;
      // storage 不可写时仍保留内存 pending，不换提交标识。
      savePending(TYPED_PENDING_SCOPE, record.pending);
    }
    setSaving(true);
    setSaveError("");
    try {
      const result = await sendPending(record.pending);
      clearPending(TYPED_PENDING_SCOPE);
      pendingRef.current = null;
      setPendingResume(null);
      return result;
    } catch (error) {
      setSaveError("请检查网络后重试");
      throw error;
    } finally {
      setSaving(false);
    }
  }, []);

  /** 提交答案：判分 + 记录 + 反馈 + 统计。网络错误抛出（调用方解锁/提示）。 */
  const submit = useCallback(
    async (value) => {
      if (!item || feedback || submittedRef.current || phase !== "ready") return;
      submittedRef.current = true;
      const config = typedAttemptRef.current?.(item) ?? null;
      try {
        let outcome;
        if (config) {
          const result = await sendTypedAttempt(item, value, false, config);
          outcome = { correct: result.correct, expected: result.expected };
        } else {
          outcome = await judgeAnswer(item, value, fsrsOnSpell);
          setSaveError("");
        }
        submittedRef.current = false;
        applySaved(outcome, value, false);
        return outcome;
      } catch (e) {
        submittedRef.current = false;
        throw e;
      }
    },
    [item, feedback, phase, fsrsOnSpell, sendTypedAttempt, applySaved]
  );

  /** 跳过：先完成视图提供的保存（若有），成功后才显示反馈；输入题保存 correct=null。 */
  const skip = useCallback(async () => {
    if (!item || feedback || phase !== "ready") return;
    if (typeof item.skip === "function") {
      await item.skip();
    } else {
      const config = typedAttemptRef.current?.(item) ?? null;
      if (config) {
        submittedRef.current = true;
        try {
          const result = await sendTypedAttempt(item, null, true, config);
          applySaved(
            { correct: result.correct, expected: result.expected },
            null,
            true
          );
        } catch {
          // 失败保留待确认请求，由页面的重试入口处理
        } finally {
          submittedRef.current = false;
        }
        return;
      }
    }
    sfxFail();
    const expected = q?.word || q?.answer || "";
    if (speakOnAnswer && expected) speak(expected, null);
    setFeedback({ correct: false, expected, userInput: null, skipped: true });
    setStats((s) => ({ ...s, wrongList: [...s.wrongList, { item, userInput: null, expected }] }));
  }, [item, feedback, phase, q, speakOnAnswer, sendTypedAttempt, applySaved]);

  /** 失败后重试原 pending，不换 submission_id。 */
  const retry = useCallback(async () => {
    const record = pendingRef.current;
    if (!record) return null;
    setSaving(true);
    setSaveError("");
    try {
      const result = await sendPending(record.pending);
      clearPending(TYPED_PENDING_SCOPE);
      pendingRef.current = null;
      setPendingResume(null);
      applySaved(
        { correct: result.correct, expected: result.expected },
        record.value,
        record.skipped
      );
      return result;
    } catch {
      setSaveError("请检查网络后重试");
      return null;
    } finally {
      setSaving(false);
    }
  }, [applySaved]);

  /** 刷新后继续确认上次未获得响应的提交。 */
  const resumePending = useCallback(async () => {
    const saved = loadPending(TYPED_PENDING_SCOPE);
    if (!saved) {
      setPendingResume(null);
      return null;
    }
    setSaving(true);
    setSaveError("");
    try {
      const result = await sendPending(saved);
      clearPending(TYPED_PENDING_SCOPE);
      setPendingResume(null);
      return result;
    } catch {
      setSaveError("请检查网络后重试");
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  /** 手动下一题（反馈阶段按钮；done 判定在 advance 内）。 */
  const next = useCallback(() => {
    if (phase !== "ready") return;
    advance();
  }, [phase, advance]);

  /** 再来一轮：重新装配。 */
  const replay = useCallback(() => {
    load();
  }, [load]);

  return {
    phase,
    loadError,
    idx,
    item,
    q,
    total,
    feedback,
    stats, // { correct, wrongList }
    saving,
    saveError,
    pendingResume,
    submit,
    skip,
    next,
    retry,
    resumePending,
    replay,
  };
}
