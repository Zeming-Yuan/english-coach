# EC-04 所有显式自评分页面只有保存确认才推进，失败与刷新后可重试同一次提交。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有显式自评分页面只有保存确认才推进，失败与刷新后可重试同一次提交。

**Architecture:** 消费EC-03已提供的幂等内核，在前端建立单个待确认请求的状态机。课程、故事、详情与闪卡复用同一hook，后台AI失败不影响已保存状态。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-04](../../tickets/reliability-and-daily-learning/04-self-rating-retry.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/5#implementation-plan)。

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

- RF1: commit后响应丢失：刷新重试不重复。
- RF2: localStorage不可写：内存标识保留并提示。
- RF3: 卡片已删：404不伪装保存成功。
- RF4: 自动切题和连点：保存确认之前不推进。
- RF5: AI或TTS不可用：成功提交不回滚。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 闪卡的保存确认、刷新恢复与状态机

**Files:**
- **Create:** frontend/src/hooks/useLearningAttempt.js; e2e/ec-04.spec.mjs
- **Modify:** frontend/src/views/StudyPage.jsx; frontend/src/App.jsx

**Interfaces:**
- Consumes: EC-03 makePending/sendPending/savePending/loadPending/clearPending与原子幂等内核。
- Produces: 共享契约useLearningAttempt及闪卡可见重试；基础存储函数已由03交付。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-04.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-04 response-loss-reload",async({app,page})=>{
  const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
  await page.locator(".flip-hint").first().click();
  await page.route("**/api/reviews",async route=>{await route.fetch();await route.abort("failed");},{times:1});
  await page.locator(".rating-3").click();
  await expect(page.getByRole("alert")).toContainText("尚未确认保存");
  await page.reload();
  await page.getByRole("button",{name:"继续确认保存",exact:true}).click();
  await expect.poll(async()=> (await (await app.request.get("/api/cards/"+id)).json()).learning_events.length).toBe(1);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-04
```

**预期失败原因：** 当前闪卡吞掉保存故障并完成，刷新后无法继续确认；首次红灯是页面行为，不重复测试03已实现的存储函数。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
import {useRef,useState} from "react";
import {makePending,sendPending,savePending,loadPending,clearPending} from "../lib/learning.js";
export function useLearningAttempt(scope){
 const pending=useRef(loadPending(scope));
 const busy=useRef(false);
 const [state,setState]=useState({phase:pending.current?"failed":"idle",result:null,
   error:pending.current?"尚未确认保存":null});
 const run=async p=>{
   if(!p||busy.current) throw Error("提交不存在或正在保存");
   busy.current=true;
   const durable=savePending(scope,p);
   setState({phase:"saving",result:null,error:durable?null:"临时存储不可用，刷新可能丢失待确认信息"});
   try{
     const result=await sendPending(p);
     if(result.committed!==true) throw Error("尚未确认保存");
     setState({phase:"saved",result,error:null});return result;
   }catch(error){
     setState({phase:"failed",result:null,error:"尚未确认保存："+error.message});
     throw error;
   }finally{busy.current=false;}
 };
 return {...state,
   submit:(path,payload)=>{
     if(pending.current) return Promise.reject(Error("请先继续确认或明确放弃待确认提交"));
     pending.current=makePending(path,payload);return run(pending.current);
   },
   retry:()=>run(pending.current),
   clear:()=>{clearPending(scope);pending.current=null;setState({phase:"idle",result:null,error:null});}
 };
}
```

- [ ] **Step 4: 给StudyPage显式生成sessionId（13可传入固定会话ID），提交source=study/kind=self_rating；13之前stage=standalone。只有result.committed才增加answered和索引。**

- [ ] **Step 5: App初始化收集已知scope的pending，显示继续确认入口；不需要丢失的studyQueue也能发送原请求。核实后重新加载队列。用户明确放弃才clear。**

- [ ] **Step 6: hook的run还用mounted ref和本次pending标识过滤过期返回；等待与失败用role=status/alert。不同题切换前处理原pending，不能悄悄用新答案覆写旧请求。failed时原评分按钮禁用，只保留继续确认或明确放弃。**

- [ ] **Step 7: 保留EC-03提供的公共函数，页面加载/动画、AI升级与TTS均不能决定保存完成。**

- [ ] **Step 8: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
for(const failure of ["transport","commit"]) {
  test("EC-04 pending-"+failure,async({app,page})=>{
    await app.seedCards([{word:"apple",meaning:"苹果"}]);
    if(failure==="commit") await app.failCommitOnce();
    else await page.route("**/api/reviews",r=>r.abort("failed"),{times:1});
    await page.goto(app.baseURL);
    await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-3").click();
    await expect(page.getByRole("alert")).toContainText("尚未确认保存");
    await expect(page.locator(".study-done")).toHaveCount(0);
  });
}
```

测试03的storage降级单测无需再造；本票覆盖storage不可用时的可见警示、卡已删除404可明确放弃、组件退出后旧返回不推进另一题。


- [ ] **Step 9: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-04
node --test frontend/src/lib/learning.test.mjs
python -m pytest tests/test_learning_events.py -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 10: 同步文档或ADR**

ADR-0001同步待确认/刷新恢复/存储不可写降级，README说明继续确认操作。

- [ ] **Step 11: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/hooks/useLearningAttempt.js' 'e2e/ec-04.spec.mjs' 'frontend/src/views/StudyPage.jsx' 'frontend/src/App.jsx'
git commit -m "fix: confirm flashcard persistence before advancing"
```

**回滚或兼容策略：** 保留服务端去重契约；关闭刷新恢复时仍不能把未确认请求算成功，浏览器旧pending保留或由用户明确放弃。

---

### Task 2: 把课程、故事和详情显式评分迁到相同规则

**Files:**
- **Modify:** frontend/src/views/LessonsPage.jsx; frontend/src/views/StoriesPage.jsx; frontend/src/views/WordsPage.jsx
- **Modify:** e2e/ec-04.spec.mjs

**Interfaces:**
- Consumes: Task1 hook与EC-03 source=lesson/story/card_detail；不改变课程生成/完成模型。
- Produces: 所有非闪卡显式评分按相同保存确认规则工作，带独立scope。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-04.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-04 detail-rating-stays-on-failure",async({app,page})=>{
 await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/单词本/}).click();
 await page.getByText("apple",{exact:true}).click();
 await page.route("**/api/reviews",r=>r.abort("failed"),{times:1});
 await page.getByTestId("rate-good").click();
 await expect(page.getByRole("alert")).toContainText("尚未确认保存");
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-04
```

**预期失败原因：** 原详情吞掉保存异常而不显示可重试错误；课程与故事同类路径需要逐一迁移。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const attempt=useLearningAttempt("card_detail:"+cardId);
const rate=async rating=>{
 try{
   const result=await attempt.submit("/api/reviews",{
     card_id:cardId,rating,source:"card_detail",kind:"self_rating",stage:"standalone"
   });
   if(result.committed){await reloadCard();attempt.clear();}
 }catch{}
};
```

