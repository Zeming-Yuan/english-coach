# EL-20 内部消费者契约收口

规格：#56、docs/tickets/evidence-based-personalized-learning/20-contract-evidence-consumers.md。
日期：2026-11-03（Asia/Shanghai）。隔离分支 codex/el20-evidence-consumers，固定基线
`3e4d6d79d5c00d5ddaad059d209fdb6fbf9acea8`；直接前置 #39/#46/#48/#49/#51/#52/#54/#55 均已关闭。

## 最终所有权与现存消费者

| 契约 | owner 与实际消费者 | 收口边界 |
| --- | --- | --- |
| 当前回忆证据 | services/learning_evidence.py；cards/today 读取，详情、词表、首页、统计、分享图 | 当前修订的真实独立首答；次数不转成掌握 |
| 延迟保持 | services/retention.py；练习上下文、建议、课程、统计 | 首答/辅助/跳过分别解释，接触确认只能降低资格 |
| 语境应用 | scene_attempts/scene_feedback + scene_rules；ScenePage、统计 | 各三轮规则与原版本，模型回复不改变权威结果或 FSRS |
| 学习保存 | services/learning.py + run_write；reviews/typing/quiz/practice | 同提交回放原缓存优先；当前证据重新读取，不重发当前证据日期 |
| 接触确认 | services/contacts.py；详情、词表、闪卡、专项、课程、故事、反馈可见内容 | 显示/播放实际发生后显式确认；预取、纯 GET 不写；失败 pending 保留 |
| V3 集合登记 | services/backup_v3_registry.py；schemas/backup_v3.py 声明一次，backup/restore 使用同份模型与 remap | 原 schemas.backup_v3 注册 API 重导出；拒绝重复注册、未知/重复功能及声明/集合不匹配 |
| V3 版本与引用校验 | schemas/backup_v3.py；import preview/execute | V1/V2 分支独立；早期 V3 缺集合明确预览，不补造证据；接触同时间按原 ID 保存顺序恢复 |
| 句子练习解锁兼容 | graduation.py + card_payload.py；learning、cards、today、WordsPage、StatsPage | card_is_graduated/is_graduated 仍有调用者，保留 review_count/graduated、公开 URL 和旧事件/基线 |
| 当前状态/旧请求兼容 | learning.get_memory_state/select_current_review/review_submission | 唯一当前行、每日队列及兼容适配仍有调用者，保留；不重启旧写入 |
| 课程状态 | lesson_progress.py + practice.py；LessonsPage | 生成/打开/浏览与首答成绩分离；显式自评只解锁练习，不复制为短测成绩 |
| 预算与恢复 | today.py、daily_plan.py、duration.py；App/StudyPage | 冻结轮次、真实排期与时长分离；恢复只选有限到期项，不新增学习事实 |

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
- 扩展受影响 Python 结果与固定点双轴审查待本次运行后补录。

## 回退与未验证范围

不新增持久集合、迁移或 UI；V3 schema/原导入接口、V1/V2 适配、旧 URL、历史/缓存与新数据保持可读。
功能回退可恢复原 registry 导入适配，或使用前置已有功能开关隐藏入口；必须保留同时间保存顺序修复和当前证据规则。
禁止恢复次数等于掌握的 UI、降级清库或用旧快照覆盖新学习。事务故障回滚和功能回退分别验证。

按用户明确要求仅运行修改/受影响验证；全量 pytest、未过滤 E2E 与生产部署未验证，不作为完整发布资格。
无新增账户/租户/外部服务权限；沿用本机单用户范围。数据库新迁移/seed、Docker、独立安全扫描、变异测试 N/A（未引入对应变更/流程）。

第一切片扩展回归：`.venv/bin/python -m pytest tests/test_el20_contract_evidence_consumers.py tests/test_el01_expand_revisions_and_v3.py tests/test_el03_migrate_evidence_readers.py tests/test_el04_expand_contact_recording.py tests/test_full_restore.py tests/test_backup_v2.py -q`：181 passed。
