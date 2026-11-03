# EL-20 内部消费者契约收口

规格：#56、docs/tickets/evidence-based-personalized-learning/20-contract-evidence-consumers.md。
日期：2026-11-03（Asia/Shanghai）。隔离分支 codex/el20-evidence-consumers，固定基线
`3e4d6d79d5c00d5ddaad059d209fdb6fbf9acea8`；直接前置 #39/#46/#48/#49/#51/#52/#54/#55 均已关闭。

## 最终所有权与现存消费者

| 契约 | owner 与实际消费者 | 收口边界 |
| --- | --- | --- |
| 当前回忆证据 | services/learning_evidence.py；cards/today 读取，详情、词表、首页、统计、分享图 | 当前修订的真实独立首答；次数不转成掌握 |
| 延迟保持 | services/retention.py；练习上下文、建议、课程、统计 | 首答/辅助/跳过分别解释，接触确认只能降低资格 |
| 语境应用 | models/scene_attempt.py + services/scenes.py/scene_feedback.py；ScenePage、统计 | 各三轮规则与原版本，模型回复不改变权威结果或 FSRS |
| 学习保存 | services/learning.py + run_write；reviews/typing/quiz/practice | 同提交回放原缓存优先；当前证据重新读取，不重发当前证据日期 |
| 接触确认 | services/contacts.py；详情、词表、闪卡、专项、课程、故事、反馈可见内容 | 显示/播放实际发生后显式确认；预取、纯 GET 不写；失败 pending 保留 |
| V3 集合登记 | services/backup_v3_registry.py；schemas/backup_v3.py 声明一次，backup/restore 使用同份模型与 remap | 原 schemas.backup_v3 注册 API 重导出；拒绝重复注册、未知/重复功能及声明/集合不匹配 |
| V3 版本与引用校验 | schemas/backup_v3.py；import preview/execute | V1/V2 分支独立；早期 V3 缺集合明确预览，不补造证据；接触同时间按原 ID 保存顺序恢复 |
| 句子练习解锁兼容 | graduation.py + card_payload.py；learning、cards、today、WordsPage、StatsPage | card_is_graduated/is_graduated 仍有调用者，保留 review_count/graduated、公开 URL 和旧事件/基线 |
| 当前状态/旧请求兼容 | learning.get_memory_state/select_current_review/review_submission | 唯一当前行、每日队列及兼容适配仍有调用者，保留；不重启旧写入 |
| 课程状态 | lesson_progress.py + practice.py；LessonsPage | 生成/打开/浏览与首答成绩分离；显式自评只解锁练习，不复制为短测成绩 |
| 预算与恢复 | routers/today.py、services/time_budget.py/practice_durations.py；App/StudyPage | 冻结轮次、真实排期与时长分离；恢复只选有限到期项，不新增学习事实 |

调用核对使用 `rg` 对登记、graduation、card_payload、contacts、evidence、practice 与前端源文件定位；
未发现仍需删除的无调用内部次数掌握/接触旁路。保留有调用的兼容接口，不按关键词机械删除。
前置已交付 evidence-overview 与公开拒绝未知功能直接绿色，如实记为继承行为。

## TDD 与验证进度

- 开始前受影响基线：EL-01/03/04 Python 84 passed。
- 同时间两条接触以 words_list → card_detail 保存，将 V3 数组反转；恢复后 last_contact.source 错为 words_list，测试真实失败；修复后通过。
- registry 服务层导入契约先失败（模块不存在），迁移所有权后通过；extension_names_match 先失败（函数不存在），实现并用于 V3 校验后通过。
- 第一切片本票 HTTP/规则 4 passed；Pyright 对 5 个修改 Python 文件 0 errors/0 warnings。
- fresh-base + changed Ruff/format + diff 检查通过。
- EL-20 浏览器 6 passed（3 分支 × 两视口），新构建/真实应用/无重试；诊断 `e2e/release-results/ec-e2e-static-Udcj3s`，run.json 保存源码摘要、HEAD 与浏览器身份。已读取两视口证据总览截图。
- 第一切片固定 diff `3e4d6d7...a8a6a8a`：独立 Standards 0 项、Spec 0 项，各自重跑本票 4 条测试通过。
- 第二切片缺失提示：V3 页面缺少结果区，两视口真实失败；补齐提示后 8 passed。只缺接触集合时发现误提示“内容修订会重新生成”，两视口先失败，再缩小提示为实际缺失范围。
- 第二切片本票 HTTP/规则 17 passed；无新业务行为的边界测试直接绿色，如实记为继承能力，不伪造红灯。
- 前置集合的定向 V3/恢复/回放/同时间顺序回归 105 passed、300 deselected（见下方实际命令）。
- 第二切片静态/类型检查通过；17 条本票 + 2 条报告校验合计 19 passed、18 deselected。
- EL-01/EL-04 双视口分别 10 passed，诊断 `ec-e2e-static-8wPddC` / `ec-e2e-static-oEmKmA`。
- 初次最终 EL-20 18 passed/2 failed：提交故障测试误用刻意跳过接触的默认注入。已定位测试支持边界，新增 failCommitOnce({contacts:true}) 的独立真实事务注入；默认作答故障不改变，HTTP 的真实接触 500/回滚已通过。
- 随后浏览器断言再次明确复现“接触注入返回 200 而非 500”及 V1 旧故事替换误提示（4 failed/16 passed），再实现测试注入与准确版本分支，保留全部失败诊断。
- 最终 EL-20 20 passed，`ec-e2e-static-obr4A9`；EL-19 28 passed，`ec-e2e-static-xlmt5Z`，包含默认提交故障/恢复/修订/删除/功能回退，验证默认注入语义保持。
- 本票实际 JSON 报告与 requirements.EL20 的 10 个具名分支 × 2 视口逐项比对通过；无重试/跳过。已读取最终桌面 V1、移动 V3 缺失提示截图。
- 最终 6 个修改 Python 文件 Pyright 0 errors/0 warnings，fresh-base/Ruff/format 与 diff 检查通过。两切片全部文档、ADR 和上下文同步。
- 第二切片与累计 diff 双轴独立审查均为 0 项，固定身份与限制见下方记录。

