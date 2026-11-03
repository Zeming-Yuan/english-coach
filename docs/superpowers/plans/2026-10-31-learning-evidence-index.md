# 可验证学习效果：21张已确认tickets实施计划

- 日期：2026-10-31；状态：21 份计划已随对应 GitHub Issues 发布；产品未实施。
- [规格](../../specs/evidence-based-personalized-learning.md)；[tickets与依赖图](../../tickets/evidence-based-personalized-learning/README.md)；[共享接口](2026-10-31-learning-evidence-contracts.md)。
- 21张均涉及跨层行为或独立兼容/故障资格，因此各有多步计划。文案、链接、状态更新和同任务夹具并入所属提交，没有单独的重复计划。
- 已确认31条直接阻塞边，frontier为EL-01与EL-17。原有已关闭GitHub issues保持不变。
- 每票计划包含首条测试/预期红灯、实际代码核心、文件职责、消费/产出接口、验证、文档/ADR、两个提交边界和保留数据的回退策略。

| Ticket | GitHub | 计划 | Blocked by | 提交边界 |
| --- | --- | --- | --- | --- |
| [EL-01](../../tickets/evidence-based-personalized-learning/01-expand-revisions-and-v3.md) | [#37](https://github.com/Zeming-Yuan/english-coach/issues/37) | [Expand：编辑词卡后仍能完整备份与恢复内容修订](2026-10-31-el-01-expand-revisions-and-v3.md) | None | 可见闭环；边界/兼容 |
| [EL-02](../../tickets/evidence-based-personalized-learning/02-recall-evidence-detail.md) | [#38](https://github.com/Zeming-Yuan/english-coach/issues/38) | [独立作答后，在词卡详情看到有依据的回忆状态](2026-10-31-el-02-recall-evidence-detail.md) | EL-01 | 可见闭环；边界/兼容 |
| [EL-03](../../tickets/evidence-based-personalized-learning/03-migrate-evidence-readers.md) | [#39](https://github.com/Zeming-Yuan/english-coach/issues/39) | [Migrate：首页、词表、统计和分享图统一解释学习进展](2026-10-31-el-03-migrate-evidence-readers.md) | EL-02 | 可见闭环；边界/兼容 |
| [EL-04](../../tickets/evidence-based-personalized-learning/04-expand-contact-recording.md) | [#40](https://github.com/Zeming-Yuan/english-coach/issues/40) | [Expand：看词卡或听答案后，能核对最近一次应用内接触](2026-10-31-el-04-expand-contact-recording.md) | EL-01 | 可见闭环；边界/兼容 |
| [EL-05](../../tickets/evidence-based-personalized-learning/05-migrate-practice-contact.md) | [#41](https://github.com/Zeming-Yuan/english-coach/issues/41) | [Migrate：闪卡与专项练习准确记录答案接触和提示](2026-10-31-el-05-migrate-practice-contact.md) | EL-04 | 可见闭环；边界/兼容 |
| [EL-06](../../tickets/evidence-based-personalized-learning/06-migrate-content-contact.md) | [#42](https://github.com/Zeming-Yuan/english-coach/issues/42) | [Migrate：课程、故事和内容编辑保持可追溯的接触与修订](2026-10-31-el-06-migrate-content-contact.md) | EL-04 | 可见闭环；边界/兼容 |
| [EL-07](../../tickets/evidence-based-personalized-learning/07-lesson-goals-and-progress.md) | [#43](https://github.com/Zeming-Yuan/english-coach/issues/43) | [课程有明确目标，生成、浏览和待检查分别记录](2026-10-31-el-07-lesson-goals-and-progress.md) | EL-06 | 可见闭环；边界/兼容 |
| [EL-08](../../tickets/evidence-based-personalized-learning/08-lesson-recall-check.md) | [#44](https://github.com/Zeming-Yuan/english-coach/issues/44) | [课程三题短测可保存、继续，并留下可解释的结果](2026-10-31-el-08-lesson-recall-check.md) | EL-02、EL-05、EL-07 | 可见闭环；边界/兼容 |
| [EL-09](../../tickets/evidence-based-personalized-learning/09-delayed-recall-check.md) | [#45](https://github.com/Zeming-Yuan/english-coach/issues/45) | [隔日和一周回测按真实记录间隔计分](2026-10-31-el-09-delayed-recall-check.md) | EL-08 | 可见闭环；边界/兼容 |
| [EL-10](../../tickets/evidence-based-personalized-learning/10-actionable-learning-advice.md) | [#46](https://github.com/Zeming-Yuan/english-coach/issues/46) | [统计能解释薄弱项，并一键进入对应练习](2026-10-31-el-10-actionable-learning-advice.md) | EL-09 | 可见闭环；边界/兼容 |
| [EL-11](../../tickets/evidence-based-personalized-learning/11-bounded-personalized-story.md) | [#47](https://github.com/Zeming-Yuan/english-coach/issues/47) | [根据已有学习依据生成难度受控的短故事](2026-10-31-el-11-bounded-personalized-story.md) | EL-02、EL-06 | 可见闭环；边界/兼容 |
| [EL-12](../../tickets/evidence-based-personalized-learning/12-simpler-story-version.md) | [#48](https://github.com/Zeming-Yuan/english-coach/issues/48) | [把故事变简单，同时保留原版与各自结果](2026-10-31-el-12-simpler-story-version.md) | EL-11 | 可见闭环；边界/兼容 |
| [EL-13](../../tickets/evidence-based-personalized-learning/13-story-reading-check.md) | [#49](https://github.com/Zeming-Yuan/english-coach/issues/49) | [读后两题检查区分理解、独立回忆和回看帮助](2026-10-31-el-13-story-reading-check.md) | EL-08、EL-11 | 可见闭环；边界/兼容 |
| [EL-14](../../tickets/evidence-based-personalized-learning/14-three-turn-drink-scene.md) | [#50](https://github.com/Zeming-Yuan/english-coach/issues/50) | [用三轮买饮品任务建立首个可恢复的场景练习](2026-10-31-el-14-three-turn-drink-scene.md) | EL-08 | 可见闭环；边界/兼容 |
| [EL-15](../../tickets/evidence-based-personalized-learning/15-intro-and-directions-scenes.md) | [#51](https://github.com/Zeming-Yuan/english-coach/issues/51) | [扩展自我介绍和问路，保留各场景的任务边界](2026-10-31-el-15-intro-and-directions-scenes.md) | EL-14 | 可见闭环；边界/兼容 |
| [EL-16](../../tickets/evidence-based-personalized-learning/16-bounded-ai-scene-feedback.md) | [#52](https://github.com/Zeming-Yuan/english-coach/issues/52) | [AI 提供受约束的场景回应，失败仍能继续](2026-10-31-el-16-bounded-ai-scene-feedback.md) | EL-14 | 可见闭环；边界/兼容 |
| [EL-17](../../tickets/evidence-based-personalized-learning/17-time-budget-daily-plan.md) | [#53](https://github.com/Zeming-Yuan/english-coach/issues/53) | [按 3/8/15 分钟开始、暂停和继续每日词卡计划](2026-10-31-el-17-time-budget-daily-plan.md) | None | 可见闭环；边界/兼容 |
| [EL-18](../../tickets/evidence-based-personalized-learning/18-personal-active-time-estimate.md) | [#54](https://github.com/Zeming-Yuan/english-coach/issues/54) | [实际主动用时逐步改善计划估算](2026-10-31-el-18-personal-active-time-estimate.md) | EL-01、EL-17 | 可见闭环；边界/兼容 |
| [EL-19](../../tickets/evidence-based-personalized-learning/19-return-to-learning-mode.md) | [#55](https://github.com/Zeming-Yuan/english-coach/issues/55) | [中断后用有限复习恢复学习](2026-10-31-el-19-return-to-learning-mode.md) | EL-17 | 可见闭环；边界/兼容 |
| [EL-20](../../tickets/evidence-based-personalized-learning/20-contract-evidence-consumers.md) | [#56](https://github.com/Zeming-Yuan/english-coach/issues/56) | [Contract：收口证据、接触与新备份的全部内部消费者](2026-10-31-el-20-contract-evidence-consumers.md) | EL-03、EL-10、EL-12、EL-13、EL-15、EL-16、EL-18、EL-19 | 可见闭环；边界/兼容 |
| [EL-21](../../tickets/evidence-based-personalized-learning/21-integrated-learning-restore-qualification.md) | [#57](https://github.com/Zeming-Yuan/english-coach/issues/57) | [完整演练六项学习、换设备恢复与继续学习](2026-10-31-el-21-integrated-learning-restore-qualification.md) | EL-20 | 可见闭环；边界/兼容 |

## 验证与自检

- 已检查21份计划：89个Python代码块、46个JavaScript代码块、3个JSON代码块语法通过；96个纯规则样例通过。这不等于产品实现或浏览器验收已通过。
- 首条HTTP用例使用真实迁移ec，主UI用例使用appFactory；不新造与现有ECEnv不一致的辅助方法。
- 特别检查EL-05的首红是实际闪卡曝光，而非已由前置满足的空态；EL-16/18先创建真实已保存操作，再验证新增功能。
- EL-20收口若负例已通过，保留实际绿灯并找真正残留旁路，不破坏前置以伪造红灯。EL-21首红为未注册新发行门禁。
- V3在每项新增数据当票同步；不得用EL-21掩盖中间票不能恢复数据的问题。
- 文档/ADR作为任务同一提交显式暂存，不git add .，避免纳入工作区已有未跟踪资料。

## 实施入口

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

当前E2E过滤只接受EC-NN，未添加EL过滤器之前不使用虚构参数。每票使用具体Python节点定位，E2E使用未过滤真实构建/双视口；各票只登记已实现的自身分支，EL-21汇总新旅程。

## 发布结果

用户已授权的21张tickets及完整计划均已发布，直接标记ready-for-agent，未重复triage；31条原生阻塞关系已回读核验。实际编号及正文/计划摘要见 [发布记录](../../tickets/evidence-based-personalized-learning/publication.md)。

为使远端新上下文可独立理解，EL-01的正文另附完整来源规格和共享接口；其他票链接其稳定锚点。这只是文档承载点，不将EL-01变成EL-17的实现依赖，也不新建/修改已有父issue。
