# 每日学习体验优化（#84 / EL-22）

规格：[GitHub #84](https://github.com/Zeming-Yuan/english-coach/issues/84)，用户在会话中确认设计、测试边界及基线。
基线：`8d827ccc9debb0881bbfad0126269810a0de4e46`，隔离分支 `codex/daily-learning-flow`。
按优先级串行实现；测试仅经真实 UI、公开 today/summary API 与迁移 SQLite。

## 切片 1：唯一的下一步

- 首页主任务区域命名“今天下一步”，理由从同一份当前预览或冻结轮次派生；继续轮次优先。
- 空库、无可学卡、到期复习、新词与恢复模式的理由不冒充完成或暴露英文答案。
- RED：`ec-e2e-static-qh8jqN`，两视口均因缺少下一步区域/理由失败。第一次实现脚本误用环境不存在的 `python`，未改动代码；随后重复红灯 `nyrPPv` 不作为实现证据。
- GREEN：`EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm --prefix frontend run test:e2e -- --ticket EL-22` → 2 passed，`ec-e2e-static-trGcok`。验证三分钟目标、唯一开始按钮、暂停/刷新后同索引继续、未提前揭示英文答案。构建在同次主入口完成。
- 基线公开接口：`.venv/bin/python -m pytest tests/test_daily_session.py tests/test_session_summary.py -q` → 14 passed。
- 前端独立类型/静态命令 N/A：package.json 未配置；没有 Python 产品变更，不扩大类型检查范围。
- 独立 Standards / Spec reviewer 对 `8d827cc...e371bf1` 均无 actionable findings；未直接验证的理由分支继续标记为补充验证范围。

## 门禁边界

全量 pytest、未过滤 E2E、真实外部模型/音频和生产部署未验证；按用户要求只运行受影响范围。
本票不增加账户/权限、数据库写入或迁移。安全扫描、容器、不可逆迁移恢复 N/A；不声称既有发布流程通过。
回滚方式：撤回前端改动，保留所有服务器学习事件、时长与排期。

## 切片 2：首页信息层级

- 样本、估算公式、目标设置、余量折入原生 details，键盘和触屏均可展开。时间、理由、本轮任务和开始保留在外层，沿用当前视觉系统。
- RED：初次 negative visibility 断言遇到加载空态提前通过，最终缺少详情入口而超时；停止该轮，不作为有效红灯证据。补“预估已可见”的前置条件后，`ec-e2e-static-xvabQQ` 两视口均因估算依据仍在外层可见失败。
- GREEN：EL-22 6 passed，`ec-e2e-static-02ycfc`；EC-09 6 passed，`ec-e2e-static-4EFVne`；EC-13 32 passed，`ec-e2e-static-6MDXHc`。均使用 README 主入口、新构建、独立数据库和实际 Chrome 双视口；所有结果收齐后才修改文档。
- 截图已实际查看：桌面/移动 home-focused，验证标题和开始按钮完整在首屏，手机无横向溢出。更新既有目标测试，仅增加真实展开步骤，保留原断言。
- 独立前端类型/静态命令仍 N/A；本片无后端改动。审查固定点 `e371bf1`。

- 切片 2 独立 Standards / Spec 对 `e371bf1...f14020c` 均无 actionable findings。Spec reviewer 无法读取实时 GitHub（401），改用本会话确认、发布时保存的完整 issue body；未核实时评论。

## 切片 3：完成收尾

- 只在真实 summary 成功后，完成态显示“本轮已完成，今天可以结束了”；暂停态仍显示剩余目标，没有完成提示。待巩固词保持外层可见，指标、下一排期和自选测验折入详情。恢复模式另外提供“今天先到这里”，常规计划仍可选。
- RED：`ec-e2e-static-p8iYch`，新增两视口因缺少 daily-closure 失败，旧分支 6 passed。
- GREEN：EL-22 8 passed，`ec-e2e-static-yOSVWB`；已查看桌面与移动 daily-closure 截图。公开备份事件对比确认展开详情不写学习记录，主队列两次保存、仍有 apple 待复习。
- EC-14 首轮 28 passed / 4 failed（两个具名分支 × 双视口）；诊断为旧测试通用 summary 选择器歧义、指标已折叠未展开，产品保存状态机未改。精确指向“专项练习”并补真实展开后，EC-14 **32 passed**，`ec-e2e-static-Lq4s2f`。
- 同样依赖通用 summary 的 EC-04 课程及 EC-16 两个 TTS 失败分支改为准确控件，定向 **6 passed**。此补充用项目已有 Playwright CLI/config 和 runner 同等 Vite 新构建 `/tmp/ec84-slice3-static` 执行：`EC_STATIC_DIR=/tmp/ec84-slice3-static EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_REPORT_PATH=/tmp/ec84-slice3-scoped-report.json node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs --grep 'EC-04 lesson-rating-stays-on-failure|EC-16 TTS provider (timeout|error) preserves saved learning'`。保留全部原断言；无全量门禁。
- 前端独立类型/静态命令 N/A；审查固定点 `f14020c`。
