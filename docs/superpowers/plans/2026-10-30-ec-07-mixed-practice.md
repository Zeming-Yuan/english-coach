# EC-07 混合入口复用相同题型契约，一次点击只保存一次并在确认后切题。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 混合入口复用相同题型契约，一次点击只保存一次并在确认后切题。

**Architecture:** 不建新后端评分服务，复用05输入、06选择协议。把MixedPage的客户端判分/二次回调改成统一的等待保存转换。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-07](../../tickets/reliability-and-daily-learning/07-mixed-practice.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/8#implementation-plan)。

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

- RF1: 选择题双请求导致错词变化两次。
- RF2: 自动计时在未保存时启动。
- RF3: 键盘下一题与计时同时触发。
- RF4: 混合提示状态丢失。
- RF5: 空题池/不足题数被当完成。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 让一次混合作答对应一次真实提交

**Files:**
- **Modify:** frontend/src/views/MixedPage.jsx; frontend/src/lib/learning.js
- **Create:** e2e/ec-07.spec.mjs

**Interfaces:**
- Consumes: EC05 typed与EC06 choice/listening接口；EC03稳定pending；05/06应先合入共享QuizPage改动。
- Produces: 混合handleAnswer只构造并发送一次题型命令；来源mixed、stage=standalone。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-07.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-07 choice-single-write",async({appFactory,page})=>{
 const app=await appFactory({fixture:"ec07-mixed.json"});
 const ids=await app.seedCards(["apple","book","cat","dog"].map(word=>({word,meaning:word})));
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/混合练习/}).click();
 let writes=0;
 page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/quiz/score")) writes++;});
 const choice=page.getByTestId("mixed-choice");
 await expect(choice).toBeVisible();
 await choice.getByRole("button").first().click();
 await expect(page.getByRole("status")).toContainText("已保存");
 expect(writes).toBe(1);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-07
```

**预期失败原因：** 当前choice分支先POST quiz/score，再经handleAnswer重复POST同一判分。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const answerMixed=async answer=>{
  if(submittedRef.current) return;
  submittedRef.current=true;
  try {
    pendingRef.current ??= makePending(endpoint,{
      card_id:q.card_id,answer,user_input:answer,question_token:q.question_token,
      source:"mixed",kind:item.type==="spell"?"typed":"choice",assistance
    });
    const result=await sendPending(pendingRef.current);
    setFeedback({correct:result.correct,expected:result.expected??result.correct_word});
  } catch(error) {
    setError(error.message);
    submittedRef.current=false;
  }
};
```

- [ ] **Step 4: endpoint按typed/listening/choice选择现有协议；quiz/score需要answers数组时在发送前包裹，保留每项自己的submission_id。不要把整个批次ID当题ID。**

- [ ] **Step 5: 正确数/错题表只在成功结果之后更新，独立与混合的同类题共享hint/FSRS策略；source变化只表达入口。**

- [ ] **Step 6: 测试夹具固定题型顺序，测试不是靠连续跳过赌随机题型；创建e2e/fixtures/ec07-mixed.json含确定顺序的测试随机源与四个单词。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-07 save-error-stops-auto-next",async({appFactory,page})=>{
 const app=await appFactory({fixture:"ec07-mixed.json"});
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/混合练习/}).click();
 await page.route("**/api/quiz/score",r=>r.abort("failed"),{times:1});
 await page.getByTestId("mixed-choice").getByRole("button").first().click();
 await expect(page.getByRole("alert")).toContainText("尚未确认保存");
 await expect(page.locator(".study-count")).toContainText("1");
});
```

固定夹具使首题choice、次题listen、末题typed，分别验证提示标记和一次事件。成功后手动下一题与自动计时竞态由Task2验证。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-07
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README混合练习说明引用同类题规则；组件注释删除本地最终判分与先反馈后写入描述。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/MixedPage.jsx' 'frontend/src/lib/learning.js' 'e2e/ec-07.spec.mjs'
git commit -m "fix: submit each mixed answer exactly once"
```

**回滚或兼容策略：** 可暂时隐藏混合入口，保留独立练习API与历史来源，不删除混合事件。

---

### Task 2: 收紧自动推进和空态边界

**Files:**
- **Modify:** frontend/src/views/MixedPage.jsx
- **Create:** frontend/src/lib/practice_navigation.js; frontend/src/lib/practice_navigation.test.mjs

**Interfaces:**
- Consumes: Task1成功feedback和当前题唯一键。
- Produces: advanceOnce(questionId:string,advance:()=>void) -> boolean，由createAdvanceGuard()返回的闭包，手动与计时共享防重。

- [ ] **Step 1: 写第一条失败测试**

文件：frontend/src/lib/practice_navigation.test.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {createAdvanceGuard} from "./practice_navigation.js";
test("advance once",()=>{
 let n=0;
 const advanceOnce=createAdvanceGuard();
 advanceOnce("q1",()=>n++);
 advanceOnce("q1",()=>n++);
 advanceOnce("q2",()=>n++);
 assert.equal(n,2);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
node --test frontend/src/lib/practice_navigation.test.mjs
```

**预期失败原因：** 尚无统一推进门闩，当前nextItem可从计时与按钮重复递增索引。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
export function createAdvanceGuard(){
 const advanced=new Set();
 return (questionId,advance)=>{
   if(advanced.has(questionId)) return false;
   advanced.add(questionId);
   advance();
   return true;
 };
}
```

- [ ] **Step 4: 计时useEffect只依赖已确认feedback与当前questionId，cleanup清除旧计时；按钮、Enter和计时都经过同一advanceOnce。新一轮重新创建guard。**

- [ ] **Step 5: 题池少于3但有合法题时仍运行实际题数；完全无题是空态，加载失败为错误态，二者不能进入完成。**

- [ ] **Step 6: 需要跳过时发送同类skipped命令并等待保存，再走advanceOnce；不让skip调用本地handleAnswer(false)造答错。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {createAdvanceGuard} from "./practice_navigation.js";
for(const sequence of [["timer","button"],["button","timer"],["enter","timer"]]){
 test("advance race "+sequence.join("-"),()=>{
   const guard=createAdvanceGuard();let n=0;
   for(const source of sequence) guard("q1",()=>n++);
   assert.equal(n,1);
 });
}
```

e2e/ec-07增加单题池能完成、全空显示无题、API500显示错误且不能记完成；键盘和计时通过同一门闩后用事件总数核对。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
node --test frontend/src/lib/practice_navigation.test.mjs
npm --prefix frontend run test:e2e -- --ticket EC-07
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

更新独立验收记录：题量不足仍可练、空态不算完成；不另发UI重构任务。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/MixedPage.jsx' 'frontend/src/lib/practice_navigation.js' 'frontend/src/lib/practice_navigation.test.mjs'
git commit -m "fix: advance mixed practice once per saved question"
```

**回滚或兼容策略：** 撤回自动推进改为保存后用户手动下一题，保留单题guard和已保存事件；不撤回保存确认门槛。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
