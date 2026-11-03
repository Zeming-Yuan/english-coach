import React from "react";
import {BookOpenIcon} from "@phosphor-icons/react/dist/csr/BookOpen";
import {BookBookmarkIcon} from "@phosphor-icons/react/dist/csr/BookBookmark";
import {HouseIcon} from "@phosphor-icons/react/dist/csr/House";
import {ChartBarIcon} from "@phosphor-icons/react/dist/csr/ChartBar";
import {GearSixIcon} from "@phosphor-icons/react/dist/csr/GearSix";
import {PlusIcon} from "@phosphor-icons/react/dist/csr/Plus";

const destinations = [
  ["queue", "今天", HouseIcon],
  ["lessons", "课程", BookOpenIcon],
  ["words", "单词本", BookBookmarkIcon],
  ["stories", "故事", BookOpenIcon],
  ["stats", "学习记录", ChartBarIcon],
];

/** 阅读工作区专用导航；复用主应用的现有视图入口。 */
export default function StoryNavigation({onNavigate}) {
  return (
    <>
    <aside className="reader-navigation">
      <div className="reader-brand"><BookOpenIcon weight="fill" aria-hidden="true" /><span>EnglishCoach</span></div>
      <nav aria-label="学习导航">
        {destinations.map(([view, label, Icon]) => (
          <button key={view} type="button" aria-current={view === "stories" ? "page" : undefined}
            onClick={() => onNavigate(view)}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="reader-settings" type="button" onClick={() => onNavigate("settings")}>
        <GearSixIcon aria-hidden="true" /><span>设置与备份</span>
      </button>
    </aside>
    <nav className="reader-mobile-tabs" aria-label="学习导航">
      {[["queue", "今天", HouseIcon], ["words", "单词本", BookBookmarkIcon], ["stories", "故事", BookOpenIcon], ["add", "加词", PlusIcon]].map(([view, label, Icon]) => (
        <button key={view} type="button" aria-current={view === "stories" ? "page" : undefined} onClick={() => onNavigate(view)}><Icon aria-hidden="true" /><span>{label}</span></button>
      ))}
    </nav>
    </>
  );
}
