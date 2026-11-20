import React from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useAiConfig } from "../hooks/useAiConfig.js";

export default function HomeStarter({ onStart, loading, error, onNavigate }) {
  const { config, error: configError, reload } = useAiConfig();

  return (
    <div className="home-welcome">
      <h2>欢迎来到 EnglishCoach</h2>
      <div className="home-welcome-actions">
        <button className="btn home-primary" onClick={onStart} disabled={loading}>
          {loading ? "正在添加…" : "体验入门词卡"}<CaretRightIcon aria-hidden="true" />
        </button>
        <button className="btn home-on-dark" onClick={() => onNavigate("add")}
          aria-describedby={config?.has_key ? undefined : "home-ai-config"}>
          先加几个词
        </button>
        <button className="home-text-link home-on-dark" onClick={() => onNavigate("backup")}>恢复备份</button>
      </div>
      {error && <p role="alert">添加失败：{error}，请重试</p>}
      {!config?.has_key && <div className="home-ai-config-actions">
        <p id="home-ai-config" role={configError ? "alert" : "status"}>
          {configError ? "暂时无法确认 AI 配置。" : config ? "自定义加词需要配置 AI 服务。" : "正在读取 AI 配置…"}
        </p>
        {configError && <button className="home-text-link home-on-dark" onClick={reload}>重试读取 AI 配置</button>}
        <button className="home-text-link home-on-dark" onClick={() => onNavigate("settings")}>去设置</button>
      </div>}
    </div>
  );
}
