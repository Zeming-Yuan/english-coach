# 第一档视觉与样式打磨修复验证（2026-11-20）

- **规格来源**：前端视觉与样式走查报告「第一档（一眼可见的粗糙 / 违和点）」5 项修复要求。
- **远端基线**：`origin/dev` = `a4499cffc1b43404214b46a4fa1aa266218e0b8b`。
- **隔离交付工作区**：`.worktrees/fix-tier1-visual-polish`，分支 `fix/tier1-visual-polish`；主工作区原有的未提交文档（`README.md`、`docs/README.md`、`docs/development-guide.md`、`docs/learning-guide.md`、`docs/research/2026-11-05-echo-implementation.md`）保持原样未触碰。
- **冻结实现 HEAD**：`7a44c4ae2a8f59c58bd67691eb406e47dd11b76f`（主实现 `1d86378a` + 审查收敛补丁 `7a44c4ae`；本验后证据文档单独提交，不改源码与静态产物）。
- **测试边界（Seams）**：FastAPI HTTP / 静态资源边界（`pytest`）、前端纯函数与存储/主题同步边界（`node:test`）、真实后端 + 生产静态产物双视口浏览器边界（`Playwright` `mobile` + `desktop`）。

## 切片、红绿证据与双向审查（Standards + Spec）

| 规格项 | 覆盖范围与关键改动 | 观察到的 Red → Green | 双向 Code Review 结论 |
| --- | --- | --- | --- |
| Tier 1.1 品牌与旧薄荷绿残留统一 | `app/static/favicon.svg` 替换为赤陶色 `#a26243` 圆角底块 + Phosphor `BookOpen`（`fill`）精确矢量路径；`SessionRoot.jsx` 与 `login.css` 将 `.login-brand` 切换为 `<UiIcon name="book" weight="fill" size={30} />` + `Tinos` 700 衬线字标，与工作台侧栏 `.workspace-brand` 一致 | `favicon.svg` 缺 `#a26243` / Phosphor 路径断言失败，`.login-brand img` 计数为 `1` → 静态响应与双视口登录页品牌图标、色值（`rgb(162, 98, 67)`）及 `Tinos` `700` 字重全部通过 | 初审建议 `favicon.svg` 直接内嵌 Phosphor `BookOpen` `fill` 原始路径以严格对齐设计规范；修复复审后 Standards 0 问题、Spec 0 问题 |
| Tier 1.2 故事库顶部生成控件间距 | `StoryGeneration.jsx` 与 `story-reader.css` 为同意复选框行、生成/入门材料按钮组及待确认恢复操作补齐弹性间距与换行对齐 | 复选框标签 `gap` 为 `0`、两按钮 `nonTouchingGap` 为 `0px` → 桌面与移动双视口控件间距均 ≥ `8px` 且无横向溢出 | 初审与复审均通过（Standards 0 问题、Spec 0 问题） |
| Tier 1.3 课程列表与详情页排版打磨 | `utils.js` 提取共享 `hasLessonLevelPrefix` / `formatLessonTitle` 供 `LessonsPage.jsx` 与 `App.jsx` 复用，消除 `第 1 课 · 第 1 课` 与重复 `.eyebrow`；`[data-testid="lesson-progress"]` 增加 `.lesson-status-bar` 双轴间距（`gap: 8px 24px`）；`dialogue.length === 0` 时隐藏空对话标题；`.lesson-actions` 仅保留「开始本课短测」一个 `.btn-primary`，「内容已看完」改为 `.btn-ghost`（保留精确可访问名称）并在已浏览及悬停态保持 `.lesson-viewed-done` 成功色，移除第三按钮孤立 `marginTop: 8` | 标题出现 `第 1 课 · 第 1 课`、移动端状态项换行间距 `6px < 8px`、悬停「内容已看完」时被 `.btn-ghost:hover`（`0,3,0`）覆盖回 `rgb(48, 46, 43)` → 去重、间距、单主按钮对齐及悬停态 `rgb(75, 113, 88)` 全部通过 | 初审指出 `.btn-ghost:hover` 特异性覆盖 `.lesson-viewed-done` 及课程标题辅助函数可与 `App.jsx` 复用；修复复审后 Standards 0 问题、Spec 0 问题 |
| Tier 1.4 统一四处拼写输入为底线打字机风格 | `SpellingBoard.jsx` 默认启用 `variant = "qwerty"` 与 `placeholder = "点击这里，直接输入"`，`qwerty-spelling.css` 将底线无框等宽输入面泛化至所有 `.qwerty-typing` 宿主，统一 `SpellingPage`、`DailySessionPage`（本轮巩固）、`QuizPage`（`cn2en` / `fill`）与 `MixedPage`（`spell`），保留独立/辅助回忆光标隐藏与防重保存语义 | 本轮巩固、测验拼写题与混合练习拼写题缺失 `.qwerty-typing-line` → 四处统一渲染 `0px` 文本框边框 + `1px` 底线，辅助模式隐藏原生插入符，既有 `qwerty-spelling.spec.mjs` 全绿 | 初审建议将 `variant="qwerty"` 与占位文案收拢为 `SpellingBoard` 默认值以消除调用点重复；修复复审后 Standards 0 问题、Spec 0 问题 |
| Tier 1.5 深色热力图单调亮度与登录前无闪烁同步 | `product-theme.css` 新增 `body.dark .product-app .cal-l0 ~ .cal-l3` 暖棕/赤陶递增色阶；新增 `frontend/src/lib/theme.js`，在 `main.jsx` 首帧渲染前同步执行 `applyPreAuthDarkMode()`，在 `SessionRoot.jsx` 与 `App.jsx` 使用 `useLayoutEffect` 同步 `body.dark`，并在 `LoginPage` 登录成功跳转前通过 `primeLoginDarkMode(username)` 按目标账号隔离预热 `ec.ui.dark` | 深色模式热力图 `l1 (0.599) > l2 (0.331)` 亮度倒置、多账号切换时浅色账号退出后深色账号登录加载态缺少 `body.dark` → `l0 < l1 < l2 < l3` 严格单调递增，首屏 `.session-loading`、`LoginPage` 及多账号切换均零闪烁且互不串色 | 初审指出被动 `useEffect` 首帧闪烁与共享浏览器多账号 `ec.ui.dark` 串色问题；修复复审后 Standards 0 问题、Spec 0 问题 |

