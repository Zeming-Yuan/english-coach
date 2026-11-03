# 可靠性与每日学习闭环：已确认 tickets 的计划索引

- 日期：2026-10-30。
- GitHub：[总览](https://github.com/Zeming-Yuan/english-coach/issues/1)；[发布映射与核验记录](../../tickets/reliability-and-daily-learning/publication.md)。
- 状态：用户已确认16张ticket的粒度与23条非冗余阻塞边；16份实施计划已随对应GitHub issue发布。
- [源规格](../../specs/reliability-and-daily-learning.md)；[已确认ticket与DAG](../../tickets/reliability-and-daily-learning/README.md)；[跨票接口契约](2026-10-30-reliability-contracts.md)。本索引/共享契约不是额外ticket，不重复制造实施任务。
- 16张票均需跨层实现或故障/兼容验证，因此各有计划；静态文案、状态更新、加链接等机械单步操作合入所属任务，不另建计划。
- 每计划有第一条失败测试、预期原因、核心最小实现、精确文件职责、消费/产出接口、验证命令、文档/ADR同步、独立提交和回滚/兼容策略。
- 所有命令和代码块是未来执行内容。编写/语法/引用检查通过不等于实现通过；本次仅发布规格、tickets与计划，没有产品代码改动、真实迁移、产品测试执行或代码提交。

## 计划清单

| 已确认ticket | 计划 | 独立任务提交 | 交付目标 |
| --- | --- | --- | --- |
| [EC-01](../../tickets/reliability-and-daily-learning/01-first-install.md) | [实施计划](2026-10-30-ec-01-first-install.md) | 2 | 按文档初始化空库或升级旧库后，真实首页可以打开，未配置 AI 不阻断本地学习。 |
| [EC-02](../../tickets/reliability-and-daily-learning/02-starter-cards.md) | [实施计划](2026-10-30-ec-02-starter-cards.md) | 2 | 用户主动添加入门词卡后无需AI即可完成第一轮真实学习。 |
| [EC-03](../../tickets/reliability-and-daily-learning/03-expand-event-history.md) | [实施计划](2026-10-30-ec-03-expand-event-history.md) | 2 | 新增追加事件与兼容基线，评分轨迹可见，同时提供各后续迁移独立依赖的原子幂等契约。 |
| [EC-04](../../tickets/reliability-and-daily-learning/04-self-rating-retry.md) | [实施计划](2026-10-30-ec-04-self-rating-retry.md) | 2 | 所有显式自评分页面只有保存确认才推进，失败与刷新后可重试同一次提交。 |
| [EC-05](../../tickets/reliability-and-daily-learning/05-typed-retrieval.md) | [实施计划](2026-10-30-ec-05-typed-retrieval.md) | 2 | 输入题一次提交原子保存，并如实区分独立回忆、提示和跳过。 |
| [EC-06](../../tickets/reliability-and-daily-learning/06-recognition-practice.md) | [实施计划](2026-10-30-ec-06-recognition-practice.md) | 2 | 测验和听力选择由服务端判分，一次保存结果且不把识别题当独立排期。 |
| [EC-07](../../tickets/reliability-and-daily-learning/07-mixed-practice.md) | [实施计划](2026-10-30-ec-07-mixed-practice.md) | 2 | 混合入口复用相同题型契约，一次点击只保存一次并在确认后切题。 |
| [EC-08](../../tickets/reliability-and-daily-learning/08-history-calendar.md) | [实施计划](2026-10-30-ec-08-history-calendar.md) | 2 | 同卡跨天活动不会消失，学习日、streak与完成词数按真实事件计算。 |
| [EC-09](../../tickets/reliability-and-daily-learning/09-metrics-adaptive-limit.md) | [实施计划](2026-10-30-ec-09-metrics-adaptive-limit.md) | 2 | 统计区分真实题型，新词推荐不被提示、未知历史或即时重做抬高。 |
| [EC-10](../../tickets/reliability-and-daily-learning/10-complete-backup-export.md) | [实施计划](2026-10-30-ec-10-complete-backup-export.md) | 2 | 用户从设置下载完整版本化备份，业务字段与关联不遗漏。 |
| [EC-11](../../tickets/reliability-and-daily-learning/11-safe-legacy-import.md) | [实施计划](2026-10-30-ec-11-safe-legacy-import.md) | 2 | 旧备份经过预览与完整校验后安全部分恢复，失败不损坏原进度。 |
| [EC-12](../../tickets/reliability-and-daily-learning/12-full-backup-restore.md) | [实施计划](2026-10-30-ec-12-full-backup-restore.md) | 2 | 完整备份能恢复到另一实例并继续学习，全部关联和幂等结果不串ID。 |
| [EC-13](../../tickets/reliability-and-daily-learning/13-daily-queue.md) | [实施计划](2026-10-30-ec-13-daily-queue.md) | 2 | 首页一键进入到期优先、去重且目标固定的每日主队列。 |
| [EC-14](../../tickets/reliability-and-daily-learning/14-reinforcement-summary.md) | [实施计划](2026-10-30-ec-14-reinforcement-summary.md) | 2 | 主队列结束后最多三题巩固，可跳过，并展示仅基于已保存事件的反馈。 |
| [EC-15](../../tickets/reliability-and-daily-learning/15-contract-legacy-paths.md) | [实施计划](2026-10-30-ec-15-contract-legacy-paths.md) | 2 | 删除已无人消费的旧业务写入与统计分支，保持公共协议和已产生数据兼容。 |
| [EC-16](../../tickets/reliability-and-daily-learning/16-release-journey.md) | [实施计划](2026-10-30-ec-16-release-journey.md) | 2 | 独立新上下文用完整命令验证从新安装到换设备继续学，以及安全降级边界。 |

## 执行顺序与接口归属

1. 先EC-01；之后EC-02与EC-03可分别推进。EC-03完成后遵循已确认DAG选择frontier，不创建无关先后关系。
2. 唯一宽改造为EC-03 expand → EC-04/05/06/07写入迁移及EC-08/09读取迁移 → EC-15 contract。每批独立可用，不等待EC-16才恢复绿色。
3. 技术归属澄清：原子幂等内核、事件/基线和浏览器基础pending工具归EC-03；EC-04交付React状态机和显式评分可见恢复。这保证不依赖04的05/06也可实现可靠提交。没有新增需求或改变DAG。
4. 完整导出新增/api/export/backup，旧/export/cards兼容保留；先EC-11修旧导入，再EC-12支持新格式，旧往返测试不在中间票被破坏。
5. 共享视图/服务按批次串行合入。EC-05与06的QuizPage分支、EC-08与09统计、EC-10/11/12的BackupPage分别限定职责，避免并行编辑覆盖；文件重叠不伪装成业务阻塞。
6. EC-15只删除内部重复业务形式，保留公共URL、必要成功字段与物理历史兼容数据。EC-16只读基线演练不能被描述为旧后端可继续安全写学习数据。
7. 执行前核对代码漂移、依赖完成和实际环境；需要隔离工作区时按using-git-worktrees处理。当前仅为计划阶段。

## 统一验证入口

在仓库根目录激活Python虚拟环境并安装前后端依赖。EC-01交付入口后：

```bash
npm --prefix frontend run test:e2e -- --ticket EC-01
python -m pytest -q
npm --prefix frontend run build
```

每票将EC编号替换为自身编号，且须注册至少一个实际执行的场景；未知选择或无匹配是失败。完整验收使用不带过滤的命令：

```bash
npm --prefix frontend run test:e2e
python -m pytest -q
npm --prefix frontend run build
```

最高测试seam固定为浏览器→真实FastAPI→Alembic迁移的隔离SQLite。原有HTTP/数据库测试只补充边界和数据约束，不以内部mock次数替代保存行为。

## 规格覆盖与自检

| 场景 | 归属计划/任务 | 覆盖 |
| --- | --- | --- |
| T01–T03 | EC-01 Task 1–2；EC-03 Task 1；EC-15 Task 1 | 新装、配置、真实旧库升级与约束 |
| T04 | EC-02 Task 1–2 | 无AI入门内容和首轮学习 |
| T05–T07 | EC-03 Task 1；EC-04/05/06/07 各Task 1–2 | 原子提交、幂等、故障/响应丢失与并发 |
| T08–T09 | EC-08 Task 1–2；EC-09 Task 1 | 跨天与同日去重计数 |
| T10–T11 | EC-05/06/07 各Task 1–2；EC-09 Task 1 | 跨入口分类、提示、选择和跳过 |
| T12–T13 | EC-08/09 各Task 1–2 | 时区、未知历史与样本门槛 |
| T14 | EC-10/12 各Task 1–2 | 完整导出、全图映射、换实例恢复和续学 |
| T15–T17 | EC-11/12 各Task 1–2 | 坏输入、安全副本、回滚和旧格式 |
| T18 | EC-13 Task 1–2 | 到期优先、去重、余量、固定目标 |
| T19 | EC-14 Task 1–2 | 有限巩固、可跳过、持久化总结 |
| T20–T21 | EC-01 Task 2；各UI Task；EC-16 Task 1–2 | 外部服务故障、两视口、键盘、完整旅程与兼容边界 |

| 验收条件 | 实施归属 |
| --- | --- |
| AC01 | EC-01、EC-03、EC-15 |
| AC02 | EC-01、EC-02、EC-11/12 |
| AC03–AC04 | EC-03–EC-07、EC-15 |
| AC05 | EC-08、EC-09 |
| AC06 | EC-05、EC-06、EC-07、EC-09 |
| AC07 | EC-10、EC-12 |
| AC08–AC09 | EC-11、EC-12 |
| AC10 | EC-13、EC-14 |
| AC11 | 各UI Task与EC-16 |
| AC12 | EC-01、EC-16 |
| AC13 | 每任务回归命令及EC-16总门禁 |
| AC14 | 每任务文档/ADR同步点 |
| AC15 | EC-16最终聚合，不能提前声明整体完成 |

自检范围：对照规格逐节核对；扫描占位词；核对接口owner、字段名、token回放与恢复ID映射；逐计划检查五项Review Focus并安排到实际测试步骤。没有把尚未执行的验收框勾选。

## 文件与文档同步原则

- 新建支持文件按计划给出的责任组织，沿用routers/services/models/views结构，不把所有逻辑塞入单个文件。
- 具体源文件只在计划出现，ticket仍以行为表达；执行者同时读取源规格与对应计划。
- EC-03创建ADR-0001（当前状态/追加事件与幂等）；EC-08创建ADR-0002（学习日/统计）；EC-10创建ADR-0003（版本备份/恢复）。之后的票更新对应ADR而非重复立项。
- 单个任务的commit只包含自己的行为、测试和同步文档；分支和代码实施不由本次计划编写自动触发。

## 回退与外部发布

- 加法式数据保留；已落地消费者须先按依赖逆序撤回或保留契约再关闭入口。
- 不将恢复旧快照称为安全代码回退；有新增进度时先保护数据，再执行兼容前向修复。
- 原始5868cd1后端不追加新事件，只允许受控只读兼容演练。继续学习写入必须保留事件后端，不能退回原版后端继续写。
- 规格、tickets与计划已按用户授权统一上传；EC编号映射到真实issue号，保留Blocked by并直接使用ready-for-agent，不再次triage。

## 实施交接

当前执行方式未选择。请先审阅计划；实施时可选Native（本会话逐任务实现，最后独立审查）或Subagent-driven（逐任务新实施者与审查者）。本项目共享提交与恢复契约较多，建议Native按DAG推进，减少共享文件交接；数据风险由明确红绿测试和最终独立审查把关。选择方式之前不开始产品实现。
