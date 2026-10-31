# EC-16 发行证据与聚合验收

状态：后续切片已集成，父规格 AC01–AC15 已取得最终验收证据。冻结提交 `3d1c453bc1b0b142824d3ff5c8bd3b72b52e7c9e` 的完整 pytest、未过滤双视口 E2E 和适用门禁均通过；下面保留定向历史与最终记录的区别。合并记录以 GitHub 为准，未部署。

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
| AC01 安装/升级 | T01–03，installation/upgrade JUnit、真实旧库 UI 续学 | 通过：最终两视口全部分支 |
| AC02 无密钥本地闭环 | T01、T04、EC-16 入门/下载/恢复/继续评分 | 通过：最终两视口全部分支 |
| AC03 原子统一提交 | T05–07、T10–11，现有学习提交/识别/输入 HTTP 回归 | 通过：416 pytest 与 244 E2E |
| AC04 保存确认/幂等 | T05 transport/server/commit，T06 响应丢失，T07 同 UUID 并发/冲突/批次 | 通过：最终两视口全部分支 |
| AC05 真实统计 | T08 逐日 UI 评分 1/3/4→2/3，T09 去重，T12 上海午夜，T13 未知/样本 | 通过：最终两视口全部分支 |
| AC06 题型规则 | T10 来源策略一致，T11 提示/识别/跳过/离开；README 规则表 | 通过：416 pytest 与 244 E2E |
| AC07 完整备份往返 | T14 全实体关联/同词不同卡型；EC-16 UI 文件往返与新 ID 续学 | 通过：最终两视口全部分支 |
| AC08 坏文件/回滚/旧格式 | T15 36 参数，T16 三故障，T17 歧义与重复部分恢复 | 通过：最终两视口全部分支 |
| AC09 预览/确认/安全副本 | T14/16/21；EC-16 键盘取消不写入、确认后显示安全副本 | 通过：最终两视口全部分支 |
| AC10 每日主线 | T18–20；EC-16 主队列→薄弱词输入→已保存反馈→结果→跨天 | 通过：最终两视口全部分支 |
| AC11 两视口键盘 | T21；EC-16 使用 Tab/Enter/PageDown，焦点、横向边界和中心命中断言；保存失败可键盘重试 | 通过：最终两视口全部分支 |
| AC12 可信命令 | 实际结果门禁、独立迁移库/端口、外部替身；CLI 缺失/skip/blocked/中断非零测试 | 通过：未过滤命令 exit 0 |
| AC13 回归与构建 | 定向检查与最终生产构建；合并后完整 pytest/E2E/build/audit | 通过：最终全套与构建 |
| AC14 文档一致 | README/.env.example/CONTEXT/ADR；兼容边界、题型、学习日、备份范围、旧历史限制 | 已同步；固定差异双轴审查无重要未处理项 |
| AC15 不提前完成 | 分别记录定向历史与最终测试身份；单票与历史日志不充当最终集成证明 | 全部验收证据已取得；合并记录以 GitHub 为准，未部署 |

## 定向验证记录

2026-10-31 本分支定向记录（不是最终集成全套）：

| 命令 | 实际结果 |
| --- | --- |
| `npm --prefix frontend run test:e2e -- --ticket EC-16` | 38 passed，mobile/desktop 各 19，4.1 分钟，exit 0；无跳过或重试 |
| `python -m pytest tests/test_release_coverage.py -q` | 原 38 场景阶段 16 passed；复审中断修复后 18 passed（见后续记录），exit 0；包含缺分支、非通过、阻塞、中断和三个 TTS 回归分支缺失的拒绝 |
| 受影响 Python 的 `ruff check` / `ruff format --check` | server、seed、readonly_server、contracts、test_release_coverage 五文件均 exit 0 |
| `npm --prefix frontend audit --json` | total 0，exit 0；锁文件只更新 Vite 7.3.6→7.3.7、source-map-js 1.2.1→1.2.2 两项补丁 |
| TTS 受影响组合 | 12 passed，exit 0；另有预热公共 UI 2 passed，exit 0 |
| 配置的生产 `npm --prefix frontend run build` | exit 0；从干净源码提交 `3cb67c956b3b104258e13e80ab8a51bcb61e4473` 生成最终跟踪产物，cache `?v=4` |
| 生产静态资源 HTTP smoke | 真实隔离迁移库下首页/JS/今日队列均 200，JS 字节摘要与定向浏览器构建完全相同，exit 0 |

