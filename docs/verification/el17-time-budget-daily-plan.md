# EL-17 时间预算每日计划：实施与验证

- Issue：#53；规格：`docs/tickets/evidence-based-personalized-learning/17-time-budget-daily-plan.md`。
- 基线：`origin/dev=d0842729afc4f5c39763c06e0b3158f70c299b42`；分支 `codex/el17-time-budget`。
- 测试 seam 沿用票据已确认的浏览器 → React → FastAPI → 事务/FSRS → 真实迁移隔离 SQLite，HTTP 补边界。只替换外部 AI/TTS，不接触用户数据库或付费凭据。

## 切片一：可观察闭环

- HTTP 红灯：缺少 `plan`、未扣跨轮配额、内容修订仍返回 200、旧记忆状态/句子卡误扣新词额度、忽略旧 `due_limit`。每个失败均在对应断言执行后补最小实现。
- UI 红灯：缺少预算选择；随后超时提示缺失。真实 Chrome 双视口运行到相应断言后补 UI。
- 默认八分钟，三档预算；预留巩固时间，到期优先、组内标签优先、积压零新词，保留原数组形状。额度按真实新词首次排期学习日扣减，旧记忆、基线、句子卡不占词卡日配额。
- 开始冻结卡序/目标；暂停读取已保存事件而不结束轮次；刷新恢复索引。保存中禁用暂停，响应丢失/提交失败保留原身份，预算到时不推进。
- 自评修订前置条件在统一写事务内核对，幂等回放优先。既有事件 JSON 保存条件；兼容旧事件缺省条件，V3 导出、校验和恢复路径保留该字段。无新表或迁移。

浏览器主入口（`EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm --prefix frontend run test:e2e -- --ticket <ID>`）：

| 范围 | 结果 | 运行目录（`e2e/release-results/`） |
| --- | --- | --- |
| EL-17 | 10 passed | `ec-e2e-static-gzUXH6` |
| EC-13 | 32 passed | `ec-e2e-static-cA83xw` |
| EC-14 | 32 passed | `ec-e2e-static-BjokSb` |
| EL-05 | 14 passed | `ec-e2e-static-VcZykE` |

每轮主入口重新构建，报告保留源文件/HEAD 指纹、资源摘要、Chrome 实际版本和文件摘要，运行时未改源或提交。截图已检查移动视口的预算与主轮次入口。Playwright 所需配套浏览器缺失，按 README 已支持的 Chrome 路径运行，未降低断言或禁用覆盖校验。EL-17 五个具名分支已登记完整门禁。

上述 E2E 后补的两个纯 HTTP 兼容修复（句子卡配额、`due_limit`）由本票新增 HTTP 红绿测试验证；不把较早 E2E 的源指纹写成最终源码身份。切片二补充最终证据。

## 门禁与限制

- 本轮按用户要求只执行修改及受影响路径；全量 pytest 和未过滤 E2E **未运行**，不宣称全仓回归通过。
- Pyright 使用现有配置与 `.venv/bin/python`：除 `app/schemas/backup.py` 外的改动产品 Python 文件 0 errors。该文件两处既有 `BaseModel.id/card_id` 类型错误在基线源码亦可复现，尚未修复；不能宣称全部改动文件类型检查通过。
- Ruff changed-file check/format、fresh-base guard 与 `git diff --check` 用于提交前检查；最终结果在切片二续记。
- 发布/部署、真实外部模型/音频服务、生产负载：**未验证**。独立安全扫描、Docker Compose、不可逆迁移与降级：**N/A**，本票未配置/未引入。隔离库迁移、事务、备份恢复为适用门禁。

### 切片一独立审查及修复

固定审查范围 `d084272...f5f2fab`：Standards 1 个 P2（同时间戳 UUID 排序违反 ADR-0002）；Spec 2 个 P2（同一配额缺陷、继续时迟到的暂停结果可将未完成轮次显示为完成）。两轴均由独立 reviewer / gpt-6.1-sol high 执行，只查本票 diff。

