# P2 导航架构与练习流一致性优化验证（2026-11-19）

- **规格来源**：会话内用户提交的「二、P2 导航架构与练习流一致性优化」清单及已确认的四项设计/测试边界决策（A1–A4）。
- **远端基线**：`origin/dev` = `826a3b227f06b73b8a9613000febeabc5361926d`（已合入 PR #92 P1 修复基线）。
- **隔离交付工作区**：`.worktrees/fix-p2-nav-practice`，分支 `fix/p2-nav-and-practice-consistency`；主工作区原有的未提交文档（`README.md`、`docs/README.md`、`docs/development-guide.md`、`docs/learning-guide.md`、`docs/research/2026-11-05-echo-implementation.md`）保持原样未触碰。
- **冻结实现 HEAD**：`71369ae5126e4bd2705d8f8128b2a7608edab3e2`（验后文档记录单独提交，不改源码与静态产物）。
- **用户确认的设计与测试边界（Seams）**：
  - Hash 路由格式（`#/`、`#/words/:id`、`#/lessons/:level`、`#/lessons/:level/check`、`#/stories/:id`、`#/stories/starter`、`#/spelling/:id`、`#/delayed/day|week`、`#/advice?from=stats` 等）+ `pushState`/`replaceState`/`popstate`/`hashchange`，零后端路由改动。
  - `MixedPage` 答错与跳过取消自动跳题定时器（改为手动点击「下一题 →」或按 `Enter`），答对保留 `900ms` 自动推进。
  - `node:test` 纯路由模块边界（`frontend/src/lib/router.test.mjs`）+ `Playwright` 双视口（`mobile` 420×880、`desktop` 1280×720）用户可观察行为/历史栈/网络计数/布局边界（`e2e/p2-nav-practice.spec.mjs` 及受影响套件）。

## 切片、红绿证据与双向审查（Standards + Spec）

| 切片与提交 | 覆盖的 P2 规格项 | 观察到的 Red → Green | 双向 Code Review 结论 |
| --- | --- | --- | --- |
| Slice 1 `2e21cb5` | 新增 `router.js`、`useAppRoute.js`、`useRouteDetail.js`，全站一级视图与二级详情（`WordsPage` 词卡详情、`LessonsPage` 课程详情/短测、`StoriesPage` 故事阅读/读前准备、`SpellingPage` 单卡测验）同步 URL Hash 与 `popstate`，支持刷新留驻、侧滑/浏览器后退前进、失效深链回退与备份恢复期间锁定 | `router.js` 模块缺失、详情打开后 `hash === ""` 且刷新回首页 → 纯路由测试 4/4 通过，词卡/课程/故事刷新留驻与后退前进零重复详情请求、删除词卡不留重复栈项、恢复备份中途屏蔽 `popstate`（Node 44 passed，Playwright 4 passed） | 初审指出 `WordDetail` 卸载守卫、详情选择请求令牌抽取、单卡拼写清理与备份恢复清理 `ec.practice.active`；抽取 `useRouteDetail` 修复复审后 Standards 0 问题、Spec 0 问题 |
| Slice 2 `21586a1` | 记录首页（`queue`）与统计页（`stats`）进入 `advice`/`delayed` 的来源路径并在返回（含刷新后）回到原入口；移动端（`<=1023px`）故事列表与阅读页恢复 `.topbar`（课程/学习记录/设置可达）；底栏统一为「今天」；`VIEW_LABELS` 补齐 `scene: "场景练习"`；侧栏课程改用 `GraduationCapIcon` 与故事区分；移除 `LessonsPage` 根列表与 `StatsPage` 根视图多余 `← 返回` | 首页进回测点返回跳 `#/stats`、移动端故事页 `.topbar` `display: none`、底栏仍为「队列」、`scene` 顶栏空白、一级页含 `← 返回` → 来源返回与刷新持久一致、移动故事页顶栏可见无纵向溢出、文案图标对齐且一级根视图无多余返回（Playwright 8 passed） | 初审指出清理 `LessonsPage` 残留未用 `onExit`、回退 `StoryNavigation.jsx` 无效改动及限定桌面 `@media (min-width: 1024px)` 隐藏顶栏；修复复审后 Standards 0 问题、Spec 0 问题 |
| Slice 3 `afbeee1` | `SpellingBoard.jsx` 默认变体支持 `formId` 表单绑定；`DailySessionPage.jsx`（本轮巩固）、`QuizPage.jsx`（`cn2en`/`fill` 输入题）、`MixedPage.jsx`（`spell` 拼写题）在 `.practice-actions` 补齐显式「提交答案 `Enter`」按钮；同步 `ec-14` 刷新后留驻 `#/study` 步骤 | 三处 `.practice-actions` 均找不到「提交答案」按钮 → 输入失焦（模拟手机收起软键盘）后点击「提交答案」均完成服务端保存确认，空输入点击不误提交，输入法组词态受保护（Playwright Slice 1–3 + 拼写/测验/混合/巩固共 122 passed） | Standards 0 阻塞问题、Spec 0 问题（一次通过） |
| Slice 4 `71369ae` | `DailySessionPage.jsx` 巩固页将 `← 退出 / 先到这里` 归入 `.page-head`、`提示首字母` 归入 `.spelling-difficulty`、`提交答案 / 跳过本轮巩固` 归入 `.practice-actions`；`MixedPage.jsx` 答错与跳过取消 1.5s 自动跳题（保留答对 `900ms`），并为 `MixedPage`、`LearningAdvice`、`DurationRecovery` 所有原生灰按钮补齐 `.btn`；`ScenePage.jsx` 输入框支持 `Enter` 提交（含 IME 保护）、卡片按钮改为 `开始 / 继续`、`Standard` 跨展示与多次朗读复用单次 `/api/cards` 请求 | `.page-head` 无退出/暂停按钮、`DurationRecovery` 按钮 `class=""`、场景卡片按钮仍为标题 → 巩固按钮宽度紧凑无 100% 堆叠，混合错题/跳过 2s 后不跳题而答对 1s 内自动完成，场景展示+多次朗读跨轮仅发 1 次 `GET /api/cards` 且按钮切换 `开始`→`继续`（Playwright 16 passed + 场景/混合/巩固回归 158 passed） | 初审指出 `el-05.spec.mjs:197` 与 `verified-css.spec.mjs:67` 旧定位受混合错题暂停和场景按钮改名影响，以及 `ScenePage` 放弃待确认重置 `composing`；修复重跑 42 passed 并复审后 Standards 0 问题、Spec 0 问题 |

