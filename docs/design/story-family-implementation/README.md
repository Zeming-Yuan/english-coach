# 全站故事页视觉落地

2026-11-02。用户确认第三张暖白词条详情图，并要求其他页面同样采用。此目录是实际浏览器截图，不是新一轮生成图。

- [视觉基准](../page-by-page-2026-11-02/story-visual-baseline.md)
- [已确认图与实际实现对照](comparison.png)
- [桌面页面总览](contact-sheet-desktop.png)
- [手机页面总览](contact-sheet-mobile.png)
- [浏览器计算样式与溢出记录](browser-audit.json)
- [构建、测试与源码指纹](verification.json)
- [完整 Playwright 结果](playwright-results.json)
- [项目视觉 QA](../../../design-qa.md)

使用暖白内容面、暖灰导航、炭黑主按钮和少量陶土色强调。中文采用本地打包的 Noto Sans SC Variable，英文学习内容采用 Tinos；不再依赖 Google Fonts。字体许可随构建资源保存在 `app/static/fonts/`。

词条详情以主内容与证据旁注分栏，手机上改为上下排列。首页把课程与故事入口移出折叠区，设置按功能分节；课程、词库使用轻量行分隔，练习保留专注模式。同步进来的故事原版/简化版与读后检查也保留原有逻辑并纳入样式。

## 截图入口

| 页面或状态 | 桌面 | 手机 |
|---|---|---|
| 首页 | [查看](screens/home-desktop.png) | [查看](screens/home-mobile.png) |
| 课程 | [查看](screens/courses-desktop.png) | [查看](screens/courses-mobile.png) |
| 课程详情 | [查看](screens/course-detail-desktop.png) | [查看](screens/course-detail-mobile.png) |
| 本课短测 | [查看](screens/lesson-check-desktop.png) | [查看](screens/lesson-check-mobile.png) |
| 词库 | [查看](screens/words-desktop.png) | [查看](screens/words-mobile.png) |
| 词条详情 | [查看](screens/word-detail-desktop.png) | [查看](screens/word-detail-mobile.png) |
| 故事库 | [查看](screens/stories-desktop.png) | [查看](screens/stories-mobile.png) |
| 阅读 | [查看](screens/reader-desktop.png) | [查看](screens/reader-mobile.png) |
| 阅读查词 | [查看](screens/reader-lookup-desktop.png) | [查看](screens/reader-lookup-mobile.png) |
| 加词 | [查看](screens/add-desktop.png) | [查看](screens/add-mobile.png) |
| 记录 | [查看](screens/stats-desktop.png) | [查看](screens/stats-mobile.png) |
| 设置 | [查看](screens/settings-desktop.png) | [查看](screens/settings-mobile.png) |
| 深色设置 | [查看](screens/settings-dark-desktop.png) | [查看](screens/settings-dark-mobile.png) |
| 备份 | [查看](screens/backup-desktop.png) | [查看](screens/backup-mobile.png) |
| 拼写 | [查看](screens/spelling-desktop.png) | [查看](screens/spelling-mobile.png) |
| 听写 | [查看](screens/listening-desktop.png) | [查看](screens/listening-mobile.png) |
| 测验 | [查看](screens/quiz-desktop.png) | [查看](screens/quiz-mobile.png) |
| 混合 | [查看](screens/mixed-desktop.png) | [查看](screens/mixed-mobile.png) |
| 回测空态 | [查看](screens/delayed-desktop.png) | [查看](screens/delayed-mobile.png) |
| 建议练习 | [查看](screens/advice-desktop.png) | [查看](screens/advice-mobile.png) |
| 词卡 | [查看](screens/flashcards-desktop.png) | [查看](screens/flashcards-mobile.png) |
| 巩固 | [查看](screens/reinforcement-desktop.png) | [查看](screens/reinforcement-mobile.png) |
| 本轮结果 | [查看](screens/result-desktop.png) | [查看](screens/result-mobile.png) |
| 故事简化版 | [查看](screens/story-simplified-desktop.png) | [查看](screens/story-simplified-mobile.png) |
| 读后检查结果 | [查看](screens/story-check-result-desktop.png) | [查看](screens/story-check-result-mobile.png) |

## 范围和限制

38 项相关浏览器测试与 7 项前端库测试通过。23 种页面/状态进行了双尺寸巡检，另从集成测试补充简化故事和读后检查结果截图；巡检未见横向溢出和页面异常。没有宣称覆盖所有弹窗、所有错误或全量后端回归。

截图与预览使用隔离样例库；没有写入用户学习数据库。设计图的额外词典定义、记忆法和示例历史没有伪造到产品中。实际数据不足时保留已有空态与未知状态。下载成绩单的旧画布样式不属于本轮页面重构。

修改尚未自动提交、推送或发布。此前 QA 保存在 [previous-design-qa.md](previous-design-qa.md)，不能把旧报告当作本次验证结果。
