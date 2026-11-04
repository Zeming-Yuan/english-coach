import React, { useRef, useState } from "react";
import "./backup-page.css";

/**
 * 备份与恢复：下载完整 V3 备份；备份先预览，确认后原子恢复。
 */

const COLLECTION_LABELS = {
  cards: "词卡", reviews: "当前记忆状态", learning_events: "学习事件",
  review_baselines: "迁移基线", memos: "记忆法", errors: "错词", hard_cards: "困难词",
  lessons: "课程", stories: "故事", story_words: "故事关联", content_revisions: "内容修订",
  story_versions: "故事版本", learning_contacts: "应用内接触", practice_durations: "主动用时",
  lesson_progress: "课程进度", practice_sessions: "练习轮次", practice_items: "练习题目",
  scene_attempts: "场景首答", scene_feedback: "场景表达反馈",
};

function formatDetail(detail, fallback) {
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        [item.collection, item.index, item.field, item.reason]
          .filter(Boolean)
          .join(" · "),
      )
      .join("；");
  }
  return typeof detail === "string" ? detail : fallback;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      formatDetail(data?.detail, `HTTP ${response.status}`),
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function BackupPage({ onBack, onRestored, restoring, onRestoringChange }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [restoreResult, setRestoreResult] = useState(null);
  const inputRef = useRef(null);

  const downloadBackup = async () => {
    setDownloading(true);
    setError("");
    setDone(false);
    try {
      const response = await fetch("/api/export/backup");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "english-coach-backup.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setDone(true);
    } catch (e) {
      setError("备份下载失败：" + (e?.message || String(e)));
    } finally {
      setDownloading(false);
    }
  };

  const previewFile = async (file) => {
    setError("");
    setRestoreResult(null);
    setCandidate(null);
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch (e) {
      setError("文件不是有效的 JSON：" + (e?.message || String(e)));
      return;
    }
    try {
      const preview = await postJson("/api/import/preview", backup);
      setCandidate({ backup, preview });
    } catch (e) {
      setError("文件校验失败：" + (e?.message || String(e)));
    }
  };

  const confirmRestore = async () => {
    if (!candidate || restoring) return;
    onRestoringChange(true);
    setError("");
    try {
      const result = await postJson("/api/import/cards", {
        backup: candidate.backup,
        expected_revision: candidate.preview.expected_revision,
      });
      if (!result || !["full_replace", "legacy_partial"].includes(result.mode)) {
        throw new Error("恢复响应无效");
      }
      setRestoreResult(result);
      onRestored?.();
      setCandidate(null);
      setDone(false);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      if (e.status === 409 || !e.status) {
        try {
          const preview = await postJson(
            "/api/import/preview",
            candidate.backup,
          );
          setCandidate({ backup: candidate.backup, preview });
          setError(e.status === 409
            ? "数据已有新变化，请核对影响范围后再次确认。"
            : "恢复尚未确认：已重新读取影响预览，请先核对当前数据，再决定是否替换。您可以取消并返回查看。");
        } catch (previewError) {
          setError("恢复尚未确认，重新预览失败：" + (previewError?.message || String(previewError)));
          setCandidate(null);
        }
      } else {
        setError("恢复失败：" + (e?.message || String(e)));
      }
    } finally {
      onRestoringChange(false);
    }
  };

  const cancelPreview = () => {
    setCandidate(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const full = candidate?.preview.mode === "full_replace";

  return (
    <section className="view view-center backup-view">
      <div className="settings-panel backup-panel">
        <h1 className="settings-panel-head">备份与恢复</h1>
        <p className="backup-intro">
          下载包含数据库全部学习内容的版本化 JSON 备份，可在换设备或故障后使用。
        </p>
        <button className="btn btn-primary backup-download" disabled={downloading} onClick={downloadBackup}>
          {downloading ? "正在准备备份…" : "下载完整备份"}
        </button>
        {done && <p role="status" className="backup-success">备份已下载：english-coach-backup.json</p>}

        <div className="backup-upload">
          <h2>从备份恢复</h2>
          <label className="settings-label" htmlFor="backup-file">选择备份文件</label>
          <input
            ref={inputRef}
            id="backup-file"
            aria-label="选择备份文件"
            type="file"
            accept="application/json,.json"
            className="backup-file"
            disabled={restoring}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) previewFile(file);
            }}
          />
          <p className="backup-hint">
            无版本号的旧版备份只会部分恢复其中包含的卡与关联；未包含的课程、故事和其他学习内容保持原样。
          </p>
        </div>

        {candidate && (
          <section className={`backup-preview ${full ? "backup-preview-full" : "backup-preview-partial"}`} aria-labelledby="restore-preview-title">
            <p className="backup-preview-kicker">核对恢复范围</p>
            <h2 id="restore-preview-title">{full ? "全量恢复" : "旧版部分恢复"}</h2>
            {full ? <>
              <p className="backup-summary">备份格式：V{candidate.preview.version ?? 2}。现有数据库学习内容将被备份替换。</p>
              <p className="backup-count-summary">备份包含 {candidate.preview.counts.cards} 张卡、{candidate.preview.counts.learning_events} 条学习事件；将替换现有 {candidate.preview.impact.replaced.cards} 张卡、{candidate.preview.impact.replaced.learning_events} 条学习事件。</p>
              {candidate.preview.extensions?.missing?.includes("content_revisions") && (
                <p role="alert" className="backup-warning">
                  此备份缺少内容修订：确认后将清空现有修订，并为恢复的词卡、课程和故事重新生成身份；旧修订不再适用。
                </p>
              )}
              <dl className="backup-counts">
                {Object.entries(candidate.preview.counts).map(([name, count]) => <div key={name}><dt>{COLLECTION_LABELS[name] || "其他学习记录"}</dt><dd>恢复 {count} 项，替换现有 {candidate.preview.impact.replaced[name]} 项</dd></div>)}
              </dl>
              {candidate.preview.counts.cards === 0 && <p role="alert">这是空备份：确认后全部学习内容将替换为 0 项。</p>}
            </> : <p className="backup-summary">
              备份格式：V{candidate.preview.version ?? 1}。将新增 {candidate.preview.impact.new_cards} 张卡，匹配已有 {candidate.preview.impact.matched_cards} 张；
              复习 {candidate.preview.impact.reviews} 条、记忆法 {candidate.preview.impact.memos} 条、错词 {candidate.preview.impact.errors} 条。
              旧版备份不包含内容修订；新增卡会建立新身份，未包含的内容不会被清空。
            </p>}
            {candidate.preview.extensions?.missing?.length > 0 && (
              <div role="note" className="backup-missing" data-testid="missing-backup-collections">
                <p>此备份未包含以下学习记录：{full ? "将按本次备份替换，缺失历史不会补造。" : "部分恢复保留未包含的现有记录，不补造缺失历史。"}</p>
                <ul>
                  {candidate.preview.extensions.missing.map(name => (
                    <li key={name}>
                      <span>{COLLECTION_LABELS[name] || "其他学习记录"}</span>
                      <span>{full ? `恢复 0 项，替换现有 ${candidate.preview.impact.replaced[name]} 项` : "保留现有记录"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="backup-compatibility">
              {candidate.preview.scene_history === "not_recorded" && <p role="note">此备份没有场景练习记录；不会补造语境应用证据。</p>}
              {candidate.preview.reading_check_history === "not_recorded" && <p role="note">此备份没有读后检查记录；旧故事仍可读，不补造阅读识别或独立提取成绩。</p>}
              {candidate.preview.targeted_history === "not_recorded" && <p role="note">此备份没有专项练习记录；建议仅从可用学习证据重新计算，不补造薄弱项或练习成绩。</p>}
              {candidate.preview.extensions?.missing?.includes("practice_durations") && <p role="note">此备份没有主动时长记录；{full ? "全量恢复会替换现有时长记录，恢复后使用默认估算，积累至少五条可靠同类记录后再校准。" : "部分恢复保留现有时长记录；没有可靠同类记录时使用默认估算。"}</p>}
              {candidate.preview.extensions?.missing?.includes("story_versions") && <p role="note">此备份没有故事版本与检查材料；旧故事仍可读，不补造题目或成绩。{full ? "已有故事版本与操作去重记录将按本次备份替换。" : "部分恢复保留已有故事版本与操作去重记录。"}</p>}
              {candidate.preview.retention_history === "not_recorded" && <p role="note">此备份没有延迟回测记录；旧接触依据不足时仅能普通练习，不会补造隔日或一周保持证据。</p>}
            </div>
            <p role="note" className="backup-safety">
              {full ? "备份未包含的现有学习内容将被删除。" : "未包含的内容不会被清空。"}执行前会自动保存当前数据库的完整备份。
            </p>
            <div className="backup-actions">
              <button className="btn btn-primary" disabled={restoring} onClick={confirmRestore}>
                {restoring ? "正在恢复…" : full ? "确认替换学习数据" : "确认恢复包含的内容"}
              </button>
              <button className="btn btn-ghost" disabled={restoring} onClick={cancelPreview}>
                取消
              </button>
            </div>
          </section>
        )}

        {restoreResult && (
          <p role="status" data-testid="release-journey" className="backup-success">
            {restoreResult.mode === "full_replace" ? "恢复成功" : "恢复完成"}：恢复 {restoreResult.imported_words} 张卡。恢复前备份保存在
            {" "}{restoreResult.safety_backup_path}
          </p>
        )}
        {error && <p role="alert" className="err">{error}</p>}

        <div className="backup-contents">
          <span className="settings-label">备份包含</span>
          <p>
            词卡全部字段、当前记忆状态、学习事件、迁移基线、记忆法、错词、困难词、课程、故事及关联。
          </p>
          <span className="settings-label">不包含</span>
          <p>
            API 密钥、环境配置、语音缓存，以及仅保存在浏览器中的外观与播放偏好。
          </p>
        </div>

        <button className="btn btn-ghost backup-back" disabled={restoring} onClick={onBack}>返回设置</button>
      </div>
    </section>
  );
}