- [ ] **Step 4: reloadCard定义为现有详情GET重新加载动作：async()=>setCard(await api('/api/cards/'+cardId))；不要复制新查询层。**

- [ ] **Step 5: 课程使用scope lesson:cardId与source=lesson，故事使用story:cardId与source=story；只有成功才更新mastered/反馈，按钮失败后有retry。**

- [ ] **Step 6: 三个入口的高分按钮都提供data-testid=rate-good和有意义的文本；动画/关闭面板不得抢在保存之前。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
for(const failure of ["transport","commit"]) {
  test("EC-04 pending-"+failure,async({app,page})=>{
    await app.seedCards([{word:"apple",meaning:"苹果"}]);
    if(failure==="commit") await app.failCommitOnce();
    else await page.route("**/api/reviews",r=>r.abort("failed"),{times:1});
    await page.goto(app.baseURL);
    await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
    await page.locator(".flip-hint").first().click();
    await page.locator(".rating-3").click();
    await expect(page.getByRole("alert")).toContainText("尚未确认保存");
    await expect(page.locator(".study-done")).toHaveCount(0);
  });
}
```

为课程、故事准备真实fixture实体/词卡关联，分别从其页面评分；模拟提交前失败、响应丢失、404和TTS故障，结果只保存一次。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-04
node --test frontend/src/lib/learning.test.mjs
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README写明未确认保存、刷新继续与明确放弃的交互；同步四入口说明，不另建文案任务。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/LessonsPage.jsx' 'frontend/src/views/StoriesPage.jsx' 'frontend/src/views/WordsPage.jsx' 'e2e/ec-04.spec.mjs'
git commit -m "fix: advance explicit reviews only after confirmed persistence"
```

**回滚或兼容策略：** 按消费者逆序回退UI，后端保持原子幂等；不能恢复吞错当成功的逻辑作为安全回退路径。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
