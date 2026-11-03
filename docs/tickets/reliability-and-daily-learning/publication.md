# GitHub发布映射与核验记录

- 父规格：[#1 规格、共享接口与执行总览](https://github.com/Zeming-Yuan/english-coach/issues/1)。
- 用户已授权上传；仅发布文档与issues，未开始产品实现，未执行计划中的代码提交或产品验收命令。
- 16张ticket均有完整内嵌计划、ready-for-agent标签与原生父子关联；23条原生Blocked by边已回读核对。
- 核验时间：2026-10-30T09:49:05.755581+00:00；[机器可读记录](publication.json)保存真实issue ID和发布正文SHA-256。

| Ticket | GitHub issue | 完整计划 | Blocked by |
| --- | --- | --- | --- |
| EC-01 | [#2 全新安装和旧库升级后能打开真实首页](https://github.com/Zeming-Yuan/english-coach/issues/2) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/2#implementation-plan) | None（可立即开始） |
| EC-02 | [#3 没有 AI 密钥也能体验首轮学习](https://github.com/Zeming-Yuan/english-coach/issues/3) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/3#implementation-plan) | [EC-01 #2](https://github.com/Zeming-Yuan/english-coach/issues/2) |
| EC-03 | [#4 Expand：新增学习事件，首次看见真实评分轨迹](https://github.com/Zeming-Yuan/english-coach/issues/4) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/4#implementation-plan) | [EC-01 #2](https://github.com/Zeming-Yuan/english-coach/issues/2) |
| EC-04 | [#5 迁移自评分：保存确认、幂等重试与刷新恢复](https://github.com/Zeming-Yuan/english-coach/issues/5) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/5#implementation-plan) | [EC-03 #4](https://github.com/Zeming-Yuan/english-coach/issues/4) |
| EC-05 | [#6 迁移拼写与填空：一次提交，区分独立回忆和提示](https://github.com/Zeming-Yuan/english-coach/issues/6) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/6#implementation-plan) | [EC-03 #4](https://github.com/Zeming-Yuan/english-coach/issues/4) |
| EC-06 | [#7 迁移测验选择与听力：服务端判分，识别练习不改排期](https://github.com/Zeming-Yuan/english-coach/issues/7) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/7#implementation-plan) | [EC-03 #4](https://github.com/Zeming-Yuan/english-coach/issues/4) |
| EC-07 | [#8 迁移混合练习：同题同规则，一次操作只记录一次](https://github.com/Zeming-Yuan/english-coach/issues/8) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/8#implementation-plan) | [EC-05 #6](https://github.com/Zeming-Yuan/english-coach/issues/6)、[EC-06 #7](https://github.com/Zeming-Yuan/english-coach/issues/7) |
| EC-08 | [#9 跨天历史、热力图和连续学习天数可信](https://github.com/Zeming-Yuan/english-coach/issues/9) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/9#implementation-plan) | [EC-04 #5](https://github.com/Zeming-Yuan/english-coach/issues/5) |
| EC-09 | [#10 区分正确率与自评通过率，可靠调节新词量](https://github.com/Zeming-Yuan/english-coach/issues/10) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/10#implementation-plan) | [EC-05 #6](https://github.com/Zeming-Yuan/english-coach/issues/6)、[EC-06 #7](https://github.com/Zeming-Yuan/english-coach/issues/7)、[EC-08 #9](https://github.com/Zeming-Yuan/english-coach/issues/9) |
| EC-10 | [#11 从界面导出完整、带版本的数据库备份](https://github.com/Zeming-Yuan/english-coach/issues/11) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/11#implementation-plan) | [EC-03 #4](https://github.com/Zeming-Yuan/english-coach/issues/4) |
| EC-11 | [#12 旧备份导入不串卡，失败不清空原进度](https://github.com/Zeming-Yuan/english-coach/issues/12) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/12#implementation-plan) | [EC-10 #11](https://github.com/Zeming-Yuan/english-coach/issues/11) |
| EC-12 | [#13 完整备份恢复到另一实例后继续学习](https://github.com/Zeming-Yuan/english-coach/issues/13) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/13#implementation-plan) | [EC-04 #5](https://github.com/Zeming-Yuan/english-coach/issues/5)、[EC-11 #12](https://github.com/Zeming-Yuan/english-coach/issues/12) |
| EC-13 | [#14 首页一键开始到期优先、目标固定的每日学习](https://github.com/Zeming-Yuan/english-coach/issues/14) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/14#implementation-plan) | [EC-09 #10](https://github.com/Zeming-Yuan/english-coach/issues/10) |
| EC-14 | [#15 结束主队列后做有限巩固并获得可信反馈](https://github.com/Zeming-Yuan/english-coach/issues/15) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/15#implementation-plan) | [EC-13 #14](https://github.com/Zeming-Yuan/english-coach/issues/14) |
| EC-15 | [#16 Contract：收口到唯一学习记录规则，移除旧业务分支](https://github.com/Zeming-Yuan/english-coach/issues/16) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/16#implementation-plan) | [EC-07 #8](https://github.com/Zeming-Yuan/english-coach/issues/8)、[EC-09 #10](https://github.com/Zeming-Yuan/english-coach/issues/10)、[EC-12 #13](https://github.com/Zeming-Yuan/english-coach/issues/13) |
| EC-16 | [#17 在新机器到换设备的完整旅程中独立验收](https://github.com/Zeming-Yuan/english-coach/issues/17) | [Implementation Plan](https://github.com/Zeming-Yuan/english-coach/issues/17#implementation-plan) | [EC-02 #3](https://github.com/Zeming-Yuan/english-coach/issues/3)、[EC-14 #15](https://github.com/Zeming-Yuan/english-coach/issues/15)、[EC-15 #16](https://github.com/Zeming-Yuan/english-coach/issues/16) |

## 核验范围

逐票回读GitHub正文，与发布稿SHA-256逐字比对；核对每票对应EC编号、完整计划的两个任务、open状态、ready-for-agent标签、全部直接阻塞与父规格的16个原生子issue。正文中的本地相对链接已改为GitHub issue锚点或固定仓库基线链接。

ready-for-agent不代表忽略阻塞；按已完成依赖选择frontier，初始入口为EC-01。产品验收框仍保持未完成。
