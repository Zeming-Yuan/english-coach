# EL-13 Agent 工作流复盘

范围：EL-13 从旧基线实施、整合 EL-12、验证和合并的本次会话。产品交付为 [PR #68](https://github.com/Zeming-Yuan/english-coach/pull/68)，合并提交 `abe04f3`。本次改进仅涉及 Agent 环境、导航、自动检查、审查标准和工作协议。

## 按严重度排序的发现与处理

1. **高：旧本地基线未被拦截。** 实施起点是 `6a6e41f`，远端已通过 #67 进入 `76dbcfd`；#68 因九个共用文件冲突而无法直接合并。业务依赖已完成与分支包含最新基线是两个独立条件。新增 `scripts/agent_check.py`：每次实际 fetch 后检查目标 SHA 是否为当前 HEAD 祖先，打印双方身份，旧分支或拉取失败返回非零。仅更新远端跟踪引用，保留源文件、索引和 HEAD。工作协议要求创建后、编辑前与 PR 更新前执行；CI 核对真实 PR head。
2. **中：已声明的 Ruff 规范没有自动入口。** `requirements.txt` 要求提交前 Ruff check/format，现有 package 脚本、仓库 CI 与 hook 没有接线。新增 `Agent checks` CI，使用已有工具和 `ruff.toml`，只检查本 PR 涉及的 Python。CLI 同时覆盖本地未提交、未跟踪 Python；不以全仓库扫描掩盖本票信号。工作流只读仓库权限，官方 action 固定至已核对的发布提交。
3. **中：导航只留在原工作区。** AGENTS 与 tracker/domain/labels 指针文档未跟踪，隔离 checkout 不能直接找到。本次按已有内容持久保存，另以一条条件指针接入 development 协议。整合审查要求核对两侧状态、迁移、API、UI 生命周期与 V3 意图；E2E 期间冻结源码/HEAD，验证证据与后续票上下文分开。机械的基线与格式要求交给检查器，语义兼容保留为审查判断。

## 验证与范围内自审

- 行为红灯：仅报告 HEAD 的可运行初版无法拒绝旧基线、fetch 失败和两类非法 Python，隔离回归 **4 failed / 3 passed**。入口文件缺失的准备失败不计行为红灯。
- 最终 `.venv/bin/python -m unittest discover -s scripts/tests -p test_agent_check.py`：**10 passed**。覆盖新鲜基线、远端推进后拒绝且保留脏文件、整合后通过、fetch 失败、未知基线、提交内/未提交/未跟踪 Python、格式失败保留原字节、合法格式。
- 两个新增 Python 文件 Ruff check / format --check、Pyright：**0 errors / warnings**。
- 实际 checkout 执行 `.venv/bin/python scripts/agent_check.py --base dev --lint` 通过，打印远端与当前提交身份。远端 CI 的实际运行记录随 PR 检查保留；这里记录本地证据。
- 自审检查了全部环境增量：参数通过 argv 传递，路径以 NUL 分隔，fetch/祖先/格式失败都非零，未合并冲突被拒绝；不进行 merge/reset/stash/提交/推送，不写应用或用户数据库。导航目标均存在；复用已有 tracker/domain 内容。
- 本切片不启动 Standards/Spec 代理，遵循 retro 的环境交付边界。产品 #68 已单独完成双轴审查。
- 应用测试、浏览器、构建、数据库迁移、备份恢复和领域 ADR：**N/A**，没有产品或数据模型改动。应用 Pyright/测试仍按实际产品切片要求运行，Agent CI 不替代验收。分支保护设置本轮未调整，不把工作流文件存在当作 required-check 已启用。

回退：撤销本环境提交可移除工作流、检查器及新增导航；没有数据转换、依赖迁移或生产状态需要恢复。未扩大产品范围，#64 的历史迁移测试修复继续由原票跟踪。
