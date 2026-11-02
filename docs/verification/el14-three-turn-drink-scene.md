# EL-14：三轮买饮品场景验收

- Ticket：[#50](https://github.com/Zeming-Yuan/english-coach/issues/50)，前置 EL-08 / #44 已关闭。
- 固定基线：`6b9a6dcf0a241acd0b54c6abd5c9ffcfea4b8e36`，来自新获取的 `origin/dev`；独立工作树 `codex/el14-drink-scene`。
- 原工作区的设计改动、未跟踪规格与计划均未纳入本票。
- 只审查本票差异，只执行受影响检查；未运行未过滤完整发布门禁。

## 规格与证据

| 验收范围 | 自动证据 |
| --- | --- |
| AC31 三轮、中文目标与准备状态、模板可离线 AI 使用 | `test_el14_scene_starts_without_word_scheduling`、`test_el14_preparation_reports_real_recall_readiness`；E2E independent / preparation |
| AC32 认可/拒绝/未判定/空输入/跳过与辅助分列 | `test_el14_unknown_rejected_empty_skip_and_first_response_are_distinct`、`test_el14_saved_help_survives_reopen_and_copy_is_not_transfer`；E2E unknown / assistance |
| AC33 当前修订、目标映射、教学情境与维度分离 | independent、same_taught_task、taught_dialogue、previous_shown_scene_standard、backup_cannot_attach…；场景不创建 ReviewEvent 或 FSRS |
| AC34 单一纠正、无 AI 模板、TTS 失败不撤销保存 | E2E assistance / TTS failure / successful standard audio；只有实际播放才确认音频接触 |
| AC35 保存失败、丢响应、刷新后原身份确认 | commit_failure_retries_and_concurrent_confirmation；E2E 创建/作答各 commit / response-loss |
| AC36 修订/删除、旧请求与历史 | deleted_target…、各 replay、功能回退；E2E revision / deletion / browser restore |
| AC37 原子、幂等、跨入口冲突与范围 | concurrent_confirmation、scene_submission_identity…、an_item_from_another_scene…；空输入 422、失效 409、跨轮题目/删除 404、入口关闭 403 |
| AC39 V3/旧格式、映射、顺序、可恢复 | v3_restores…、restore_keeps_same_time…、各畸形/伪造缓存拒绝、upgrade_preserves…；E2E 跨实例真实下载/导入/继续；受影响 EL-01/04 旧格式检查 |
| 回退 | functional_rollback…、rollback_marks…、rollback_does_not_invent…、schema_rollback_refuses…；隐藏入口，保留读取/确认/导出/恢复，拒绝破坏性降级 |

教学依据含词卡例句/语境、课程例句/对话及曾展示的场景标准表达。新开一轮不把刚学过的同任务说法当成新情境。准备页只显示中文释义/状态与缺词数量，避免提前泄露 `one` 等可直接作答的词形。

## TDD 与审查

已观察的红灯包括：创建用途 422、任务提交走旧词卡路径 500、缺少 V3 集合、跨入口重用提交标识、删词后推进、回退创建确认、回退错误历史标记、畸形命令 500、伪造完成缓存、同任务换说法、对话教学遗漏、错误目标映射、同时间戳恢复倒序、缓存隐藏首答、已展示标准的后续新轮次等；对应测试均在最小修复后重新执行。

Standards 预审发现 2 个 P2：准备页英文展示/音频缺接触，以及缓存可隐藏已保存首答。分别采用中文准备页、真实播放回调记录可重试接触，以及按持久顺序校验 processed 标记；已由失败测试复现并修复。Spec 预审 0 项。固定产品提交复审结果见下文。

## 已执行检查

- 场景 HTTP/迁移/恢复测试：追加跨轮数据范围用例后 **23 passed**（30.05 秒）。
- 受影响集合一次运行：451 passed、4 failed。2 条是旧 head 固定断言，2 条是从当前保护 head 降级构造旧库；改为对应旧版本临时库准备，保留原始行为断言，定向复验 6 passed。另 2 条涉及类型明确化的原断言复验 2 passed。不把失败运行写成全绿，也不重复无改动的全部用例。
- 类型检查使用既有 Pyright 配置与 `.venv/bin/python`，只传本票修改的 Python 文件：**0 errors / 0 warnings**；`scripts/agent_check.py --base dev --lint`：**All checks passed，24 files already formatted**，并重新确认最新 `origin/dev` 是产品提交祖先。
- 浏览器曾执行 10 分支双视口 20 passed，补回退后 11 分支 22 passed；后续加入准备页/成功音频分支，成功音频的极短 WAV 流式夹具触发安全降级。已改为真实预加载再播放，同时断言预取不记接触；探针双视口 2 passed。最终在干净、冻结的产品提交上执行 13 分支 × 双视口，**26 passed**（3.8 分钟），无跳过、失败或重试。
- E2E 每次重新构建，真实 React/FastAPI/事务/经 Alembic 迁移的独立 SQLite，只替换外部 AI/TTS，源代码与 HEAD 在运行中冻结。
- 浏览器下载受限，使用显式 `EC_CHROMIUM_EXECUTABLE`；报告记录 Chrome for Testing 156.0.8078.4、可执行文件 SHA-256、源码摘要与构建产物摘要。默认配套浏览器未验证。

## 命令与剩余边界

实际命令来自 README、requirements.txt、pyrightconfig.json、frontend/package.json 与既有 E2E runner：

```bash
.venv/bin/python scripts/agent_check.py --base dev --lint
.venv/bin/python -m pytest tests/test_el14_three_turn_drink_scene.py -q
pyright --pythonpath .venv/bin/python \
  alembic/versions/el14_scene_attempts.py app/config.py app/main.py \
  app/models/__init__.py app/models/practice.py app/models/scene_attempt.py \
  app/routers/practice.py app/routers/today.py app/runtime.py \
  app/schemas/backup_v3.py app/schemas/learning.py app/schemas/practice.py \
  app/schemas/scene_backup.py app/services/learning.py app/services/learning_evidence.py \
  app/services/practice.py app/services/restore.py app/services/scenes.py \
  e2e/support/server.py tests/test_el01_expand_revisions_and_v3.py \
  tests/test_el04_expand_contact_recording.py tests/test_el13_integration.py \
  tests/test_el14_three_turn_drink_scene.py tests/test_learning_events.py
EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell npm --prefix frontend run test:e2e -- --ticket EL-14
```

受影响旧路径涵盖 EL-01/02/04/08/09/10/11/12/13、完整/旧格式恢复、学习事件、今日/统计与发布覆盖解析器。新增 13 个浏览器分支已登记到 `e2e/spec-coverage.mjs`，没有减少既有条目。

N/A / 未验证：全仓 pytest 与未过滤全发布 E2E（按本轮范围要求不跑）；独立前端类型/lint、独立安全扫描、变异测试、Docker/部署/发布（未配置为本票门禁或本票无部署）；多账户权限（现有本地单用户模型，本票无账户/权限模型变更）；未来规则 v2（当前仅交付 v1，不声称未来材料兼容已演练）。备份恢复、并发、事务失败、功能回退与保护性拒绝 schema 降级均有本票自动化证据。

## 固定点复审与最终运行

- 产品提交：`447c41f2e428a0e067e340d05ca07c93a770e3da`（`feat: deliver recoverable three-turn drink scene (#50)`）。审查差异固定为 `6b9a6dcf0a241acd0b54c6abd5c9ffcfea4b8e36..447c41f2e428a0e067e340d05ca07c93a770e3da`，非空，仅本票 37 个文件。
- Standards：独立 reviewer（gpt-6.1-sol / high）复审 **0 项待处理问题**；确认先前 2 个 P2 已修复。独立运行缓存首答、已展示标准、历史迁移 3 条用例，3 passed。
- Spec：另一独立 reviewer（gpt-6.1-sol / high）复审 **0 项待处理问题**；检查三轮、首答、帮助、新情境、恢复与回退边界。独立运行缓存完整性、已展示标准、保护性降级、跨轮题目隔离 4 条用例，4 passed。
- 两位审查者均未修改文件、未跑全量门禁；审查后产品提交保持不变。
- 最终浏览器记录：`e2e/release-results/ec-e2e-static-tuhLuJ/run.json`，`status=passed`、`working_tree=""`、HEAD 为上述产品提交；`playwright.json` 记录 26 passed。诊断与双视口截图保留于忽略目录，移动端结果截图已人工读取。
- 源码 SHA-256：`42bdca7ae63ec988c3977b7649f00ea2c3e7674a37c62b5f5a82a96c1e4137ef`；构建 JS `index-Bfdnne2z.js` SHA-256：`e53153acdc5f3b1161301254953e36a4cfa20dfa39f7e1e084f4163bf98d9829`。
- 浏览器 SHA-256：`0f696dbaf73f8cfe8e387a5f41e2ff822b96526d57d8aac952f10899ff59d29e`。构建成功；既有 `/static/style.css?v=11` 在运行时解析提示仍存在，真实页面加载及截图通过。
- 本报告随后单独提交，不改变已测试和已审查的产品内容。功能回退路径见 ADR-0008；未推送、未合并、未部署。
