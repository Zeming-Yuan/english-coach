/**
 * 单个待确认学习提交的状态机（EC-04）。
 * 消费 EC-03 的 makePending/sendPending/savePending/loadPending/clearPending；
 * 只有服务端明确 committed 才进入 saved，失败保留同一提交标识等待重试。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  makePending,
  sendPending,
  savePending,
  loadPending,
  clearPending,
} from "../lib/learning.js";

const STORAGE_WARNING = "本次操作尚未确认保存；刷新后可能需要重新核对";
const RECOVERED_WARNING = "尚未确认保存；请继续确认保存或明确放弃";

export function useLearningAttempt(scope) {
  const pending = useRef(loadPending(scope));
  const busy = useRef(false);
  const mounted = useRef(true);
  const [state, setState] = useState(() =>
    pending.current
      ? { phase: "failed", result: null, error: RECOVERED_WARNING }
      : { phase: "idle", result: null, error: null },
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (target) => {
      if (!target || busy.current) throw new Error("提交不存在或正在保存");
      busy.current = true;
      const durable = savePending(scope, target);
      if (mounted.current) {
        setState({
          phase: "saving",
          result: null,
          error: durable ? null : STORAGE_WARNING,
        });
      }
      try {
        const result = await sendPending(target);
        if (result.committed !== true) throw new Error("尚未确认保存");
        if (mounted.current) setState({ phase: "saved", result, error: null });
        return result;
      } catch (error) {
        if (mounted.current) {
          const message = "尚未确认保存：" + (error?.message || error);
          setState({
            phase: "failed",
            result: null,
            error: durable
              ? message
              : STORAGE_WARNING + "（保存失败：" + (error?.message || error) + "）",
          });
        }
        throw error;
      } finally {
        busy.current = false;
      }
    },
    [scope],
  );

  const submit = useCallback(
    (path, payload) => {
      if (pending.current) {
        return Promise.reject(
          new Error("请先继续确认或明确放弃待确认提交"),
        );
      }
      pending.current = makePending(path, payload);
      return run(pending.current);
    },
    [run],
  );

  const retry = useCallback(() => run(pending.current), [run]);

  const clear = useCallback(() => {
    clearPending(scope);
    pending.current = null;
    if (mounted.current) setState({ phase: "idle", result: null, error: null });
  }, [scope]);

  return { ...state, submit, retry, clear };
}
