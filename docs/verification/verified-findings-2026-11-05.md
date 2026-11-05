# 核实清单修复记录（2026-11-05）

## 范围与基线

用户本会话提供的「CSS 7 条核实结果」及随后列出的构建、配置、迁移、测试基础设施问题为本轮规格。只实施已确认部分，不推断未提供的其余条目，不开展全仓审计。

- 会话起始 HEAD：`243f0c3358c220d9f9cf5169af1796cd4981782b`。
- 项目要求先同步目标分支，实际实现/审查基线：`685fb3f16840a553f10f42e22f42e7d87b08fda9`。
- 隔离分支：`codex/verified-fixes`。原 checkout 的 README.md、docs/README.md 以及三个未跟踪文档不属于本轮。
- 本轮只提交自己的改动；不更新外部 tracker，不 push、不创建 PR、不合并远端、不部署。
- 用户已确认测试 seam：浏览器可见行为；工具实际进程/退出码；Alembic upgrade 与 ECEnv API；normalizedBackup 导出函数。

## 执行切片与验收

按下面顺序串行执行，每项行为先写一条测试，观察红，再做最小修复、观察绿。

1. 工具配置：fresh clone 的 clean 不因缺目录失败；Vite 首页、模块与 HMR 留在开发服务器，后端静态图片、CSS/图标仍可访问。显式启用 Ruff B；Git 忽略环境变体、数据库备份及 WAL/SHM。
2. 迁移：两张 DDL 表已存在的失败重试仍捕获缺失基线；按源指纹幂等；已有现代事件的卡不伪造旧基线；保留已有事件/审计。contract 遇到非法 last_review 在任何写入前报出可操作错误。
3. 备份比较：拒绝核心集合坏形状、父集合重复 ID 和悬空引用；大集合不通过函数参数展开替换；保留审计 raw 与事件次序。
4. E2E 生命周期：spawn、seed、snapshot 和 dispose 失败均回收资源；一个实例关闭失败不打断其余清理；旧脚本失败返回非零，不运行其真实付费 AI 路径。
5. ECEnv：毕业后台升级使用所属测试库，通过 API 观察异步结果，不能漏到全局默认库。
6. CSS：在相关断点恢复预期列数；暗色对话与历史评分文字可读；场景保存反馈跨列并提供稳定重开位置；辅助拼写在减少动画时保持隐藏原生光标。首页记录和移动遮罩先以完整级联与当前 DOM 验证，成立才改。
7. 历史报告：标注 22 个标题与 failed=16 的统计不一致；缺少逐项状态时不猜改原始计数，不把历史失败改成通过。

不修改已被 product-theme 覆盖的练习视口高度；不修改已透明化的 explanation-box 等。rating 按钮已有产品主题覆盖，仍检查实际使用 rating 类的历史记录。

## 验证约束

使用仓库现有 pytest、Node test、Playwright 配置和 agent_check。浏览器验证沿用 source-ui 入口加载相关源码，不运行全应用构建。类型检查若不能限定范围则记录缺口。迁移仅在临时 SQLite 数据库验收，MySQL 的真实环境未提供。

本轮未运行全量测试和完整门禁。

## 执行证据

环境：Linux ARM64；Python 3.12；Node v24.21.0；Playwright 1.62.1；Ruff 0.17.3；Google Chrome for Testing 156.0.8078.4。使用项目现有配置与依赖，没有安装全局技能或修改全局配置。过程日志保存在 `/tmp/ec-verified-fixes/`（本机临时诊断，不提交）。

