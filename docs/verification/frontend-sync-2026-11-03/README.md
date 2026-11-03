# 前端同步回原项目 — 2026-11-03

用户授权“同步回去”。已将已验证的新首页和 Qwerty 风格拼写实现从独立工作区同步到 `/home/clusteradmin/Desktop/english-coach`，重新生成原目录 `app/static` 产物。不是只保留在临时预览。

## 集成依据

- 原目录旧 HEAD：`6b9a6dcf0a241acd0b54c6abd5c9ffcfea4b8e36`。
- 目标和已验证工作区 HEAD：`7cfbafec2730294a6e74ed0d445bb9b5e79ffad9`，fresh-base guard 在源工作区和原目录均通过。
- 原目录 fast-forward 到该远端基础，带入首页场景练习入口所需的 EL-14 前后端依赖。没有合并提交。
- README 的本地许可证补充与上游说明通过三方合并保留；App 的原有视觉基线与源工作区索引差异仅为场景集成，最终复制已审查并验证的首页版本。
- 原目录 package.json/package-lock.json 的许可证字段比源工作区新，已保留，不用旧副本覆盖。其他许可证、商业说明、研究/规格/任务文档、既有页面改动均保留。
- 所有原有未提交文件先归档，备份路径与同步文件 SHA-256 见 verification.json。临时只保存 README/App 的 stash 在两者恢复并验证后删除；完整恢复归档保留。

## 验证

- 原目录 `npm --prefix frontend run build` 通过，已生成并引用新 JS/CSS。
- 126 项桌面/手机 Playwright 检查通过：Home、EC-01、EC-13、EL-10、Qwerty、EL-14，0失败、0跳过、0重试。
- `pytest tests/test_el14_three_turn_drink_scene.py tests/test_learning_events.py -q`：47 passed。
- `node --test frontend/src/lib/*.test.mjs`：7 passed。
- 测试期间 HEAD 与源文件整体指纹保持不变，最终同步文件字节与已验证工作区一致。
- 浏览器实拍桌面1488×1056/手机420×880，控制台和pageerror均为空、没有横向溢出；配图与深色学习区正常。
- 本次没有改写产品逻辑，复用此前独立 Correctness/Spec 审查的同一源码；本次额外核对了基础集成、README三方结果和原目录真实构建/回归。
- 不是全站完整发布验收；未运行全部后端测试与所有 E2E 文件。

预览：`http://127.0.0.1:37695/`，运行原目录已编译前端，配套数据库在 `/tmp/ec-original-sync-preview/app.db`，仅为样例。真实学习数据库未用于本次验证或改写。

未自动提交、推送或发布。正常从原项目目录启动即可使用同步后的前端。
