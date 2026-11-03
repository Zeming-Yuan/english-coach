# EL-16 受约束场景回应验证

目标：Issue #52；规格 AC31–AC37；计划 `docs/superpowers/plans/2026-10-31-el-16-bounded-ai-scene-feedback.md`。
基线：`57b6d2a5c660f39eae39c5488fe32573a81301d0`（origin/dev）。隔离分支 `codex/el16-scene-feedback`。

## 切片 1：可见路径

- HTTP 红灯：反馈端点缺失，200 断言实际 404；模板接入后通过。
- 模型红灯：有效外部替身回复的 origin 仍为 template；接入现有客户端后通过，模型附带的 verdict/score 未改变规则结果。
- 浏览器红灯：双视口缺少 `scene-feedback`；接入真实结果区后，双视口模型回应与实际可见接触通过。
- V3 红灯：完整有效备份中把反馈移到未答题，预览仍为 200；补关联校验后返回 422。最初使用去掉 exported_at 的比较快照产生了准备层拒绝，该次不作为目标红灯。
- 本票沿用已存在的“你的答案 / 提交答案”可访问文案，保持 EL-14/15 的用户行为与验收兼容；计划示例的旧文案不覆盖当前界面。
- 原计划说明 EL 标识不能定向过滤已过时；当前 runner 已支持 `--ticket EL-NN` 且拒绝空匹配，本轮实际用 EL-16 入口完成红/绿验证。

两个切片的本票验收及受影响回归已执行，最终清单和双轴审查见下文。全量门禁按本轮用户要求不执行，仅运行修改路径及其受影响回归。

### 第一切片双轴审查与修复

- 固定范围 `57b6d2a…df37c2d`：Standards 发现自我介绍第三轮模板含标准串导致自身 V3 拒绝；Spec 发现同快照恢复后的旧模型可写回。
- `1f45c3e` 修复并验证三场景九轮模板预览与单次同快照恢复隔离；第一次复审又复现空恢复再恢复原快照复用整数 ID 的变体，原恢复 finding 尚未关闭。
- 补充真正的恢复隔离令牌：完整保留场景/提交 UUID，每次恢复重新生成本地 feedback_epoch；单次和经过空库两种恢复均测试旧请求返回 409。
- 降级保护继续拒绝删数据，修复消息兼容 EL-14 既有“保留场景记录”断言。

## 切片 2：边界与恢复

- RF1–RF5：`test_el16_review_focus` 覆盖词内短回应、空回应、超词汇、标准串泄露、空标准串；HTTP 的非法/不可用模型用例补充可见结果与原首答不变。额外模型 verdict/score/next_turn 无权威，未知仍未知，明确不满足只保留一个冻结纠正。
- `test_el16_feedback_requires_saved_first_answer_and_owns_its_scope`：未保存 422、错误轮次/题目 404、非法 UUID/额外答案 422、跨题复用操作 409。
- `test_el16_feedback_commit_failure_and_concurrent_confirmation_are_atomic`：提交故障 500 后整库快照不变，相同操作并发及重放只保存一条，不重评首答。
- `test_el16_generation_sends_only_approved_context_and_does_not_lock_next_turn`：阻塞外部模型时下一轮真实 HTTP 仍可保存；提供方只收到场景、可用词形和首答结果，无词库例句、内部身份、标准答案或未来任务。
- 修订/删除的晚到回复分别返回 409/404；两类恢复晚到返回 409；V3 校验错误归属、篡改材料、无效版本、非法来源、时间倒流及嵌套缓存注入。旧 V3 缺反馈/令牌时预览说明缺失，读取不补造记录。
- 时间边界红灯：等价的 `+00:00` 时间曾使预览 500；统一 UTC 后正常预览。
- 功能回退红灯：关闭增强时仍返回 model；接入 `SCENE_FEEDBACK_ENABLED` 后模板可用、历史 model 不变，恢复 true 后新轮次可再次使用模型。
- 可见性红灯：只有标题在视口、英文正文在屏幕外时错误写入接触；改为观察英文正文完整进入视口，双视口定向探针 2 项通过。此用例将各项目视口高度临时减少 120px，宽度不变，以稳定构造标题/正文边界；其余用例使用项目默认视口。
- V3 新集合使旧 EL-01/EL-04 的显式集合期望需要新增 scene_feedback；EL-13 升级测试的当前 head 更新为 el16_feedback_epoch，原旧数据保留断言未减少。

### 已执行的受影响检查

