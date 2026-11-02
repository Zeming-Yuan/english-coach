# EL-09 实现与验收记录

日期：2026-11-02（Asia/Shanghai）。规格：[GitHub #45](https://github.com/Zeming-Yuan/english-coach/issues/45)。
基线：`2e6ff05dd30fe510f140236122155107c63efad4`（EL-08 已合入）。工作在既有 dev 分支，
只提交本票代码、测试和关联文档，不收录开始时已有的未跟踪 spec/plan/agent 文件。

## 行为与自动化证据对应

| 条件 | 证据 |
| --- | --- |
| 当前修订、完整记录、最多三题、到期/薄弱优先，无候选普通练习 | `test_el09_candidates_prioritize_weak_words_and_limit_three`、`test_el09_pending_or_missing_current_contact_never_creates_candidates`、E2E missing-history |
| 24/72 小时、7/14 天 UTC 边界与超窗提交 | `test_el09_utc_window_boundaries`、`test_el09_submit_after_window_moves_to_other` |
| 其他标签页接触/待确认接触重新分类 | `test_el09_disqualified_or_assisted_first_result_stays_frozen`、E2E another-tab |
| 同词/学习日/窗口首处理、辅助/跳过不补入分母 | `test_el09_first_processed_order_wins_across_tabs_at_same_time`、E2E assisted/skip |
| 一周有效成功、后续失败、保留成功时间 | `test_el09_independent_week_success_counts_and_schedules_once`、`test_el09_new_independent_failure_weakens_retention_but_keeps_success_date` |
| 不泄露英文、实际间隔、零/少样本说明 | E2E week-check/missing-history，成功路径统计截图 `retention-overview.png` |
| 同一输入只排期一次、失败回滚、重复确认、内容冲突/删除 | `test_el09_write_failure_retries_same_identity_once`、`test_el09_parallel_confirmations_schedule_once`、`test_el09_saved_replay_precedes_revision_conflict_and_new_attempt_is_stale`、E2E lost-response/commit-failure |
| V3 完成/未完成轮次、卡 ID 映射、原依据与恢复后继续 | `test_el09_v3_roundtrip_keeps_basis_and_first_result`、`test_el09_pending_session_roundtrip_can_continue_with_remapped_card`、E2E V3-restore |
| 恢复图校验拒绝伪造间隔/窗口/锚点或绕过较新接触，旧数据不补样本 | `test_el09_v3_rejects_fabricated_retention_without_writes`、`test_el09_v3_cannot_ignore_a_newer_confirmed_contact`、`test_el09_old_v3_without_delayed_fields_stays_readable` |
| 功能回退保留记录/排期/普通练习，关闭可见入口 | `test_el09_functional_rollback_preserves_evidence_and_normal_learning`、E2E functional-rollback |
| 新场景进入完整覆盖门禁、EL 定向拒绝未知/空匹配 | `e2e/spec-coverage.mjs` EL09 十三分支、`tests/test_release_coverage.py` EC-99/EL-99 |

最高 seam：浏览器 → React → FastAPI → 统一学习事务/FSRS → Alembic 隔离 SQLite。
历史准备可经模型/公开 HTTP；关键新作答走真实 UI。只替换外部 AI/TTS 与注入时钟。
本应用是单用户本地学习库；本票没有新增账户/角色/跨租户授权面，数据引用限于当前本地库。
写入仍由 `BEGIN IMMEDIATE` 串行，卡/轮次/题目/修订引用与首答在同一事务确认。

## 红绿记录

已观察到的目标红灯包括：delayed_check 尚未支持（422）、统计缺 retention、V3 不接受新增用途、
新失败仍显示 verified、同时间戳首处理次序错误、旧锚点绕过新接触仍获准、恢复找不到原轮次、
旧备份预览缺少回测说明、回退开关不存在；对应最小实现后运行相应节点。
浏览器红灯包括：缺少入口、失败刷新丢原答案、重分后仍显示“一周回测：通过”、无候选无法重查。
修复均保持原提交身份、真实输入与确认后推进，不重写统一评分模块。

## 验证范围与运行方式

从 requirements.txt、README、frontend/package.json、pyrightconfig.json 和既有 E2E 配置发现命令。
本轮遵照用户“只跑修改过的部分”要求：运行本票与受影响的证据读取、课程短测、备份/恢复、
安装迁移和覆盖校验测试；浏览器运行 EL-09 及受影响前置的定向入口。没有宣称完整父规格通过。
每次 E2E 都重新构建并在 `e2e/release-results/<run>/` 保留源码摘要、构建摘要、实际 JSON 结果、
失败 trace 和截图；目录按项目规则忽略。最终结果见本次交接消息及这些原始诊断。

- 类型检查：`pyright --pythonpath .venv/bin/python` 后接本票修改的 Python 文件。
- 静态检查：`.venv/bin/ruff check` 与 `.venv/bin/ruff format --check` 后接同一范围。
- 后端：`.venv/bin/python -m pytest` 后接本票及上述受影响测试文件，`-q`。
- 浏览器/新构建：`npm --prefix frontend run test:e2e -- --ticket EL-09`；前置按已实现 EL/EC 票定位。
- 生产目录构建：N/A，本轮使用 E2E 独立临时目录中的新 Vite 生产构建，不改写已跟踪发行产物。
- 全库 pytest/未过滤 E2E/完整发布门禁：未运行（用户要求定向），存在未涉及场景回归风险。
- 安全扫描/依赖审计：N/A，无依赖或锁文件变更；未作整站安全认证。
- Docker/发布/线上恢复：N/A，未部署。迁移、V3 安全副本/原子恢复由受影响自动化测试覆盖。
- 破坏性迁移回滚：N/A，扩展迁移不删除既有数据；显式拒绝 destructive downgrade。

## Code review

固定点到工作区的非空 diff 按本票文件审查。优先 reviewer（gpt-6.1-sol/high）因用量上限未执行；
随后两个隔离的默认子代理上下文继承本会话配置，实际返回了 Standards 与 Spec 报告。
工具没有返回继承模型的具体标识，因此不将其称为已验证使用某个具名模型。

首轮 Standards：两项（legacy 锚点在线/恢复不一致，legacy 错误误入独立证据）。
首轮 Spec：两项（恢复结果漏记实际答案接触，失败重试没有刷新待确认接触）。
每项均追加公开 HTTP 或真实浏览器回归，观察目标红灯后修正；表单和全局重试都覆盖，
已接受的响应丢失重放另列不变性场景。再运行受影响验证后进行第二轮分轴审查。
第二轮 Standards：原两项已解决，无新增可操作问题；审查者独立重跑两个 HTTP 回归通过。
第二轮 Spec：原两项已解决，无剩余重要问题；确认重试保留身份和答案，已接受结果保持不可变。

## 回退与解释决策

- 按单票在当前分支实现，共享服务与迁移串行编辑；只把两个只读审查轴并行派发。
- 复用 practice 扩展字段而非新建成绩表，避免复制首答正误或重复排期；V3 当票校验与映射。
- 首页推荐 chip 改用释义，避免为保留英文展示引入不必要的提前答案接触。
- 时间戳相同的事件用真实保存次序；V3 已有事件导出/恢复顺序保证该语义延续。
- 按产品回退方式使用配置隐藏入口，保留统计和备份适配，不用旧数据库覆盖新学习。

## 已取得的原始结果

- 首轮扩大后的后端定向回归：245 项中 244 通过，唯一失败为 EL-03 的无证据标签兼容断言。
  保留既有“独立证据不足”标签后重跑本票与 EL-03 受影响文件，不降低原断言。
- 本票九分支双视口 18/18：`e2e/release-results/ec-e2e-static-u2hrqZ/`。
- 前置双视口回归：EL-08 16/16（`ec-e2e-static-z6KBbY`），EL-03 8/8
  （`ec-e2e-static-nTsWiR`），EC-12 16/16（`ec-e2e-static-eHDksQ`）。
- 上述结果为兼容标签单行修正前的冻结源码。本票/EL-03 在修正后重新执行；最终
  `run.json` 状态、源码和产物摘要与 `playwright.json` 位于相应新诊断目录。
- Ruff check/format：本票 14 个 Python 文件通过；coverage self-test 的缺场景、缺视口、
  skipped/failed/timedOut/interrupted/blocked/flaky/partial-branch 均被拒绝。
- 本票核心新增/修改 Python 文件类型检查 0 错误。将范围扩展到 restore.py、server.py、
  test_release_coverage.py 后有 19 项既有类型错误；从 `2e6ff05` 提取原文件重验也是同样
  19 项（restore 的字典推断、server 的 os.sys、测试 stdout 可空）。随后以恢复行的局部字典注解、测试服务器标准 sys 引用及 stdout 非空断言三个局部修正消除，
  不更改恢复映射或评分行为；最终对完整受影响 Python 文件集合重跑类型检查。

## 推进时钟与冻结源码补验

- 推进时钟的两个公开 HTTP 回归先同时失败（发题依据与实际时间不一致）；统一发题时刻后
  发题通过、提交仍失败，继而将提交间隔改为真实学习事件保存时间后两个分支通过。
  测试为 `test_el09_advancing_clock_keeps_backup_gap_consistent[issued/submitted]`。
- 发题在写锁内只冻结一个时刻，保存前冻结最新锚点，评分事件写入后按其 `occurred_at`
  算间隔；不把本次事件当成自己的锚点，不向统一评分模块另加排期。
- `ec-e2e-static-iLfluC` 的 18 个场景通过，但整轮因共享工作区出现本票外的前端依赖修改，
  被源码摘要检查拒绝；**该轮整体不是通过**。外部修改保留且不纳入本票提交。
- 后续在仅包含基线 + 本票暂存 diff 的临时 Git 副本中执行最终 EL-09、EL-03、EL-08
  定向验证，避免共享工作区继续变化污染验收。采用原有依赖运行时，源码与提交 diff 可比对。


## 审查问题的红绿补证

- `test_el09_legacy_wrong_input_is_not_independent_retention_failure`：verified 被 legacy 错误改为 weak，红后修复。
- `test_el09_legacy_input_between_issue_and_submit_keeps_backup_restorable`：自己的 V3 导出预览 422，红后修复；
  同时按真实新 legacy 接触重分为其他间隔（3600 秒），不利用旧间隔制造保持成功。
- 浏览器 reopened-results：旧结果英文已经显示而没有新接触，红后补视口上报。
- 浏览器 pending-contact form/global：未到服务端的失败提交重试错误地形成一周样本（预期 0，实际 1），红后补发送前合并。
  accepted-replay 分支确认已接受结果不会被后续接触改写。

## 最终冻结快照验收

最终验证只包含基线与本票暂存文件；测试源码树为
`75a6e8db5e3b1f0825a7607ca73350456686f58a`，暂存补丁 SHA-256 为
`c6fed94d613e36c4efe808fcf952da110e6f7560e8392ca360c2879c30889ab4`。
验收后只补写本节与上文复审结果，不改已验证代码；提交前比对树差异。

- 后端：`.venv/bin/python -m pytest tests/test_el09_delayed_recall_check.py tests/test_el03_migrate_evidence_readers.py tests/test_el08_lesson_recall_check.py tests/test_full_restore.py tests/test_release_coverage.py -q`：**187 passed，243.27 秒，退出 0**。
- EL-09：`npm --prefix frontend run test:e2e -- --ticket EL-09`：**26/26**，移动/桌面各十三分支。
  原始结果：`e2e/release-results/ec-e2e-static-5VZIOF/`。
- EL-08：同入口 `--ticket EL-08`：**16/16**；原始结果 `ec-e2e-static-EkQL9c/`。
- EC-04：同入口 `--ticket EC-04`：**18/18**；原始结果 `ec-e2e-static-Tckklo/`。
- 三轮均为最终源码，`run.json` 状态 passed，Playwright unexpected/flaky/skipped 均为 0；
  新 Vite 生产构建的脚本为 `index-DOdEcKRG.js`，SHA-256
  `af027e0e70fd7419e11adcde83c47ab9ecf6ad0784f9dff23ea7828df754d4bd`。
  已把完整诊断复制回工作区忽略目录，汇总为 `e2e/release-results/el09-final-summary.json`。
- 完整受影响的 14 个 Python 文件：Pyright **0 errors / 0 warnings**；Ruff check 通过，format --check **14 files already formatted**。
- 覆盖校验 self-test 通过，确认缺场景/视口、跳过、失败、超时、中断、阻塞、flaky 和部分分支均不能冒充完整结果。

共享工作区其他任务新增的 reader 文件、依赖/锁文件和 story 页面修改不属于本票，保持原状。
本票未执行全库门禁或发布；未验证范围与 N/A 项仍按上文标记，不把定向通过扩写为全站通过。
