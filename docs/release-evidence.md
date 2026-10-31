# EC-16 发行证据与聚合验收

状态：EC-16 实现与定向验证中；父规格 AC01–AC15 的最终集成验收待执行。下表是可复核的行为映射，不是全套通过声明。只有最终合并后的未过滤 E2E、完整 pytest、生产构建和安全检查均有真实输出，才可声明整体交付。

## 命令与诊断

`npm --prefix frontend run test:e2e` 每次新建构建目录，运行所有已交付场景，再按实际 Playwright JSON 对以下具名分支逐一检查 mobile（420×880）和 desktop（1280×720）。任何测试跳过、预期失败、失败后重试、超时、中断、缺项目或缺分支都不接受。

报告位于 `e2e/release-results/<run>/`：`run.json` 保存 HEAD、工作区状态、包含未提交/未跟踪源码的内容摘要、构建时刻与产物摘要；`playwright.json`、`artifacts/` 与 `coverage.txt` 属于同一次运行。源码或 HEAD 在运行中变化也会使门禁失败。失败进程保留诊断，临时前端目录和隔离应用在结束后清理。

以下补充 HTTP/安装场景通过主命令中的具名 Playwright 包装执行；`e2e/support/contracts.py` 核对实际 JUnit 中每个参数身份和通过状态，缺失、跳过、失败或进程中断均非零。它们明确是补充 seam，不冒充浏览器输入排列。

| 补充组 | 实际必经用例 |
| --- | --- |
| installation | 新库迁移；旧配置与冲突两参数；自定义库目标；显式迁移目标（5） |
| upgrade | 已标记但缺评分列修复；升级后公开 API 评分（2）；另有真实旧库浏览器续学 |
| concurrent | 同 UUID 并发相同请求和不同评分（2，200/200 或 200/409） |
| invalid | V2 全图 16 参数、旧状态 4 参数、NaN、提交缓存 9 参数、审计 6 参数（36） |
| faults | 安全副本落盘、插入中途、提交三种故障（3） |
| ambiguous | 旧数据无法消歧拒绝（1） |

## T01–T21 实际分支要求

每个具名断言必须在两个项目真实通过；仅存在源码或 annotation 不计完成。详细断言位于对应 `e2e/ec-*.spec.mjs`，补充用例选择固定在 `contracts.py`。