- `.venv/bin/python -m pytest tests/test_el16_bounded_ai_scene_feedback.py tests/test_el14_three_turn_drink_scene.py tests/test_el15_intro_and_directions_scenes.py tests/test_el01_expand_revisions_and_v3.py tests/test_el04_expand_contact_recording.py tests/test_full_restore.py tests/test_legacy_restore.py tests/test_backup_v2.py tests/test_el13_integration.py tests/test_model_router.py -q` → **327 passed**，395.12s。
- Pyright 使用仓库 pyrightconfig.json、`.venv/bin/python` 和本票全部 16 个改动 Python 文件 → **0 errors / 0 warnings**。
- `.venv/bin/python scripts/agent_check.py --base dev --lint` → origin/dev=57b6d2a，基线有效；改动 Python Ruff check/format 通过。`git diff --check` 通过。
- 首轮异常浏览器验收：18 个分支加入之前的 17 个分支共 **34 passed**，主入口重新构建，运行 `ec-e2e-static-G32bow`；最终包含可见性分支的主入口结果在下方续记。

全量 pytest / 未过滤 E2E：**未运行**，遵照本轮只检查修改和受影响部分的要求，不能据此断言全仓回归通过。真实付费 AI、生产数据库/密钥、发布/部署、真实服务负载与独立教学质量评价：**未验证**；本票使用确定的外部提供方替身。独立安全扫描、Docker Compose、生产备份恢复：**N/A**，未配置为本票门禁；隔离库真实迁移、备份安全副本、恢复和功能回退已在上述适用路径覆盖。迁移保留历史并拒绝破坏性降级。

### 双视口主入口与来源身份

以下均使用 `EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell npm --prefix frontend run test:e2e -- --ticket <EL-NN>`；启动独立迁移 SQLite 和真实应用，新构建静态文件。源文件和 HEAD 在每次收集期间保持冻结，未跳过、重试或伪造正常应用响应。

| 范围 | 实际结果 | 本次诊断目录 |
| --- | --- | --- |
| EL-16：18 个具名分支、双视口 | 36 passed | `e2e/release-results/ec-e2e-static-yVP5GI/` |
| EL-14 受影响回归 | 26 passed | `e2e/release-results/ec-e2e-static-xJJpk6/` |
| EL-15 受影响回归 | 38 passed | `e2e/release-results/ec-e2e-static-qDfmfD/` |

各目录的 `run.json` 记录收集时的 HEAD、dirty 源码内容摘要、浏览器版本/可执行文件摘要及新构建产物摘要；报告和截图/trace 同目录。最终证据文档的追加晚于结果收集，不将追加后的文档摘要冒充当时已测源码摘要。正常路径仅替换外部 AI/TTS；响应丢失和晚到使用 route.fetch 后丢弃/延迟真实传输。

收尾外部提供方边界另补两个红灯：空/缺失 choices 导致可选表达返回 500。将 generate_json 调用的适配器异常降为同一核对模板，保持原答案；补充验证本票 52 个定向测试及 EL-16 主入口，不重复无关路径。

接触确认的最后一个并发红灯：正文实际显示后，词卡身份查询晚到且页面已离开，原 live 检查漏记接触。改为保留实际展示的确认，并在查询期间保存 `ec.contact.lookup:scene-feedback:*`，使未知接触保守降低回测资格；具体词卡接触开始确认后移交原 pending，离开仅取消 UI 更新。定向双视口探针 2 项通过；加入第 19 个具名分支，最终 EL-16 主入口验证 38 次执行。

### 最终实现验收身份

- EL-16：status=passed；HEAD=`2704b075617a957f6ac2eb366eba08a2e305e685`；源码 SHA-256=`0c3c01c6174089846956f9819711e802d739064717aaea586d18139d83720d7c`；目录 `ec-e2e-static-D5tkOA`。
- EL-14：status=passed；HEAD=`2704b075617a957f6ac2eb366eba08a2e305e685`；源码 SHA-256=`af23c0724dd767deca96649dd83d8e3dc579a73c269af01f96e47faa2545a8f9`；目录 `ec-e2e-static-xJJpk6`。
- EL-15：status=passed；HEAD=`2704b075617a957f6ac2eb366eba08a2e305e685`；源码 SHA-256=`af23c0724dd767deca96649dd83d8e3dc579a73c269af01f96e47faa2545a8f9`；目录 `ec-e2e-static-qDfmfD`。

