# 首页色彩与排版改稿

日期：2026-11-02。状态：用户授权在 1 或 3 中选择，选择并实现第 1 张；已完成浏览器验证与独立审查。

## 用户反馈

“首页还是不行，排版和视觉效果不行，太素了，太白了。”

## 现场依据

- 实际首页：`http://127.0.0.1:47275/`，截图 `before.png`。
- 之前认可的首页：原工作区 `docs/design/learning-layout-2026-11-02/home-proposal.png`。
- 实际首页仍是早期布局，没有落实该提案的课程与故事并排、练习分组布局。
- 当前预览使用独立样例库，只有两个词、没有已生成的课程和故事；不能把这个样本当成用户的实际学习记录。

## 截图可见的问题

- 主背景、任务块、课程和故事几乎都在同一浅色明度，缺少视觉重心。
- 两个零计数占据显眼位置，完成状态区域留白过大。
- 右栏聚集了多种操作和长说明，左侧内容却稀疏。
- 课程与故事只有入口文字，缺少能帮助用户判断下一步的内容。
- 练习按钮没有形成清楚的分组与优先级。

## 改稿边界

保留暖石色、陶土色、墨色和阅读质感。改变有面积的表面、主次与布局，不只提高按钮饱和度。每天的学习任务保持唯一主操作，课程与故事为支持区域，专项练习紧凑分组。

三张独立首页候选采用不同结构：横向深色任务区、纵向陶土色任务区、深色导航配暖色内容工作区。图片中的课程、故事、10 词学习轮次与 4/10 进度均为说明布局的示例数据，不代表真实记录。

选择后实现时仍需覆盖：未添加词、无到期词、学习中、全部完成、课程或故事未生成、加载失败。不能为了排版伪造完成率、连续天数、预计学习时间、课程进度或学习建议。

生成参考均实际附带现场截图及之前认可的首页图片。本轮已按第 1 张实现真实首页；未提交、未推送、未发布。

## 本轮显示顺序

1. option-1.png：Charcoal Study Desk，横向深色任务区。
2. option-2.png：Terracotta Learning Workspace，纵向陶土色任务区。
3. option-3.png：Warm Learning Itinerary，深色导航和橄榄色故事区。

每张均有对应 option-N-prompt.txt。第三张首次请求长时间未返回，终止后重新生成；最终只展示这三张成功结果各一次。候选的图片与示例数据均不是已实现的功能截图。

## 实现与验证

- `desktop.png` / `mobile.png` / `tablet.png` / `dark.png` 是最终浏览器实拍；`current.png` 是用户原预览地址的最终状态。
- 原预览 `http://127.0.0.1:47275/` 已更新，仍使用原先两个词的隔离样例库。
- 内容较完整的演示 `http://127.0.0.1:48111/` 使用本目录 `preview-fixture.json` 对应的独立样例；咖啡馆为第 4 课，遵循后端“食物和饮品”目标。不是用户真实学习记录。
- 队列、统计、课程、故事与推荐词都读取既有 API；可选请求各自失败/加载时不会挡住每日学习。没有新增 schema、后端接口或依赖。
- 首页课程/故事/推荐预览保守使用中文；中英混排字段使用中文概述或占位，常见词性缩写可去除。首页预览不记录课程打开、接触、完成或作答。
- 保留开始/继续轮次、独立每日目标、错词/推荐复习、四项练习、场景、学习建议、回测、学习记录与空库入门入口。
- 最新 fresh build 后 Home、EC-01、EC-13、EL-10、Qwerty 共 100 项桌面/手机浏览器检查通过，7 项前端工具测试通过。不是全站发布验收。
- 独立 Correctness / Spec 审查发现英文标题、混排课程目标、课程失败隐藏场景入口三个 P2，均有失败用例后修复并复核。未保留未解决的实质审查问题。
- 详见 `verification.json`、`playwright.json` 与仓库根目录 `design-qa.md`。

验证命令：

```bash
.venv/bin/python scripts/agent_check.py --base dev
cd frontend
node node_modules/vite/bin/vite.js build --outDir /tmp/ec-home-build-verified --emptyOutDir
cd ..
cp app/static/style.css app/static/favicon.svg /tmp/ec-home-build-verified/
cp -r app/static/images /tmp/ec-home-build-verified/
EC_STATIC_DIR=/tmp/ec-home-build-verified EC_REPORT_PATH=/tmp/ec-home-verified.json EC_OUTPUT_DIR=/tmp/ec-home-verified-artifacts EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/home-workspace.spec.mjs e2e/ec-01.spec.mjs e2e/ec-13.spec.mjs e2e/el-10.spec.mjs e2e/qwerty-spelling.spec.mjs --workers 4 --timeout 30000
node --test frontend/src/lib/*.test.mjs
git diff --check
```

此前尝试的初版检查失败与中断均不算通过；最终报告是 `playwright.json` 的 100 passed / 0 skipped / 0 failed。初版发现的统计入口遗漏已补回，旧测试针对新按钮/默认展开状态更新了定位，保存与排期断言保留。

回退：仅还原本次 App.jsx 首页差异、main.jsx 的 home CSS 导入、新样式与配图；保留此前全站样式、拼写实现、全部学习数据。不要还原整个脏工作区或删除数据库。没有需要回退的数据迁移。
