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
