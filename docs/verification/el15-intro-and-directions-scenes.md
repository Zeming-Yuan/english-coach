# EL-15：自我介绍与虚构问路验收

- Ticket：[#51](https://github.com/Zeming-Yuan/english-coach/issues/51)；规格：[#37](https://github.com/Zeming-Yuan/english-coach/issues/37)。前置 EL-14 / #50 已关闭，经 PR #70 合入 dev。
- 固定基线：`4413c950fe8ddf02c69d3c3a304ca2956f96594a`，取自新获取的 origin/dev。隔离分支：`codex/el15-scenes`；原工作区已有改动未纳入本票。
- 产品提交：`487cc0f`（可见闭环）、`747d9cb`（恢复/版本/回退边界）、`0bae04b`（语法片段与模板修复）、`ff253fdb60ea7f8602fa02f5c58ac09674ac1c08`（带版本的缩写检查）。最终审查命令：`git diff 4413c950fe8ddf02c69d3c3a304ca2956f96594a...ff253fdb60ea7f8602fa02f5c58ac09674ac1c08`。
- 按用户要求只审本票差异、只跑受影响验证；全仓与完整发布门禁没有运行。

## 验收条件与证据

以下 Python 节点均在 `tests/test_el15_intro_and_directions_scenes.py`；浏览器分支在 `e2e/el-15.spec.mjs`，登记到 `e2e/spec-coverage.mjs` 的 EL15，保留 EL14 全部条目。

| 验收 | 自动证据与边界 |
| --- | --- |
| AC31 三类三轮、任务、准备状态、模板 | introduction_uses_three_specific_tasks、directions_has_a_fictional_context_and_three_distinct_tasks、catalog_has_separate_preparation_and_resume_identity、task_query_returns_each_scenes_own_fixed_tasks；双视口 independent / preparation / switching |
| AC32 首答、认可/拒绝/未判定、帮助/跳过分开 | reviewed_expression_and_slot_boundaries、grammar_fragments_are_not_name_or_place_slots、assistance_skip_and_retry_keep_the_original_first_answer；双视口 unknown help retry and skip |
| AC33 实际覆盖目标与相应情境 | independent_results_only_map_scene_targets 验证专名不获词汇证据、无 ReviewEvent/FSRS；failure_does_not_overwrite_another_scene_context 与双视口 application outcomes，分别展示买饮品成功与问路失败，按场景/版本/hash/context 计算 |
| AC34 模板、单一纠正、语音失败保留结果 | registry_rejects_invalid_distributed_material（含完整/嵌入标准答案泄露）；双视口 standard expression and failed speech 与保留的 EL14 语音/实际接触分支 |
| AC36 冲突/删除、旧请求与恢复 | target_changes_stop_new_answers_but_keep_original_replay；rule_upgrade_keeps_old_results_replayable_and_restorable；旧 verdict 恢复；两类场景各 revision/deletion 双视口 |
| AC39 V3 身份、引用、恢复与回放 | v3_restores_original_scene_and_replays_submission、v3_rejects_forged_scene_scope_before_writing、old_verdict_restores_without_rejudging_under_current_rules；两类场景各真实下载→另一实例导入→继续，词卡整数 ID 重映射 |
| 原子/幂等/数据范围 | failed_commits_and_concurrent_retries_save_one_submission；两类场景各 commit/response-loss creation and answer 双视口；500 回滚、同 ID 同内容仅一记录、异内容/跨场景冲突 409、跨轮题目 404、未知场景 404、非法 V3 422 |
| 回退 | expansion_rollback_preserves_drinks_and_saved_new_scenes、expansion_rollback_only_marks_new_scene_evidence_historical；双视口 expansion rollback；关闭新增入口、保留买饮品与原创建确认、继续、导出恢复，恢复开关可重开 |

## 五项 Review Focus

- RF1：买饮品原 JSON、request/quantity/confirm 三键与原摘要不改；23 项 EL14 Python 和 13 分支双视口回归保留。早期计划示例的 thanks 不替换已交付的 confirm。
- RF2：姓名/地点只作槽位，支持李、北京、New York、O’Connor、Jean-Luc；不映射专名词卡。缺槽位、歧义与语法片段保持明确拒绝或未判定，不评价专名拼写。
- RF3：问路始终限定虚构广场→车站、路口左转，角色模板与这个上下文一致，不提供真实地图/导航。
- RF4：规则完整匹配；缺姓名/地点、不完整喜好、错误/歧义方向、只感谢未确认均有 HTTP 例子；浏览器实际输入 I am from I'm / Should I turn left or right? 显示未判定。
- RF5：v1/v2/v3 原材料分别保留；当前 introduction-v4 不能借旧版通过作证。旧 verdict、首答、时间与原提交回放不重判；新作答在规则变化后 409，旧版摘要为历史。新规则版本只有登记后才能恢复。

## TDD 与独立审查修复

观察到的目标红灯包括新场景 404、目录只有买饮品、旧备份校验拒绝新场景 422、证据错误标为 drinks、未知槽位误认可、旧版本备份被当前规则拒绝、材料损坏未被拒绝、新增入口回退仍能创建、关闭后仍显示新开按钮等。每个目标红灯均在最小修复后复验。已有框架正确覆盖的事务/并发/帮助等边界直接记为首次运行通过，没有人为破坏产品造红灯。

第一切片 Standards 0；Spec 提出 2 个 P2（thank 跨情境失败覆盖、缺少 scene_tasks 接口），加公开 HTTP/浏览器回归修复后复审均为 0 待处理。最终审查再发现地点语法片段可误算独立通过；4 条完整任务用例先失败，先修订为 v3；复审发现缩写变体后再以 6 条失败测试钉住，修订为 v4，并保留 v1–v3 原字节。v4 的语法词检查由版本材料显式启用，旧规则不重判。还补了嵌入标准答案的材料拒绝回归（先失败再修复）。最初浏览器探针有一次测试导航准备错误；修正后才确认目标红灯，中断/失败探针未当作验收通过。

## Standards

正式固定范围 4413c950...ff253fdb：0 个待处理发现（硬违规 0、可操作 smell 0）。独立 reviewer 核对最终增量与冻结候选一致，三版历史恢复/原提交回放定向 3 passed；未修改产品文件或重跑全量门禁。

## Spec

正式 HEAD ff253fdb：0 项待处理发现。原槽位 P2 已闭合；归档字节与旧 HEAD 一致，旧判定与回放保持。独立 reviewer 定向 13 passed，核对最终提交与已审候选一致；未修改文件或重跑全量门禁。全部历史审查合计 3 项 P2 均已修复，不把它们隐去或计为仍未处理。

## 已执行检查与源码身份

- 修订前较广受影响集合：345 passed / 445.47 秒，涵盖 EL01/02/04/08/09/13、完整/旧格式备份及场景路径。这是最终槽位修订前的结果，不声称 v4 重新执行了这 345 项。
- 最终 v4 场景集合：95 passed（EL15 72 + EL14 23；132.52 秒）；包括 EL15 与 EL14。
- 最终 EL15：19 登记分支 × mobile/desktop = 38 passed，无跳过/重试。
- 最终 EL14：13 登记分支 × mobile/desktop = 26 passed，无跳过/重试。
- Pyright 按已有配置检查全部本票 Python：0 errors / 0 warnings；agent_check --base dev --lint 重新获取基线并通过 Ruff check/format（8 文件）；git diff --check 通过；覆盖解析器自测通过，并逐项核对两个定向报告覆盖全部本票登记分支。
- E2E 每次新构建，真实 React→FastAPI→事务→真实迁移 SQLite；仅替换外部 AI/TTS，丢响应注入先 route.fetch 保存再 abort。两个命令使用独立构建目录、端口和数据库；运行中源码/HEAD 冻结。
- 最终源码 SHA-256：00b882188011eb7777eb02a36049c195ba5a0fcc47ba1bf9f69741bd1ada7409；构建 JS：index-BVHiGt3M.js，SHA-256：79691cc5304451e1600d5b66b86bad015fd0420d216d9cdb8cb353fbbdd24987。产品提交后的源码摘要与两个浏览器报告一致；本报告随后单独提交，不改产品代码。
- 浏览器：Chrome for Testing 156.0.8078.4，显式 EC_CHROMIUM_EXECUTABLE；可执行文件 SHA-256 `0f696dbaf73f8cfe8e387a5f41e2ff822b96526d57d8aac952f10899ff59d29e`。
- 最终报告目录：e2e/release-results/ec-e2e-static-zPUW4E、e2e/release-results/ec-e2e-static-wUdBkO，含 run.json / playwright.json / trace 与双视口截图；已读取最终场景截图。目录由仓库忽略，未提交临时库或诊断产物。

实际命令来自 README、requirements.txt、pyrightconfig.json、frontend/package.json 与现有 E2E runner：

```bash
.venv/bin/python scripts/agent_check.py --base dev --lint
pyright --pythonpath .venv/bin/python app/config.py app/main.py app/routers/practice.py app/runtime.py app/schemas/scene_backup.py app/services/scenes.py e2e/support/server.py tests/test_el15_intro_and_directions_scenes.py
.venv/bin/python -m pytest tests/test_el15_intro_and_directions_scenes.py tests/test_el14_three_turn_drink_scene.py -q
EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell npm --prefix frontend run test:e2e -- --ticket EL-15
EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell npm --prefix frontend run test:e2e -- --ticket EL-14
node e2e/spec-coverage.mjs --self-test
git diff --check
```

## N/A / 未验证

全仓 pytest 与未过滤完整发布 E2E：按用户本轮范围要求未运行，整体验收仍未验证。默认配套浏览器、跨平台行为未验证。独立前端 lint/type 脚本未配置；独立安全扫描、变异测试、Docker/部署/发布未配置为本票门禁或不在本票范围。多账户权限 N/A：应用沿用本地单用户模型，验证的是本票题目/提交/备份数据范围。新数据库迁移 N/A：复用既有场景记录与 V3 集合，无新增表或用途；真实 Alembic 建库与恢复已随自动化执行。本票无不可逆迁移。

回退：设置 SCENE_EXPANSIONS_ENABLED=false 并重启，保留数据与兼容读取；恢复 true 重新开放。不用旧快照覆盖新增学习，不删除字段/记录，不破坏买饮品。原 SCENES_ENABLED 整体回退仍保留。本票代码/测试/README/材料核对记录/ADR 同步，临时输出与依赖软链接均未提交。

Standards：0 项待处理；Spec：0 项待处理。

2026-11-03 用户确认的场景页视觉调整及其独立验证，见 [视觉调整报告](el15-scene-visual-refresh.md)。该增量保留本报告记录的业务行为。
