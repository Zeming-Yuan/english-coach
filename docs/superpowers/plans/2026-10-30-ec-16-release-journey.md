# EC-16 独立新上下文用完整命令验证从新安装到换设备继续学，以及安全降级边界。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立新上下文用完整命令验证从新安装到换设备继续学，以及安全降级边界。

**Architecture:** 复用每票已独立交付的测试，不在发行验收中补前票功能。加入全旅程和真实旧版本只读兼容演练，显式检查所有T01–T21实际被执行且成功。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-16](../../tickets/reliability-and-daily-learning/16-release-journey.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/17#implementation-plan)。

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

- RF1: 带过滤或跳过导致假绿。
- RF2: 构建产物不是本次源码。
- RF3: 恢复到另一ID布局后继续记录。
- RF4: 旧版写入会丢事件必须阻止。
- RF5: 版本回退不等于恢复旧快照。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 完整旅程与场景覆盖门禁

**Files:**
- **Create:** e2e/ec-16.spec.mjs; e2e/spec-coverage.mjs; tests/test_release_coverage.py
- **Modify:** e2e/run.mjs; e2e/playwright.config.mjs

**Interfaces:**
- Consumes: 所有前置票场景与真实appFactory；依赖02/14/15已使整个DAG覆盖。
- Produces: 无过滤主命令验证全部T01–T21；失败/skip/阻塞非零，双实例新进度可继续。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_release_coverage.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
def test_spec_coverage_requires_all_cases():
 import subprocess
 result=subprocess.run(["node","e2e/spec-coverage.mjs","--self-test"],
   text=True,capture_output=True)
 assert result.returncode==0
 assert "missing-case-rejected" in result.stdout
 assert "skipped-case-rejected" in result.stdout
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_release_coverage.py::test_spec_coverage_requires_all_cases -q
```

**预期失败原因：** 现在没有覆盖门禁；缺少必经场景时旧E2E会打印跳过而最终成功。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
export function assertSpecCoverage(results){
 const required=new Set(Array.from({length:21},(_,i)=>"T"+String(i+1).padStart(2,"0")));
 const passed=new Set();
 for(const result of results){
   if(result.status!=="passed") throw new Error("Non-passing required case: "+result.id);
   for(const id of result.specCases) passed.add(id);
 }
 const missing=[...required].filter(id=>!passed.has(id));
 if(missing.length) throw new Error("Missing spec coverage: "+missing.join(","));
}
```

- [ ] **Step 4: 从Playwright JSON报告/annotations读取真实通过场景，不从注册文件存在与否判断完成；每个T编号映射到具体票的真实行为断言，部分通过不能满足同编号故障分支。**

- [ ] **Step 5: self-test传完整通过集合、缺T21集合和含skip集合，后两者必须抛；CLI仅self-test打印两个rejected标记。**

- [ ] **Step 6: ec16全旅程从空实例UI入门→主队列→弱项巩固→summary→跨天再学→下载→另一实例恢复→继续评分。用公开API核对事件/ID，仅外部服务替身。**

- [ ] **Step 7: 构建输出在本次临时目录，记录源HEAD与构建时间；禁止读取仓库旧assets替代本次build。既有每票独立命令仍可运行。**

- [ ] **Step 8: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-16 restore-and-continue",async({appFactory,page})=>{
 const a=await appFactory({fixture:"ec12-full.json"});
 const backup=await (await a.request.get("/api/export/backup")).json();
 const b=await appFactory({});
 const preview=await (await b.request.post("/api/import/preview",{data:backup})).json();
 expect((await b.request.post("/api/import/cards",{data:{backup,
   expected_revision:preview.expected_revision}})).ok()).toBe(true);
 const cards=(await (await b.request.get("/api/cards")).json()).cards;
 const word=cards.find(c=>c.kind==="word");
 const before=(await (await b.request.get("/api/cards/"+word.id)).json()).learning_events.length;
 await page.goto(b.baseURL);
 await page.getByRole("button",{name:/单词本/}).click();
 await page.getByText(word.word,{exact:true}).first().click();
 await page.getByTestId("rate-good").click();
 await expect.poll(async()=>(await (await b.request.get("/api/cards/"+word.id)).json()).learning_events.length).toBe(before+1);
});
```

此辅助测试验证最后续学；完整旅程主测试必须用UI下载/文件上传而非仅API。为既有每票测试添加T编号annotations与报告映射，核对T05/06/07/15/16不同故障分支都运行。


- [ ] **Step 9: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e
python -m pytest -q
npm --prefix frontend run build
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 10: 同步文档或ADR**

README汇总安装/学习/备份与一条验收命令；记录T01–T21/AC01–AC15实际证据。没有通过的条目保持未完成，不能用写完计划替代。

- [ ] **Step 11: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'e2e/ec-16.spec.mjs' 'e2e/spec-coverage.mjs' 'tests/test_release_coverage.py' 'e2e/run.mjs' 'e2e/playwright.config.mjs'
git commit -m "test: qualify the complete install learn restore journey"
```

