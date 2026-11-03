# 页面回归测试入库（2026-11-03）

用户授权将仓库中全部已有改动分开提交 PR 并按顺序合并。本次只收录原目录已有的三份页面回归测试和 reader-design 样例，不改变产品实现。对应历史设计材料在后续资料归档 PR 中保留。

## 范围与结果

- 基线：`48f5d4d79ffd7df7b98a3a9dba234e22e817a662`（已合并 EL-15 和许可说明）。四个原文件字节完整保留。
- 实际生产构建通过，随后只运行这三个文件：mobile/desktop 合计 **20 passed，0 skipped，0 unexpected，0 flaky**；50.8 秒。
- 覆盖导航、备份入口布局、译文和字号控制、键盘查词与焦点恢复、释义框边界和句子隔离、词条编辑与证据、长单词窄屏显示、设置返回及不请求外部字体服务。
- 使用现有真实 FastAPI／独立迁移 SQLite 测试支持；未访问或修改用户学习库。测试运行期间未修改源码或 HEAD。
- 原样首次运行即通过，没有修改产品制造失败；不把已有行为的补充测试称为新功能 TDD。

## 可复核命令

来自 frontend/package.json、e2e/playwright.config.mjs、现有 runner 与故事阅读设计手册中的定向命令：

```bash
.venv/bin/python scripts/agent_check.py --base dev
npm --prefix frontend run build
EC_STATIC_DIR="$PWD/app/static" \
EC_OUTPUT_DIR=/tmp/ec-design-regression \
EC_REPORT_PATH=/tmp/ec-design-regression.json \
EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell \
node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/full-design.spec.mjs e2e/reader-design.spec.mjs e2e/story-theme.spec.mjs
git diff --check
```

本次实际诊断保留在 `/tmp/ec-design-tests-first.json`、`/tmp/ec-design-tests-first.log`，输出目录 `/tmp/ec-design-tests-first`；均未入库。未更改完整门禁，也未把定向结果称为完整发布验收。

## N/A 与回退

前端独立 lint/type 脚本未配置；本次没有生产源码、权限、幂等、审计、错误码、并发、数据模型、迁移或 ADR 变化，相关新增行为验证 N/A。未重跑全部 Python 或完整发布套件。删除这三个测试文件和样例即可回退，不改变学习数据。
