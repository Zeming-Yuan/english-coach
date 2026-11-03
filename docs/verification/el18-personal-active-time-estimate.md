# EL-18 主动时长与个人估算验证

- 规格：#54、`docs/tickets/evidence-based-personalized-learning/18-personal-active-time-estimate.md`；仅交付 F5 个人负担校准。
- 固定审查基线（用户确认）：`ce389ca7aab589b2915c4eddab9a8a538ca22fea`（EL-17 合入后）。
- 隔离分支：`codex/el18-active-time`。EL-01 #37、EL-17 #53 已关闭，实际远端 dev 已包含前置实现。
- 接口：浏览器真实 React → FastAPI → FSRS/事务 → Alembic SQLite；公开 HTTP、纯估算规则补充边界。

## 验收映射

| 条件 | 自动证据 |
| --- | --- |
| 真实提交关联、分类、不重复评分 | HTTP `duration_links_one_saved_attempt`、`review_and_reinforcement_are_separate_real_attempts`；浏览器 due review / reinforcement |
| 五条门槛、最近三十、中位数、2–180 秒 | HTTP `five_same_kind_samples_calibrate_only_future_previews`、`rules_use_last_thirty_finite_nonnegative_samples`、`http_preview_uses_latest_thirty_same_kind_samples`；浏览器 five real answers |
| 闲置/后台/保存等待排除 | 浏览器 idle gaps、hidden document、lost answer response |
| 暂停/刷新未提交题不使用部分时长 | 浏览器 resumed unanswered card（先保存部分样本失败，加入标签页标记后通过） |
| 已开始目标及依据冻结 | 浏览器 five real answers / frozen-estimate 截图；沿用 EL-17 状态源 |
| 保存失败/响应丢失、并发及冲突 | HTTP `commit_failure_retry_conflict_and_concurrency`；浏览器 duration 两种故障、lost answer response |
| 编辑/删除与数据范围 | HTTP `deleted_card_removes_duration_and_rejects_late_sample`、`invalid_unknown_and_wrong_kind_samples_do_not_write`；V3 replay after revision |
| V3 规则、关联、映射、继续校准 | HTTP `v3_restore_preserves_rule_order_links_and_replay_after_revision`、`v3_rejects_orphan_and_misclassified_duration_before_restore`；浏览器 V3 UI restore |
| 缺失集合/旧 V2、原子替换 | HTTP `older_v3_missing_durations_explains_default_and_atomic_replacement`、`v2_missing_durations_restores_with_defaults`；浏览器 older backups |
| 功能回退保留数据 | HTTP V3 restore / rollback；浏览器 functional rollback |

## TDD 与执行口径

- 首条 HTTP 测试先返回 404，再接通保存、幂等和 V3 导出；五条校准测试先持续 default，再接通个人预览。
- V3 孤立关联先被错误接受（200），补校验后 422；删卡测试先留下孤立时长，补显式级联后清空并对迟到样本 404。
- 慢速样本先使目标为零，补规格 F5.5 的至少一张及超时提示后通过。
- 浏览器首测先缺少 estimate-basis；复习分类先未保存时长（轻量队列不含 review_count），补服务端类别后通过。
- 已由实现覆盖的规则/兼容边界直接记录绿灯，不破坏产品伪造红灯。
- 配套 Playwright 浏览器缺失，使用 README 已支持的 `EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`。保留双视口、新构建、源码与资源指纹和全部断言。
- Headless 多标签都报告 visible；后台分支注入 document 的浏览器可见性信号并触发真实 visibilitychange 监听，实际应用 API 不伪造。桌面窗口切换未做原生手动验证。
- 曾中断一轮因巩固测试误寻找不存在的提交按钮；改为既有 Enter 提交。回退夹具曾传对象而非 databasePath；均不计为通过，重跑结果另记。

## 门禁结果

命令来自项目配置、开发文档和既有验证记录；按用户要求只运行修改及受影响范围。

| 检查 | 结果 |
| --- | --- |
| 本票/EL-17/备份 HTTP | 44 passed（`tests/test_el18_personal_active_time_estimate.py tests/test_el17_time_budget_daily_plan.py tests/test_backup_v2.py`） |
| 扩大的相关 Python（coverage、events、EL-01、full_restore、daily_session、session_summary） | 首轮 173 passed / 3 failed；失败均为旧 V3 扩展精确列表缺少 practice_durations，已同步；本票/EL-01/EL-04 复验 82 passed |
| EL-18 新构建双视口 | 22 passed，`ec-e2e-static-Vk3GOV`（11 个具名分支） |
| EL-17 新构建双视口 | 24 passed，`ec-e2e-static-9pNEV2` |
| EC-13 新构建双视口 | 32 passed，`ec-e2e-static-WgIq0L` |
| EC-14 新构建双视口 | 32 passed，`ec-e2e-static-kDq344` |
| Pyright（17 个修改 Python 文件） | 0 errors / 0 warnings |
| fresh-base + changed-file Ruff/format | origin/dev=ce389ca，检查通过（17 个文件已格式化） |
| 覆盖校验自测 | 缺分支、缺视口、跳过、失败、中断、重试、阻塞和部分覆盖均被拒绝 |
| 全量 pytest / 未过滤 E2E | 未验证；遵照用户定向范围。误启动的全量 pytest 已中止，不计为通过 |

每次 E2E 的 run.json、playwright.json、trace 和截图均保留在上述 release-results 子目录。
运行时冻结源文件/HEAD；此后仅更新旧测试扩展列表和证据文档，不把早期报告声称为最终提交的相同源码摘要。
最终代码审查采用固定点到提交 HEAD 的非空 diff，Standards 与 Spec 由独立 reviewer 执行；不委派产品文件修改。

截图已实际读取：移动/桌面 personal-estimate 和 frozen-estimate，确认个人/默认依据与冻结目标可见。
本票的可见闭环与兼容边界集中在同一个可独立验收提交中交付，未拆出不可运行的准备提交。

## 适用边界

- 应用沿用单用户本地数据范围；新增写入只引用已保存词卡作答，不扩展账户/租户/外部权限。
- 新表升级由真实迁移夹具覆盖；回退采用保留数据的功能开关。生产发布/部署、容器编排、独立安全扫描、变异测试：N/A（本票未引入这些流程）。
- 原生窗口切换、操作系统崩溃、跨设备浏览器 pending 恢复：未验证/不承诺；数据库完整备份与事务恢复使用自动测试。