| 场景 | 必经具名测试 |
| --- | --- |
| T01 | `EC-01 no-key-home`<br>`EC-01 external-missing` |
| T02 | `EC-16 installation configuration contracts` |
| T03 | `EC-16 old database upgrade contracts`<br>`EC-16 upgraded old database continues through UI` |
| T04 | `EC-02 first-learning without ai`<br>`EC-02 repeat-add-does-not-duplicate`<br>`EC-02 keeps custom card content`<br>`EC-02 sentence-card-does-not-block-word` |
| T05 | `EC-04 transport-failure-retry`<br>`EC-04 commit-failure-retry`<br>`EC-16 server error retains unsaved answer` |
| T06 | `EC-04 response-loss-reload`<br>`EC-05 lost-response-retry-saves-once`<br>`EC-07 choice-unknown-refresh-retry-once` |
| T07 | `EC-06 quiz-batch-is-atomic-and-once`<br>`EC-16 concurrent submission contracts` |
| T08 | `EC-16 three days retain ratings and two-thirds pass rate` |
| T09 | `EC-08 same-day-two-attempts-one-word` |
| T10 | `EC-07 listening-source-parity`<br>`EC-07 typed-and-choice-source-policy-parity`<br>`EC-07 listening-single-saved-event` |
| T11 | `EC-05 independent-input`<br>`EC-05 feedback-is-assistance`<br>`EC-05 explicit-skip-is-not-wrong`<br>`EC-05 leaving-page-creates-no-event`<br>`EC-06 skip-records-null-correct`<br>`EC-06 choosing-does-not-change-due` |
| T12 | `EC-16 Shanghai midnight preserves both learning days` |
| T13 | `EC-08 legacy-baseline-does-not-fake-days`<br>`EC-09 no-samples`<br>`EC-09 target-does-not-override-new-limit` |
| T14 | `EC-10 download-complete-backup`<br>`EC-12 restore-other-instance-and-continue`<br>`EC-16 complete install learn restore journey`<br>`EC-16 legacy readonly preserves new events and forward learning`<br>`EC-16 legacy implicit GET write is visibly blocked` |
| T15 | `EC-11 invalid-file-keeps-data`<br>`EC-12 invalid-graph-rollback-and-preview-conflict`<br>`EC-16 invalid backup contracts` |
| T16 | `EC-12 invalid-graph-rollback-and-preview-conflict`<br>`EC-16 safety backup and insertion fault contracts` |
| T17 | `EC-11 import-legacy-twice-keeps-story`<br>`EC-16 ambiguous legacy contracts` |
| T18 | `EC-13 daily round is due-first with fixed target and visible backlog`<br>`EC-13 a completed full round leaves the backlog for a fresh next round` |
| T19 | `EC-14 main low rating and explicit skip both become reinforcement`<br>`EC-14 three question lifetime cap survives refresh without refilling`<br>`EC-14 no weak items reads summary and a summary failure remains retryable`<br>`EC-14 assisted reinforcement stays weak without another schedule` |
| T20 | `EC-16 TTS retries the same word after provider recovery`<br>`EC-16 a newer replay owns its playback deadline`<br>`EC-16 speech prewarming cannot block detail or saving`<br>`EC-16 TTS uses controlled external adapter`<br>`EC-16 TTS provider timeout preserves saved learning`<br>`EC-16 TTS provider error preserves saved learning`<br>`EC-01 external-missing`<br>`EC-01 external-timeout`<br>`EC-01 external-unavailable`<br>`EC-04 ai-upgrade-failure-does-not-block`<br>`EC-06 tts-failure-options-usable`<br>`EC-13 load error is distinct from empty library and offers retry` |
| T21 | `EC-13 small library completes with keyboard and keeps specialist practice`<br>`EC-16 complete install learn restore journey` |

## AC01–AC15 核对

| 验收条件 | 行为证据 | 聚合状态 |
| --- | --- | --- |
| AC01 安装/升级 | T01–03，installation/upgrade JUnit、真实旧库 UI 续学 | 待最终未过滤运行 |
| AC02 无密钥本地闭环 | T01、T04、EC-16 入门/下载/恢复/继续评分 | 待最终未过滤运行 |
| AC03 原子统一提交 | T05–07、T10–11，现有学习提交/识别/输入 HTTP 回归 | 待完整 pytest 与 E2E |
| AC04 保存确认/幂等 | T05 transport/server/commit，T06 响应丢失，T07 同 UUID 并发/冲突/批次 | 待最终未过滤运行 |
| AC05 真实统计 | T08 逐日 UI 评分 1/3/4→2/3，T09 去重，T12 上海午夜，T13 未知/样本 | 待最终未过滤运行 |
| AC06 题型规则 | T10 来源策略一致，T11 提示/识别/跳过/离开；README 规则表 | 待完整 pytest 与 E2E |
| AC07 完整备份往返 | T14 全实体关联/同词不同卡型；EC-16 UI 文件往返与新 ID 续学 | 待最终未过滤运行 |
| AC08 坏文件/回滚/旧格式 | T15 36 参数，T16 三故障，T17 歧义与重复部分恢复 | 待最终未过滤运行 |
| AC09 预览/确认/安全副本 | T14/16/21；EC-16 键盘取消不写入、确认后显示安全副本 | 待最终未过滤运行 |
| AC10 每日主线 | T18–20；EC-16 主队列→薄弱词输入→已保存反馈→结果→跨天 | 待最终未过滤运行 |
| AC11 两视口键盘 | T21；EC-16 使用 Tab/Enter/PageDown，焦点、横向边界和中心命中断言；保存失败可键盘重试 | 待最终未过滤运行 |
| AC12 可信命令 | 实际结果门禁、独立迁移库/端口、外部替身；CLI 缺失/skip/blocked/中断非零测试 | 待最终完整命令 |
| AC13 回归与构建 | 定向检查与最终生产构建；合并后完整 pytest/E2E/build/audit | 待父执行最终全套 |
| AC14 文档一致 | README/.env.example/CONTEXT/ADR；兼容边界、题型、学习日、备份范围、旧历史限制 | 已同步；待独立审查 |
| AC15 不提前完成 | 本表保留最终待验项；单票与历史日志不充当最终集成证明 | 整体未声明完成 |

