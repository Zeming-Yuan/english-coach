import React from "react";

/**
 * 回忆证据：只展示服务端从当前修订真实事件算出的摘要。
 * 不按复习次数推断百分比；旧历史或样本不足时明确说明原因。
 */

const REASON_TEXT = {
  insufficient: "至少需要两个不同学习日、相隔 24 小时以上的独立首答。",
  weak: "最近一次独立首答错误，当前回忆证据待巩固。",
  stale: "最近独立证据已超过 30 天，建议复测后再下结论。",
  history_incomplete: "升级前或旧修订的记录无法逐次还原，只作为历史，不证明当前内容。",
  verified: "当前修订已有跨学习日的独立回忆证据。",
};

function dateText(value) {
  return value ? new Date(value).toLocaleDateString() : "暂无";
}

export default function LearningEvidence({ evidence }) {
  if (!evidence) return null;
  const { recall, retention, application, revision } = evidence;
  const recallLabel = recall.label || evidence.progress_label || "独立证据不足";
  return (
    <div className="word-detail-status" data-testid="learning-evidence" role="status">
      <div className="status-item">
        <span className="status-label">独立回忆</span>
        <span className="status-value">{recallLabel}</span>
      </div>
      <div className="status-item">
        <span className="status-label">独立样本</span>
        <span className="status-value">
          {recall.count} 次 · 最近 {dateText(recall.last_verified_at)}
        </span>
      </div>
      <div className="status-item">
        <span className="status-label">延迟保持 / 实际应用</span>
        <span className="status-value">
          {retention.label || "独立证据不足"} / {application.label || "独立证据不足"}
        </span>
      </div>
      {(application.contexts || []).map(context => <div className="status-item" key={`${context.context}:${context.content_hash}`}>
        <span className="status-value">{context.title} · {context.rule_version}：{context.label}</span>
      </div>)}
      <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--muted)" }}>
        {REASON_TEXT[recall.status] || ""}
        {revision ? ` 当前修订：第 ${revision.version} 版。` : ""}
      </div>
    </div>
  );
}
