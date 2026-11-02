# EL-11 定向验证记录

日期：2026-11-02。规格：GitHub #47 / F3 的 AC14、AC15、AC18、AC19、AC35–37。
审查基线：`16b266ef17e3461a4bc5000249fa436d86564945`。单票实施，不推进 EL-12/13。

## 范围与证据

- 先从空库 POST 失败（400）开始，加入已核对入门材料后通过；已有依据生成最初因“新词不足”失败，再接通有效依据与不可变版本后通过。
- 篡改 V3 理解题答案最初仍被预览接受，加入材料/引用重验后返回 422。保存失败、无 AI、超时、修正上限、错误材料都保留原快照。
- 生成期间删除/恢复最初触发 ORM 失效 500，冻结输入后返回 409；全部覆盖依据重验、重复已知词卡去重与新目标选择均有单独 RED→GREEN。
- 旧布局导航含图标，首轮独立候选用例误用精确按钮名而失败；修正为兼容的实际导航定位，未改产品语义。早期 V3 只缺故事版本却误报缺修订，新增双视口失败用例后按缺失集合分别解释。
- 工作区有未提交阅读器改版。功能在索引中基于原 HEAD 构造并在 `/tmp/el11-session/candidate/` 独立导出验证；未把改版、依赖升级和用户规划文档纳入功能提交。

| 验收 | 自动证据 |
| --- | --- |
| AC14 有依据选材、边界、翻译、题目材料 | `test_el11_selects_one_to_three_known_targets`、`test_el11_only_current_verified_recall_is_known`、`test_el11_invalid_material_never_publishes_after_one_correction`、撇号/复数覆盖和显式新目标测试；浏览器实际生成与阅读 |
| AC15 无词/不足依据与新词 | 空库、自评库入门浏览器分支；显式同意新目标但词卡数不变；支撑词表独立标注 |
| AC18 旧故事兼容 | 无题旧故事真实读取，V2 恢复继续阅读，不制造作答/成绩；新理解题仅保存材料 |
| AC19 外部失败/两次非法 | 非法、缺 AI、超时的具名浏览器分支与 HTTP 快照对比；最多一次修正 |
| AC35 保存未确认 | commit 故障与丢响应→刷新→原操作确认；学习事件和排期不受生成影响 |
| AC36 修订/删除/恢复/晚到 | HTTP 四类生成上下文变化 409；浏览器晚到详情不替换选择；删除失败提示和删除墓碑；V3 目标/故事映射 |
| AC37 原子/幂等 | 双线程同操作只保存一个版本，同操作不同同意选项 409；事务故障回滚；删除后同操作 410 |

## 实际命令

- `.venv/bin/python -m pytest tests/test_el11_bounded_personalized_story.py tests/test_stories.py tests/test_el01_expand_revisions_and_v3.py tests/test_el06_migrate_content_contact.py tests/test_full_restore.py tests/test_backup_v2.py tests/test_installation.py tests/test_release_coverage.py -q`：**228 passed**，214.47 秒。
- 独立候选 `npm --prefix frontend run test:e2e -- --ticket EL-11`：早期 V3 提示修复前 **28 passed**（14 分支×双视口）；最终 15 分支复核另记于下方。
- 独立候选 `npm --prefix frontend run test:e2e -- --ticket EC-15`：**4 passed**，38.9 秒，保留跨详情/故事/备份/恢复/删除的一致性断言；选词前置更新为真实两学习日独立输入依据。
- 修改 Python 文件的 `ruff check` 与 `ruff format --check`：通过。`git diff --cached --check`：通过。
- 独立候选 `npm --prefix frontend run build`：通过，提交生产资源取自该候选，未混入工作区改版；缓存参数 v8→v9。
- 入门材料不写数据库；每个 ECEnv/AppFactory 通过真实 Alembic 升级创建隔离 SQLite。回退开关的 HTTP 和双视口分支确认新入口关闭、已有内容和 V3 仍可读。

完整日志在 `/tmp/el11-session/`；首次集成工作区的 24 项浏览器证据位于 `e2e/release-results/ec-e2e-static-LOrlxD/`。
独立候选 28 项报告为 `/tmp/el11-session/candidate/e2e/release-results/ec-e2e-static-BxZ07Z/`，EC-15 为同目录 `ec-e2e-static-32iJxQ/`。保留失败诊断，不把失败或中断算通过。

## 边界与未验证项

依照本次用户范围只运行受影响检查，未运行未过滤全量 pytest/E2E，不宣称全量门禁通过。类型检查、ESLint、CI/Makefile、Docker Compose、独立安全扫描、变异测试和部署门禁：N/A（项目未配置或本票不涉及）。未新增依赖、账号权限、发布步骤或不可逆数据清理。

真实外部模型的故事语义质量未验证；自动校验只能保证词形、结构及证据引用，不能保证学习者理解全文。备份/恢复和回退使用真实事务及合成学习数据，不访问用户数据库或付费供应商。