EL-16 最新主入口 **38 passed**；EL-14 **26 passed**；EL-15 **38 passed**。按各自命名空间核对实际 JSON 报告：EL16 19 / EL14 13 / EL15 19 个登记分支均在 mobile、desktop 各单次通过。完整未过滤覆盖门禁未运行，不用这些局部结果冒充全局覆盖。`node e2e/spec-coverage.mjs --self-test` 的缺用例/缺视口/跳过/失败/超时/中断/阻塞/重试/分支缺失拒绝自检均通过。

提供方 envelope 修复后，本票 `.venv/bin/python -m pytest tests/test_el16_bounded_ai_scene_feedback.py -q` **52 passed**；该次补充 Pyright 0 errors、Agent baseline/lint 通过。327 项受影响回归与 52 项存在重叠，未相加冒充独立样本。新增接触 lookup helper 为真实已见正文先保留未知接触，具体确认晚到仍只记录原可见词形，不产生学习事件。

| 验收归属 | 证据 |
| --- | --- |
| AC31 / 原场景兼容 | EL-14/EL-15 双视口回归；三场景模板九轮自身 V3 预览 |
| AC32 / 规则权威 | unknown/rejected 模型越权 HTTP；unknown 浏览器；首答、辅助、跳过回归 |
| AC33 / 应用依据 | feedback 前后 scene_attempts 不变；原场景映射/新情境/内容修订回归 |
| AC34 / 一纠正与降级 | invalid/unavailable provider 参数化；三类无 AI/失败完整三轮；原 FSRS/事件未变化 |
| AC35 / 保存后生成与恢复 | 提交故障原子快照、原 operation 并发；两类刷新确认浏览器；慢 AI 时下一题可存 |
| AC36 / 归属与晚到 | 内容修订/删除；单次和空后再原恢复；换轮/换场景；延迟接触确认 |
| AC37 / 唯一与一致性 | 单条反馈唯一约束；run_write；同操作冲突/重放；完整 V3 校验与跨实例恢复 |
| 当票数据保护 / 旧格式 | 两个加法迁移；前一切片升级；V1/V2/旧 V3 缺失说明、映射和恢复 |
| 功能回退 | false 使用 template、原 model 可读、V3 保留、true 可恢复；HTTP 与双视口 |

## Standards

最终独立审查固定范围：`57b6d2a5c660f39eae39c5488fe32573a81301d0...92e7fb9a67335b7cb71b0e5693dfc91150d98dfb`，非空本票 diff。审查者未修改产品文件。无确认的可行动 finding；独立补跑恢复隔离、并发/提交故障、归属、缓存注入与异常 provider 共 **7 passed / 45 deselected**。

另复现了只读确认标识的契约歧义：新 opX 读取 A 的既有反馈时返回原 opA，此后 opX 仍可用于 B。复核结论：只有实际持久化并返回的规范 operation_id 被占用；只读确认不创建别名、不写记录。ADR-0008 已明确此语义，原 opA 跨题冲突仍有公开 HTTP 测试。此项为文档澄清，不更改产品行为。

Standards：**0 个未处理 finding；无最高严重性问题**。

## Spec

最终独立审查使用上述相同固定范围；核对 #52、EL-16 两个 Task、F6、AC31–37 与共享 AC42。无 actionable findings，无缺失规格。独立补跑三场景模板 V3 回环、两类恢复晚到、并发原子性与跨实例恢复回放共 **5 passed**（7.34s）。未据此宣称真实付费模型或生产负载通过。

Spec：**0 个未处理 finding；无最高严重性问题**。

## 交付状态

产品提交依次为 `df37c2d`（可见闭环）、`1f45c3e`（模板及恢复修复）、`2704b07`（重复恢复隔离）、`92e7fb9`（异常、兼容、接触和功能回退）。每个修复保留红/绿验证和复审；两个切片均已提交。本票在隔离分支实现，尚未 push、合入、发布或关闭远端 Issue。功能回退采用 ADR 中的增强开关，迁移保留已存历史；不执行破坏性降级。

最终文档同步期间再次执行本票 pytest：**52 passed，45.12s**；全部 16 个改动 Python 文件 Pyright **0 errors / 0 warnings**；fresh origin/dev 基线仍为 `57b6d2a`，Agent lint/format 与覆盖校验器负向自检通过。产品源码自 `92e7fb9` 起未再改变；本次同步仅涉及 ADR、ticket、计划与本证据。原 `dev` 工作区保持干净。