定向报告 `ec-e2e-static-qxjIum` 实际状态为 passed；构建时间 `2026-10-31T05:49:06.210Z`，HEAD 为 `7d19ac103d7e2ec4be66aebe88d90ae740c40994` 且工作区有未提交实现，完整源码摘要为 `d31da2f8c6e9802f69685f89d01c137bf4a545decb0dde06c781663099b6faa7`。不能把该 HEAD 单独当作实现身份。构建使用 Vite 7.3.7，JS 摘要 `5ad4a472680735ef40d3f5fa10fcdf6f03c211e0e48fe4824876a15df2400504`；运行期间源码与 HEAD 均保持不变。本节验后填写的报告文字不改变行为。

补充 JUnit 实际执行 installation 5、upgrade 2、concurrent 2、invalid 36、faults 3、ambiguous 1，各视口共 49 个具名参数用例，合计 98；无 missing/skipped/failure/error。完整同次 JSON/JUnit 与诊断副本保留在 `/tmp/english-coach-followup-2026-10-31/ec16-qualified-focused-results/`，命令输出为该目录同级 `ec16-qualified-focused-e2e.log`、`ec16-final-coverage-cli.log`、`ec16-final-verified-{ruff,format}.log`、`ec16-qualified-audit.log`。

生产构建的干净源码摘要为 `03cbdcbc757b4204ccc248696b0cf90fa58a71999318c14e047a706f499edfd5`，构建开始于 `2026-10-31T05:55:11.603790Z`；生成的 JS、index、style、favicon 与 38 场景所用字节逐项相同。完整来源见外部 `ec16-production-build-provenance.json`，真实命令输出 `ec16-qualified-production-build.log` 与 `ec16-qualified-production-smoke-verified.log`。本节后续仅补充报告文字，生产输入与产物未改变。

类型检查：N/A，项目没有 TypeScript/typecheck 脚本。

早期 RED/重跑日志位于实施会话的 `/tmp/english-coach-followup-2026-10-31/ec16-*.log`，每份包含完整命令、输出与 EXIT_CODE；文件名含 green 不等于成功，以实际退出码为准。错误的测试预期（毕业新增句卡、HTTP 指标字段位置、TTS preload 的 200/cached=false 语义）单独记录为测试修正，不声称产品 RED→GREEN。有效循环包括覆盖门禁、JUnit 参数门禁、真实旧版不安全 POST、TTS 外部适配成功/故障及旧 GET 隐式写入保护。TTS 另有真实外部故障后同词重试、旧播放调用不能取消新重播、慢预热未完成仍可详情评分的公共 UI RED→GREEN；T20 明确要求三条分支。重播用例在外部适配处控制音频释放，避免将浏览器 request 事件误当提供方已经开始；成功仍须真实媒体 ended。初期固定延迟用例的组合失败和撤回的 seek 原因假设保留在日志中，不算 GREEN，也不证明 EC14 历史停滞具有同根因。

## 最终集成门禁（2026-10-31 实际结果）

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `python -m pytest -q` | 416 passed，190.85 秒，exit 0 |
| 未过滤 `npm --prefix frontend run test:e2e` | 244 passed，28.3 分钟，exit 0；mobile/desktop 各 122；无跳过、预期失败或重试 |
| T01–T21 实际结果门禁 | 两项目全部必需分支通过；正式 `coverage.txt` 已逐场景记录 |
| 六组补充 JUnit | 两项目各 49 个参数用例；12 份 XML 共 98 项，无 failure/error/skipped；它们是 HTTP/安装补充，不是额外浏览器用例 |
| `npm --prefix frontend ci` / `npm --prefix frontend run build` | exit 0；根目录按锁安装 Vite 7.3.7；再次构建与提交产物逐字节相同，cache `?v=5` |
| 生产静态资源 HTTP smoke | 隔离迁移库下首页、JS、今日队列均 200；实际返回 JS 摘要与构建一致 |
| 变更 Python 的 `ruff check` / `ruff format --check` | Git 固定基线至最终实现的 30 个现存 Python 文件，均 exit 0 |
| `npm --prefix frontend audit --json` | exit 0，全部严重级别 total 0 |
| Standards / Spec | 非空固定差异 `8ad4d36...b0dc5e7` 及最后 CLI 修复 `b0dc5e7...544c954` 分别审查；实际集成源与已审提交相同，重要未处理项各 0 |

构建、Ruff、audit 的实际结果来自 `b0dc5e7`；最后合入的 `3d1c453` 只补回测试命令的一行非法参数诊断，生产构建、Python 与锁文件输入逐字节相同，因此复用这些相关检查，没有假称重新运行。完整 pytest 和未过滤 E2E 则在最后合并后重新执行。

测试提交为 `3d1c453bc1b0b142824d3ff5c8bd3b72b52e7c9e`。主命令开始于 `2026-10-31T06:49:35.595Z`，本次构建完成于 `06:49:36.327Z`；源码内容摘要为 `ad35da2321dac33b6c0128544420e24775a8957f572d73e7c0bf1a73debb1073`。摘要包含原有未跟踪文档，运行期间 HEAD 与内容均冻结；本节是验后仅文档补记，不能将补记提交冒充测试提交。

