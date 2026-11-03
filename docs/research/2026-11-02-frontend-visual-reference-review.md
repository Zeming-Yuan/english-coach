# EnglishCoach 前端视觉参考调研

> 发布说明（2026-11-03）：缺少图片许可依据的第三方原图及含原图的对比图仅在本地备份保留，公开版本只保留[来源链接与原文件摘要](reference-sources.json)。历史截图路径和比较记录不表示这些原图仍随仓库分发。

- 核对日期：2026-11-02。
- 用户目标：寻找开源项目和成熟厂商产品的真实界面，替代此前两轮未满意的展示稿；偏好成熟产品感。
- 项目基线：`dev@2e6ff05`，已包含每日队列、学习证据、课程进度与持久短测。
- 本文的“可借鉴”属于针对 EnglishCoach 的设计判断；事实依据来自官方产品页、公开仓库、官方帮助和设计系统文档。
- 图片为官方公开发布的产品截图或场景示例，已经逐张打开核对；本次没有登录这些产品完成全流程体验，不将它们称为现场操作截图。

## 优先参考清单

| 参考 | 类型与一手入口 | 针对 EnglishCoach 的借鉴建议 | 适配边界 |
| --- | --- | --- | --- |
| Enjoy Player | [官网](https://player.enjoy.bot/) · [源码](https://github.com/baizhiheizi/enjoy_player) | 练习页：当前任务聚焦、中英内容层级、上下文与操作区分开；词汇页：复习入口、搜索、状态与列表 | 原生 Flutter 产品，适合借鉴视觉和交互结构；其语音评分不是本项目现有能力 |
| Lector | [官网及界面图](https://lector.dev/) · [源码](https://github.com/heuwels/lector) | 故事页：阅读列宽、正文排版、词汇上下文；检查页：题目与选项的集中布局 | 不照搬其掌握百分比、CEFR 推断或整页词汇着色到本项目证据口径 |
| Qwerty Learner | [演示](https://qwerty.kaiyi.cool/) · [源码](https://github.com/RealKai42/qwerty-learner) | 拼写、听写与键盘练习的候选参考；README 的目标与本项目部分练习吻合 | 抓取的官方页面需要 JavaScript，未取得可核验静态截图；不据此声称已经视觉审视全部状态 |
| Readwise Reader | [官方产品页与界面预览](https://readwise.io/read) | 内容库、阅读列表、正文与注释侧栏，适合课程/故事从列表进入阅读的层级 | 商业产品；只借鉴页面组织，不复制其完整知识管理工作流 |
| Apple Books | [官方 Mac 指南及产品图](https://support.apple.com/en-mz/guide/books/welcome/mac) · [阅读操作](https://support.apple.com/en-mz/guide/books/ibks5f526382/mac) | 课程/故事库：封面和标题形成内容识别；阅读页：正文为主、工具为辅；首页强调继续上次内容 | macOS 原生产品；Web 版应重做触控、窄屏与键盘行为，而非模拟窗口外壳 |
| Microsoft Fluent 2 | [设计系统](https://fluent2.microsoft.design/) · [React 组件入口](https://fluent2.microsoft.design/components/web/react) · [源码](https://github.com/microsoft/fluentui) | 统一导航、按钮、输入、弹窗、提示和加载/失败反馈 | 组件规范提供一致性，页面布局仍需围绕学习任务设计 |
| Semi Design | [官网与场景示例](https://semi.design/en-US/) · [源码](https://github.com/DouyinFE/semi-design) | 中文界面的控件尺寸、间距、筛选、列表、表单与状态标签 | 官网场景示例偏企业工作台，不能作为学习首页的整页模板 |
| Linear | [官方界面更新说明](https://linear.app/now/behind-the-latest-design-refresh) | 导航退后、当前任务突出；小图标、弱化边框和稳定工具栏位置 | 只借细节与层级；项目管理的列表密度不直接等于适合初学者的学习密度 |

## 已查看的官方图片

### Enjoy Player：桌面练习

来源：[Enjoy Player 官网](https://player.enjoy.bot/)。官方仓库说明相关截图由应用本身渲染。

[Enjoy Player 官方桌面练习界面（来源链接，原图本地保留）](https://player.enjoy.bot/images/desktop-echo.webp)

观察：当前句子置于主要阅读区，上下文弱化；模式位于顶部，播放/录音在底部。建议借任务与辅助信息的层级，不引入录音评分功能。

### Enjoy Player：词汇页

来源：[官方词汇图](https://player.enjoy.bot/images/phone-vocabulary.webp)。

[Enjoy Player 官方词汇页（来源链接，原图本地保留）](https://player.enjoy.bot/images/phone-vocabulary.webp)

观察：复习入口、总体词汇状态与具体词条分层；下方是统一列表。页面中的 Mastered 属于该产品定义，EnglishCoach 应保留自己的证据标签。

### Lector：阅读页

来源：[Lector 官网](https://lector.dev/)。

[Lector 官方阅读页（来源链接，原图本地保留）](https://lector.dev/_astro/reader.yk5tcvhY_1j6mdD.webp)

观察：阅读内容有固定列宽，导航与阅读工具不占正文主导位置。大量词汇着色会产生视觉负担；本项目宜只突出目标词或当前选择。

### Lector：挖空练习

来源：[Lector 官网](https://lector.dev/)。

[Lector 官方挖空练习页（来源链接，原图本地保留）](https://lector.dev/_astro/cloze.Cg9PXzb6_ZOxQFA.webp)

观察：题干、释义和选项在一个清晰的任务区域。借布局时需保持本项目独立/辅助/识别的区别；图中的 Mastery 不作为可迁移规则。

### Readwise Reader：内容库

来源：[Readwise Reader 官网](https://readwise.io/read)。这是官网公开产品预览，非本次登录捕获。

[Readwise Reader 官方内容库预览（来源链接，原图本地保留）](https://d34adp677peecb.cloudfront.net/static/images/reader/Hero-Screen%401x.72ad6bf1deaa.webp)

观察：内容列表承担主体，导航与右侧笔记是辅助。可借其列表/详情分工；明暗主题需单独决定，不因参考图为深色就固定为深色。

### Apple Books：书架

来源：[Apple Books Mac 用户指南](https://support.apple.com/en-mz/guide/books/welcome/mac)。

[Apple Books 官方书架界面（来源链接，原图本地保留）](https://help.apple.com/assets/67DB47E269E8D943E20D7C8C/67DB47E569E8D943E20D7C92/en_US/7343d8866dcbd4df865352e28de172ce.png)

观察：主内容是具体书籍，侧栏层级简洁，动作不会变成大面积宣传区。对 EnglishCoach 的启发是以课程、故事和继续入口组织首页，而非让统计表占据主体。

### Linear：导航更新细节

来源：[Linear 官方设计更新](https://linear.app/now/behind-the-latest-design-refresh)。

[Linear 官方侧栏更新对照（来源链接，原图本地保留）](https://webassets.linear.app/images/ornj730p/production/b6d6be14c96978b10553cfb9205be1065087e793-3904x2720.png)

官方说明并可在图中看到：图标缩小、非当前项目文字弱化、侧栏留出更稳定的垂直节奏。它提供的是细节依据，不是本项目应采用项目管理布局的证据。

### Semi：官方组件场景示例

来源：[Semi 官网](https://semi.design/en-US/)。这是官方场景示例，不冒充某个内部业务系统的现场截图。

[Semi 官方场景示例（来源链接，原图本地保留）](https://lf9-static.bytednsdoc.com/obj/eden-cn/ptlz_zlp/ljhwZthlaukjlkulzlp/root-web-sites/37361.png)

观察：字体、间距、表单、列表和分割线遵循统一规则。可用来检查组件一致性，但示例的人员、项目、指标区域不属于 EnglishCoach。

## 推荐的设计取舍

这是基于项目目标与上述视觉材料的设计判断，不是用户已经选定的最终方案。

1. 首选 **Enjoy 的学习工作流与 Readwise 的内容组织**作为产品参考：先把“继续学习”和课程/故事做成可使用的内容入口。
2. 如果用户更偏好原生阅读器的精致感，以 **Apple Books** 的内容库和阅读层级为主方向，减少首页统计存在感。
3. 练习页参考 **Enjoy / Qwerty / Lector** 的集中任务区；保存中、保存失败、提示已使用与已确认结果沿用真实业务含义。
4. 全局按钮、输入、抽屉、消息与主题只选择 **Fluent 2 或 Semi 中的一套**作为控件基础，避免各页分别拼出不同风格。
5. 学习证据在首页以简短摘要与详情入口呈现；课程/故事正文承担视觉主体。证据不足采用中性说明，不自动画成错误或失败。

下一轮设计应先确定一款主要产品参考，再针对首页、练习页、故事阅读页各做一个相同视觉系统的具体页面；不再用整页换色表达不同方案。

## 研究边界与追溯

- 本次未变更产品源码、安装组件库或发布外部记录。
- 官方素材原始链接见 [sources.json](reference-images/sources.json)；图片保持原样，仅作为研究材料保存。
- 一张 Readwise 高亮宣传图因透视展示不适合量取界面布局，未纳入主要视觉参考。
- 更详细的开源项目核对见 [开源项目调研](2026-11-02-open-source-visual-references.md)。
- Enjoy Player 当前官方源码是 [baizhiheizi/enjoy_player](https://github.com/baizhiheizi/enjoy_player)，AGPL-3.0；它与 GPL-3.0 的历史仓库 [everyone-can-use-english](https://github.com/ZuodaoTech/everyone-can-use-english) 以及新版 Web 产品的授权范围须区分。
