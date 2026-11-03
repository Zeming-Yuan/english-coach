# Story Family Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将第三张已确认词条图的故事页视觉迁移到全部现有页面，保留真实学习行为。

**Architecture:** 沿用现有 React/FastAPI 应用，在公共主题中共享故事页 token、控件和响应式规则。词条详情调整为内容与证据两列，其余页面按既有功能组织；不新增路由、后端或伪造数据。

**Tech Stack:** React 19、Vite、现有 CSS、Phosphor、Tinos、Playwright、真实隔离 SQLite。

**Spec:** `docs/design/page-by-page-2026-11-02/story-visual-baseline.md`。选定图：同目录 `word-detail-story-style-v2.png`；用户已确认第三张且其他页面同样处理。

## Global Constraints

- 内容 `#FCFAF6`，导航 `#F1EEE8`，文字/主按钮 `#302E2B`，次要文字 `#736C63`，线条 `#E5DFD5`，陶土 `#A26243`。
- 中文无衬线，英文学习内容 Tinos；陶土色只作少量强调，主按钮炭黑。
- 使用真实数据，缺少的词典定义、图片、统计不从设计图编造。
- 保留接触确认、独立/辅助证据、保存失败重试、备份替换确认和专注练习。
- 在现有含未提交工作的 dev 工作区继续，只修改本轮涉及的前端；不自动提交、发布或推送。

## Review Focus

- 长单词、句子卡、长翻译不得撑破列宽；窄屏证据移至内容后。
- 重排详情不能丢失接触失败重试、评分失败重试或编辑/删除操作。
- 练习上下文里的导航保持专注模式；底部操作不能被视口裁切。
- 深色模式不能残留浅底与浅字；成功/错误状态仍可区分。
- 设置/备份长内容与文件输入在手机上可用，不水平溢出。

## Task 1: 词条页与公共外壳

**Files:** `frontend/src/views/WordsPage.jsx`、`frontend/src/components/AppNavigation.jsx`、`frontend/src/styles/product-theme.css`、`e2e/story-theme.spec.mjs`。

**Interfaces:** 消费现有卡片 API 与 `LearningEvidence({evidence})`；产出语义区域「词条内容」「学习状态与记录」。API 和回调不变。

- [x] 第一条失败测试：在真实隔离应用打开 apple，桌面上「学习状态与记录」位于「词条内容」右侧；窄屏在下方；编辑释义后仍读到保存结果。
- [x] 验证失败：`EC_STATIC_DIR=/tmp/ec-story-theme-static node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/story-theme.spec.mjs --grep 'word detail'`。预期因旧页面没有这两个语义区域而失败。
- [x] 最小实现：保留函数、请求、条件与处理器；只重组 JSX，将释义/例句/记忆法放主列，证据/排期/记录放辅列；主测试按钮与编辑移动到上方。移除外包卡片，匹配选定图暖白表面。
- [x] 文档同步：记录缺少字典双释义/记录时的真实空态，不补设计示例。
- [x] 独立提交边界：词条与导航主题（本轮留工作区，不自动提交）。回滚仅恢复本轮 JSX 结构和对应主题差异，不回退数据。

## Task 2: 全站页面与状态的视觉统一

**Files:** `frontend/src/styles/product-theme.css`、`frontend/src/App.jsx`、各 view 中有硬编码旧颜色/图标的展示节点。

**Interfaces:** 消费 Task 1 公共 token；页面路由、表单状态、学习请求不变。

- [x] 首个失败入口：浏览器捕获首页、课程、添加、统计、设置、备份及全部练习，检查旧色/渐变/大卡片与目标的差异；截图作为本任务视觉失败证据，不为 CSS 常量新增镜像单测。
- [x] 最小实现：统一标题、页面边距、行分组、输入、状态反馈和主按钮；首页突出本轮行动，学习建议与附加练习分组；课程和词库使用清晰列表；设置/备份分节；专注练习使用暖白纸面。
- [x] 验证：上面的 Playwright 命令加 `e2e/full-design.spec.mjs e2e/reader-design.spec.mjs`，并运行真实数据页面巡检，保存桌面与手机截图及计算样式。
- [x] 文档同步：逐页验收矩阵；不修改领域 ADR，因为领域行为不变。
- [x] 独立提交边界：公共主题与页面展示。回滚主题/展示差异即可，保留所有学习记录。

## Task 3: 浏览器核对与交付

**Files:** `docs/design/story-family-implementation/`、`design-qa.md`。

**Interfaces:** 消费已选择设计图和 Task 1/2 的浏览器截图；产出逐页截图、对照图、验证记录与可运行预览。

- [x] 第一失败门槛：选定图与同尺寸词条截图并排，任何 P0/P1/P2 差异都阻止完成声明。
- [x] 最小修订：只修复实际可见差异和交互回归，再截图复查。
- [x] 验证：`node --test frontend/src/lib/*.test.mjs`；临时目录 Vite build；相关 Playwright 在桌面/手机通过；所有页面没有非预期控制台错误或水平溢出。
- [x] 文档同步：`design-qa.md` 记录字体、间距、颜色、图片、真实文案差异及未覆盖项。
- [x] 独立提交边界：视觉验收证据；不发布外部服务。恢复预览只需重新构建，不触及用户数据库。

实际结果与环境见 `docs/design/story-family-implementation/verification.json`。构建和 38 项浏览器验收通过；独立审查的长词问题已按失败→修复→通过验证。当前修改留工作区，未自动提交。