本次报告为 `e2e/release-results/ec-e2e-static-zhNTR2/`，`run.json` 实际 `status=passed`、`ticket=null`。正式 JSON 逐项核对 244 次执行，每项恰有一个 passed 结果；无报告错误。`coverage.txt` 逐条列出 T01–T21 两项目分支。完整诊断另保留于 `/tmp/english-coach-followup-2026-10-31/final-unfiltered-results/`；原始输出为同级 `final-pytest-resumed.log`、`final-unfiltered-e2e.log`、`final-reproducible-build.log`、`final-ruff-{check,format}.log`、`final-npm-audit.json`。机器证据为 `final-gates-result.json` 与父代理独立核对的 `final-root-evidence-inspection.json`。

本次新构建与提交的生产文件摘要逐项相同：

- `index-DfwY2ILZ.js`：`a7527ab6727de1bcdb53985b8cb634325bf02828dbc786b7cd65cf102cb1e603`。
- `index.html`：`1446b3251ac78b797e08ea93cd9b3a901cf31f17445d5a14fbfc308e8a3a93a6`。
- `style.css`：`559448c6cc4597f3c3d1580349b0c483a112bdc5dfa8c383e611085008e75ff9`。
- `favicon.svg`：`f785f84057e716ae12632ae706e639c36f0b893abe8ab53835c54ec72c0b7e8b`。

完整门禁首次运行曾有 415 passed / 1 failed：旧 CLI 回归要求非法参数含 `Invalid`，新诊断只有 Usage。保留原断言，仅补回 `Invalid arguments.`；同一测试先 RED 后 GREEN，34 项相关测试通过，五类真实 npm 非法调用仍 exit 2，经双轴复审后重新运行完整 416 项与本次未过滤 E2E。初次失败保留在 `final-pytest.log`，没有改称通过。

最终恢复审查修复也有公开行为 RED→GREEN：V2 必须携带预览修订；命令会话/评分与外层事件、规范化答案与缓存相符；可接受的外层会话 UUID 规范保存后能读取结果和巩固。前端三个晚到响应路径均按提交 UUID 保护下一条待确认记录，刷新重试保持同一事件和排期。代码、测试与既有 ADR 契约一致。

未配置门禁为 **N/A**：TypeScript/typecheck、前端 ESLint、CI/Makefile、Docker Compose、变异测试、独立 SAST。没有把这些检查计为通过。真实迁移、入门 seed、备份恢复故障、旧版只读与前向续学已在上述实际测试内验证。外部 AI/TTS 使用已批准的可控适配器，真实供应商内容质量**未验证**；Windows `TerminateProcess` 后代清理**未原生验证**，Linux/POSIX 的中断清理已有实际证据。

本轮差异未新增数据库、生产数据文件或可识别密钥；原有未跟踪文档保留，测试使用独立数据库。仅验后报告文字的补记不改变已验行为或产物，需独立审查文档差异。

[真实旧版兼容与前向恢复边界](release-compatibility.md)。


## 整票复审后的补充进程清理

固定版本 `34d29aa` 的真实 RED：补充包装器收到 SIGTERM 后退出，实际 pytest 子进程仍存活。新增公共命令生命周期回归先复现这一泄漏，再改为隔离 POSIX 进程组；信号处理器只标记/转交控制流，正常控制流负责转发信号、最多 3 秒宽限、必要时强制结束所属组，并回收 pytest。中断仍非零（SIGTERM 143、SIGINT 130），`.log` 保留 `INTERRUPTED` 与退出码，不把未完成的 JUnit 当作通过。

修复后定向验证：

- 同一 SIGTERM 公共回归从 1 failed 变为 1 passed；SIGTERM/SIGINT 两参数均通过。
- `python -m pytest tests/test_release_coverage.py -q`：18 passed，Linux 下无跳过；原缺失/跳过/失败/阻塞参数资格自检仍拒绝。
- 六个真实正常补充组共 49 个具名参数用例通过并核对 JUnit（5/2/2/36/3/1）。中断以外的分支资格契约保持原状。
- 独立真实进程树演练覆盖 pytest 和后代均忽略优雅信号的情形，两种信号约 3.03 秒强制收敛；也覆盖 pytest 先退出、忽略信号的后代已关闭继承管道的情形。pytest 被包装器回收，后代被终止并由隔离演练的 subreaper 回收，未遗留运行进程。
- 受影响 `contracts.py` / `test_release_coverage.py` 的 Ruff check/format 均 exit 0。

