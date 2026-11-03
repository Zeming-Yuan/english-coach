# EL-19 有限恢复学习验证记录

日期：2026-11-03（Asia/Shanghai）。规格：#55、EL-19；前置 #53 已关闭，PR #78 已合入 dev。
基线 `0053405d0e8ba84e63ae06601739c064f5b977d8`（执行前 fresh origin/dev），
工作分支 `codex/el19-recovery-mode`；第一切片 `e3fec24a6758113903ea9d9c4dc878e4ec1eb36d`。
第二切片与审查修复以本文件所在提交为准。未推送、未合并或部署。

## 验收映射

| 验收 | 自动证据 |
| --- | --- |
| 依据真实活跃日；首页不写活动；无到期不推荐 | HTTP inactivity_and_due_boundaries、current_timezone_uses_immutable_saved_learning_day、skip_and_answer_contact_do_not_end_inactivity、old_memory_is_unknown_but_saved_legacy_events_count_as_activity；双视口四种 2/3 天 × 有/无到期组合及上海午夜 |
| 显式、三分钟、至多五到期、零新词；保留优先级和 FSRS | HTTP recovery_requires_three_minute_budget、recovery_retains_priority_and_excludes_future_hard_words、long_interruption_caps_even_fast_personal_review_estimates；浏览器 finite recovery、explicit recovery selection、long interruption，断言真实排期变化和未选卡状态不变 |
| 结束保存量、实际剩余到期、继续常规 | HTTP summary_reports_actual_remaining_due；浏览器 finite recovery 结果为保存五张/剩余两张，再进入常规计划；显式选择不覆盖 15 分钟常规偏好 |
| 失败、暂停、刷新和重复确认 | 浏览器 pause and refresh、response-loss、commit-failure；未确认不推进，原 submission_id 回放一次；HTTP failed_save_and_parallel_replays_schedule_once 验证失败全量回滚、并发同内容同响应、异内容 409 |
| 内容修订、删除、恢复后旧上下文 | 浏览器 frozen revision/deletion 明确退出重载、无假保存；V3 UI restore 清除旧浏览器轮次；HTTP V3 双实例 ID 映射、学习日、修订、已保存提交回放和会话结果保持 |
| 数据保护与回退 | 无新持久集合/迁移，复用学习事件、修订及时长 V3。HTTP 和浏览器 functional rollback 隐藏推荐/拒绝新预览，已冻结轮次仍完成，历史/FSRS/导出保留；既有 backup_v2 与 EL-18 旧备份分支通过 |
| 覆盖登记 | 14 个 EL-19 具名分支登记在 e2e/spec-coverage.mjs；release coverage 自测拒绝缺分支、缺视口、重试、跳过和失败。未运行完整未过滤验收，不将登记当作全量通过 |

## TDD 与问题处理

- 首条 HTTP 缺 recovery_available、summary 缺 remaining_due，均先失败再接通最小实现；首条真实浏览器找不到 recovery-offer，两视口失败后实现 UI。
- 非三分钟恢复先返回 200（应为 422）；关闭恢复开关仍推荐 True；旧协议真实事件未计活跃，各自有失败断言后修复。
- 初始 Standards/Spec 审查各发现 1 个 P2，均指向非法恢复预算。路由现校验组合；关闭常规时间选择也不覆盖恢复的三分钟。
- 补充既有边界直接绿色时如实记为继承行为，未破坏产品制造红灯。V3 测试曾误用去掉 exported_at 的语义快照；接触测试曾写错既有 URL；修正夹具后重跑。快速估算常规队列的总数应为 13（12 复习+1 新词），初写 12 导致两视口失败，修正预期。
- 学习日与现有统计对齐：真实非跳过事件（含旧协议实际保存）算活跃；迁移基线/接触/时长不补造活动。

## 已执行门禁

按用户指令只运行修改及受影响范围，命令取自项目配置、开发手册和既有测试入口。

- `.venv/bin/python -m pytest tests/test_el19_return_to_learning_mode.py tests/test_el17_time_budget_daily_plan.py tests/test_el18_personal_active_time_estimate.py tests/test_daily_session.py tests/test_session_summary.py tests/test_backup_v2.py tests/test_release_coverage.py tests/test_today.py tests/test_activity_history.py tests/test_learning_events.py tests/test_stats.py -q`：142 passed。
- 测试 import 排序修正后，本票单文件复验：17 passed。
- Pyright 使用现有配置、`--pythonpath .venv/bin/python`，检查 7 个修改 Python 文件：0 errors / 0 warnings。默认不指定解释器时曾无法解析依赖，未用源码忽略压掉错误。
- `.venv/bin/python scripts/agent_check.py --base dev --lint`：fresh base / Ruff / format 通过。首次发现两处测试 import 排序，已修正后通过。
- `git diff --check`：通过。
- 浏览器：`EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome npm --prefix frontend run test:e2e -- --ticket EL-NN`。配套默认浏览器未安装；使用仓库已支持的已安装 Chromium，实际版本与可执行 SHA256 写入 run.json。真实 React/FastAPI/FSRS/迁移 SQLite，只替外部服务/时钟/传输故障；每轮重新构建、双视口且禁止重试/跳过。

| 范围 | 结果 | 诊断目录（e2e/release-results/ 下） |
| --- | --- | --- |
| EL-17 | 24 passed | ec-e2e-static-NGV0Uc |
| EL-18 | 24 passed | ec-e2e-static-IpW37W |
| EL-19 | 28 passed（按钮样式修正前） | ec-e2e-static-zevbcO |
| EL-19 最终按钮样式 | 28 passed | ec-e2e-static-crK1vK |

各目录保存 run.json、源码指纹、HEAD、构建资源摘要、Playwright JSON、trace 与截图。
录制期间未改源码/HEAD；之后只同步验证记录、票据/计划状态等文档，不声称文档提交与早期报告具有相同的全仓摘要。
已实际读取桌面恢复结果、移动恢复选择截图；原选择按钮偏暗，改用现有 home-on-dark 样式，已读取最终移动截图，按钮清晰可辨。

## 审查与适用边界

初次固定范围 `0053405...e3fec24`，Standards 1 P2、Spec 1 P2（同一预算问题）；已修复。
最终两轴独立审查待记录。审查只覆盖任务 diff，没有以全量代码审计或完整门禁代替本票验证。

单用户本地数据范围未扩大，无账户/租户/外部服务权限新增；公开 HTTP 并发/幂等/事务故障及 V3 映射覆盖数据一致性。
全量 pytest、未过滤 E2E：未验证（用户明确要求定向范围，不能据此声称完整发布门禁通过）。
新增迁移、seed 升级/不可逆数据变更：N/A（无新集合或迁移；真实夹具仍从 Alembic 建库）。
生产发布/部署、Docker 编排、独立安全扫描、变异测试：N/A（本票未引入这些流程）。
原生操作系统崩溃、默认缺失浏览器、跨设备浏览器轮次续接：未验证/不承诺。
功能回退使用 RECOVERY_MODE_ENABLED=false 并重启，保留已开始轮次和全部数据；恢复 true 可重新开放，无删除列/清库/覆盖快照。