| 本轮改动 → 直接行为 | 实际验证命令 | 本轮结果与范围 |
| --- | --- | --- |
| 迁移重试/脏时间戳、后台数据库归属 → 迁移与学习提交 | `.venv/bin/python -m pytest tests/test_learning_events.py tests/test_memory_contract.py tests/test_ec_environment.py tests/test_graduation.py -q -k 'not e2e_runner_unknown_ticket_has_no_matches'` | 74 passed、1 deselected。涵盖迁移、幂等回放、当前记忆状态、毕业升级与环境隔离。被排除的未知票据测试会触发全应用构建；首次选择调整前的中断运行不作为通过证据。 |
| 新异步回归测试初始化调整 → 最终测试版本 | `.venv/bin/python -m pytest tests/test_ec_environment.py::test_graduation_background_writes_only_to_its_application_database -q` | 1 passed；观察真实后台升级后的 API 状态，不替换毕业实现。 |
| clean/Vite、备份比较器、E2E 生命周期与旧脚本 → 实际进程/导出函数 | `node --test frontend/tooling.test.mjs e2e/support/backup-comparison.test.mjs e2e/support/lifecycle.test.mjs e2e/support/legacy-scripts.test.mjs` | 初始快照 13 passed；复审修复后同命令 15 passed。含真实 HMR WebSocket 连接、16 万条事件、seed/snapshot/spawn/dispose 失败与批量清理；旧脚本只替换浏览器边界，不访问真实 AI/个人数据库。 |
| CSS/场景重开 → 浏览器布局、点击和减少动画行为 | `EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome EC_STATIC_DIR=$PWD/app/static EC_REPORT_PATH=/tmp/ec-verified-fixes/css-final.json EC_OUTPUT_DIR=/tmp/ec-verified-fixes/css-final-artifacts frontend/node_modules/.bin/playwright test --config e2e/playwright.config.mjs e2e/verified-css.spec.mjs` | 12 passed（desktop/mobile 项目）。通过 source-ui 加载当前源文件，与真实隔离服务器联通；未运行全应用构建。截图已读取检查，首页图片和阅读器使用完整应用结构。 |
| Ruff 配置与所有修改 Python → 静态规范、目标分支基线 | `.venv/bin/python scripts/agent_check.py --base dev --lint` | 本轮通过；目标与 HEAD 均为 `685fb3f`，7 个 Python 文件 lint/format 通过。另用 B006 样例与合法 Depends 样例核对选择规则和例外。 |
| 修改 Python → 类型边界 | `pyright --project pyrightconfig.json --pythonpath .venv/bin/python app/services/graduation.py app/services/learning.py alembic/versions/b1c2d3e4f502_add_learning_events.py alembic/versions/b1c2d3e4f503_unique_current_memory.py tests/test_ec_environment.py tests/test_learning_events.py tests/test_memory_contract.py` | 1 个已有错误：test_ec_environment.py 的 LabelledClient 与 LazyLLMClient 不兼容。将基线同文件另存至临时路径，用相同配置复测也只有同一错误；去掉该文件的其余 6 文件为 0 errors。未把此项报告为全通过。 |
| Git 忽略规则 → 环境与数据库临时文件不进入索引 | `git check-ignore --no-index .env.staging app.db.bak-20261105 app.db-wal app.db-shm` | 四项均命中；`.env.example` 保持可跟踪。 |

红绿日志：clean-red/tooling-green；baseline-red/baseline-green；contract-red/contract-green；backup-shape/ref/large/id-red 与 backup-green；lifecycle-seed/spawn/dispose/group-red 与 lifecycle-green；graduation-red/graduation-final；legacy-red/legacy-green；css-layout/scene/dialogue/caret-red 与 css-final。所有日志均在上述临时诊断目录。contract 的初次建数失败已纠正，记录的正式 red 来自目标迁移未进行类型检查。

## 与原核实结果不同的当前事实

- `home-record-strip p`：当前 App 的记录内容已经是 `.home-record-total` 按钮，暗色选择器已覆盖；浏览器对当前按钮的对比度验证通过，无需添加死选择器。
- 移动故事遮罩：`app/static/style.css:700` 已提供 `position:fixed; inset:0; z-index:90`；当前完整级联的矩形覆盖视口且点击能关闭面板。没有修改 story-reader.css。
- 练习高度：沿用用户确认的“过时”判断，不修改已被 product-theme 覆盖的高度。
- `.btn-rating` 在产品主题中已覆盖；本轮只修仍受亮色值影响的对话气泡和旧历史评分 1/2/3。
- `screenshot_demo.js` 的未捕获异常原本已产生非零退出码；通过实际子进程确认，不作无效修改。其余三个脚本的失败步骤、捕获异常及收集到的页面错误均设置退出码 1。
- 历史 broad-run-summary 保留原计数与标题，新增 `summary_validation` 明确标记不一致和不可作为验收证据。缺少原始逐项状态，未宣称恢复了正确历史计数。