本次信号路径只在 Linux 原生验证。非 POSIX 的信号回归明确标为不适用；Windows 的 `TerminateProcess` 不会触发 Python 信号处理器，该强制终止路径未原生验证，不计为平台通过。没有为此引入跨平台进程框架。此修复只改测试支持、回归与报告，生产源码和产物未变化，未重复生产构建或全部 38 场景；最终合并后的未过滤全套实际结果见上节。

实际输出与诊断位于外部 `ec16-contract-interrupt-{red,green}.log`、`ec16-contract-interrupt-signals.log`、`ec16-contract-cleanup-coverage.log`、`ec16-contract-normal-groups.log`、`ec16-contract-tree-{force,closed-pipe}.log`、`ec16-contract-qualifier-selftest.log` 和 `ec16-contract-cleanup-{ruff,format}.log`。具名 JUnit/正常组日志在 `ec16-contract-cleanup-groups/`；保留的实际信号日志在 `ec16-contract-signal-diagnostics/` 与 `ec16-contract-tree-closed-pipe/`，均位于此前同一 `/tmp/english-coach-followup-2026-10-31/`。


## 分票顺序发布与验收复用（2026-10-31）

已审实现按 EC12 → EC07 → EC13 → EC15 → EC14 → EC16 顺序重组。此前完整验收身份仍为 `3d1c453bc1b0b142824d3ff5c8bd3b72b52e7c9e`：416 项 pytest、244 项未过滤双视口 E2E 与 T01–T21 全分支。验后文档参考树为 `d0351fb66e4a1158f2eb2adc592b3f0bf44caa4e`。下列分票当前结果和旧完整门禁分别保留各自身份。

| 已合并票据 | PR | GitHub 合并提交 |
| --- | --- | --- |
| EC-12 | [#31](https://github.com/Zeming-Yuan/english-coach/pull/31) | `4fc5a0d3af5c734b961324218fdd4f9d2d720348` |
| EC-07 | [#32](https://github.com/Zeming-Yuan/english-coach/pull/32) | `9fa628f5df6176d4e95fdd273c492ab819b5727c` |
| EC-13 | [#33](https://github.com/Zeming-Yuan/english-coach/pull/33) | `d53e7c9917a5be59f82cddb64e7df896b3f99067` |
| EC-15 | [#34](https://github.com/Zeming-Yuan/english-coach/pull/34) | `1334e93d4c1aa89de2c700a4b85580104aad43b7` |
| EC-14 | [#35](https://github.com/Zeming-Yuan/english-coach/pull/35) | `2ab3be00002312288a2bab1d16a1ba7f723603a9` |

EC16 本票当前为待审候选；合并与 issue #17、父规格 #1 的最终关闭以 GitHub 记录为准，未部署。

EC16 定向测试的代码提交为 `9b15432b09b07e3e2dd0983c5cc6c70efa436f1a`。重组后的核心源码、全部测试、依赖锁、样式与 JavaScript 产物逐字节等于 `d0351fb`；仅两个 HTML 的样式缓存查询单调递增为 `?v=8`，以及本节/CONTEXT 的发布记录属于元数据差异。JavaScript 仍为 `index-DfwY2ILZ.js`，SHA256 `a7527ab6727de1bcdb53985b8cb634325bf02828dbc786b7cd65cf102cb1e603`。

| 本次分票定向检查 | 实际结果 |
| --- | --- |
| 当前工作树 `npm --prefix frontend ci` / audit | 锁定安装完成，audit JSON 为 0 漏洞 |
| 新鲜生产构建 | 成功；cache 8，JavaScript 与已验产物相同 |
| 临时迁移库生产 HTTP smoke | index、同摘要 JS、today 均 200；cache 8 |
| `tests/test_ec_environment.py` + `tests/test_release_coverage.py` | 34 passed，11.16 秒，exit 0 |
| 本票 5 个变更 Python 文件 Ruff check/format | 全部通过 |
| 两视口定向公开旅程与兼容/TTS | 14 passed，2.0 分钟，exit 0；每视口 7 项，无跳过或重试 |

定向浏览器覆盖安装→学习→备份→恢复旅程、真实旧版只读与隐式 GET 写保护、TTS 超时/播放所有权/预热、旧库升级后 UI 续学。运行报告 `e2e/release-results/ec-e2e-static-oYqOKA/` 的 `run.json` 为 passed；外部留存 `/tmp/english-coach-followup-2026-10-31/per-ticket/ec16-selected-results/`，同级 `ec16-frontier-manifest.json` 记录最终等价差异与新提交。原完整 416/244 通过结果按相同核心/测试/锁/样式/JS 复用，本次新 SHA 的实际执行是上述定向检查。本节为验后文档记录，不替代运行提交身份。

既有未验证边界保持：付费外部 AI/TTS 质量、Windows 强制终止后代清理和部署均未验证；只读旧版回退不允许恢复旧写入或覆盖新进度。
