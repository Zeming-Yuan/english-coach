import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// 防止浏览器翻译功能劫持页面 DOM（Chrome/Edge 翻译、沉浸式翻译都遵守 notranslate）
// 此前遇到过翻译插件克隆 DOM 导致 React 状态与页面显示脱节
document.documentElement.setAttribute("translate", "no");
document.documentElement.classList.add("notranslate");
document.body.classList.add("notranslate");

createRoot(document.getElementById("root")).render(<App />);
