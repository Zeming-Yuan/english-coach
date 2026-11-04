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
- 审查固定点为上述实施基线，审查结果待独立 reviewer 返回后补记。

## 门禁边界

全量 pytest、未过滤 E2E、真实外部模型/音频和生产部署未验证；按用户要求只运行受影响范围。
本票不增加账户/权限、数据库写入或迁移。安全扫描、容器、不可逆迁移恢复 N/A；不声称既有发布流程通过。
回滚方式：撤回前端改动，保留所有服务器学习事件、时长与排期。
