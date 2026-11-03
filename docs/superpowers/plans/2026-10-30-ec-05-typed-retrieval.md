# EC-05 输入题一次提交原子保存，并如实区分独立回忆、提示和跳过。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入题一次提交原子保存，并如实区分独立回忆、提示和跳过。

**Architecture:** 复用EC-03事务和事件，不新建评分内核。先接输入API，再改SpellingBoard与拼写/测验输入分支；不依赖EC-04的React hook。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-05](../../tickets/reliability-and-daily-learning/05-typed-retrieval.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/6#implementation-plan)。

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

- RF1: 长度/首字母提示使独立题降级为辅助。
- RF2: 逐字反馈或答案朗读不能冒充独立掌握。
- RF3: 空答案与明确跳过含义不同。
- RF4: 规范化保留有效连字符/撇号。
- RF5: 失败重试只产生一次事件。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 输入题判分接入原子记录

**Files:**
- **Modify:** app/routers/quiz.py; app/schemas/learning.py; app/services/learning.py
- **Create:** tests/test_typed_attempts.py

**Interfaces:**
- Consumes: EC-03 AttemptCommand、submit_attempt、run_write和normalize；source显式spelling/quiz，kind=typed。
- Produces: POST /api/typing/check接受扩展字段，返回兼容判分字段与完整AttemptResult；legacy请求不冒充可排期独立练习。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_typed_attempts.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_independent_typing_saves_once(ec):
    cid=ec.seed_card()
    payload={"card_id":cid,"answer":"Apple","user_input":"Apple",
             "source":"spelling","kind":"typed","assistance":[],
             "submission_id":str(uuid4())}
    first=ec.client.post("/api/typing/check",json=payload)
    again=ec.client.post("/api/typing/check",json=payload)
    assert first.status_code == again.status_code == 200
    assert first.json()["scheduled"] is True
    assert first.json()["correct"] is True
    assert first.json()["event_id"] == again.json()["event_id"]
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_typed_attempts.py::test_independent_typing_saves_once -q
```

**预期失败原因：** 当前typing/check只判分和改错词，不追加事件/排期，也没有幂等返回字段。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
@router.post("/typing/check")
def check_typing(payload: TypingCheckIn,db=Depends(get_db),runtime=Depends(get_runtime)):
    cmd=AttemptCommand(
        **payload.model_dump(exclude={"user_input","answer","kind"}),
        answer=payload.user_input,
        kind=payload.kind,
    )
    result=submit_attempt(db,cmd,runtime)
    data=result.model_dump(mode="json")
    data["normalized_answer"]=normalize(payload.user_input or "")
    return data
```

- [ ] **Step 4: TypingCheckIn继承共享字段但不重复传answer/kind；具体定义kind仅允许typed，user_input对应answer，source默认legacy。先schema规范化再构造一次command。**

- [ ] **Step 5: 独立typed正确用3、错误用1；任何assistance或legacy未分类输入不更新FSRS；跳过correct=None，empty普通答案按错误，不自动当skip。**

- [ ] **Step 6: 不再由页面额外POST /reviews；服务端词不存在404、坏字段422、ID重用不同答案409；原子事务沿用03。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
import pytest
from uuid import uuid4
@pytest.mark.parametrize(("answer","assistance","skipped","correct","scheduled"),[
 ("apple",[],False,True,True),
 ("appl",[],False,False,True),
 ("apple",["length"],False,True,False),
 ("apple",["live_feedback","answer_audio"],False,True,False),
 ("",[],True,None,False),
])
def test_typed_review_focus(ec,answer,assistance,skipped,correct,scheduled):
    cid=ec.seed_card()
    response=ec.client.post("/api/typing/check",json={
      "card_id":cid,"user_input":answer,"source":"spelling","kind":"typed",
      "assistance":assistance,"skipped":skipped,"submission_id":str(uuid4())})
    assert response.status_code==200
    assert response.json()["correct"] is correct
    assert response.json()["scheduled"] is scheduled
```

加can't、well-known的既有normalize回归；fail_commit_once后公开详情和错误列表保持原样，再同ID重试只一条事件。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_typed_attempts.py tests/test_scoring.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

ADR-0001补充类型/提示与排期映射，README不再把所有拼写一概称为独立提取。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/routers/quiz.py' 'app/schemas/learning.py' 'app/services/learning.py' 'tests/test_typed_attempts.py'
git commit -m "feat: record typed answers with explicit assistance and scheduling policy"
```

**回滚或兼容策略：** 保留扩展接口/事件，旧无标识调用继续有限兼容；撤回页面时不能再次叠加两次错词写入。

---

### Task 2: 独立输入不泄露答案并等待保存

**Files:**
- **Modify:** frontend/src/components/SpellingBoard.jsx; frontend/src/views/SpellingPage.jsx; frontend/src/views/QuizPage.jsx
- **Create:** e2e/ec-05.spec.mjs

**Interfaces:**
- Consumes: 03 makePending/sendPending/savePending/loadPending/clearPending与Task1输入协议。
- Produces: SpellingBoard新增mode='independent'|'assisted'，独立模式自由输入/Enter提交；来源与辅助被真实传递。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-05.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-05 independent-input",async({app,page})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/拼写练习/}).click();
 await page.getByRole("button",{name:"独立回忆",exact:true}).click();
 await expect(page.locator(".spelling-box")).toHaveCount(0);
 await page.getByRole("textbox").fill("apple");
 await page.getByRole("textbox").press("Enter");
 await expect(page.getByRole("status")).toContainText("已保存");
 const detail=await (await app.request.get("/api/cards/"+id)).json();
 expect(detail.learning_events[0].scheduled).toBe(true);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-05
```

**预期失败原因：** 现有SpellingBoard总按目标长度画格/截断并自动提交；页面还会另发reviews请求。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const independent=mode==="independent";
const submit=useCallback(()=>{
  if(disabled||submittedRef.current) return;
  if(independent ? value.trim().length===0 : value.length!==maxLength) return;
  submittedRef.current=true;
  Promise.resolve(onSubmit(value)).catch(()=>{submittedRef.current=false;});
},[disabled,independent,value,maxLength,onSubmit]);
const handleChange=e=>{
  if(!disabled) setValue(independent?e.target.value:e.target.value.slice(0,maxLength));
};
const handleKeyDown=e=>{
  if(e.key==="Enter" && !disabled && value.length>0) {
    e.preventDefault();submit();
  }
};
useEffect(()=>{
  if(!independent && maxLength>0 && value.length===maxLength && !disabled){
    const timer=setTimeout(submit,300);
    return ()=>clearTimeout(timer);
  }
},[independent,maxLength,value,disabled,submit]);
```

- [ ] **Step 4: 为现有格子for循环增加!independent条件；independent不渲染格子、不传target、不按长度自动提交，不提前朗读目标词；assisted保留既有体验。提示按钮改变assistance并保持到本题结束。**

- [ ] **Step 5: 用ref保留makePending返回值，发送前持久化；仅committed后进入反馈。失败不清空输入或ID；刷新检测pending并提供继续确认。**

- [ ] **Step 6: 移除拼写页面第二个reviews POST；只修改测验输入分支，不夹带06选择题迁移。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-05 feedback-is-assistance",async({app,page})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/拼写练习/}).click();
 await page.getByRole("button",{name:"独立回忆",exact:true}).click();
 await page.getByRole("button",{name:"提示首字母",exact:true}).click();
 await page.getByRole("textbox").fill("apple");
 await page.getByRole("textbox").press("Enter");
 await expect(page.getByRole("status")).toContainText("已保存");
 const d=await (await app.request.get("/api/cards/"+id)).json();
 expect(d.learning_events[0].assistance).toContain("first_letter");
 expect(d.learning_events[0].scheduled).toBe(false);
});
```

追加网络abort后输入值不变、显式跳过、离开无事件三条浏览器测试；只有提交前请求提示的事件才带辅助标记。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-05
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README同步独立/辅助差别与跳过规则；SpellingBoard注释更新真实props和自由输入行为。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/components/SpellingBoard.jsx' 'frontend/src/views/SpellingPage.jsx' 'frontend/src/views/QuizPage.jsx' 'e2e/ec-05.spec.mjs'
git commit -m "fix: distinguish independent recall from assisted spelling"
```

**回滚或兼容策略：** 关闭独立入口时仍保留正确分类；如恢复旧格子体验必须标为辅助且不得排期。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
