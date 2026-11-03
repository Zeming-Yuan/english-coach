# EC-10 用户从设置下载完整版本化备份，业务字段与关联不遗漏。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户从设置下载完整版本化备份，业务字段与关联不遗漏。

**Architecture:** 新增完整导出URL而保留旧导出兼容面，避免恢复切片尚未实现时破坏旧往返测试。导出为一致快照，恢复将复用同一格式。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-10](../../tickets/reliability-and-daily-learning/10-complete-backup-export.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/11#implementation-plan)。

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

- RF1: 同词不同卡型保持独立。
- RF2: Card新增字段与困难词不遗漏。
- RF3: 故事/课程/事件关联完整。
- RF4: 并发写入不能混成半份快照。
- RF5: 密钥与缓存不可进入备份。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 完整V2快照和格式契约

**Files:**
- **Create:** app/services/backup.py; tests/test_backup_v2.py
- **Modify:** app/routers/export.py

**Interfaces:**
- Consumes: 03当前状态/事件/基线和既有所有模型；Runtime时钟。
- Produces: export_backup/semantic_snapshot/snapshot_revision，GET /api/export/backup；旧/export/cards与Anki保持原形态。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_backup_v2.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
def test_backup_contains_all_database_collections(ec):
 ec.seed_card(word="apple",kind="word",chunks=[{"text":"an apple","role":"subject"}],
              related_words=[{"word":"fruit","meaning":"水果"}],difficulty="basic")
 ec.seed_card(word="apple",kind="sentence",example="An apple fell.",example_cn="一个苹果掉了。")
 response=ec.client.get("/api/export/backup")
 assert response.status_code==200
 data=response.json()
 assert data["version"]==2
 assert len(data["cards"])==2
 assert {"reviews","learning_events","review_baselines","hard_cards","lessons","stories","story_words","memos","errors"}<=data.keys()
 assert data["cards"][0]["chunks"] is not None
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_backup_v2.py::test_backup_contains_all_database_collections -q
```

**预期失败原因：** 完整导出路由不存在；旧导出未包含chunks/difficulty/related_words和全部关联。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
from sqlalchemy import inspect,select,text
from fastapi.encoders import jsonable_encoder

def export_rows(db,model):
    columns=inspect(model).columns
    return [jsonable_encoder({c.key:getattr(row,c.key) for c in columns})
            for row in db.scalars(select(model).order_by(model.id))]

def semantic_snapshot(payload):
    return {key:value for key,value in payload.items() if key!="exported_at"}
```

- [ ] **Step 4: export_backup在干净会话显式BEGIN读事务后读取共享契约所有集合，存在写事务时复用；一次快照内读取，不在各集合之间commit。**

- [ ] **Step 5: 列出明确的模型白名单Card/Review/ReviewEvent/ReviewBaseline/Memo/ErrorCard/HardCard/Lesson/Story/StoryWord，不遍历任意表或Settings。**

- [ ] **Step 6: snapshot_revision将各集合按ID规范排序、剔除exported_at再JSON排序hash；安全备份元数据不参与业务内容比对。**

- [ ] **Step 7: 为事件缓存结果、command_json和原始题目token保存可回放数据，不能导出签名密钥；raw旧基线保持原始审计数据，活引用单独映射。**

- [ ] **Step 8: 钉住Review Focus及异常路径**

```python
import pytest
@pytest.mark.parametrize("field",["contexts","related_words","chunks","difficulty","explanation"])
def test_backup_review_focus_card_fields(ec,field):
 values={"contexts":[{"en":"Hello","cn":"你好"}],"related_words":[{"word":"fruit","meaning":"水果"}],
   "chunks":[{"text":"an apple","role":"subject"}],"difficulty":"basic","explanation":"测试说明"}
 cid=ec.seed_card(**{field:values[field]})
 data=ec.client.get("/api/export/backup").json()
 assert next(c for c in data["cards"] if c["id"]==cid)[field]==values[field]
```

准备hard/memo/error/lesson/story/link和一条真实事件后核对全部引用；并发写入时快照只能是完整前/后状态；断言导出文本不含测试密钥标记、缓存内容或环境路径。


- [ ] **Step 9: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_backup_v2.py tests/test_export.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 10: 同步文档或ADR**

创建ADR-0003-versioned-backup-and-restore，固定V2集合、ID含义和排除范围；旧导出明确为兼容格式。

- [ ] **Step 11: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/services/backup.py' 'tests/test_backup_v2.py' 'app/routers/export.py'
git commit -m "feat: export a complete versioned learning database snapshot"
```

**回滚或兼容策略：** 保留V2只读格式；可以撤回新入口，不把不完整旧格式重新称为完整备份。

---

### Task 2: 设置中的可下载备份入口

**Files:**
- **Create:** frontend/src/views/BackupPage.jsx; e2e/ec-10.spec.mjs
- **Modify:** frontend/src/App.jsx; frontend/src/views/SettingsPage.jsx

**Interfaces:**
- Consumes: Task1/export/backup及现有App路由方式。
- Produces: “备份与恢复”页面；当前只启用下载，尚未实现恢复时不显示假可用按钮。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-10.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
import {readFile} from "node:fs/promises";
test("EC-10 download-complete-backup",async({app,page})=>{
 await app.seedCards([{word:"apple",kind:"word"},{word:"apple",kind:"sentence"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 const downloadPromise=page.waitForEvent("download");
 await page.getByRole("button",{name:"下载完整备份",exact:true}).click();
 const download=await downloadPromise;
 const data=JSON.parse(await readFile(await download.path(),"utf8"));
 expect(data.version).toBe(2);
 expect(data.cards).toHaveLength(2);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-10
```

**预期失败原因：** 现有React没有可见的备份与恢复入口。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const downloadBackup=async()=>{
  const response=await fetch("/api/export/backup");
  if(!response.ok) throw new Error("备份下载失败");
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement("a");
  link.href=url;link.download="english-coach-backup.json";
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
};
```

- [ ] **Step 4: 设置按钮加aria-label=设置，BackupPage经现有view路由打开和返回，不引入新路由框架。**

- [ ] **Step 5: 加载/错误有文本，失败不提示下载成功；说明包含数据库学习内容，不含密钥/语音缓存/浏览器偏好。**

- [ ] **Step 6: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-10 export-failure-is-visible",async({app,page})=>{
 await page.route("**/api/export/backup",r=>r.abort("failed"),{times:1});
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 await page.getByRole("button",{name:"下载完整备份",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("备份");
});
```

内容齐全与密钥排除由Task1真实格式测试覆盖；浏览器核对两视口下载、返回和键盘操作，下载命名不能带密钥或用户目录。


- [ ] **Step 7: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-10
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 8: 同步文档或ADR**

README增加下载入口与范围；ADR-0003补充新旧URL并存理由。

- [ ] **Step 9: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/BackupPage.jsx' 'e2e/ec-10.spec.mjs' 'frontend/src/App.jsx' 'frontend/src/views/SettingsPage.jsx'
git commit -m "feat: download complete backups from settings"
```

**回滚或兼容策略：** 隐藏下载入口不删除用户已保存文件；保留后续恢复依赖的新格式服务。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