- 随机边界红绿：固定生成两个逆字典序事件 UUID，第二次保存后原先 `new_remaining` 从 9 回升到 10。改用 `occurred_at, review_events.rowid` 选择实际首次保存事件后保持 9。
- 迟到读取红绿：真实 summary 响应暂留，点击继续后放行，原先覆盖为完成页；继续时递增读取序号并清理暂停 UI 后仍停留第二张、目标两张。
- `.venv/bin/python -m pytest tests/test_el17_time_budget_daily_plan.py tests/test_daily_session.py -q` → **13 passed**。
- EL-17 主入口双视口 → **12 passed**（`ec-e2e-static-tykP4p`），包含具名迟到响应回归，已登记覆盖门禁。

## 切片二：边界、恢复与兼容

- V3 往返实际重映射 card_id，修订条件保持；修改内容后同身份同内容仍回放原缓存，同身份异内容/新身份旧修订返回 409。事务失败前后完整公开快照相同；并发确认只产生一个事件、一次 FSRS 排期（review_count=1）。
- V3 命令修订与事件修订不一致原先被接受（200），补校验后 422 且原快照不变。V2 不能保留新修订条件的文件原先被接受，现明确提示使用 V3；旧 V2/V1 缺省条件正常读取，未补造修订知识。
- `TIME_BUDGET_ENABLED=false` 的 HTTP 与 UI 红绿完成：隐藏选择、新轮次默认八分钟，已有事件、原轮次、配额和 V3 仍可用。不是恢复旧数据库的回退。
- 额度耗尽原先隐藏余量；新分支稳定显示今日剩余 0，继续多轮不补发额度。跳过、辅助输入和句子卡不耗新词量；真实旧库升级后的基线不计新词，上海学习日午夜后按新日计算余量。
- 巩固修订冲突原先映射 500，现为 409。保存巩固后暂停再继续，原先旧 saved 反馈阻止下一题并可能把旧答案展示归给新题；真实浏览器红灯后，继续时先清理已保存反馈，下一题可输入且没有虚假接触。
- 原“积压时仍加新词”的旧断言按新规格调整；补充所有到期均可容纳时的新词组内错词/困难优先、去重与未到期词排除，保留旧排序验收要求。既有事务/恢复的首次绿色边界保留为回归，没有为造红灯破坏产品。
- 新增 12 个具名 EL-17 用户分支登记 `e2e/spec-coverage.mjs`；报告与登记名单逐项相等，两视口都有单次成功执行。覆盖校验自测仍拒绝缺分支、缺项目、跳过、失败、中断、重试、阻塞和部分覆盖。

### 验收条件到证据

| 条件 | 自动证据 |
| --- | --- |
| AC26 三档预算/默认八分钟、真实有限计划 | `test_el17_three_minute_plan_is_bounded`、`test_el17_preview_is_read_only_and_validates_budget`；EL-17 budget preview / three budgets / empty library，EC-13 默认学习入口 |
| AC27 上限/优先级/全日余量 | `test_el17_due_cap_never_fills_backlog_with_new_cards`、`test_daily_queue_keeps_new_group_priority_when_due_cards_all_fit`、`test_el17_equal_time_repeats_keep_saved_order_for_quota`、`test_el17_daily_quota_exhausts_and_resets_on_the_event_learning_day`、基线/跳过/辅助/句子卡测试；EC-14 三题终身上限分支 |
| AC29 固定目标/暂停/超时/刷新 | EL-17 budget preview pauses、两种 budget expiry 故障、late pause summary、saved reinforcement pause；EC-13 固定目标及刷新回归 |
| AC35 未确认不能推进/同身份恢复 | EL-17 response-loss / commit-failure；`test_el17_revision_save_failure_and_concurrent_confirmation_are_atomic` |
| AC36 修订/删除/迟到/恢复旧请求 | EL-17 frozen revision / deletion、late pause summary、same-browser V3 restore；巩固修订 HTTP、V3 重映射后旧请求 409 |
| AC37 幂等/冲突/同事务 | 并发确认只保存一次、故障整库回滚、V3 恢复后同内容回放/异内容冲突；既有学习提交与恢复回归 |
| RF1–RF5 | 空池无题；到期在新词前；积压零新词；新日/多轮/同时间戳配额；三分钟仍只纳入两张新卡并保留巩固估算 |