## 门禁检查结果（基于冻结实现 `71369ae5`）

| 检查类别 | 实际执行命令 | 结果 |
| --- | --- | --- |
| 基线与守护自测 | `../../.venv/bin/python -m unittest discover -s scripts/tests -p test_agent_check.py` | **通过**（10 tests，exit 0） |
| 远端基线祖先、空白检查与改动 Python Ruff lint/format | `../../.venv/bin/python scripts/agent_check.py --base dev --lint` | **通过**（`origin/dev=826a3b2`，`HEAD=71369ae`，exit 0） |
| Python 类型检查 | `pyright --pythonpath ../../.venv/bin/python tests/test_frontend.py scripts/agent_check.py` | **通过**（0 errors, 0 warnings，exit 0） |
| 前端路由与构建脚本单元测试 | `npm --prefix frontend test` | **通过**（44/44 pass，exit 0） |
| 前端生产构建与产物指纹校验 | `npm --prefix frontend run build` | **通过**（产出 `index-BESG17Jb.js`、`index-BnuPF7ZZ.css` 与一致 `ec-source-sha256`，exit 0） |
| 后端静态资源同步、会话网关与 V3 全量备份恢复测试 | `PYTHONPATH="$(pwd)" ../../.venv/bin/python -m pytest tests/test_frontend.py tests/test_gateway.py tests/test_full_restore.py -q` | **通过**（94 passed，exit 0） |
| 双视口浏览器与真实后端集成测试（P2 全量 + 受影响回归） | `EC_PYTHON="$(pwd)/../../.venv/bin/python" EC_STATIC_DIR="$(pwd)/app/static" EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-p2-final-pw EC_REPORT_PATH=/tmp/ec-p2-final-pw.json node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/p2-nav-practice.spec.mjs e2e/p1-defects.spec.mjs e2e/story-theme.spec.mjs e2e/reader-design.spec.mjs e2e/home-workspace.spec.mjs e2e/verified-css.spec.mjs e2e/qwerty-spelling.spec.mjs e2e/session-login.spec.mjs e2e/el-05.spec.mjs e2e/el-10.spec.mjs e2e/ec-05.spec.mjs e2e/ec-07.spec.mjs e2e/ec-14.spec.mjs e2e/el-14.spec.mjs`（另在切片验证中覆盖 `full-design`、`ec-06`、`el-13`、`el-15`、`el-16`） | **通过**（最终冻结门禁 230 passed，mobile + desktop 双视口，exit 0） |
| 数据库迁移与 seed | `N/A`（本轮纯前端导航、样式与练习交互改动，无数据库模型、Alembic 迁移或备份格式变更；`ECEnv` 已在上述 pytest/Playwright 中执行常规建库与种子） | `N/A` |
| Docker Compose 验证 | `N/A`（仓库未配置 `docker-compose.yml` / `compose.yaml`） | `N/A` |
| 独立 SAST / 依赖漏洞扫描 / 变异测试 | `N/A`（仓库 `package.json` 与 `.github/workflows/` 未配置对应扫描或变异测试工具；已核对 `git diff origin/dev...HEAD` 无密钥、生产数据或未跟踪脏文件） | `N/A` |
| 未过滤全量发行级 E2E（`npm --prefix frontend run test:e2e`）与跨版本回滚演练 | **未验证**（本轮按要求仅运行新增 P2 测试与受影响模块回归，未跑全量无过滤发行套件） | **未验证**（风险：未运行的少量历史只读/预算边缘规格若同样假定 `page.reload()` 强制跳回首页，合入全量发行验收时需按新的 URL Hash 留驻语义核对；此外 `origin/dev` 既有提交 `0e2b4c9` 在 `app/services/practice.py` 收紧首答幂等后原有的 `el-08`/`el-09` 跳过重答旧断言不在本前端票范围内） |

## 回滚与兼容路径

- 本轮无任何后端 API 契约、数据库表结构、`localStorage` 持久化格式或备份恢复格式变更；4 个切片提交（`2e21cb5`、`21586a1`、`afbeee1`、`71369ae`）均可按单切片或整分支通过 `git revert` 安全回退并重新执行 `npm --prefix frontend run build`。
- Hash 路由对无 `#` 的根路径 `/` 保持完全兼容（自动识别为首页 `queue`），未知或已删除的二级详情深链自动平滑回退到对应一级列表或首页。
