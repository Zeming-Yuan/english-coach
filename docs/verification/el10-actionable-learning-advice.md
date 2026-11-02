# EL-10 实现与验收记录

日期：2026-11-02（Asia/Shanghai）；规格：[GitHub #46](https://github.com/Zeming-Yuan/english-coach/issues/46)。
基线：`4d1ae157c66b718ba532c4568075614ad7142d35`（EL-09 已合入）。在现有 dev 分支实施，
保留初始阅读器、构建产物、依赖及未跟踪设计文档的改动，只提交本票文件与 App 中本票差异。

## 行为与自动化证据

| 条件 | 自动化证据 |
| --- | --- |
| 固定优先级、每项三词、同词跨理由/身份去重 | `test_el10_primary_reasons_do_not_hide_other_eligible_delayed_targets`、`test_el10_priority_deduplication_limits_and_assisted_only`、`test_el10_same_word_is_not_recommended_twice_across_card_identities` |
| 无样本不诊断、识别与提取区分、辅助不扩大独立样本 | `test_el10_empty_and_recognition_are_not_recall_failure`、`test_el10_recognition_error_is_not_an_independent_recall_failure`、`test_el10_repeated_assistance_never_inflates_independent_sample_count` |
| 建议读取不排期、显式启动、绑定集合和题型 | `test_el10_advice_targets_actual_failed_card`、`test_el10_explicit_targeted_practice_binds_revision_and_replays`；E2E failed/assisted-only |
| 延迟窗口、隐藏答案、展开接触后重算 | `test_el10_delayed_suggestion_hides_answers_and_binds_eligible_set`；E2E delayed advice/delayed suggestion |
| 删除/修订/空池解释，无替换或伪造通过 | `test_el10_target_changes_are_explained_without_substitution`；E2E revision/deletion/deleted frozen pool |
| 本课短测与当前目标延迟首测分开 | `test_el10_course_retention_is_scoped_to_current_lesson_targets`；E2E course |
| 创建/作答事务失败、重复确认、并发只保存一次、已保存回放优先 | `test_el10_targeted_failure_rolls_back_and_concurrent_retry_saves_once`、`test_el10_delayed_target_set_replays_even_when_requested_order_differs`；E2E lost-response/commit-failure/lost creation |
| V3 目标引用映射、恢复继续、旧备份缺失说明、非法用途拒绝 | `test_el10_targeted_v3_roundtrip_continues_frozen_target`、`test_el10_old_backup_explains_missing_targeted_history`、`test_el10_targeted_backup_rejects_inconsistent_scope_without_writes`；E2E V3 restore |
| 可逆功能回退保留新记录、证据、排期与兼容 | `test_el10_rollback_hides_entries_and_keeps_learning_and_v3`；E2E functional rollback |
| 浏览器存储不可用有可见限制说明 | E2E unavailable browser storage |
| 具名分支进入完整覆盖校验 | `e2e/spec-coverage.mjs` EL10 十七分支；`test_release_coverage.py` 包含本票遗漏分支拒绝 |

最高 seam：浏览器用户操作 → 真实 React → 真实 FastAPI → 统一事务/FSRS → Alembic 隔离 SQLite。
关键成功作答从 UI 发生，只替换外部 AI/TTS、在启动处注入时钟；异常传输使用真实 route.fetch 后丢响应。
本地单用户学习库，无新角色/租户授权面；目标限于当前库并验证内容身份/修订；引用不存在 404、
目标/提交冲突 409、非法组合 422。写入继续由 BEGIN IMMEDIATE 与唯一提交标识保护。

## 红绿与实现判断

观察到建议 API 404、targeted 用途 422、缺延迟建议、V3 不接受 targeted、课程缺 retention、
辅助十次错误扩大独立样本量、反序目标同请求回放 409、同词多卡重复建议、浏览器缺存储限制提示等目标红灯，
每次在对应最小改动后验证。新增异常测试也钉住前置已提供的正确回滚/并发行为，不为制造红灯破坏旧实现。

按规格把计划示例的“前三个候选”改为“最多三组、每组三词”。专项复用已有表，不引入迁移。
用户要求每切片可独立验证，本票将可见闭环与其边界一起形成一个完整切片，先完成双轴审查再提交。
测试边界来自用户指定执行的现有计划，不新增私有方法测试 seam。

## 适用验证与限制

实际命令来自 README、requirements.txt、pyrightconfig.json、frontend/package.json 与既有 E2E runner。
仅运行本票和受影响的证据/课程/回测/备份/恢复/覆盖验证；没有运行全库完整门禁。
E2E runner 每次重新构建，在 release-results 保存源码摘要、构建摘要、双视口实际结果及失败诊断。
首轮 15 个场景双视口 30 次执行通过（`ec-e2e-static-01EUGG`）。独立审查指出：延迟建议的
样本/事件依据缺失、部分目标删除后缩小轮次、同浏览器恢复被旧入口遮住。分别补 HTTP/浏览器
失败测试后修复，再次审查与运行最新源码。新增部分删除轮次的不可用状态随 V3 恢复，不新增表。

扩大到受影响文件的首次 Python 回归：345 通过、2 失败（391.93 秒）。两项失败均在原始基线
的独立 git archive 环境复现：旧测试试图破坏性 downgrade，被既有 EL-09 迁移拒绝。
已建后续票 [#64](https://github.com/Zeming-Yuan/english-coach/issues/64)，不在本票重写无关迁移。
这些失败不记为通过；后续定向结果明确排除这两个已复现的基线问题。

- Python 类型/静态检查：pyright、ruff check/format --check，限定本票 Python 文件。
- 前端独立类型/静态检查：N/A，package.json 没有配置；Vite 构建与真实浏览器运行覆盖语法/运行行为。
- 迁移：复用既有表，N/A 新迁移；所有新测试环境使用真实 Alembic 最新迁移。
- 备份/恢复：V3 导出、预览、校验、引用映射、原子恢复及功能回退在受影响测试中验证。
- 全库 pytest、未过滤 E2E、完整发布门禁：未验证（遵照本轮只跑修改及受影响部分），保留跨模块回归风险。
- 安全扫描/依赖审计：N/A，无依赖变更；本票不作全站安全认证。
- Docker/部署/生产恢复、破坏性迁移回滚：N/A，本票未部署、未新增破坏性迁移。

## 回退

设置 LEARNING_ADVICE_ENABLED=false 并重启，隐藏首页/统计建议入口；原分类统计、课程结果、
既有练习读取、V3 导出恢复和真实排期保留。事务故障整体回滚与功能回退分别有测试，禁止清库或恢复旧快照冒充回退。

## 最新验证结果

- 修改的 17 个 Python 文件：pyright `0 errors, 0 warnings`；ruff check 通过，format --check 通过。
- 最后定向 Python：44 通过（27.15 秒），包括本票 21 项、覆盖校验与删除后引用/课程计数回归。
- 将暂存候选独立提取到临时目录（树 `e21af99cf88197b57bb5b490c94351270e9c038a`），
  排除工作区原有未提交改动：本票 HTTP 测试 21 通过（19.71 秒），原依赖范围的 Vite 构建退出 0。
- 本票 EL-10：17 个具名场景 × 双视口，34 通过（`ec-e2e-static-1JwomF`）。
- 受影响前置：EL-07 18 通过（`ec-e2e-static-bA3V3R`）、EL-08 16 通过
  （`ec-e2e-static-RpDAcD`）、EL-09 26 通过（`ec-e2e-static-obhiFC`）。
- 上述之后补正了去重/截断的顺序，并将删词函数改为类型化但等价的 SQLAlchemy delete 表达式。
  使用最新 Vite 构建重跑五条受影响浏览器路径（实际失败词、进入前删除、延迟建议、同浏览器恢复、
  部分删除）× 双视口：10 通过、0 跳过/失败/重试；原始结果 `.superpowers/el10/latest-browser.json`。
- 覆盖测试新增 EL10 时，原测试硬编码 T20 命名空间，产生 1 个测试预期失败；改为独立显式
  参数矩阵后通过，完整覆盖校验仍拒绝缺分支、跳过或重试，没有降低门槛。
- 第一次扩大回归的两个既有降级测试失败仍单列为 #64，不当作通过；完整未过滤门禁仍未运行。

Python 日志与红绿过程保留在本工作区忽略目录 `.superpowers/el10/`；浏览器完整入口的构建、
源码摘要、截图和诊断保留在 `e2e/release-results/` 对应运行目录。最新构建针对删除/恢复边界的
截图同样由真实 Playwright 运行产生。

## Standards

首轮 1 项 P2：延迟建议未返回真实独立样本量与依据事件 ID。已用公开 HTTP 的真实事件复现并修复，
`test_el10_delayed_advice_reports_actual_basis_and_sample_count` 通过；辅助不扩大分母。

## Spec

首轮 2 项 P2：多词轮次部分删除后可能缩小集合判通过；同浏览器恢复可能被旧入口遮住。
已以 HTTP（含 V3 恢复）和真实浏览器复现并修复；targeted/delayed 删除路径、同浏览器恢复均有回归。

两个审查轴独立：首轮 Standards 1、Spec 2，均已修复；提交后的复审结论另记。

提交复审补充：Spec 轴 0 项未处理；Standards 轴发现零独立样本的延迟候选仍缺支持事件引用。
对仅自评、辅助错误两类公开 HTTP 路径观察到 event_ids=[] 红灯后，独立样本数继续为 0，
同时保留当前修订的真实非跳过支持事件引用。该调整不改变筛选、评分、排期、UI 或持久结构。
新增 `test_el10_delayed_basis_keeps_event_reference_without_independent_samples` 两分支，
本票当前共 23 项 HTTP 测试；最后验证与复审结果见本次交接。
