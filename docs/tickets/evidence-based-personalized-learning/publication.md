# GitHub 发布记录：可验证学习效果与个性化训练

- 日期：2026-10-31；21 张已确认 tickets，各含完整实施计划；标签 `ready-for-agent`。
- GitHub 仓库：[Zeming-Yuan/english-coach](https://github.com/Zeming-Yuan/english-coach)。
- 完整来源规格：[EL-01 附录](https://github.com/Zeming-Yuan/english-coach/issues/37#source-specification)；共享接口：[EL-01 附录](https://github.com/Zeming-Yuan/english-coach/issues/37#shared-interface-contracts)；远端清单：[Ticket Map](https://github.com/Zeming-Yuan/english-coach/issues/37#ticket-map)。
- 机器可读编号、正文/计划 SHA-256 与 31 条直接依赖：[publication.json](publication.json)。EL 标识不等于 GitHub issue 编号。
- 回读验收：21 份标题、完整正文、标签与唯一性；31 条原生 Blocked by 关系；原有 #1–#17 的状态、标题、正文、标签和更新时间保持不变。
- 文档检查：21 份计划、89 个 Python 代码块、46 个 JS 代码块、3 个 JSON 代码块语法通过，96 个纯规则样例通过；机器可读结果见 [plan-checks.json](plan-checks.json)。
- 产品代码未实施；未运行产品测试、迁移或部署。计划中的红绿测试、双视口 E2E 与回退演练留待逐票实施并记录证据。
- 最高测试 seam：浏览器 → 真实 React/FastAPI/FSRS/事务 → Alembic 迁移的隔离 SQLite；外部 AI/TTS 替身、注入时钟。
- 当前无业务前置的入口：[EL-01](https://github.com/Zeming-Yuan/english-coach/issues/37) 与 [EL-17](https://github.com/Zeming-Yuan/english-coach/issues/53)。其他票等待原生阻塞关系完成。

| Ticket | GitHub | 完整本地计划 | Blocked by |
| --- | --- | --- | --- |
| EL-01 | [#37](https://github.com/Zeming-Yuan/english-coach/issues/37) | [Expand：编辑词卡后仍能完整备份与恢复内容修订](../../superpowers/plans/2026-10-31-el-01-expand-revisions-and-v3.md) | None |
| EL-02 | [#38](https://github.com/Zeming-Yuan/english-coach/issues/38) | [独立作答后，在词卡详情看到有依据的回忆状态](../../superpowers/plans/2026-10-31-el-02-recall-evidence-detail.md) | [EL-01](https://github.com/Zeming-Yuan/english-coach/issues/37) |
| EL-03 | [#39](https://github.com/Zeming-Yuan/english-coach/issues/39) | [Migrate：首页、词表、统计和分享图统一解释学习进展](../../superpowers/plans/2026-10-31-el-03-migrate-evidence-readers.md) | [EL-02](https://github.com/Zeming-Yuan/english-coach/issues/38) |
| EL-04 | [#40](https://github.com/Zeming-Yuan/english-coach/issues/40) | [Expand：看词卡或听答案后，能核对最近一次应用内接触](../../superpowers/plans/2026-10-31-el-04-expand-contact-recording.md) | [EL-01](https://github.com/Zeming-Yuan/english-coach/issues/37) |
| EL-05 | [#41](https://github.com/Zeming-Yuan/english-coach/issues/41) | [Migrate：闪卡与专项练习准确记录答案接触和提示](../../superpowers/plans/2026-10-31-el-05-migrate-practice-contact.md) | [EL-04](https://github.com/Zeming-Yuan/english-coach/issues/40) |
| EL-06 | [#42](https://github.com/Zeming-Yuan/english-coach/issues/42) | [Migrate：课程、故事和内容编辑保持可追溯的接触与修订](../../superpowers/plans/2026-10-31-el-06-migrate-content-contact.md) | [EL-04](https://github.com/Zeming-Yuan/english-coach/issues/40) |
| EL-07 | [#43](https://github.com/Zeming-Yuan/english-coach/issues/43) | [课程有明确目标，生成、浏览和待检查分别记录](../../superpowers/plans/2026-10-31-el-07-lesson-goals-and-progress.md) | [EL-06](https://github.com/Zeming-Yuan/english-coach/issues/42) |
| EL-08 | [#44](https://github.com/Zeming-Yuan/english-coach/issues/44) | [课程三题短测可保存、继续，并留下可解释的结果](../../superpowers/plans/2026-10-31-el-08-lesson-recall-check.md) | [EL-02](https://github.com/Zeming-Yuan/english-coach/issues/38), [EL-05](https://github.com/Zeming-Yuan/english-coach/issues/41), [EL-07](https://github.com/Zeming-Yuan/english-coach/issues/43) |
| EL-09 | [#45](https://github.com/Zeming-Yuan/english-coach/issues/45) | [隔日和一周回测按真实记录间隔计分](../../superpowers/plans/2026-10-31-el-09-delayed-recall-check.md) | [EL-08](https://github.com/Zeming-Yuan/english-coach/issues/44) |
| EL-10 | [#46](https://github.com/Zeming-Yuan/english-coach/issues/46) | [统计能解释薄弱项，并一键进入对应练习](../../superpowers/plans/2026-10-31-el-10-actionable-learning-advice.md) | [EL-09](https://github.com/Zeming-Yuan/english-coach/issues/45) |
| EL-11 | [#47](https://github.com/Zeming-Yuan/english-coach/issues/47) | [根据已有学习依据生成难度受控的短故事](../../superpowers/plans/2026-10-31-el-11-bounded-personalized-story.md) | [EL-02](https://github.com/Zeming-Yuan/english-coach/issues/38), [EL-06](https://github.com/Zeming-Yuan/english-coach/issues/42) |
| EL-12 | [#48](https://github.com/Zeming-Yuan/english-coach/issues/48) | [把故事变简单，同时保留原版与各自结果](../../superpowers/plans/2026-10-31-el-12-simpler-story-version.md) | [EL-11](https://github.com/Zeming-Yuan/english-coach/issues/47) |
| EL-13 | [#49](https://github.com/Zeming-Yuan/english-coach/issues/49) | [读后两题检查区分理解、独立回忆和回看帮助](../../superpowers/plans/2026-10-31-el-13-story-reading-check.md) | [EL-08](https://github.com/Zeming-Yuan/english-coach/issues/44), [EL-11](https://github.com/Zeming-Yuan/english-coach/issues/47) |
| EL-14 | [#50](https://github.com/Zeming-Yuan/english-coach/issues/50) | [用三轮买饮品任务建立首个可恢复的场景练习](../../superpowers/plans/2026-10-31-el-14-three-turn-drink-scene.md) | [EL-08](https://github.com/Zeming-Yuan/english-coach/issues/44) |
| EL-15 | [#51](https://github.com/Zeming-Yuan/english-coach/issues/51) | [扩展自我介绍和问路，保留各场景的任务边界](../../superpowers/plans/2026-10-31-el-15-intro-and-directions-scenes.md) | [EL-14](https://github.com/Zeming-Yuan/english-coach/issues/50) |
| EL-16 | [#52](https://github.com/Zeming-Yuan/english-coach/issues/52) | [AI 提供受约束的场景回应，失败仍能继续](../../superpowers/plans/2026-10-31-el-16-bounded-ai-scene-feedback.md) | [EL-14](https://github.com/Zeming-Yuan/english-coach/issues/50) |
| EL-17 | [#53](https://github.com/Zeming-Yuan/english-coach/issues/53) | [按 3/8/15 分钟开始、暂停和继续每日词卡计划](../../superpowers/plans/2026-10-31-el-17-time-budget-daily-plan.md) | None |
| EL-18 | [#54](https://github.com/Zeming-Yuan/english-coach/issues/54) | [实际主动用时逐步改善计划估算](../../superpowers/plans/2026-10-31-el-18-personal-active-time-estimate.md) | [EL-01](https://github.com/Zeming-Yuan/english-coach/issues/37), [EL-17](https://github.com/Zeming-Yuan/english-coach/issues/53) |
| EL-19 | [#55](https://github.com/Zeming-Yuan/english-coach/issues/55) | [中断后用有限复习恢复学习](../../superpowers/plans/2026-10-31-el-19-return-to-learning-mode.md) | [EL-17](https://github.com/Zeming-Yuan/english-coach/issues/53) |
| EL-20 | [#56](https://github.com/Zeming-Yuan/english-coach/issues/56) | [Contract：收口证据、接触与新备份的全部内部消费者](../../superpowers/plans/2026-10-31-el-20-contract-evidence-consumers.md) | [EL-03](https://github.com/Zeming-Yuan/english-coach/issues/39), [EL-10](https://github.com/Zeming-Yuan/english-coach/issues/46), [EL-12](https://github.com/Zeming-Yuan/english-coach/issues/48), [EL-13](https://github.com/Zeming-Yuan/english-coach/issues/49), [EL-15](https://github.com/Zeming-Yuan/english-coach/issues/51), [EL-16](https://github.com/Zeming-Yuan/english-coach/issues/52), [EL-18](https://github.com/Zeming-Yuan/english-coach/issues/54), [EL-19](https://github.com/Zeming-Yuan/english-coach/issues/55) |
| EL-21 | [#57](https://github.com/Zeming-Yuan/english-coach/issues/57) | [完整演练六项学习、换设备恢复与继续学习](../../superpowers/plans/2026-10-31-el-21-integrated-learning-restore-qualification.md) | [EL-20](https://github.com/Zeming-Yuan/english-coach/issues/56) |
