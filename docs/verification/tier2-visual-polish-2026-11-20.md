# 第二档进阶视觉与交互打磨修复验证（2026-11-20）

- **规格来源**：前端视觉与样式走查报告「第二档：可选的进阶审美打磨」4 项修复要求（在已完成第一档的同一独立交付分支上递进完成）。
- **远端基线**：`origin/dev` = `a4499cffc1b43404214b46a4fa1aa266218e0b8b`。
- **隔离交付工作区**：`.worktrees/fix-tier1-visual-polish`，分支 `fix/tier1-visual-polish`；主工作区原有的未提交文档（`README.md`、`docs/README.md`、`docs/development-guide.md`、`docs/learning-guide.md`、`docs/research/2026-11-05-echo-implementation.md`）保持原样未触碰。
- **冻结实现 HEAD**：`a739ab3bcbc71ee7760399b5bc6ab28fb3473930`（第二档主实现 `52345670` + 审查收敛 `c5132f56` + `EL-01` 单次 `PUT` 拦截稳定化 `a739ab3b`；本验后证据文档单独提交，不改源码与静态产物）。
- **测试边界（Seams）**：FastAPI HTTP / 静态资源边界（`pytest`）、前端纯函数与存储/主题同步边界（`node:test`）、真实后端 + 生产静态产物双视口浏览器边界（`Playwright` `mobile` + `desktop`）。

## 切片、红绿证据与双向审查（Standards + Spec）

| 规格项 | 覆盖范围与关键改动 | 观察到的 Red → Green | 双向 Code Review 结论 |
| --- | --- | --- | --- |
| Tier 2.1 闪卡与选项卡片纸面层次 | `product-theme.css` 拉开浅色与深色模式下的 `--paper` 画布（`#f9f6f0` / `#22201e`）与 `--card` 纸面（`#ffffff` / `#2c2824`），为 `.card-face`、`.quiz-option`、`.listening-option`、`.btn-rating` 增加温润细边框与柔和纸张阴影层次，并补充 `--mint-ink` / `--sun-ink` 确保小字号标签在 `--paper` / `--nav-paper` / `--sun-soft` 上全部满足 WCAG AA（≥ `4.5:1`） | 闪卡 `.card-face` 与 `.app.product-app` 背景同为 `rgb(252, 250, 246)`、`boxShadow` 为 `none`；初版浅色 12px 标签对比度 `4.01:1 < 4.5` → 浅/深色卡片明度高于画布且具阴影层次，小字号对比度提升至 `5.84:1 ~ 7.00:1` | 初审指出 12px 标签在 `--nav-paper` / `--sun-soft` 上对比度低于 `4.5:1`；引入 `--mint-ink` / `--sun-ink`（保留品牌图形 `#a26243`）复审后 Standards 0 问题、Spec 0 问题 |
| Tier 2.2 学习记录页版式对齐与周趋势坐标轴 | `StatsPage.jsx` 与 `product-theme.css` 将「学习证据」与「练习指标」重构为等高并排双栏 `<dl className="stats-kv-list">` 键值面板（复用 `EVIDENCE_DEFAULTS`）；将「延迟保持」重构为全宽三栏窗口网格（`.retention-window`）；将「本周复习通过率」无数据态 `（暂无）` 从错误红 `var(--coral)` 修正为中性 `var(--muted)`，补齐零填充 `MM/DD` 周起点坐标轴、轨道柱与无排期记录提示 | `evidence-overview` 键值项计数 `0`、周坐标未零填充（`"8/17"`）、`this_week === null` 呈珊瑚红 → 桌面双栏顶边对齐误差 ≤ `2px`、三栏保持窗口齐平、8 个 `MM/DD` 坐标与空态说明在双视口完整通过 | 初审指出 `shortMonthDay` 应零填充 `MM/DD`、复用 `EVIDENCE_DEFAULTS` 并移除旧 `.metrics-panel` 死规则与 `!important`；修复复审后 Standards 0 问题、Spec 0 问题 |
| Tier 2.3 加词页桌面主副卡片分区 | `AddPage.jsx` 与 `product-theme.css` 拆分为桌面左右双栏（移动端单列自适应）：左侧 `.add-primary-panel` 承载 AI 生成词卡（唯一 `.btn-primary`、无障碍 `<label className="sr-only">`、复用 `parseInputWords` 并诚实提示 20 词截断上限），右侧 `.add-starter-panel` 承载零配置 10 张入门词卡（`.btn-ghost.add-starter-btn` 独立悬停表面） | `.add-primary-panel` 缺失、同列双 `.btn-primary` 抢重心 → 桌面主副卡片左右分区对齐、移动纵向堆叠无溢出、悬停表面清晰且计数提示与分词行为严格一致 | 初审指出 `.btn-ghost:hover` 覆盖 `.add-starter-btn`、计数提示文案与空白分词不一致及文本框缺 `<label>`；修复复审后 Standards 0 问题、Spec 0 问题 |
| Tier 2.4 词卡详情原位行内编辑替代原生 `prompt()` | `WordsPage.jsx` 抽离共享 `InlineDetailEditor`，将「编辑内容」（区分单词卡 `meaning` 与句子卡 `example_cn`）及「写个记忆法 / 编辑记忆法」改为原位行内表单，支持保存防重、失败保留草稿重试（不双倍递增修订）、重复点击工具栏不覆盖草稿、键盘 `:focus-visible` 焦点环，以及中文输入法组合态（`isComposing` / `229`）下 `Escape` / `Enter` 安全保护；同步更新 `el-01`、`reliability-frontend`、`story-theme` 用例 | 点击「编辑内容」触发原生 `dialog`（`dialogCount = 1`），初版 `outline: none` 遮蔽键盘焦点环 → 全程 `dialogCount = 0`，取消/保存/记忆法校验、键盘焦点环、输入法组合态 `Escape` 不误关及 `EL-01` 断网重放不双倍升版全部通过 | 初审指出中文输入法组合态 `Escape`/`Enter` 保护、`:focus-visible` 焦点环保留、重按按钮草稿保护及抽离通用 `.sr-only` / `InlineDetailEditor`；修复复审后 Standards 0 问题、Spec 0 问题 |

