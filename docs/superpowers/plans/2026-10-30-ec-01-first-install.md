# EC-01 按文档初始化空库或升级旧库后，真实首页可以打开，未配置 AI 不阻断本地学习。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按文档初始化空库或升级旧库后，真实首页可以打开，未配置 AI 不阻断本地学习。

**Architecture:** 先修真实迁移链和延迟模型客户端，再把可控运行环境接到现有 FastAPI 入口。测试准备与首条启动行为一起交付，不独立建设通用测试平台。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-01](../../tickets/reliability-and-daily-learning/01-first-install.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/2#implementation-plan)。

**Status:** 实施计划已编写；已随对应ticket发布；未执行产品改动、未宣称产品测试已通过。

## Global Constraints

- 保留现有前后端结构与本地数据库方案，不重写应用。
- 新事件以 UTC 存储时间，按配置的学习时区归属学习日，默认 `Asia/Shanghai`。事件保存当时的学习时区，后续设置变化不重写历史日期。
- 使用本次运行独有的数据库、端口、下载目录和浏览器上下文；不接触用户数据库，不调用真实付费 AI。
- 必经步骤不可因队列为空、AI 超时或入口缺失而静默跳过。断言失败、未处理错误或流程中断必须使命令以非零状态退出，并保留诊断信息。
- 当前最高测试 seam：浏览器用户界面 → 真实 FastAPI → 通过 Alembic 迁移建立的隔离 SQLite。
- 单卡当前记忆状态与追加事件分离；旧历史未知就标注未知，不补造。
- 所有schema变更沿expand→迁移→contract，保留兼容读写；本票不能顺便删除公共URL或物理历史数据。

## Review Focus

以下五类输入在首个正常示例中未覆盖，已分别纳入下方Task的Review Focus代码、具名边界测试或故障演练步骤。不能只检查正常示例就完成本票。

- RF1: 已标记迁移完成但缺 rating：仍可向前修复。
- RF2: 旧 DEEPSEEK 配置与新配置冲突：说明迁移方向且不泄密。
- RF3: 从不同工作目录启动：静态目录仍有效。
- RF4: 自定义或只读数据库：迁移目标一致，失败有原因。
- RF5: 空密钥与外部服务故障：已有内容可用，AI明确503。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 真实迁移与无密钥启动

**Files:**
- **Create:** alembic/versions/b1c2d3e4f501_repair_review_rating.py
- **Create:** app/runtime.py
- **Create:** app/services/llm_client.py
- **Modify:** app/config.py; app/db.py; alembic/env.py; app/main.py
- **Modify:** app/services/card_generator.py; app/services/lesson_generator.py; app/services/story_generator.py; app/services/graduation.py; app/routers/stories.py; app/routers/lookup.py
- **Test:** tests/test_installation.py

**Interfaces:**
- Consumes: 现有 Settings、get_db、Alembic a9f3e7d1c2b4；保持 app.main:app 和生成模块 client 的兼容名。
- Produces: 共享契约中的 Runtime、Clock、create_app、get_runtime、LazyLLMClient；repair revision b1c2d3e4f501。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_installation.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

def test_fresh_migration_contains_rating(tmp_path):
    url = f"sqlite:///{tmp_path / 'fresh.db'}"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")
    engine = create_engine(url)
    try:
        assert "rating" in {c["name"] for c in inspect(engine).get_columns("reviews")}
    finally:
        engine.dispose()
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
LLM_API_KEY=plan-placeholder LLM_BASE_URL=http://127.0.0.1:9/v1 python -m pytest tests/test_installation.py::test_fresh_migration_contains_rating -q
```

**预期失败原因：** 现有 rating 迁移为空，真实迁移后的 reviews 不含 rating；首次红灯在这个业务断言，不接受依赖缺失或收集失败替代。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
from alembic import op
import sqlalchemy as sa

revision = "b1c2d3e4f501"
down_revision = "a9f3e7d1c2b4"
branch_labels = None
depends_on = None

def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("reviews")}
    if "rating" not in columns:
        op.add_column("reviews", sa.Column("rating", sa.Integer(), nullable=True))

def downgrade():
    return None
```

- [ ] **Step 4: 用 SQLite backup API 在升级前建立副本，成功校验后才迁移；不修改历史空迁移来掩盖已部署旧库缺列。**

- [ ] **Step 5: Settings 显式处理旧变量和冲突；模板使用 LLM_*，缺钥允许初始化。生成模块的 client 改成惰性代理，chat 属性访问时才检查配置；统一异常处理器将 LLMNotConfigured 映射503。**

- [ ] **Step 6: create_app 接收运行时与绝对静态目录，默认 app 仍可由 uvicorn 导入。Alembic 从相同 Settings 取数据库地址；测试显式设置 Config sqlalchemy.url 时优先测试目标，防止写到正式库。**

- [ ] **Step 7: 现有 @patch(...client) 测试继续替换代理对象；不要把所有测试改成需要真实网络。**

- [ ] **Step 8: 测试Settings的错误输出hide_input_in_errors=True并仅展示配置项名称；子进程cwd用tmp_path/PYTHONPATH，不能读取用户.env或泄露真实配置。**

- [ ] **Step 9: 钉住Review Focus及异常路径**

```python
import os
import subprocess
import sys
import pytest

@pytest.mark.parametrize(("env_update", "message"), [
    ({"LLM_API_KEY": "", "DEEPSEEK_API_KEY": "OLD_SECRET_DO_NOT_PRINT"}, "LLM_API_KEY"),
    ({"LLM_API_KEY": "NEW_SECRET_DO_NOT_PRINT", "DEEPSEEK_API_KEY": "old"}, "冲突"),
])
def test_legacy_configuration_explains_migration(env_update, message, tmp_path):
    env = dict(os.environ, **env_update, PYTHONPATH=os.getcwd())
    result = subprocess.run(
        [sys.executable, "-c", "from app.config import settings"],
        env=env, cwd=tmp_path, text=True, capture_output=True,
    )
    assert result.returncode != 0
    assert message in result.stderr
    assert "old" not in result.stderr
    assert "new" not in result.stderr
```

同文件增加 test_stamped_missing_rating_repairs、test_custom_database_target、test_readonly_database_reports_reason，分别以手建缺列库、不同 SQLite URL 和只读连接验证升级保留内容及明确错误；Task 2 再从浏览器验证工作目录/无密钥。


- [ ] **Step 10: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_installation.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 11: 同步文档或ADR**

同步 README、.env.example 的实际变量、Linux/Windows激活方式、数据库地址与升级前备份说明；本票不记录新的领域 ADR。

- [ ] **Step 12: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'alembic/versions/b1c2d3e4f501_repair_review_rating.py' 'app/runtime.py' 'app/services/llm_client.py' 'app/config.py' 'app/db.py' 'alembic/env.py' 'app/main.py' 'app/services/card_generator.py' 'app/services/lesson_generator.py' 'app/services/story_generator.py' 'app/services/graduation.py' 'app/routers/stories.py' 'app/routers/lookup.py' 'tests/test_installation.py'
git commit -m "fix: make fresh and legacy installations boot safely"
```

**回滚或兼容策略：** 保留新增兼容列；撤回配置代理须保持旧导入名。只在没有后续新进度的失败升级中使用迁移前副本，不能清库。

---

### Task 2: 从浏览器验证安装行为并建立逐票验收入口

**Files:**
- **Create:** e2e/run.mjs; e2e/playwright.config.mjs; e2e/support/test.mjs; e2e/support/server.py; e2e/support/seed.py; e2e/support/fixture_loader.py
- **Create:** tests/support/ec_env.py; tests/support/__init__.py; tests/__init__.py; tests/test_ec_environment.py
- **Create:** e2e/ec-01.spec.mjs
- **Modify:** tests/conftest.py; frontend/package.json; frontend/package-lock.json; app/main.py
- **Modify:** frontend/src/App.jsx; frontend/src/lib/tts.js
- **Modify:** .gitignore

**Interfaces:**
- Consumes: Task 1 的应用工厂和 Runtime；Playwright test/request 与子进程，不经过真实AI。
- Produces: 共享契约的 ec/ec_factory、app/appFactory、test:e2e 和逐票过滤；后续票的测试只使用这些公开夹具。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-01.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import { test, expect } from "./support/test.mjs";

test("EC-01 no-key-home", async ({ app, page }) => {
  await page.goto(app.baseURL);
  await expect(page.getByRole("button", {name: "先加几个词"})).toBeVisible();
  await expect(page.getByText("加载失败", {exact: true})).toHaveCount(0);
  const response = await app.request.post("/api/cards/generate", {data: {words: ["apple"]}});
  expect(response.status()).toBe(503);
  await expect(page.getByRole("navigation")).toBeVisible();
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-01
```

**预期失败原因：** 现在没有 test:e2e 入口和隔离 app fixture；先建立能启动测试的最小支持，再在未修无密钥入口的临时回归环境中确认业务断言失败。不能把空用例匹配当成功。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=fileURLToPath(new URL("../",import.meta.url));
const args=process.argv.slice(2);
const at=args.indexOf("--ticket");
const ticket=at<0?null:args[at+1];
if(ticket!==null&&!/^EC-\d{2}$/.test(ticket)) throw Error("Invalid --ticket selector");
const runnerArgs=["test","--config",path.join(root,"e2e/playwright.config.mjs")];
if(ticket) runnerArgs.push("--grep",ticket+"(?:\\s|$)");
const result=spawnSync(process.execPath,[
 path.join(root,"frontend/node_modules/@playwright/test/cli.js"),...runnerArgs
],{cwd:root,stdio:"inherit",env:process.env});
process.exit(result.status??1);
```

- [ ] **Step 4: 把 @playwright/test 加为开发依赖并锁定 lockfile；安装命令写入README。配置两个视口、明确测试目录与失败trace，不使用 --pass-with-no-tests。**

- [ ] **Step 5: 按共享契约实现ECEnv：临时文件库真实迁移，seed_card提交后返回ID、MutableClock按实例注入、before_commit故障仅绑定测试引擎。保留原快速fixtures，新ec独立使用。**

- [ ] **Step 6: app fixture 在每测试独立目录启动测试Python工厂、可控LLM/TTS与构建产物；test:e2e先运行Vite输出到临时静态目录并复制style.css/favicon，不能删除仓库已有assets来准备测试。**

- [ ] **Step 7: seed/时钟/故障控制仅位于测试支持，生产不注册调试端点；全生命周期finally清理进程。前端TTS先检查speechSynthesis存在，失败展示文本或本地兜底，不使页面崩溃。**

- [ ] **Step 8: npm --prefix运行脚本时cwd在frontend，因此run.mjs必须从import.meta.url解析根目录，并给所有子进程显式cwd。support/test.mjs和playwright.config.mjs用createRequire指向frontend/package.json加载@playwright/test，不能假设根目录也安装了node_modules。**

- [ ] **Step 9: 钉住Review Focus及异常路径**

```javascript
import { test, expect } from "./support/test.mjs";

for (const llmState of ["missing", "timeout", "unavailable"]) {
  test("EC-01 external-" + llmState, async ({ appFactory, page }) => {
    const instance = await appFactory({fixture: "ec01-" + llmState + ".json"});
    await page.goto(instance.baseURL);
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByText("加载失败", {exact: true})).toHaveCount(0);
  });
}
```

创建上述三个fixture JSON，分别只有 settings.llm_api_key=''、external.llm='timeout'、external.llm='unavailable'，其余数据空；同测试支持接收 settings/external，与模型数据分开。增加 runner未知票号/无用例非零的子进程测试，以及 change-cwd 静态资源测试，覆盖RF3/RF5。


- [ ] **Step 10: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-01
python -m pytest tests/test_ec_environment.py tests/test_installation.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 11: 同步文档或ADR**

README同步安装浏览器、激活环境、逐票/整体验证命令和故障诊断位置；EC-01 ticket记录入口已实现后方可让后续票执行。

- [ ] **Step 12: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'e2e/run.mjs' 'e2e/playwright.config.mjs' 'e2e/support/test.mjs' 'e2e/support/server.py' 'e2e/support/seed.py' 'e2e/support/fixture_loader.py' 'tests/support/ec_env.py' 'tests/support/__init__.py' 'tests/__init__.py' 'tests/test_ec_environment.py' 'e2e/ec-01.spec.mjs' 'tests/conftest.py' 'frontend/package.json' 'frontend/package-lock.json' 'app/main.py' 'frontend/src/App.jsx' 'frontend/src/lib/tts.js' '.gitignore'
git commit -m "test: verify first installation through an isolated browser"
```

**回滚或兼容策略：** 可撤回测试入口与前端错误展示，保留Task1数据库修复；删除测试临时目录前先关闭所属进程，不碰用户数据。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