## 回退与未验证范围

不新增持久集合或迁移；既有恢复页补充全部缺失集合的可见解释，V3 schema/原导入接口、V1/V2 适配、旧 URL、历史/缓存与新数据保持可读。
功能回退可恢复原 registry 导入适配，或使用前置已有功能开关隐藏入口；必须保留同时间保存顺序修复和当前证据规则。
禁止恢复次数等于掌握的 UI、降级清库或用旧快照覆盖新学习。事务故障回滚和功能回退分别验证。

按用户明确要求仅运行修改/受影响验证；全量 pytest、未过滤 E2E 与生产部署未验证，不作为完整发布资格。
无新增账户/租户/外部服务权限；沿用本机单用户范围。数据库新迁移/seed、Docker、独立安全扫描、变异测试 N/A（未引入对应变更/流程）。

第一切片扩展回归：`.venv/bin/python -m pytest tests/test_el20_contract_evidence_consumers.py tests/test_el01_expand_revisions_and_v3.py tests/test_el03_migrate_evidence_readers.py tests/test_el04_expand_contact_recording.py tests/test_full_restore.py tests/test_backup_v2.py -q`：181 passed。


## 验收条件与证据映射

| 本票要求 | 自动证据与适用边界 |
| --- | --- |
| 内部消费者只用统一证据/接触规则，保留公共兼容 | 上方 owner/调用者清单；EL-03 读取回归、EL-20 visible overview；card_payload/graduation 的真实调用不删除 |
| 全部已交付集合登记、原 Python 导入兼容 | registry_keeps_the_published_registration_interface、registry_exports_every_delivered_persistent_model：全部 19 个业务模型 = 10 个核心 + 9 个扩展；每个父集合先于子集合登记；重复注册拒绝 |
| RF1/RF2 旧空 V3/已登记一致 | extension_names_must_match_without_duplicates、older_versions_explain_missing_data_without_inventing_evidence、V1/V2/V3 预览与 partial V3 浏览器分支 |
| RF3/RF4/RF5 重复/缺集合/未声明额外集合不丢失 | invalid_extension_declarations_reject_preview_and_execution 五种变体、unknown_extension_never_silently_disappears；预览/执行均 422，数据与安全副本目录不变 |
| 修订正反变更、删除与旧缓存不重新发证据 | revision_reversal_and_cached_replay_cannot_reissue_current_evidence：版本 1→2→3，双实例恢复后缓存原样回放、旧新请求 409/删除后 404；today/stats 当前证据仍不足 |
| 保存先后、同时间恢复 | restore_preserves_equal_time_contact_save_order；真实 UI V3 restore；前置 EL-09/14/18 同时间首答与时长顺序回归 |
| 保存失败、重复确认、迟到请求、并发一致性 | contact_failure_parallel_confirmation_and_restore_stale_request：500 全量回滚、并发一次生效、不同内容 409、映射回放原时间、退役 ID 的未保存请求 404；浏览器 contact 两种故障与 failed V3 replacement |
| 读取不变成学习 | reading_export_and_preview_are_not_learning，重复列表/详情/today/stats/导出/预览不改变完整快照；浏览器接触故障不记事件/FSRS/每日作答 |
| 旧格式缺失/安全恢复/回退与后继数据保护 | V1/V2/早期 V3 公开预览+恢复；functional_rollback_keeps_public_reads_and_new_records 关闭既有入口后旧 URL、当前证据、接触及全部集合导出不变；完整/旧格式恢复回归 |
| 文档、ADR 与具名覆盖 | ADR-0001–0008/README/CONTEXT/兼容边界同步；EL20 具名分支登记完整覆盖校验；覆盖 CLI 自测拒绝缺分支/视口、跳过、重试、失败 |

前置定向命令：

