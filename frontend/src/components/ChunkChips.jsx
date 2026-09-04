import React from "react";
import { roleLabel } from "../lib/utils.js";

/**
 * 意群切分渲染（点块朗读/角色配色）—— 学习卡与单词详情共用。
 * chunks 兼容 [{text, role}] 与纯字符串数组；无有效切分时返回 null。
 */
export default function ChunkChips({ chunks = [], onSpeak, style }) {
  const list = (Array.isArray(chunks) ? chunks : [])
    .map((ch) => (typeof ch === "string" ? { text: ch, role: null } : ch))
    .filter((ch) => ch?.text);
  if (list.length <= 1) return null;
  return (
    <div className="front-chunks" style={style}>
      {list.map((ch, i) => (
        <span
          key={i}
          className={`chunk ${ch.role ? `role-${ch.role}` : `chip-${i % 3}`}`}
          title={`${roleLabel(ch.role)} · 点击朗读`}
          onClick={(e) => {
            e.stopPropagation();
            onSpeak(ch.text);
          }}
        >
          {ch.text}
        </span>
      ))}
    </div>
  );
}