## 未验证与限制

- 未运行全量测试、完整门禁和全应用构建。clean 与 Vite 的具体失败行为已分别验证；不据此声称完整生产构建通过。
- 真实 MySQL 的非事务 DDL 重试、Windows 原生进程清理未运行。SQLite 临时库模拟了两表已存在且基线仅部分写入的可观察重试状态。
- 类型检查保留上表已核实的基线错误，不扩大本轮治理范围。
- 没有新增架构决策，无需新建 ADR。没有引入新依赖或第三方材料。

## 固定范围审查

Standards 与 Spec 使用独立 reviewer（gpt-6.1-sol/high）上下文，基线固定为 `685fb3f16840a553f10f42e22f42e7d87b08fda9`。首审固定 tree：`f876cb50d1d378ec692baddca34a5a2710c0ad06`；命令 `git diff <base> <tree>`，此时尚无本轮提交。只审本轮差异；未运行全量测试、完整门禁、全应用构建。

- Standards 首审 1 项 P2：正常降级/重升时，现代 reviews 行被新增为 migration 基线。已强化原降级测试，复制真实 cards/reviews/events 并确认不新增基线；观察 red 后按卡排除已有现代事件的当前行，green。
- Spec 首审 2 项 P2：静态代理遗漏首页图片；其余核心集合非数组时绕过形状检查。分别补了真实 Vite 图片/样式/图标/index 请求和十个核心集合形状检查；观察 red 后修复，green。
- 复审修复后的限定验证：`.venv/bin/python -m pytest tests/test_learning_events.py tests/test_memory_contract.py -q -k 'baseline or downgrade or contract'` → **35 passed，16 deselected**。覆盖迁移补捕、重复升级、现代历史完整性与当前状态 contract；初始 74 项是修复前快照证据，未为无关行为重复整套运行。
- 更新后的 Node 限定命令（同上）→ **15 passed**。Vite 图片验证检查真实 PNG 文件头，CSS/图标内容类型、开发 index 与 HMR 均通过。
- 对改动的 migration/test 两文件复跑 Ruff check/format 和同配置 Pyright → **0 errors**。
- 另在两份临时 ECEnv 上真实完成 V3 导出→预览→完整恢复，再用当前 normalizedBackup 比较导出结果，相等；复审修复后再次比较也通过。只验证这一路径，没有运行完整 EL-21 浏览器旅程。

首轮修复固定 tree 为 `247f2665cf91b2d1ed0afe14bb5786c363be5261`。Standards 限定复审：原 P2 关闭，0 新问题；独立重跑补捕及降级/重升两项，2 passed。

Spec 限定复审关闭原两项，另发现显式 `/static/index.html`（含 query）仍落到后端。新增该入口回归，观察 404 的 red；将显式 index 也交给 Vite 后同文件 **3 passed**。仅此代理规则与对应测试再次变化，其他已通过范围未重复运行。最后固定代码 tree 为 `688339b9539d31741857a1fe0c65b269429521a0`；Standards 和 Spec 对这两个文件的限定复审均 **0 findings**。Spec 独立重跑该文件，3 passed。全部原 findings 已关闭；审查后仅回填本段审查元数据，产品代码与测试未再改变。

最终结论：本轮当前仍成立的代码问题已实现并完成限定验收。原始清单中未成立/已过时的部分按实际证据保留；历史计数仅标明不可作为验收证据，不能恢复没有逐项状态的原始统计。已知基线类型错误、真实 MySQL/Windows、全应用构建与全量门禁的缺口仍按上文记录。
