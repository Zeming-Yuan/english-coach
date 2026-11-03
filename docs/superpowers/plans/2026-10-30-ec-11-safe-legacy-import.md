# EC-11 旧备份经过预览与完整校验后安全部分恢复，失败不损坏原进度。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧备份经过预览与完整校验后安全部分恢复，失败不损坏原进度。

**Architecture:** 先修现有旧导入，再建设V2替换，保持每票绿色。恢复协调器复用03写事务，预恢复备份由10完整快照产生，界面预览与执行分别明确。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-11](../../tickets/reliability-and-daily-learning/11-safe-legacy-import.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/12#implementation-plan)。

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

- RF1: 非法字段发生在删除之前被拒绝。
- RF2: 同词两卡型的源ID分别映射。
- RF3: 多个目标匹配不能任意挑一个。
- RF4: 预备份不可写或事务中断不改现有数据。
- RF5: 预览后出现新进度返回409重览。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 严格旧格式与原子部分恢复

**Files:**
- **Create:** app/schemas/backup.py; app/services/restore.py; tests/test_legacy_restore.py
- **Modify:** app/routers/export.py

**Interfaces:**
- Consumes: 10完整快照/修订hash、03 run_write；shared ValidatedBackup与恢复函数签名。
- Produces: POST/import/preview与兼容/import/cards旧格式，persist_safety_backup、revision复核；V2暂时明确422而非半实现。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_legacy_restore.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
def test_malformed_legacy_does_not_erase_progress(ec):
 cid=ec.seed_card()
 ec.client.post("/api/reviews",json={"card_id":cid,"rating":3})
 ec.client.put(f"/api/memos/{cid}",json={"content":"记住苹果"})
 before=ec.snapshot()
 payload={"cards":[{"id":cid,"word":"apple","kind":"word"}],
          "reviews":[{"card_id":cid,"state":"not-an-int"}]}
 response=ec.client.post("/api/import/cards",json=payload)
 assert response.status_code==422
 assert ec.snapshot()==before
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_legacy_restore.py::test_malformed_legacy_does_not_erase_progress -q
```

**预期失败原因：** 现实现先删后commit，再转换state失败，返回500且原进度已清空。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
import json,os,tempfile
from pathlib import Path
from uuid import uuid4

def persist_safety_backup(payload,directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    destination=directory/("before-restore-"+str(uuid4())+".json")
    fd,temp=tempfile.mkstemp(dir=directory,suffix=".tmp")
    try:
        with os.fdopen(fd,"w",encoding="utf8") as stream:
            json.dump(payload,stream,ensure_ascii=False)
            stream.flush();os.fsync(stream.fileno())
        os.replace(temp,destination)
        return destination
    finally:
        if os.path.exists(temp):os.unlink(temp)
```

- [ ] **Step 4: 为每个旧集合定义真实列型Pydantic模型，拒绝非有限float/非法state/负次数/坏日期/重复源ID与悬空关系；ValidationError映射collection/index/field/reason的422，不吞坏行。**

- [ ] **Step 5: restore_backup先validate；run_write内读取并复核expected_revision，导出并持久化安全备份，按source id→word+kind映射，只替换覆盖卡实际包含的数据和字段。**

- [ ] **Step 6: 旧行转当前状态和baseline，不造事件；保留未覆盖故事/课程/困难词及其他卡，重复导入不重复。旧平铺请求也走同一事务但不声称有预览一致性。**

- [ ] **Step 7: preview只读返回影响和revision，恢复500通用错误不泄露路径；success含安全备份本机路径，下载若做则只允许服务器登记的备份ID。**

- [ ] **Step 8: 钉住Review Focus及异常路径**

```python
import pytest
@pytest.mark.parametrize("review",[
 {"card_id":1,"state":"broken"},
 {"card_id":1,"state":99},
 {"card_id":1,"state":1,"stability":"NaN"},
 {"card_id":1,"state":1,"review_count":-1},
 {"card_id":999,"state":1},
])
def test_legacy_invalid_review_focus(ec,review):
 ec.seed_card()
 before=ec.snapshot()
 response=ec.client.post("/api/import/cards",json={
  "cards":[{"id":1,"word":"apple","kind":"word"}],"reviews":[review]})
 assert response.status_code==422
 assert ec.snapshot()==before
```

同卡型重复目标→歧义422；同词word/sentence源ID1/2各恢复独立状态；mock persist_safety_backup抛OSError以及fail_commit_once验证业务快照不变；预览后真实评分再导入expected_revision旧值→409。


- [ ] **Step 9: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_legacy_restore.py tests/test_export.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 10: 同步文档或ADR**

ADR-0003写明旧版部分恢复、字段缺失不删除、预览修订检查和安全副本；README说明旧历史缺口。

- [ ] **Step 11: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/schemas/backup.py' 'app/services/restore.py' 'tests/test_legacy_restore.py' 'app/routers/export.py'
git commit -m "fix: restore legacy backups atomically without merging card kinds"
```

**回滚或兼容策略：** 关闭导入而保留安全保护，不能启用先删后校验；保留已恢复数据及后续进度，副本不自动清理。

---

### Task 2: 旧文件预览、确认、取消和可恢复错误

**Files:**
- **Modify:** frontend/src/views/BackupPage.jsx
- **Create:** e2e/ec-11.spec.mjs; e2e/fixtures/ec11-legacy.json

**Interfaces:**
- Consumes: Task1预览与导入契约；10 BackupPage与app fixture。
- Produces: 文件选择、旧版范围、确认/取消、失败保留预览与可用安全副本位置。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-11.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-11 invalid-file-keeps-data",async({app,page})=>{
 await app.seedCards([{word:"apple",meaning:"苹果"}]);
 const before=await (await app.request.get("/api/export/backup")).json();
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 await page.getByLabel("选择备份文件").setInputFiles({
   name:"broken.json",mimeType:"application/json",
   buffer:Buffer.from(JSON.stringify({cards:[{id:1,word:"apple"}],reviews:[{card_id:1,state:"bad"}]}))
 });
 await expect(page.getByRole("alert")).toContainText("state");
 const after=await (await app.request.get("/api/export/backup")).json();
 delete before.exported_at;delete after.exported_at;
 expect(after).toEqual(before);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-11
```

**预期失败原因：** 当前没有React文件选择/预览/错误入口，旧API也不能保证无损失败。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const chooseBackup=async file=>{
 const backup=JSON.parse(await file.text());
 const preview=await api("/api/import/preview",{method:"POST",body:JSON.stringify(backup)});
 setCandidate({backup,preview});
};
const confirmRestore=async()=>{
 const result=await api("/api/import/cards",{method:"POST",body:JSON.stringify({
   backup:candidate.backup,expected_revision:candidate.preview.expected_revision
 })});
 setResult(result);setCandidate(null);
};
```

- [ ] **Step 4: JSON解析错误显示文件错误不发执行请求；选择文件只预览，取消只清UI。确认按钮文案“确认恢复包含的内容”，旧版部分恢复说明未包含内容保留。**

- [ ] **Step 5: 执行409重新预览并要求再次确认；500保留文件供重试但必须更新revision。执行中禁用其他恢复动作，不阻塞已保存数据的展示。**

- [ ] **Step 6: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-11 cancel-preview-does-not-write",async({app,page})=>{
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 await page.getByLabel("选择备份文件").setInputFiles({
  name:"legacy.json",mimeType:"application/json",
  buffer:Buffer.from(JSON.stringify({cards:[{id:1,word:"banana",kind:"word"}]}))
 });
 await expect(page.getByText("旧版部分恢复",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"取消",exact:true}).click();
 expect((await (await app.request.get("/api/cards")).json()).cards).toHaveLength(0);
});
```

样本文件ec11-legacy含两种卡型、记忆法与独立reviews；浏览器导入两次验证不重复，另准备额外故事证明未覆盖内容不清空。


- [ ] **Step 7: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-11
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 8: 同步文档或ADR**

README补取消、旧版范围与错误字段定位，成功页给安全备份位置，不承诺浏览器偏好恢复。

- [ ] **Step 9: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/BackupPage.jsx' 'e2e/ec-11.spec.mjs' 'e2e/fixtures/ec11-legacy.json'
git commit -m "feat: preview and confirm safe legacy backup imports"
```

**回滚或兼容策略：** 隐藏确认入口但保留下载和已有数据；不自动用旧副本覆盖恢复后新增作答。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
