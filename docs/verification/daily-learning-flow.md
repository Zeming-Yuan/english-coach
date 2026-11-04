# 每日学习体验优化（#84 / EL-22）

规格：[GitHub #84](https://github.com/Zeming-Yuan/english-coach/issues/84)，用户在会话中确认设计、测试边界及基线。
基线：`8d827ccc9debb0881bbfad0126269810a0de4e46`，隔离分支 `codex/daily-learning-flow`。
按优先级串行实现；测试仅经真实 UI、公开 today/summary API 与迁移 SQLite。

## 切片 1：唯一的下一步

- 首页主任务区域命名“今天下一步”，理由从同一份当前预览或冻结轮次派生；继续轮次优先。
- 空库、无可学卡、到期复习、新词与恢复模式的理由不冒充完成或暴露英文答案。
- RED：`ec-e2e-static-qh8jqN`，两视口均因缺少下一步区域/理由失败。第一次实现脚本误用环境不存在的 `python`，未改动代码；随后重复红灯 `nyrPPv` 不作为实现证据。
- GREEN：`EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm --prefix frontend run test:e2e -- --ticket EL-22` → 2 passed，`ec-e2e-static-trGcok`。验证三分钟目标、唯一开始按钮、暂停/刷新后同索引继续、未提前揭示英文答案。构建在同次主入口完成。
- 基线公开接口：`.venv/bin/python -m pytest tests/test_daily_session.py tests/test_session_summary.py -q` → 14 passed。
- 前端独立类型/静态命令 N/A：package.json 未配置；没有 Python 产品变更，不扩大类型检查范围。
- 独立 Standards / Spec reviewer 对 `8d827cc...e371bf1` 均无 actionable findings；未直接验证的理由分支继续标记为补充验证范围。

## 门禁边界

全量 pytest、未过滤 E2E、真实外部模型/音频和生产部署未验证；按用户要求只运行受影响范围。
本票不增加账户/权限、数据库写入或迁移。安全扫描、容器、不可逆迁移恢复 N/A；不声称既有发布流程通过。
回滚方式：撤回前端改动，保留所有服务器学习事件、时长与排期。

## 切片 2：首页信息层级

- 样本、估算公式、目标设置、余量折入原生 details，键盘和触屏均可展开。时间、理由、本轮任务和开始保留在外层，沿用当前视觉系统。
- RED：初次 negative visibility 断言遇到加载空态提前通过，最终缺少详情入口而超时；停止该轮，不作为有效红灯证据。补“预估已可见”的前置条件后，`ec-e2e-static-xvabQQ` 两视口均因估算依据仍在外层可见失败。
- GREEN：EL-22 6 passed，`ec-e2e-static-02ycfc`；EC-09 6 passed，`ec-e2e-static-4EFVne`；EC-13 32 passed，`ec-e2e-static-6MDXHc`。均使用 README 主入口、新构建、独立数据库和实际 Chrome 双视口；所有结果收齐后才修改文档。
- 截图已实际查看：桌面/移动 home-focused，验证标题和开始按钮完整在首屏，手机无横向溢出。更新既有目标测试，仅增加真实展开步骤，保留原断言。
- 独立前端类型/静态命令仍 N/A；本片无后端改动。审查固定点 `e371bf1`。

- 切片 2 独立 Standards / Spec 对 `e371bf1...f14020c` 均无 actionable findings。Spec reviewer 无法读取实时 GitHub（401），改用本会话确认、发布时保存的完整 issue body；未核实时评论。

## 切片 3：完成收尾

- 只在真实 summary 成功后，完成态显示“本轮已完成，今天可以结束了”；暂停态仍显示剩余目标，没有完成提示。待巩固词保持外层可见，指标、下一排期和自选测验折入详情。恢复模式另外提供“今天先到这里”，常规计划仍可选。
- RED：`ec-e2e-static-p8iYch`，新增两视口因缺少 daily-closure 失败，旧分支 6 passed。
- GREEN：EL-22 8 passed，`ec-e2e-static-yOSVWB`；已查看桌面与移动 daily-closure 截图。公开备份事件对比确认展开详情不写学习记录，主队列两次保存、仍有 apple 待复习。
- EC-14 首轮 28 passed / 4 failed（两个具名分支 × 双视口）；诊断为旧测试通用 summary 选择器歧义、指标已折叠未展开，产品保存状态机未改。精确指向“专项练习”并补真实展开后，EC-14 **32 passed**，`ec-e2e-static-Lq4s2f`。
- 同样依赖通用 summary 的 EC-04 课程及 EC-16 两个 TTS 失败分支改为准确控件，定向 **6 passed**。此补充用项目已有 Playwright CLI/config 和 runner 同等 Vite 新构建 `/tmp/ec84-slice3-static` 执行：`EC_STATIC_DIR=/tmp/ec84-slice3-static EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_REPORT_PATH=/tmp/ec84-slice3-scoped-report.json node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs --grep 'EC-04 lesson-rating-stays-on-failure|EC-16 TTS provider (timeout|error) preserves saved learning'`。保留全部原断言；无全量门禁。
- 前端独立类型/静态命令 N/A；审查固定点 `f14020c`。

- 切片 3 独立 Standards / Spec 对 `f14020c...c1bd487` 均无 actionable findings。Standards 自行执行 summary 9 passed；Spec 用新构建独立复跑完成、暂停/刷新、summary 失败重试，双视口 6 passed（`/tmp/ec84-spec-review-c1bd487-report.json`）。

## 切片 4：本浏览器的完成观察与建议

- 观察只记录轮次 ID、开始时间和中断/完整保存标记，保留最近 30 轮明细及更早记录的建议摘要；不存词卡内容或答案，不进入数据库/FSRS/配额/完成统计。原冻结轮次仍是唯一进度来源。
- 最近三轮两次中断时未来默认建议三分钟；连续三轮完整保存后按 3→8→15 逐档恢复，常规预算偏好是自动建议上限。用户显式改选可覆盖。中断后再完成仍保留中断；同轮重复暂停/刷新/并发标签页按 ID 合并。仅跳过记中性结束，打断上调连续数。
- 原生 Web Locks 串行合并和恢复清理，恢复 generation 拒绝跨恢复迟到的旧观察；确认完整保存后不接受旧标签页的迟到中断。存储失败不阻断学习。直接关窗未可靠观察时不推断完成/退出；不承诺跨设备。
- `BackupPage` 等待原恢复完成回调，成功后清除旧浏览器建议；全日预算偏好、服务器学习记录/配额照旧。读取/保存失败不制造完整保存观察。

### RED → GREEN 证据

| 切片行为 | RED | GREEN |
| --- | --- | --- |
| 两次退出后缩短，重复暂停只计一轮 | `ec-e2e-static-VC8qIv`，选项仍为 8 而非 3 | `ec-e2e-static-e8sBj4`，10 passed；含直接退出与冻结继续 |
| 稳定完成三轮后逐档恢复 | `ec-e2e-static-ejXLAP`，仍为 3 而非 8 | `ec-e2e-static-QqZqYn`，12 passed；真实保存失败/重试、并发暂停、备份恢复同一流程 |
| 全跳过不能触发加量 | `/tmp/ec84-skip-red-report.json`，错误升为 8 | `/tmp/ec84-skip-green-report.json`，2 passed，15 条真实跳过事件，原 reviews 完整不变 |
| 空库仍有冻结轮次时保留继续/显式退出 | `/tmp/ec84-delete-red-report.json`，缺少继续按钮 | `ec-e2e-static-ImgEUu`，20 passed；删除接口、404、显式放弃与零虚假事件 |
| 旧标签页迟到退出不能否定已完成 | `/tmp/ec84-stale-red-report.json`，建议从 8 错降到 3 | 修复后随最终 EL-22 重新验证 |

首次缩短 GREEN 运行因测试错误假设 12 月 20 日所有词都已到期，实际只有两张到期而失败（`f6gT5q`）；修正夹具用公开 backup 的真实最大 due 推进时间，不改排期实现。一次 scoped RED 的锚定 grep 无匹配，非零退出，不计为红绿证据；修正过滤后才得到上表失败。

### 冻结源下的受影响回归

命令均为 README 的 `EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm --prefix frontend run test:e2e -- --ticket <ID>`，每个独立临时构建/数据库，结果收齐前没有编辑源码或 HEAD。

| 范围 | 结果 | run 目录 |
| --- | --- | --- |
| EL-22（迟到旧页保护之前） | 20 passed | `ec-e2e-static-ImgEUu` |
| EC-13 每日队列/确认/刷新 | 32 passed | `ec-e2e-static-ua1Lw8` |
| EC-14 巩固/反馈/迟到响应 | 32 passed | `ec-e2e-static-ZZEVHa` |
| EL-17 时间预算/配额/冻结/恢复 | 24 passed | `ec-e2e-static-oKedaZ` |
| EL-18 主动时长/个人估算/跨页 | 24 passed | `ec-e2e-static-nwG7q9` |
| EL-19 有限恢复/数据恢复/回退 | 28 passed | `ec-e2e-static-wrRW5i` |

`.venv/bin/python -m pytest tests/test_frontend.py tests/test_daily_session.py tests/test_session_summary.py tests/test_el17_time_budget_daily_plan.py tests/test_el18_personal_active_time_estimate.py -q` → **49 passed**。

上述回归之后仅增加客户端“完整保存后拒绝旧页中断”的保护；其专属红灯与最终 EL-22 负责该分支，不把较早回归的源码摘要声称为最终源码相同。已实际查看手机 shorter-advice 和桌面 steady-advice 截图，确认建议、真实有限队列与主入口。

前端类型/独立 lint N/A（未配置）；Python 类型/静态检查 N/A（未改 Python）。生产构建、最终 EL-22、基线检查和独立双轴审查结果在最终验证节补记。

## 审查修复前的验证与验收映射

- 修复前 EL-22：**22 passed**（11 个具名分支 × mobile/desktop），`ec-e2e-static-Nkmjcc`；无 skipped/flaky/unexpected。额外逐项核对 `requirements.EL22` 与同次报告，22 个唯一执行与必需标题精确对应。包含旧页迟到保护 GREEN、详情键盘展开、空库冻结轮次修复。
- 修复前生产产物：`npm --prefix frontend run build` → exit 0；JS `index-wNQHW4Sa.js`、CSS `index-D3hpSMeN.css`，产物及 index 随本片提交。主入口 E2E 同时对当前源码做独立新构建。
- 最终受影响浏览器证据：本票 22 次当前源码成功；上节相关五组 140 次成功，版本边界已明确；不冒充全量回归或相同源摘要。
- fresh origin/dev guard / diff whitespace / 覆盖校验自测通过；本片没有 Python 变更，guard 的 Ruff 步骤无文件可运行，不能写成 Python lint/类型全量通过。
- 最终 E2E 时 HEAD 为 `c1bd487` 加未提交的本片源码，run.json 记录实际 source_sha256 与工作树；运行结束后只补验证记录并提交，不把测试产物身份误当最终提交号。

| 验收条件 | 可复核证据 |
| --- | --- |
| 选时间后只有明确下一步及一句理由，继续优先 | EL-22 selected time、empty/due/recovery reasons、deleting every card；公开 /api/today 与 EC-13/EL-17 回归 |
| 首屏突出任务、预计时间、开始；技术信息按需展开 | EL-22 home keeps its action、Home daily goal；两视口标题/按钮完整 viewport、键盘 Enter 展开、手机无横向溢出；截图已查看 |
| 已保存内容、待巩固词、可结束；暂停不误报完成 | EL-22 saved completion、selected time pause；公开备份事件前后相同；EC-14 全部 32 次成功，第三片 Spec 独立 6 次 |
| 实际退出缩短、稳定完成再上调，冻结轮次不变 | EL-22 two interrupted / three uninterrupted；两页并发同轮暂停、重复刷新；直接退出、常规偏好和显式覆盖 |
| 异常路径与数据范围 | EL-22 skipped rounds / unavailable storage / stale tab / backup replacement；原 FSRS reviews 不变，失败不增事件，旧页不能改已完成观察；49 个受影响 Python 测试 |
| 恢复与可逆性 | EL-22 backup replacement；EL-17/18/19 恢复、数据/功能回退回归；撤回前端提交即可回退，服务器事件/排期/时长保留，无迁移 |

全量 pytest、未过滤 E2E、真实付费模型/TTS、原生系统崩溃/直接关窗、生产发布仍未验证；跨设备轮次建议不在承诺范围。独立安全扫描、容器、迁移/seed/不可逆降级 N/A（本票未配置或引入）；新写入仅浏览器建议，无新增权限或服务器数据集合。
独立 Standards / Spec 最后复核的固定提交与结论见文末。

## 独立审查发现与修复

### Standards（固定 c1bd487 → 1f52037）

1 个 P2：观察在回调时读取 generation，恢复前的旧标签页可能取得新范围身份，违反 ADR 的恢复隔离约束。

### Spec（固定 c1bd487 → 1f52037，回看原始基线）

2 个 P2：上述恢复隔离问题；仅截取最近 30 轮并从默认 15 分钟重算，清理旧中断后会在没有稳定完成的情况下错误加量。

### 修复及红绿证据

- 轮次开始时冻结 generation，合并观察时在锁内核对；旧格式没有身份的轮次不补造观察，保留原学习流程。真实双页备份恢复旅程 RED `/tmp/ec84-review-restore-red-report.json`（两视口错误降为 3），GREEN `/tmp/ec84-review-restore-green-report.json`（2 passed，保持 8）。
- 单一建议归约器将淘汰的明细折为档位、连续数、最近两次中断标记与截止点；不保留旧明细，不重复折入迟到轮次。连续 30 轮真实跳过 RED `/tmp/ec84-review-retention-red-report.json`（错误上调到 8），GREEN `/tmp/ec84-review-retention-green-report.json`（2 passed，每轮保持 3；150 条跳过事件，原 FSRS reviews 不变）。
- 推荐理由改为“此前的中断记录”，不把摘要中的历史中断说成仍在最近三轮。README、ADR 与首页详情同步说明 30 轮明细和更早摘要的边界。
- 修复后的新源码验证见下节；独立复核在固定提交后进行。

## 审查修复后的最终验证

所有主入口都在同一冻结源码下执行：HEAD `1f52037172f1a2a176ffecefb4cdc6ca00ca2397` 加上述修复，source_sha256 `1eefb57027ff5026a83eaf05902e74deff2ef2b8bbf6990656c20f219eec81e5`。六组进程全部 exit 0、run.json 为 passed；源码/HEAD 未在运行期间变化。结果收齐后才补本节。

| 范围 | 结果 | e2e/release-results 下的 run |
| --- | --- | --- |
| EL-22 | 24 passed | ec-e2e-static-IX4wGO |
| EC-13 | 32 passed | ec-e2e-static-T5hU4y |
| EC-14 | 32 passed | ec-e2e-static-Lfvhd3 |
| EL-17 | 24 passed | ec-e2e-static-pW9j0P |
| EL-18 | 24 passed | ec-e2e-static-ukRBWj |
| EL-19 | 28 passed | ec-e2e-static-zfjqdp |

- 合计 **164 次成功**，0 skipped / unexpected / flaky；逐项脚本确认 EL-22 的 12 个必需标题 × 两视口正好对应 24 个唯一成功执行，包含恢复前旧页与 30 轮保留边界。所有六组静态 JS/CSS 哈希均与当前提交产物对应。
- `.venv/bin/python -m pytest tests/test_frontend.py tests/test_daily_session.py tests/test_session_summary.py tests/test_el17_time_budget_daily_plan.py tests/test_el18_personal_active_time_estimate.py -q` 再执行：**49 passed in 84.86s**，`/tmp/ec84-final-fixed-pytest.log`。
- `npm --prefix frontend run build` exit 0；JS `index-UOQt5XGB.js` SHA256 `6f3e2e848edf35e62541744400423b6c9db66c0e80392f64dc72e8e70237366a`，CSS `index-D3hpSMeN.css` SHA256 `60667cbec3c41475d6ab7b48fc4f3b8405c0b03a9d4f3d5c2824bc41b30b7b1a`。
- fresh `.venv/bin/python scripts/agent_check.py --base dev --lint`、`git diff --check`、`node e2e/spec-coverage.mjs --self-test` exit 0。origin/dev 仍为批准基线；未配置的前端类型/lint、无改动的 Python 类型/lint仍为 N/A。
- 已实际查看本轮手机 shorter-advice、手机/桌面 steady-advice 截图；历史原因文案与开始按钮可见。未改动的空故事封面在临时验收构建仍缺图，不属于本票改动。
- 验收映射继续适用上表，异常/数据范围补充 EL-22 pre-restore tab 与 skipped rounds 的 30 轮真实事件断言。未运行的全量、生产与外部服务门禁仍按上文明确标记，不将定向回归解释为完整发行资格。

## 修复后的独立复审结论

固定 HEAD：`a2c5d5c`；修复 diff `1f52037...a2c5d5c`，结合 `c1bd487...a2c5d5c` 原切片与 `8d827cc...a2c5d5c` 整票交互。两轴独立上下文，均只审本票，不运行全量门禁。

### Standards

无新增 actionable findings，也无需要报告的判断性 smell。原 generation P2 已解决：开始轮次冻结身份，锁内拒绝恢复前旧轮次的迟到观察。checkpoint 保留裁剪记录的建议状态，没有形成第二个学习进度来源；README、ADR 与实现一致。独立定向检查覆盖恢复隔离、中性轮次、淘汰去重与逐档增长；未重复浏览器门禁。

### Spec

无新增 actionable findings，原两个 P2 均已解决。恢复隔离符合“恢复备份后清除旧浏览器记录”；保留建议摘要符合“连续完成三轮后逐步恢复”。独立定向检查确认 30 个中性轮次后仍为 3，再三轮完整保存到 8、再三轮到 15；淘汰轮次不重复折入。结合整票交互未发现遗漏、错误实现或范围扩大。独立核对六组报告共 164 passes、零 skipped/unexpected/flaky，当前 JS 哈希吻合。49 后端测试依据主代理已核验输出；实时 issue 评论未核实，采用指定权威规格。

复审计数：Standards 0 个未处理发现；Spec 0 个未处理发现；各轴无剩余重要问题。最后仅补本节审查记录，不改变已经验证、复审的产品源码和静态产物。原始 dev 工作区未修改，隔离分支保留供集成；未推送、未合并、未部署，issue #84 待集成后关闭。