**回滚或兼容策略：** 可撤回发行报告与编排，不删除业务数据；重新发布必须再次通过全场景，不能用较窄过滤命令冒充总验收。

---

### Task 2: 真实基线的只读降级与实施交接

**Files:**
- **Create:** e2e/support/legacy-app.mjs; e2e/support/readonly_server.py; e2e/ec-16-compat.spec.mjs; docs/release-compatibility.md
- **Modify:** e2e/support/test.mjs; README.md

**Interfaces:**
- Consumes: 实际仓库基线5868cd1与当前兼容结构；10/12完整快照和16 Task1最终门禁。
- Produces: legacyAppFactory({gitRef:string,databasePath:string}) -> Promise<AppFixture>，仅测试支持；旧版只读视图降级验证和安全运行界限。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-16-compat.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-16 legacy-readonly",async({app,legacyAppFactory})=>{
 await app.seedCards([{word:"apple",meaning:"苹果"}]);
 const old=await legacyAppFactory({gitRef:"5868cd1",databasePath:app.databasePath});
 expect((await old.request.get("/api/cards")).status()).toBe(200);
 expect((await old.request.post("/api/reviews",{data:{card_id:1,rating:3}})).status()).toBe(503);
 const result=await app.request.get("/api/export/backup");
 expect(result.ok()).toBe(true);
 expect((await result.json()).learning_events).toHaveLength(0);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-16
```

**预期失败原因：** 原版本没有只读保护，POST会更新当前行但不追加新事件；不能把这种降级称为安全可继续学习。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
from starlette.responses import JSONResponse

class ReadOnlyLegacy:
    def __init__(self,app):
        self.app=app
    async def __call__(self,scope,receive,send):
        if scope["type"]=="http" and scope["method"] not in {"GET","HEAD","OPTIONS"}:
            await JSONResponse({"detail":"兼容模式只读；继续学习请使用当前后端"},
                status_code=503)(scope,receive,send)
            return
        await self.app(scope,receive,send)
```

- [ ] **Step 4: legacyAppFactory用git archive读取已核实ref到测试临时目录，不改当前checkout；启动旧应用时指定相同测试库与本地不可达LLM地址/占位钥匙，绝不执行旧迁移。**

- [ ] **Step 5: AppFixture补充只读databasePath供测试支持，生产不暴露文件路径。使用SQLite备份副本做演练，不在用户正在使用的数据库跑旧版本。**

- [ ] **Step 6: ReadOnlyLegacy外层禁止写HTTP；还必须阻止旧GET故事自动翻译和后台工作写库：只读SQLite mode=ro连接并使用已有content_cn样本，任何潜在GET写入失败明确可见，不声称完整旧功能可用。**

- [ ] **Step 7: 演练前后用当前完整快照比较业务内容与事件；关闭旧实例后当前后端还能继续写新事件。降级文档写清旧后端不能承接写入，可回退UI但保留兼容事件后端，或停写只读后前向修复。**

- [ ] **Step 8: 提交边界不包括真实发布；用户已授权上传tickets与计划；产品实现和发行须按后续明确指令。**

- [ ] **Step 9: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-16 compatibility-preserves-new-events",async({app,legacyAppFactory})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await app.request.post("/api/reviews",{data:{card_id:id,rating:3,source:"study",
   kind:"self_rating",submission_id:crypto.randomUUID()}});
 const before=await (await app.request.get("/api/export/backup")).json();
 const old=await legacyAppFactory({gitRef:"5868cd1",databasePath:app.databasePath});
 await old.request.get("/api/cards");
 await old.request.post("/api/reviews",{data:{card_id:id,rating:1}});
 const after=await (await app.request.get("/api/export/backup")).json();
 delete before.exported_at;delete after.exported_at;
 expect(after).toEqual(before);
});
```

基线ref不存在必须明确阻塞而非跳过；旧应用启动失败记录原因，不能拿当前app替身冒充兼容通过。最终两视口键盘检查和失败产物链接随任务1报告交付。


- [ ] **Step 10: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-16
npm --prefix frontend run test:e2e
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 11: 同步文档或ADR**

docs/release-compatibility.md写明确认过的只读范围、不可安全降级的写路径、保留新数据与前向恢复步骤；ADR-0001/0003同步边界。

- [ ] **Step 12: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'e2e/support/legacy-app.mjs' 'e2e/support/readonly_server.py' 'e2e/ec-16-compat.spec.mjs' 'docs/release-compatibility.md' 'e2e/support/test.mjs' 'README.md'
git commit -m "docs: verify read-only rollback without losing learning events"
```

**回滚或兼容策略：** 本票仅撤回测试和交接说明不影响业务；产品回退只能按已证实兼容边界，禁止直接恢复旧快照丢新进度。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
