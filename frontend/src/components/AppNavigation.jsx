import React from "react";
import UiIcon from "./UiIcon.jsx";

const destinations = [["queue", "今天", "home"], ["lessons", "课程", "book"], ["words", "单词本", "words"], ["stories", "故事", "book"], ["stats", "学习记录", "stats"]];

export default function AppNavigation({view, onNavigate, disabled}) {
  return <aside className="workspace-sidebar">
    <div className="workspace-brand"><UiIcon name="book" weight="fill" size={32} /><span>EnglishCoach</span></div>
    <nav aria-label="主导航">
      {destinations.map(([key, label, icon]) => <button key={key} type="button" disabled={disabled} aria-current={view === key ? "page" : undefined} onClick={() => onNavigate(key)}><UiIcon name={icon} size={24} /><span>{label}</span></button>)}
    </nav>
    <div className="workspace-utilities">
      <button type="button" disabled={disabled} aria-current={view === "add" ? "page" : undefined} onClick={() => onNavigate("add")}><UiIcon name="plus" size={24} /><span>添加单词</span></button>
      <button className="workspace-settings" type="button" disabled={disabled} aria-current={view === "settings" || view === "backup" ? "page" : undefined} onClick={() => onNavigate("settings")}><UiIcon name="settings" size={24} /><span>设置与备份</span></button>
    </div>
  </aside>;
}