### 最终受影响 Python 验证

```text
.venv/bin/python -m pytest tests/test_el17_time_budget_daily_plan.py tests/test_daily_session.py tests/test_learning_events.py tests/test_quiz.py tests/test_stats.py tests/test_learning_metrics.py tests/test_backup_v2.py tests/test_full_restore.py tests/test_legacy_restore.py tests/test_export.py tests/test_restore_identity_migration.py tests/test_el01_expand_revisions_and_v3.py -q
→ 229 passed, 261.88s

.venv/bin/python -m pytest tests/test_review_submission.py tests/test_reviews.py tests/test_typed_attempts.py tests/test_recognition_attempts.py tests/test_session_summary.py -q
→ 62 passed, 59.28s

.venv/bin/python -m pytest tests/test_el17_time_budget_daily_plan.py tests/test_daily_session.py -q
→ 23 passed, 24.09s（在前两组之后补/强化的新边界；与前两组有重叠）
```

并发测试在最终加强 `review_count=1` 断言后单独再次运行，1 passed。旧基线测试的早期失败为夹具准备错误（NOT NULL、迁移起点），不是产品红灯；使用有效旧行并从基线引入前的真实迁移版本升级后通过。

### 最终双视口构建/浏览器身份

四个独立隔离运行同时读取冻结源与 HEAD，全部结果收齐前未改源码或提交。执行同一主入口，分别使用现有 `--ticket` 过滤；未运行未过滤门禁。

| 范围 | 单次成功数 | 诊断目录（`e2e/release-results/`） |
| --- | --- | --- |
| EL-17 | 24 | `ec-e2e-static-iBzf2z` |
| EC-13 | 32 | `ec-e2e-static-vaXBRl` |
| EC-14 | 32 | `ec-e2e-static-mGYfzE` |
| EL-05 | 14 | `ec-e2e-static-JUEkZ9` |

共 102 次成功，0 unexpected / skipped / flaky。四份报告的 HEAD 均为 `623ff7a71a4c5445fa46adaf7f3c4be2855d4e8b`，均包含当时未提交的第二切片代码；源码 SHA-256 均为 `c07016c379f3e50966e9e42b59b61bd718c7e3faa3d2b70e1a61392b6d52ff13`。Chrome 为 `155.0.8059.84`，构建 JS `index-UTAr-yzD.js`，SHA-256 `135c83faaa705bc5022b3310a5d243056f0428fbbed2f5339289abfa29671e71`。源/产物身份并非只凭提交号推断。上述运行后仅补/加强 HTTP 回归断言与文档，应用源码未变化。已查看本轮桌面和移动截图。

### 静态检查与审查范围

- fresh origin/dev 基线仍为 `d084272`；changed-file Ruff check/format 与 `git diff --check` 通过。现有配置的 Pyright 对除 `app/schemas/backup.py` 外的 12 个改动 Python 文件为 0 errors / warnings。
- `backup.py` 最终再次检查仍仅有基线两项 `BaseModel.id/card_id` 类型错误（162/177 行）；未声称其通过。独立前端类型/静态命令 **N/A**（package.json 未配置）；四次实际 Vite 构建通过。
- 切片一复审 `d084272..623ff7a`：Standards / Spec 均无未处理问题。第二切片审查固定 `623ff7a..HEAD` 并复核整票 `d084272..HEAD`，独立两轴结论随本次会话记录；审查不跑全量门禁。
- 全量 pytest、未过滤 E2E、生产发布与真实外部服务仍为上文所列 **未验证**，不把分组成功写成完整门禁通过。
