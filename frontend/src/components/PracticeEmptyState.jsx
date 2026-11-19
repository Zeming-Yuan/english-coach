import React from "react";

export default function PracticeEmptyState({ message, onAddWords, onExit }) {
  return (
    <div className="story-empty">
      <p>{message}</p>
      {onAddWords && (
        <button type="button" className="btn btn-primary btn-small" onClick={onAddWords}>
          去加词
        </button>
      )}
      {onExit && (
        <button type="button" className="btn btn-ghost btn-small" onClick={onExit}>
          返回
        </button>
      )}
    </div>
  );
}
