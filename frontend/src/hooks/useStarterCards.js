import { useState } from "react";

/**
 * 入门词卡添加动作的共享状态：loading / error + 执行。
 * 成功后的跳转由调用方决定（首页进学习页，加词页进单词本）。
 */
export function useStarterCards(onAddStarter) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addStarter = async () => {
    setLoading(true);
    setError("");
    try {
      return await onAddStarter();
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, addStarter };
}