## 门禁检查结果（基于冻结实现 `a739ab3b`）

| 检查类别 | 实际执行命令 | 结果 |
| --- | --- | --- |
| 基线与守护自测 | `../../.venv/bin/python -m unittest discover -s scripts/tests -p test_agent_check.py` | **通过**（10 tests，exit 0） |
| 远端基线祖先、空白检查与改动 Python Ruff lint/format | `../../.venv/bin/python scripts/agent_check.py --base dev --lint` | **通过**（`origin/dev=a4499cf`，clean & formatted，exit 0） |
| Python 类型检查 | `pyright --pythonpath ../../.venv/bin/python tests/test_frontend.py scripts/agent_check.py` | **通过**（0 errors, 0 warnings，exit 0） |
| 前端单元与构建清理测试 | `npm --prefix frontend test` | **通过**（47/47 pass，exit 0） |
| 前端生产构建 | `npm --prefix frontend run build` | **通过**（产出 `index-BMb21Ix_.js`、`index-D5BS8da_.css` 与同步 `ec-source-sha256` 指纹，exit 0） |
| 后端静态产物同步校验 | `PYTHONPATH="$(pwd)" ../../.venv/bin/python -m pytest tests/test_frontend.py -q` | **通过**（4 passed，exit 0） |
| 双视口浏览器与真实后端集成回归套件 | `EC_PYTHON="$(pwd)/../../.venv/bin/python" EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1208/chrome-linux/chrome EC_STATIC_DIR="$(pwd)/app/static" node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/tier2-visual-polish.spec.mjs e2e/tier1-visual-polish.spec.mjs e2e/el-01.spec.mjs e2e/story-theme.spec.mjs e2e/reliability-frontend.spec.mjs e2e/ec-02.spec.mjs e2e/ec-09.spec.mjs e2e/el-03.spec.mjs e2e/verified-css.spec.mjs`（含 `p1-defects.spec.mjs`、`p2-nav-practice.spec.mjs`、`el-09` 关联巡检） | **通过**（核心 9 套双视口 **108/108 passed**；另 `p1-defects` / `p2-nav-practice` / `el-09` 中与本分支相关的 50 项全部通过；`el-09.spec.mjs:136` `skip then retry never replaces first sample` 为 `origin/dev` 基线 `PracticePage.jsx` 既有问题，本分支未触碰 `PracticePage.jsx`） |

## 回滚与兼容路径

- 第二档全部改动限于前端视图/样式、生产构建静态产物与端到端测试，未修改任何后端模型、路由或备份结构，可按提交粒度或整分支 `git revert` 安全回退。
- 词卡编辑继续复用既有 `PUT /api/cards/{id}` 与 `PUT /api/memos/{id}` 接口，保留内容修订幂等语义（ADR-0004）与记忆法不递增修订的不变量。