```bash
.venv/bin/python -m pytest tests/test_el07_lesson_goals_and_progress.py tests/test_el08_lesson_recall_check.py tests/test_el09_delayed_recall_check.py tests/test_el10_actionable_learning_advice.py tests/test_el11_bounded_personalized_story.py tests/test_el12_simpler_story_version.py tests/test_el13_story_reading_check.py tests/test_el13_integration.py tests/test_el14_three_turn_drink_scene.py tests/test_el15_intro_and_directions_scenes.py tests/test_el16_bounded_ai_scene_feedback.py tests/test_el18_personal_active_time_estimate.py tests/test_el19_return_to_learning_mode.py -k 'v3 or restore or replay or same_time or order' -q
```

上述 105 项覆盖登记/恢复共享路径；未选的 300 项不是通过声明，不用本票替代全部前置功能或最终集成资格。


## 最终受影响门禁与身份

- Python 第一切片广泛回归 181 passed；跨前置 V3/恢复/回放/顺序 105 passed（300 deselected）；最终本票与报告校验 19 passed（18 deselected，其中本票 17）。批次有重叠，不声称是去重后的总数。
- 最终 Python/报告命令：`.venv/bin/python -m pytest tests/test_el20_contract_evidence_consumers.py tests/test_release_coverage.py -k 'el20 or spec_coverage or contract_report' -q`。
- 类型：`pyright --pythonpath .venv/bin/python app/services/backup_v3_registry.py app/schemas/backup_v3.py app/services/backup.py app/services/restore.py tests/test_el20_contract_evidence_consumers.py e2e/support/server.py`：0 errors / 0 warnings。
- 静态/基线：`.venv/bin/python scripts/agent_check.py --base dev --lint`；`git diff --check`；`node e2e/spec-coverage.mjs --self-test`，均通过。
- 浏览器命令均为 `EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome npm --prefix frontend run test:e2e -- --ticket EL-NN`。使用仓库支持的已安装 Chromium，实际版本与二进制摘要在 run.json；不承诺未运行的默认浏览器配置。每轮重新构建生产 Vite 产物、迁移隔离 SQLite、真实应用/事务/FSRS，仅替外部服务/时钟/真实故障；构建与源码指纹核对均通过。

| 范围 | 双视口结果 | e2e/release-results 下诊断 |
| --- | --- | --- |
| EL-01 | 10 passed | ec-e2e-static-8wPddC |
| EL-04 | 10 passed | ec-e2e-static-oEmKmA |
| EL-20 最终 | 20 passed | ec-e2e-static-obr4A9 |
| EL-19 默认注入/恢复回归 | 28 passed | ec-e2e-static-xlmt5Z |

EL-01/04 运行在最终测试支持修正前；最终 EL-20/19 运行在相同冻结工作区，HEAD 为 a8a6a8a，
source_sha256 见两份 run.json，代码/测试/产物相同。录制期间无源码或 HEAD 改动；
验收后仅补验证记录与本票/计划状态，不把文档提交伪称为早期同一全仓摘要。所有失败 run 也保留，最终通过来自新运行，不使用重试把失败当通过。

完整未过滤 pytest/E2E 未运行；未检查远端 CI/分支保护执行，未推送、未创建 PR、未合并或部署。
本票无不可逆迁移/新 schema；正常 Alembic 建库路径与备份恢复由上述真实测试覆盖，生产恢复演练未执行。


## 最终独立审查

- 第一切片：`3e4d6d79d5c00d5ddaad059d209fdb6fbf9acea8...a8a6a8af60f17470ba909f57f4bfdf6911a7565d`；Standards 0，Spec 0，各自重跑本票 4 passed。
- 第二切片：`a8a6a8af60f17470ba909f57f4bfdf6911a7565d...81694c9ea38fdfa168c376da25eda9d138e8e449`。
- 累计审查：`3e4d6d79d5c00d5ddaad059d209fdb6fbf9acea8...81694c9ea38fdfa168c376da25eda9d138e8e449`；两个 fresh-context reviewer 分别审查两轴，只读且只覆盖本票改动及必要调用链。

### Standards

0 项；文档硬性违规 0、需处理设计异味 0，无严重级别。独立核对开发规则、README、ADR-0001–0008，
检查登记所有权、兼容导入、顺序、版本分支、事务、数据范围、去重及修订/缓存边界。
独立运行本票 17 passed、固定 diff 空白检查通过；未重跑浏览器、类型或全量门禁。

### Spec

0 项可执行发现；未发现缺失/错误实现或未授权扩展。登记/导入兼容、同时间接触顺序、旧格式保留/替换提示、
回放、修订、删除、并发确认及失败回滚符合本票范围。独立运行本票 17 passed；
未重跑浏览器、完整 pytest/未过滤 E2E、远端 CI 或生产恢复。

两轴合计 Standards 0、Spec 0，无未处理重要问题；不把两轴合并排序，也不把审查当发布资格。
作者在提交后的 `81694c9` 再次运行本票 17 passed；之后仅补本节审查记录与票据状态，无产品/测试变更。
实施提交 `a8a6a8a`、`81694c9` 均可分别运行各自具名验证；恢复到旧 Python 导入路径及既有功能开关的回退面保留。
原主工作区 `dev` 未被修改；任务分支和隔离工作区保留供审阅，未推送或合并。
