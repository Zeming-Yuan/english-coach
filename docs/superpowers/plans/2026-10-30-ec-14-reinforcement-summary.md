# EC-14 主队列结束后最多三题巩固，可跳过，并展示仅基于已保存事件的反馈。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主队列结束后最多三题巩固，可跳过，并展示仅基于已保存事件的反馈。

**Architecture:** 复用05输入题与13会话ID，summary只读持久化事件。巩固不是第二套评分策略，也不通过无限题量阻止用户完成。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-14](../../tickets/reliability-and-daily-learning/14-reinforcement-summary.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/15#implementation-plan)。

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

- RF1: 没有薄弱词时直接结束。
- RF2: 同卡多次薄弱只出一道巩固。
- RF3: 超过三词只出最多三题。
- RF4: 辅助答对不伪装独立掌握。
- RF5: 跳过整个阶段不生成虚假答错事件。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 按会话事件读取巩固与总结

**Files:**
- **Modify:** app/services/daily_session.py; app/main.py
- **Create:** app/routers/sessions.py; tests/test_session_summary.py

**Interfaces:**
- Consumes: 03预留的session_id/stage，13真实会话事件，05typed策略。
- Produces: build_reinforcement(events,max_items=3)；GET /api/sessions/{id}/summary和/reinforcement，未知404、无薄弱questions=[]。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_session_summary.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_reinforcement_is_unique_and_bounded(ec):
 session=str(uuid4())
 for word in ["apple","book","cat","dog"]:
  cid=ec.seed_card(word=word)
  ec.client.post("/api/reviews",json={"card_id":cid,"rating":1,"source":"study",
   "kind":"self_rating","submission_id":str(uuid4()),"session_id":session,"stage":"main"})
 response=ec.client.get(f"/api/sessions/{session}/reinforcement")
 assert response.status_code==200
 questions=response.json()["questions"]
 assert len(questions)==3
 assert len({q["card_id"] for q in questions})==3
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_session_summary.py::test_reinforcement_is_unique_and_bounded -q
```

**预期失败原因：** 当前没有按session读取巩固和总结的接口。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
def build_reinforcement(events,max_items=3):
    selected={}
    for event in events:
        weak=(event["skipped"] or event.get("correct") is False or
              event.get("fsrs_rating") in (1,2))
        if event["stage"]=="main" and weak:
            selected.setdefault(event["card_id"],{"card_id":event["card_id"]})
    return list(selected.values())[:min(max_items,3)]
```

- [ ] **Step 4: API对候选卡重新查存在性并补meaning题面，删除卡过滤；不为生成巩固触发AI或自动播放目标词。**

- [ ] **Step 5: summary按已保存事件分main/reinforcement、独立/辅助/识别/自评计数，含skip和仍需复习词及实际due；不从页面本地wrongList推断。**

- [ ] **Step 6: 同卡后续独立答对或明确高分可从仍薄弱列表清除，辅助/识别答对不据此宣称独立掌握。summary不写数据。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
import pytest
from app.services.daily_session import build_reinforcement
@pytest.mark.parametrize(("events","count"),[
 ([],0),
 ([{"card_id":1,"stage":"main","skipped":False,"correct":True,"fsrs_rating":3}],0),
 ([{"card_id":1,"stage":"main","skipped":True,"correct":None,"fsrs_rating":None}],1),
 ([{"card_id":1,"stage":"main","skipped":False,"correct":False,"fsrs_rating":1}]*4,1),
 ([{"card_id":i,"stage":"main","skipped":False,"correct":False,"fsrs_rating":1} for i in range(6)],3),
])
def test_reinforcement_review_focus(events,count):
 assert len(build_reinforcement(events))==count
```

通过HTTP验证未知session404、main全通过空questions、辅助答对仍薄弱、独立答对后清除、读取summary不新增事件。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_session_summary.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README与ADR-0002同步有限巩固/仍需复习含义；不以页面完成宣称长期掌握。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/services/daily_session.py' 'app/main.py' 'app/routers/sessions.py' 'tests/test_session_summary.py'
git commit -m "feat: summarize saved daily sessions and bounded reinforcement"
```

**回滚或兼容策略：** 关闭只读巩固入口保留session事件；不删除已完成的巩固记录或修改已有due。

---

### Task 2: 有限巩固阶段和可信完成页

**Files:**
- **Modify:** frontend/src/App.jsx; frontend/src/views/StudyPage.jsx
- **Create:** frontend/src/views/DailySessionPage.jsx; e2e/ec-14.spec.mjs

**Interfaces:**
- Consumes: Task1会话API、13session与05输入界面/提交协议。
- Produces: phase=main/reinforcement/summary三阶段编排；整个阶段可跳过，已保存结果决定结束。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-14.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-14 optional-reinforcement",async({app,page})=>{
 await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
 await page.locator(".flip-hint").first().click();
 await page.locator(".rating-1").click();
 await expect(page.getByRole("heading",{name:"本轮巩固",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"跳过本轮巩固",exact:true}).click();
 await expect(page.getByRole("heading",{name:"本轮学习结果",exact:true})).toBeVisible();
 await expect(page.getByText(/仍需复习/)).toBeVisible();
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-14
```

**预期失败原因：** 原StudyPage直接本地完成，没有可跳过的有限巩固阶段或服务端summary。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const finishMain=async()=>{
 const data=await api("/api/sessions/"+session.id+"/reinforcement");
 setQuestions(data.questions);
 setPhase(data.questions.length?"reinforcement":"summary");
};
const finishSession=async()=>{
 const saved=await api("/api/sessions/"+session.id+"/summary");
 setSummary(saved);setPhase("summary");
};
```

- [ ] **Step 4: DailySessionPage作为狭窄编排，复用StudyPage的保存语义；onMainDone后请求巩固，不复制评分内核。**

- [ ] **Step 5: 最多3题使用source=reinforcement、stage=reinforcement与原session_id，独立输入不得泄露长度/答案；提示后按真实assistance保存。**

- [ ] **Step 6: 跳过整个阶段只调用finishSession，不为未作答题生成错误；summary加载失败留重试，不能用本地推算伪装已完成。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-14 no-weak-items-finishes",async({app,page})=>{
 await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
 await page.locator(".flip-hint").first().click();
 await page.locator(".rating-3").click();
 await expect(page.getByRole("heading",{name:"本轮学习结果",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"本轮巩固",exact:true})).toHaveCount(0);
});
```

增加巩固提交失败停留/重试同ID、summary请求失败不显示成功、三题上限和零题池；完成文案无“明天不会忘”等保证。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-14
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README更新最终主线和完成页术语，保留专项/课程/故事补充入口。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/App.jsx' 'frontend/src/views/StudyPage.jsx' 'frontend/src/views/DailySessionPage.jsx' 'e2e/ec-14.spec.mjs'
git commit -m "feat: finish daily learning with optional bounded reinforcement"
```

**回滚或兼容策略：** 可以关闭巩固并直接进入服务器summary，保留其历史与ID；不能回到纯本地计分假完成。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
