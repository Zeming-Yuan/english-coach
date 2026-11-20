# 从发现扩展词到完成一次语境练习

日期为 2026-11-20。范围为 #95 的首批路径 [#96](https://github.com/Zeming-Yuan/english-coach/issues/96) →
[#97](https://github.com/Zeming-Yuan/english-coach/issues/97) →
[#98](https://github.com/Zeming-Yuan/english-coach/issues/98)。
基线为 `origin/dev 5110e22d6eea1f98132ff49c0facb7bade36bb43`，实现在
`codex/s95-expansion-path` 隔离工作树。浏览器使用生产构建、真实 FastAPI 和各用例隔离的迁移后 SQLite。

## 验收与证据

| 票据 | 可观察行为 | 自动化证据 |
| --- | --- | --- |
| #96 | 翻面后的浏览保持原卡、焦点及评分数，太简单保存一次并进入 banana | `e2e/s95-01.spec.mjs` 的首轮对照 |
| #96 | 分类、详情共用、旧相关词、短例句、无内容、朗读失败、迟到响应 | `e2e/s95-01.spec.mjs`、`e2e/word-expansions.spec.mjs`、`tests/test_card_expansion_api.py` 和 `tests/test_word_expansions_service.py` |
| #96 | 未播放不确认音频接触，查询和提交失败保留可重试确认 | `e2e/s95-01.spec.mjs` 的播放、查询失败与同次提交重试 |
| #97 | 仅显式加入，已有自定义卡和历史不覆盖，短语整体保存，从详情返回冻结原轮 | `e2e/s95-02.spec.mjs`、`tests/test_expansion_additions.py` |
| #97 | 并发、回包丢失、冲突和来源失效，原子回滚，V3 及早期备份兼容 | `tests/test_expansion_additions.py`、`e2e/s95-02.spec.mjs`、`frontend/src/lib/expansionAdditions.test.mjs` |
| #98 | 空库到先前选词语境题、直接首轮与每日完成页、词卡详情、无适合题材的返回 | `e2e/s95-03.spec.mjs` 的 home、daily、detail 和 unmatched sense |
| #98 | 同次创建与作答可确认，显式再练保留前一首答，旧题修订围栏、V3 往返、识别与辅助证据 | `e2e/s95-03.spec.mjs`、`tests/test_expansion_practice.py` |

## 已执行检查

- `npm --prefix frontend run build` 通过，`tests/test_frontend.py` 在审查修复后的构建上通过 4 项，检查了静态产物及源码摘要。
- `npm --prefix frontend test` 通过 49 项。范围包括账号存储、同次加入请求和语境练习深链。
- 后端定向回归通过 209 项，覆盖两项新增 HTTP 契约、识别与输入、完整恢复、课程短测、读后检查和静态文件。#97 另有 157 项通过，覆盖词卡、每日轮次、V3 登记和会话网关，两批计数有重叠。
- 生产前端的桌面和手机 Playwright 合计通过 48 项，覆盖三票路径、原轮暂停和恢复、词卡导航、课程短测及故事检查。#98 审查修复后对 #98 和共用练习视图的定向复验两端各 11 项通过，包括新增的选项接触与旧题重新发起用例。一次中断的运行中测试应用在就绪前退出，后续两端完整重跑均退出 0。
- `.venv/bin/python scripts/agent_check.py --base dev --lint` 与按分支 Python 文件执行的 `pyright --pythonpath .venv/bin/python` 通过。Pyright 为 0 错误、0 警告。
- SQLite 隔离库从 `reliability_practice_weak_only` 带测试词卡依次升级到 `s95_expansion_additions` 和 `s95_expansion_practice`。核对原卡、三份安全副本、`integrity_check`、`foreign_key_check` 和拒绝破坏性降级。关闭两项写入开关后，HTTP 用例确认仍可读取和回放已有记录。

## 双轴审查

| 切片 | 固定范围 | Standards | Spec |
| --- | --- | --- | --- |
| #96 | `5110e22…7c6d3fa` | 无未处理项 | 无未处理项 |
| #97 | `7c6d3fa…ccf1482` | 无未处理项 | 无未处理项 |
| #98 | `ccf1482…e266348` | 无未处理项 | 无未处理项 |

审查覆盖了接触丢失、接触回放、恢复翻面、在未作答时浏览选项，以及词卡修订后新开练习。
这些问题均先复现，再修复并复审。#98 的 Spec 复审独立执行了新增的两个用例，桌面和手机各通过两项。

## 回退与验证限制

`EXPANSION_ADDITIONS_ENABLED=false` 和 `EXPANSION_PRACTICE_ENABLED=false` 关闭各自的新建并保留
确认回放、读取和备份恢复。两次迁移均为加法迁移，保留表、可空快照列及新数据。
前端查看入口可用对应功能提交反向调整，已写入的接触记录继续有效。

人工内容负责人签核与真实学习者验证沿用 #95 的人工验收项。真机和生产发布未验证。全仓回归、Docker Compose、依赖安全扫描、
变异测试和生产库回退演练未执行。本次证据覆盖定向回归、隔离库恢复与功能回退，
生产配置和跨设备真机行为仍需单独验收。
