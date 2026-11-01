/**
 * 练习入口的应用内接触（EL-05）。
 *
 * 只在答案真正显示或语音真正开始播放后调用；失败不阻断作答，只提示接触依据不完整。
 */
import { showToast } from "../App.jsx";
import { recordContact } from "./contacts.js";

export function recordPracticeContact({cardId, revision, source, kind}) {
  if (!cardId || !revision) return;
  const attempt = () =>
    recordContact({cardId, revision, source, kind}).catch((error) => {
      const message = `接触依据不完整：${error?.message || error}`;
      if (error?.retryable === false) {
        showToast(message);
        return;
      }
      showToast(message, "重试", attempt);
    });
  attempt();
}
