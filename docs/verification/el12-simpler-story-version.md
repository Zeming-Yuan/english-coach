# EL-12 简化故事验证证据

日期：2026-11-02。票据：#48。基线：`6a6e41f6da0534099250d8f63b359e57f93e53c4`（EL-11 已合入）。实现分支：`codex/el12-simpler-story`；隔离工作区，未纳入原目录的 UI 改版。

## 范围与验收映射

- AC16：独立 Story/StoryVersion、原版 UUID 父关联、原版正文保留、当前版本未检查；HTTP `test_el12_simplify_keeps_original_and_independent_material_and_replay`，浏览器 `simpler story preserves original and separate unchecked versions`。
- AC18：展示才记录词卡接触，版本切换重建阅读观察；同一浏览器分支核对两版展示接触。尚未交付 EL-13 读后评分，本票无故事成绩来源，词卡自评分不转作故事结果。
- AC19：20–40/句长 8/未知词形 2，目标、中英、题目继续校验；具名 HTTP 非法材料/精确词数/外部失败测试和浏览器非法简化分支。
- AC36：内容修订、删除、恢复、过期依据、异步选择围栏，具名 HTTP `late_generation_cannot_publish_changed_source`、`no_current_known_basis...` 与浏览器 late/deleted/pending-after-restore 分支。
- AC39：V3 保存并校验 mode/parent/材料/操作，父图预览拒绝，活故事 ID 映射、墓碑、旧字段默认；HTTP V3/旧格式/并发/冲突测试及真实浏览器恢复。
- 保存失败、丢响应、刷新确认：事务回滚快照不变、同操作只存一次；HTTP commit/concurrent 与浏览器 commit/response-loss 分支。
- 功能回退：HTTP + 浏览器禁用 `SIMPLER_STORIES_ENABLED` 后保留两版读取、切换和 V3；迁移只扩展，禁止删数据式 downgrade。

## 红绿证据

1. `story_profile("short")` 首先因 unsupported mode 失败，加入规则后通过。
2. 简化 HTTP 首先返回 404，接通 API/不可变持久化后通过。
3. V3 首先因 mode/parent 未登记拒绝恢复，登记模式与父关联校验后通过。
4. 浏览器缺“更简单”按钮红灯后接通真实 UI，核心双视口通过。
5. 依据过期首先返回 500，改为明确 409，快照保持不变。
6. 响应丢失后恢复重映射 ID，原请求返回 409；UI 按版本 UUID 找到当前原版 ID 后，同分支双视口通过，不新增第三个版本。

测试准备错误另记：初版标题断言忽略中英合并显示、相同开头定位不唯一、备份页导航隐藏，已修正定位/导航；这些不算产品目标红灯。被中断的探索轮不计通过。

## 已运行

- `.venv/bin/python -m pytest tests/test_el12_simpler_story_version.py tests/test_el11_bounded_personalized_story.py tests/test_stories.py tests/test_el01_expand_revisions_and_v3.py tests/test_el06_migrate_content_contact.py tests/test_full_restore.py tests/test_backup_v2.py tests/test_installation.py tests/test_release_coverage.py -q`：**260 passed**，256.97 秒。
- `npm --prefix frontend run test:e2e -- --ticket EL-12`：**18 passed**（9 分支 × mobile/desktop），2.2 分钟，无跳过/失败/重试。诊断：本工作区 `e2e/release-results/ec-e2e-static-Ol5uz9/`；`run.json status=passed` 保存工作区源码指纹和构建身份。
- 九个修改 Python 文件的 Pyright（`--pythonpath .venv/bin/python`）：**0 errors**；Ruff check/format：通过。
- `npm --prefix frontend run build`：通过。生产 JS `index-BfykLrIT.js` SHA-256：`7ac8810e2b506bfb4bae8262bc0c61569dde407fc051c07e1e9e04982c16540e`，与浏览器验收构建逐字节一致。
- `node e2e/spec-coverage.mjs --self-test`、`git diff --check`：通过；EL12 九分支已登记到未过滤覆盖门禁。

## 明确未验证

按本轮“只跑修改涉及部分”的范围，未运行未过滤全量 pytest/E2E，不宣称 AC43 最终集成资格通过。EL-11 浏览器回归与双轴审查结论见下方最终复核。未运行发布/部署、安全扫描、变异测试、Docker Compose；未新增依赖、账号权限或不可逆数据清理，相关发布门禁 N/A。应用仍是既有本地单用户数据范围，不引入账号或远端租户。

## 第一轮审查与并发修复

固定 diff：`6a6e41f...fc3ff68`。Standards 独立审查发现一项 P2：初检后、生成快照前修改原版可能保存基于旧材料的简化。Spec 独立审查 0 findings；各自上下文审查，无全量门禁。

补充 SQLite I/O 时序注入的公开 HTTP 回归：修复前期望 409 实得 200；冻结父版 identity/version，在写锁中、已保存操作重放之后再次比较。删除/恢复导致父引用不在当前映射时同样明确 409，不抛 500。修复后 `.venv/bin/python -m pytest tests/test_el12_simpler_story_version.py tests/test_el11_bounded_personalized_story.py -q`：**72 passed**（EL12 33 + EL11 39），77.88 秒。九文件 Pyright 0 errors，Ruff/格式/差异检查通过。浏览器源码与生产 JS 未变化。第二轮审查及最终浏览器复跑另附。

## 最终冻结提交复核

- 产品代码冻结于 `230acf599b6ed454b344f31fbe208032b96ab849`；之后仅补充本验证文档。
- 双轴复审固定范围：`git diff 6a6e41f6da0534099250d8f63b359e57f93e53c4...230acf599b6ed454b344f31fbe208032b96ab849`。Standards **0 findings**（原 P2 修复后独立 9 测试通过）；Spec **0 findings**（独立 3 测试通过），无未处理的重要问题。
- 冻结提交 `npm --prefix frontend run test:e2e -- --ticket EL-12`：**18 passed**，2.3 分钟；诊断 `e2e/release-results/ec-e2e-static-QpYcO3/`。
- 同冻结提交 `npm --prefix frontend run test:e2e -- --ticket EL-11`：**38 passed**，4.5 分钟；诊断 `e2e/release-results/ec-e2e-static-Q6qzgo/`。
- 直接读取两次实际 Playwright JSON，与 `requirements.EL12` 九分支、`requirements.EL11` 十九分支及 mobile/desktop 逐项比对：**56/56**，无缺失、跳过、失败或重试。两次 `run.json status=passed`，源码指纹均为 `7e08d42e2305e59498044f0b6dff48ce5742847a6fd3e3a64f91bbc6831cbd88`，JS SHA-256 均与上方生产构建一致。已检查实际移动端截图。
- 后端证据分开归属：首次变更范围 260 passed；并发修复后 EL12/EL11 72 passed（含新增竞态）。不把两个运行相加冒充独立测试数量。类型、Ruff、构建与差异检查通过。最终工作区不含未提交产品变更。
- 原 `dev` 工作区仍在 `6a6e41f`，其未提交 UI 改版和用户文件未纳入本分支。未发布、未部署、未关闭远端 issue；交付为可独立验证的本地提交。未过滤全量门禁仍明确未验证。
