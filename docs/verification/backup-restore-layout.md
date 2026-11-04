# 备份恢复页面排版修正

2026-11-04。来源：用户指出旧版部分恢复页的排版、样式未整理，并提供实际截图。
固定基线：`dceb6c39690dbe684ffcdcf83bbcf968c11a9595`（EL-21 / #82 已合并）。

## 本次设计与边界

沿用现有暖白、棕色、细边框和字体。恢复预览按“恢复方式 → 格式与数量摘要 → 记录范围 → 兼容说明 → 安全提示与确认操作”排列。
标题与正文分级，正文采用 14px 和宽松行距；保留范围在桌面分两列、手机分一列，手机确认/取消按钮独占一行。
输入文件区、成功反馈与备份范围也使用本页专属样式，避免通用设置页子元素规则影响排版。

不改变状态、API、修订校验、恢复/取消/下载处理函数、备份数据或原有提示含义。
完整替换、缺修订、空备份等破坏性后果保持可见；不折叠警告，不新增依赖。
没有领域决策、数据库或协议变化，ADR / 迁移 / Python 类型检查：N/A。
回退可一并撤销本页 JSX、独立 CSS 与对应静态产物，不影响任何学习记录。

## 失败与通过证据

先新增浏览器回归：旧版预览的语义标题缺失，在手机、桌面各失败一次；既有六项旧格式检查通过。
红灯目录：`e2e/release-results/ec-e2e-static-YFqQVU/`（2 failed / 6 passed，不计通过）。

最终四组均重新构建真实前端，在真实 FastAPI、迁移 SQLite 上运行；源码在运行中冻结。
每组均为 mobile + desktop，0 skipped / unexpected / flaky，退出码 0：

| 入口 | 结果 | 本机诊断目录后缀 |
| --- | --- | --- |
| `npm --prefix frontend run test:e2e -- --ticket EC-11` | 8 passed | `ec-e2e-static-MynGrR` |
| `npm --prefix frontend run test:e2e -- --ticket EC-12` | 18 passed | `ec-e2e-static-zRjMXq` |
| `npm --prefix frontend run test:e2e -- --ticket EL-20` | 20 passed | `ec-e2e-static-12LeBC` |
| `npm --prefix frontend run test:e2e -- --ticket EL-21` | 12 passed，含每视口 23 项 HTTP 补充 | `ec-e2e-static-D6Qxng` |

本机各命令设置 README 支持的 `EC_CHROMIUM_EXECUTABLE`。完整路径位于隔离工作区的 `e2e/release-results/`。
四组同一源码摘要：`f9bb3f70e09167d45f61593c4572db8c10c5554fc8ba9a77db228d976ab541fa`。
报告记录测试时的未提交修改及新文件，包含真实源码字节；本记录在四组结束后才添加。

新增用例核对：九项缺集合提示、未补造历史说明、取消前后完整快照一致、全量替换数量与删除提示、暗色模式、正文行距和横向不溢出。
新版桌面/手机及暗色截图已实际查看；`restore-panel.png`、`restore-preview.png` 随报告保留。
页面布局回归的长截图中，固定导航可能出现在长图中部，属于全页截图时固定层的捕获位置；视口内导航仍固定在底部。
现有回归覆盖响应丢失、故障回滚、空备份、导航锁、V1/V2/V3 缺集合和换设备继续学习。

本轮只验证受影响范围，共 58 项双视口用例；不把本轮定向结果替代此前的全量发行资格。
前端独立类型检查/JS lint 未配置：N/A；构建由上述每次 E2E 入口执行。

## 实际运行的静态产物

FastAPI 直接提供仓库已提交的 `app/static/index.html` 与打包资源。因此在上述测试后按 README / package.json 执行 `npm --prefix frontend run build`，同步生产入口与新 JS/CSS；既有 clean 脚本移除旧入口 JS。
逐文件 SHA256 核对生产入口及全部构建资源，与上述 EC-11 实测新构建完全相同，不重新生成另一套未经浏览器验证的产物：

- `index-ChGfNvwY.css`：`f64cd07a0030fd23c80a1aa4512b5aa371ab12f9ab1881a8c1f742354a0f3a1a`。
- `index-sLUBXHR8.js`：`3d00c50fe8b66f7c270677549e35a2d4e8bfce5e22f3abcf52e2eeba1d142c2d`。

无 API、数据或恢复逻辑的额外手工修改；静态产物由现有构建命令产生，源代码审查与实际产物摘要共同验证。