## 定向验证记录

2026-10-31 本分支定向记录（不是最终集成全套）：

| 命令 | 实际结果 |
| --- | --- |
| `npm --prefix frontend run test:e2e -- --ticket EC-16` | 38 passed，mobile/desktop 各 19，4.1 分钟，exit 0；无跳过或重试 |
| `python -m pytest tests/test_release_coverage.py -q` | 16 passed，exit 0；包含缺分支、非通过、阻塞、中断和三个 TTS 回归分支缺失的拒绝 |
| 受影响 Python 的 `ruff check` / `ruff format --check` | server、seed、readonly_server、contracts、test_release_coverage 五文件均 exit 0 |
| `npm --prefix frontend audit --json` | total 0，exit 0；锁文件只更新 Vite 7.3.6→7.3.7、source-map-js 1.2.1→1.2.2 两项补丁 |
| TTS 受影响组合 | 12 passed，exit 0；另有预热公共 UI 2 passed，exit 0 |
| 配置的生产 `npm --prefix frontend run build` | 待源码提交后生成最终跟踪产物 |

定向报告 `ec-e2e-static-qxjIum` 实际状态为 passed；构建时间 `2026-10-31T05:49:06.210Z`，HEAD 为 `7d19ac103d7e2ec4be66aebe88d90ae740c40994` 且工作区有未提交实现，完整源码摘要为 `d31da2f8c6e9802f69685f89d01c137bf4a545decb0dde06c781663099b6faa7`。不能把该 HEAD 单独当作实现身份。构建使用 Vite 7.3.7，JS 摘要 `5ad4a472680735ef40d3f5fa10fcdf6f03c211e0e48fe4824876a15df2400504`；运行期间源码与 HEAD 均保持不变。本节验后填写的报告文字不改变行为。

补充 JUnit 实际执行 installation 5、upgrade 2、concurrent 2、invalid 36、faults 3、ambiguous 1，各视口共 49 个具名参数用例，合计 98；无 missing/skipped/failure/error。完整同次 JSON/JUnit 与诊断副本保留在 `/tmp/english-coach-followup-2026-10-31/ec16-qualified-focused-results/`，命令输出为该目录同级 `ec16-qualified-focused-e2e.log`、`ec16-final-coverage-cli.log`、`ec16-final-verified-{ruff,format}.log`、`ec16-qualified-audit.log`。

类型检查：N/A，项目没有 TypeScript/typecheck 脚本。

早期 RED/重跑日志位于实施会话的 `/tmp/english-coach-followup-2026-10-31/ec16-*.log`，每份包含完整命令、输出与 EXIT_CODE；文件名含 green 不等于成功，以实际退出码为准。错误的测试预期（毕业新增句卡、HTTP 指标字段位置、TTS preload 的 200/cached=false 语义）单独记录为测试修正，不声称产品 RED→GREEN。有效循环包括覆盖门禁、JUnit 参数门禁、真实旧版不安全 POST、TTS 外部适配成功/故障及旧 GET 隐式写入保护。TTS 另有真实外部故障后同词重试、旧播放调用不能取消新重播、慢预热未完成仍可详情评分的公共 UI RED→GREEN；T20 明确要求三条分支。重播用例在外部适配处控制音频释放，避免将浏览器 request 事件误当提供方已经开始；成功仍须真实媒体 ended。初期固定延迟用例的组合失败和撤回的 seek 原因假设保留在日志中，不算 GREEN，也不证明 EC14 历史停滞具有同根因。

## 最终集成门禁（父任务合并后填写）

- 未过滤 `npm --prefix frontend run test:e2e`：待执行，须有 T01–T21 两项目分支摘要。
- `python -m pytest -q`：待执行。
- `npm --prefix frontend run build`：待最终集成复核。
- 受影响 Python Ruff 与 `npm --prefix frontend audit --json`：待最终集成复核。
- 独立 Standards / Spec 固定差异审查：待父任务执行。

[真实旧版兼容与前向恢复边界](release-compatibility.md)。