## 门禁检查结果（基于冻结实现 `7a44c4ae`）

| 检查类别 | 实际执行命令 | 结果 |
| --- | --- | --- |
| 基线与守护自测 | `../../.venv/bin/python -m unittest discover -s scripts/tests -p test_agent_check.py` | **通过**（10 tests，exit 0） |
| 远端基线祖先、空白检查与改动 Python Ruff lint/format | `../../.venv/bin/python scripts/agent_check.py --base dev --lint` | **通过**（`origin/dev=a4499cf`，clean & formatted，exit 0） |
| Python 类型检查 | `pyright --pythonpath ../../.venv/bin/python tests/test_frontend.py scripts/agent_check.py` | **通过**（0 errors, 0 warnings，exit 0） |
| 前端单元与构建清理测试 | `npm --prefix frontend test` | **通过**（47/47 pass，含新增 `theme.test.mjs` 与 `utils.test.mjs` 用例，exit 0） |
| 前端生产构建 | `npm --prefix frontend run build` | **通过**（产出 `index-BqOsGJVS.js`、`index-Bsr1GKfc.css` 与同步 `ec-source-sha256` 指纹，exit 0） |
| 后端静态产物与网关会话测试 | `PYTHONPATH="$(pwd)" ../../.venv/bin/python -m pytest tests/test_frontend.py tests/test_gateway.py -q` | **通过**（14 passed，exit 0） |
| 双视口浏览器与真实后端集成回归套件 | `EC_PYTHON="$(pwd)/../../.venv/bin/python" EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1208/chrome-linux/chrome EC_STATIC_DIR="$(pwd)/app/static" EC_OUTPUT_DIR=/tmp/ec-tier1-final-pw EC_REPORT_PATH=/tmp/ec-tier1-final-pw.json node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/tier1-visual-polish.spec.mjs e2e/session-login.spec.mjs e2e/el-07.spec.mjs e2e/qwerty-spelling.spec.mjs e2e/verified-css.spec.mjs e2e/p1-defects.spec.mjs e2e/p2-nav-practice.spec.mjs` | **通过**（84 passed，mobile + desktop 双视口，exit 0） |
| 全仓基线额外巡检记录（与本分支无关的 `origin/dev` 既有失败） | 全量 `pytest -q` 与广域 Playwright 基线扫描（已在 `origin/dev` 核实非本分支改动引入，按 `docs/agents/development.md` 不混入无关产品修复） | 既有无关失败 2 处：① `tests/test_el21_integrated_learning_restore_qualification.py::test_el21_transfer_comparison_retains_event_and_contact_order`（内联备份夹具缺 `reviews: []`）；② `e2e/el-11.spec.mjs:252` `EL-11 deletion confirmation clears detail that arrived during saving`（`StoriesPage.jsx` 既有闭包问题，本分支未触碰该文件） |

## 回滚与兼容路径

- 本轮仅涉及前端视图/样式、`app/static/favicon.svg` 及构建产物，未引入任何数据库 Schema、API 契约或备份格式变更；可通过 `git revert` 按提交或整分支无损回退。
- `readPreAuthDarkMode` 同时兼容单用户 `darkMode`、多账号升级前 `ec.account.<user>:darkMode` 一致回退以及新 `ec.ui.dark` 标记；`LessonsPage`「内容已看完」保留原有精确可访问名称与提交恢复契约。
