import React, { useRef, useState } from "react";

/**
 * 备份与恢复：下载完整 V2 备份；旧版备份先预览，确认后原子部分恢复。
 */

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

export default function BackupPage({ onBack }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [restoring, setRestoring] = useState(false);
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
    setRestoring(true);
    setError("");
    try {
      const result = await postJson("/api/import/cards", {
        backup: candidate.backup,
        expected_revision: candidate.preview.expected_revision,
      });
      setRestoreResult(result);
      setCandidate(null);
      setDone(false);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      if (e.status === 409) {
        try {
          const preview = await postJson(
            "/api/import/preview",
            candidate.backup,
          );
          setCandidate({ backup: candidate.backup, preview });
          setError("数据已有新变化，请核对影响范围后再次确认。");
        } catch (previewError) {
          setError("恢复失败：" + (previewError?.message || String(previewError)));
          setCandidate(null);
        }
      } else {
        setError("恢复失败：" + (e?.message || String(e)));
      }
    } finally {
      setRestoring(false);
    }
  };

  const cancelPreview = () => {
    setCandidate(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <section className="view view-center">
      <div className="settings-panel" style={{ position: "static", width: "100%", maxWidth: 460 }}>
        <div className="settings-panel-head">备份与恢复</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
          下载包含数据库全部学习内容的版本化 JSON 备份，可在换设备或故障后使用。
        </p>
        <button className="btn btn-primary" disabled={downloading} onClick={downloadBackup}>
          {downloading ? "正在准备备份…" : "下载完整备份"}
        </button>
        {done && <p role="status" style={{ fontSize: 13 }}>备份已下载：english-coach-backup.json</p>}

        <div style={{ marginTop: 22 }}>
          <label className="settings-label" htmlFor="backup-file">选择备份文件</label>
          <input
            ref={inputRef}
            id="backup-file"
            aria-label="选择备份文件"
            type="file"
            accept="application/json,.json"
            style={{ display: "block", marginTop: 6 }}
            disabled={restoring}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) previewFile(file);
            }}
          />
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            无版本号的旧版备份只会部分恢复其中包含的卡与关联；未包含的课程、故事和其他学习内容保持原样。
          </p>
        </div>

        {candidate && (
          <div style={{ marginTop: 14, padding: 12, background: "var(--card, #f5f7f6)", borderRadius: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>旧版部分恢复</p>
            <p style={{ fontSize: 13, margin: "6px 0" }}>
              将新增 {candidate.preview.impact.new_cards} 张卡，匹配已有 {candidate.preview.impact.matched_cards} 张；
              复习 {candidate.preview.impact.reviews} 条、记忆法 {candidate.preview.impact.memos} 条、错词 {candidate.preview.impact.errors} 条。
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              未包含的内容不会被清空。执行前会自动保存当前数据库的完整备份。
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={restoring} onClick={confirmRestore}>
                {restoring ? "正在恢复…" : "确认恢复包含的内容"}
              </button>
              <button className="btn btn-ghost" disabled={restoring} onClick={cancelPreview}>
                取消
              </button>
            </div>
          </div>
        )}

        {restoreResult && (
          <p role="status" style={{ fontSize: 13 }}>
            恢复完成：新增 {restoreResult.imported_words} 个词。恢复前备份保存在
            {" "}{restoreResult.safety_backup_path}
          </p>
        )}
        {error && <p role="alert" className="err">{error}</p>}

        <div style={{ marginTop: 20, fontSize: 13, lineHeight: 1.7 }}>
          <span className="settings-label">备份包含</span>
          <p style={{ margin: "4px 0 12px", color: "var(--muted)" }}>
            词卡全部字段、当前记忆状态、学习事件、迁移基线、记忆法、错词、困难词、课程、故事及关联。
          </p>
          <span className="settings-label">不包含</span>
          <p style={{ margin: "4px 0 12px", color: "var(--muted)" }}>
            API 密钥、环境配置、语音缓存，以及仅保存在浏览器中的外观与播放偏好。
          </p>
        </div>

        <button className="btn btn-ghost" onClick={onBack}>返回设置</button>
      </div>
    </section>
  );
}
