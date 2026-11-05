import {useEffect, useState} from "react";
import {recordContact} from "../lib/contacts.js";

// 持久轮次恢复后同样按实际可见性确认答案接触；失败标记由 contacts 保留。
export function usePracticeAnswerContact(item, enabled, source) {
  const [node, setNode] = useState(null);
  const cardId = item?.card_id;
  const identity = item?.revision?.identity;
  const version = item?.revision?.version;
  useEffect(() => {
    if (!enabled || !node || !cardId || !identity || !version || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      recordContact({cardId, revision: {identity, version}, source, kind: "answer_visible"}).catch(() => {});
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, cardId, identity, version, source]);
  return setNode;
}
