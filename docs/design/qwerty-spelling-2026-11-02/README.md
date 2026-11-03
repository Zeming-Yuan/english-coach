# Qwerty Learner 拼写交互适配

> 发布说明（2026-11-03）：缺少图片许可依据的第三方原图及含原图的对比图仅在本地备份保留，公开版本只保留[来源链接与原文件摘要](../../research/reference-sources.json)。历史截图路径和比较记录不表示这些原图仍随仓库分发。

用户指定 [Qwerty Learner](https://qwerty.kaiyi.cool/) 的拼写界面/动画作为参考，同时保留已认可的暖白质感。已实现可操作的拼写页，不是生成效果图。

- [实际打字录屏](spelling-demo.webm)
- [独立输入桌面截图](independent-desktop.png)
- [提示模式与错误反馈](assisted-error-desktop.png)
- [窄屏截图](independent-mobile.png)
- [参考与实现全图对照（来源链接，原图本地保留）](https://qwerty.kaiyi.cool/)
- [字母区域对照（来源链接，原图本地保留）](https://qwerty.kaiyi.cool/)
- [验证及未通过的全站用例](validation.md)
- [构建与源码指纹](verification.json)

采用大字号等宽字母、直接输入、逐字反馈和轻微错误震动；独立回忆使用原生输入光标，提交前不比对或显示答案。主动选择首字母/长度提示后才显示辅助逐字反馈，已请求的提示不能因切回独立按钮而撤回。输入法回车不提前提交，成功效果与进度等待服务端确认，网络失败保留原输入与提交身份。Enter提交，已保存后Enter继续沿用现有会话机制。

参考源码固定为 [1182426](https://github.com/RealKai42/qwerty-learner/tree/1182426f2bd0a28c95302c33f9e19136b1262a70)：主要核对 Word、Letter 和对应样式。仅借鉴交互表现，使用本项目原有状态与评分流程独立实现；未复制参考项目的词库、品牌、统计系统或源码模块。没有引入新运行依赖。

接口选择为 SpellingBoard 的可选 qwerty variant；其它使用该组件的测验和混合页保留原展示。辅助模式出现错误时允许即时颜色和轻震动；这不是一次已保存的答案结果。独立模式没有这些逐字信号。动画只使用transform/opacity，并支持减少动态效果。

未引入“照着完整英文跟打”、自动清空错误输入、WPM排行、计时器或即时掌握率；这些不能替代当前独立回忆证据。此改动遵守 ADR-0005 的帮助、接触和排期边界，无需新增ADR。

回退时移除拼写页的 variant/form/feedbackState 适配和该专用样式导入，即可恢复原输入展示；保留IME防误提交和独立模式不显示音标的修复。无需数据库变更，不删除事件、帮助、接触或排期。实现留在 codex/qwerty-spelling 隔离工作区，未提交、推送或发布。
