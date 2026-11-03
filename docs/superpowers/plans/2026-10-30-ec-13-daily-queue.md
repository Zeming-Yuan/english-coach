# EC-13 首页一键进入到期优先、去重且目标固定的每日主队列。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页一键进入到期优先、去重且目标固定的每日主队列。

**Architecture:** 在现有today响应上增补稳定queue，保留旧数组；页面冻结一轮队列和session_id，不用不断缩短的剩余队列重算目标。巩固阶段留给14。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-13](../../tickets/reliability-and-daily-learning/13-daily-queue.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/14#implementation-plan)。

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

- RF1: 同卡多种优先标签不能重复。
- RF2: 超过20张到期词剩余数量可见。
- RF3: 困难标记不使未到期词无限每日重播。
- RF4: 提高最低目标不抬新词配额。
- RF5: 卡片中途删除或加载失败不算完成。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 稳定每日队列的公开契约

**Files:**
- **Create:** app/services/daily_session.py; tests/test_daily_session.py
- **Modify:** app/routers/today.py

**Interfaces:**
- Consumes: 03当前状态读取、09推荐配额；既有错误/困难标记。
- Produces: build_daily_queue(db,limit,runtime)与today.queue/review_count/new_count/remaining_due/target，保留旧数组。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_daily_session.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_daily_queue_is_due_first(ec):
 new_id=ec.seed_card(word="new")
 due_id=ec.seed_card(word="old")
 ec.set_time("2026-10-29T01:00:00+00:00")
 ec.client.post("/api/reviews",json={"card_id":due_id,"rating":3,"source":"study",
    "kind":"self_rating","submission_id":str(uuid4())})
 ec.set_time("2026-10-30T01:00:00+00:00")
 result=ec.client.get("/api/today").json()
 assert [c["id"] for c in result["queue"]][:2]==[due_id,new_id]
 assert result["target"]==len(result["queue"])
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_daily_session.py::test_daily_queue_is_due_first -q
```

**预期失败原因：** 当前API没有统一queue，App把new_cards排在due_cards之前；目标依赖缩短的剩余队列。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
def assemble_daily_queue(due_cards,new_cards):
    seen=set()
    reviews=[]
    for card in due_cards:
        if card["id"] not in seen:
            seen.add(card["id"]);reviews.append(card)
    selected=reviews[:20]
    for card in new_cards:
        if card["id"] not in seen:
            seen.add(card["id"]);selected.append(card)
    return {"queue":selected,"review_count":min(20,len(reviews)),
      "new_count":len(selected)-min(20,len(reviews)),
      "remaining_due":max(0,len(reviews)-20),"target":len(selected)}
```

- [ ] **Step 4: build_daily_queue先查到期word卡，同组错误权重/困难优先、due与id稳定排序；随后挑没有当前状态的新word卡，配额来自09，不拉入未到期困难词反复排队。**

- [ ] **Step 5: 不要在join多行ErrorCard/旧Review时扩大卡数：批量当前状态和标记后按card_id去重，再限额。**

- [ ] **Step 6: target是一轮实际卡数；每日最低目标单独用于日进度/继续提醒，不改本轮队列或新词配额。二者在API/UI名称分开。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
from app.services.daily_session import assemble_daily_queue
def test_daily_queue_review_focus():
 due=[{"id":i} for i in range(1,26)]+[{"id":1}]
 result=assemble_daily_queue(due,[{"id":1},{"id":26}])
 assert result["review_count"]==20
 assert result["remaining_due"]==5
 assert result["new_count"]==1
 assert len({c["id"] for c in result["queue"]})==result["target"]==21
 assert result["queue"][-1]["id"]==26
```

通过HTTP加同卡error/hard、未到期困难词、配额5且dailyGoal20、空库/仅新词四用例；不把未到期优先标记算到期职责。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_daily_session.py tests/test_today.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README与ADR-0002同步到期优先、20张上限、固定一轮目标/每日最低目标区别；不改规格新词阈值。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/services/daily_session.py' 'tests/test_daily_session.py' 'app/routers/today.py'
git commit -m "feat: build a bounded due-first daily learning queue"
```

**回滚或兼容策略：** 保留today旧数组；可让旧首页继续读兼容字段，不删除已存在事件或改变排期。

---

### Task 2: 一键主流程与固定会话

**Files:**
- **Modify:** frontend/src/App.jsx; frontend/src/views/StudyPage.jsx; frontend/src/views/SettingsPage.jsx
- **Create:** e2e/ec-13.spec.mjs; e2e/fixtures/ec13-backlog.json

**Interfaces:**
- Consumes: Task1 queue和04保存确认行为。
- Produces: 开始今日学习主按钮、次级专项入口、session_id和固定target传递；保存事件stage=main。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-13.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-13 fixed-target-and-backlog",async({appFactory,page})=>{
 const app=await appFactory({fixture:"ec13-backlog.json"});
 await page.goto(app.baseURL);
 await expect(page.getByTestId("remaining-due")).toContainText("5");
 await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
 const count=await page.locator(".study-count").textContent();
 const total=count.split("/")[1].trim();
 await page.locator(".flip-hint").first().click();
 await page.locator(".rating-3").click();
 await expect(page.locator(".study-count")).toContainText("/ "+total);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-13
```

**预期失败原因：** 目前没有剩余到期任务说明，首页目标按剩余queueTotal变化，新词先于到期。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const startDaily=data=>{
 const session={id:crypto.randomUUID(),queue:data.queue,target:data.target};
 storageSet("activeDailySession",session);
 setDailySession(session);
 setStudyQueue(session.queue);
 setView("study");
};
// StudyPage收到session，提交时使用：
// session_id: session.id, stage: "main"
```

- [ ] **Step 4: 现有setView路由增加dailySession props，不另装路由框架；专项按钮置于“专项练习”展开区，原入口功能保留。**

- [ ] **Step 5: 创建25到期词+2新词的fixture，旧Review每行state=2、step=null、due为固定昨天，stability/difficulty>0、elapsed_days=1、review_count=2，模拟测试时钟固定今天。**

- [ ] **Step 6: 通过04原pending处理刷新确认，再由持久化session恢复剩余卡；卡已删除时404明确退出/重新加载，不显示已完成。**

- [ ] **Step 7: 完成主队列当前先显示已保存主队列结果，14再接巩固；空库提供入门/加词/恢复引导，错误提供重试。**

- [ ] **Step 8: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-13 load-error-is-not-empty",async({app,page})=>{
 await page.route("**/api/today",r=>r.abort("failed"),{times:1});
 await page.goto(app.baseURL);
 await expect(page.getByRole("alert")).toContainText("加载");
 await expect(page.getByText("今日复习已完成",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"重试",exact:true}).click();
 await expect(page.getByText("欢迎来到 EnglishCoach",{exact:true})).toBeVisible();
});
```

两视口用键盘进入主流程/展开专项入口；修改dailyGoal不改变new_count；一轮队列的duplicate ID断言与余量由Task1覆盖。


- [ ] **Step 9: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-13
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 10: 同步文档或ADR**

README更新主线与专项入口，补充固定会话目标和剩余到期提示。

- [ ] **Step 11: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/App.jsx' 'frontend/src/views/StudyPage.jsx' 'frontend/src/views/SettingsPage.jsx' 'e2e/ec-13.spec.mjs' 'e2e/fixtures/ec13-backlog.json'
git commit -m "feat: start one clear daily session with a fixed target"
```

**回滚或兼容策略：** 可恢复入口布局，保留session/事件契约；中途回退必须明确退出或恢复该会话，不凭空记完成。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
