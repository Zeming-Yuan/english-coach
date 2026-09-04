import React from "react";

/** 1-4 评分按钮（忘了/模糊/记得/太简单）—— 闪卡封面、点词面板、单词详情共用。 */
export default function RatingButtons({ onRate, disabled = false }) {
  return (
    <div className="rating-buttons">
      {[1, 2, 3, 4].map((r) => (
        <button
          key={r}
          className={`btn-rating rating-${r}`}
          disabled={disabled}
          onClick={() => onRate(r)}
        >
          {r}
          <span className="rating-label">
            {r === 1 ? "忘了" : r === 2 ? "模糊" : r === 3 ? "记得" : "太简单"}
          </span>
        </button>
      ))}
    </div>
  );
}
