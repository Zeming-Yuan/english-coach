# EC-08 同卡跨天活动不会消失，学习日、streak与完成词数按真实事件计算。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同卡跨天活动不会消失，学习日、streak与完成词数按真实事件计算。

**Architecture:** 将历史读取从当前状态切到追加事件，学习日写入时固定。保留旧计数字段作为明确定义的兼容输出；自适应指标留给09。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-08](../../tickets/reliability-and-daily-learning/08-history-calendar.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/9#implementation-plan)。

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

- RF1: 上海午夜与UTC日期不同。
- RF2: 同卡同日多次与请求重试不同。
- RF3: 昨天学过今天未学仍保留streak。
- RF4: 只有旧累计基线时不伪造日历。
- RF5: 时区设置变化不重分旧事件日期。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 按事件学习日聚合活动

**Files:**
- **Create:** app/services/statistics.py; tests/test_activity_history.py
- **Modify:** app/routers/today.py; app/routers/cards.py; app/services/learning.py

**Interfaces:**
- Consumes: 03事件learning_day/learning_timezone与04明确来源事件；Runtime时钟。
- Produces: learning_day、summarize_activity、history_days，公开字段按共享契约；事件中的学习日在写入时确定。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_activity_history.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_three_days_on_one_card_remain_visible(ec):
 cid=ec.seed_card()
 for day,rating in [("28",1),("29",3),("30",4)]:
  ec.set_time(f"2026-10-{day}T01:00:00+00:00")
  assert ec.client.post("/api/reviews",json={"card_id":cid,"rating":rating,
    "source":"study","kind":"self_rating","submission_id":str(uuid4())}).status_code==200
 days=ec.client.get("/api/stats/history?days=4").json()["days"]
 counts={row["date"]:row["reviews"] for row in days}
 assert [counts[f"2026-10-{d}"] for d in ["28","29","30"]]==[1,1,1]
 assert ec.client.get("/api/stats").json()["streak"]==3
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_activity_history.py::test_three_days_on_one_card_remain_visible -q
```

**预期失败原因：** 当前history和streak按会被覆盖的last_review聚合，前两天会变为零。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
from zoneinfo import ZoneInfo
from datetime import datetime,timedelta
def learning_day(when,tz):
    if when.tzinfo is None:
        raise ValueError("event time must be timezone-aware")
    return when.astimezone(ZoneInfo(tz)).date().isoformat()

def summarize_activity(events,today):
    active={e["learning_day"] for e in events if not e["skipped"]}
    cursor=datetime.fromisoformat(today).date()
    if cursor.isoformat() not in active: cursor-=timedelta(days=1)
    streak=0
    while cursor.isoformat() in active:
        streak+=1;cursor-=timedelta(days=1)
    todays=[e for e in events if e["learning_day"]==today]
    return {"reviewed_today":len({e["card_id"] for e in todays if e["scheduled"]}),
      "attempted_today":sum(not e["skipped"] for e in todays),
      "skipped_today":sum(e["skipped"] for e in todays),"streak":streak}
```

- [ ] **Step 4: history_days包含请求范围所有日期零填充；reviews=非跳过事件数，reviewed_words=distinct scheduled卡，new_cards只计算该卡第一条真实排期事件。**

- [ ] **Step 5: streak允许今天空但昨天活跃，从昨天起算；baseline只另示最后可知活动，不伪造过去天数或计入新正确率。**

- [ ] **Step 6: graduate统计复用统一is_graduated，不再在各读取处单写state==2；卡片总数与句子卡含义在UI标签明确。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
import pytest
from datetime import datetime
from app.services.statistics import learning_day
@pytest.mark.parametrize(("iso","zone","expected"),[
 ("2026-10-29T15:59:59+00:00","Asia/Shanghai","2026-10-29"),
 ("2026-10-29T16:00:00+00:00","Asia/Shanghai","2026-10-30"),
 ("2026-10-29T16:00:00+00:00","UTC","2026-10-29"),
 ("2026-10-30T23:00:00+00:00","Asia/Shanghai","2026-10-31"),
 ("2026-10-30T00:00:00+00:00","Asia/Shanghai","2026-10-30"),
])
def test_learning_day_review_focus(iso,zone,expected):
 assert learning_day(datetime.fromisoformat(iso),zone)==expected
```

通过HTTP另测同日两真实评分+一重试=2次/1词、只有旧基线无事件、昨天有活动今天无活动。变更Runtime时区后再次读取，旧event.learning_day保持不变。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_activity_history.py tests/test_stats.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

创建ADR-0002-learning-day-and-statistics，固定UTC存储/事件学习日、计数类别、旧基线限制；更新旧统计测试中伪造多行Review的样本为真实事件。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/services/statistics.py' 'tests/test_activity_history.py' 'app/routers/today.py' 'app/routers/cards.py' 'app/services/learning.py'
git commit -m "fix: derive learning history and streaks from immutable events"
```

**回滚或兼容策略：** 保留所有事件学习日不改写；可回退报表呈现，不压缩事件去适配旧报表。

---

### Task 2: 显示真实计数和旧历史限制

**Files:**
- **Modify:** frontend/src/views/StatsPage.jsx; frontend/src/App.jsx; frontend/src/views/WordsPage.jsx
- **Create:** e2e/ec-08.spec.mjs

**Interfaces:**
- Consumes: Task1统计字段与明确的history_incomplete。
- Produces: 首页与统计页分开显示完成词/练习次数/跳过，热力图与详情使用相同日期解释。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-08.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-08 three-day-calendar",async({app,page})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
 for(const day of ["28","29","30"]){
  await app.setTime("2026-10-"+day+"T01:00:00+00:00");
  await app.request.post("/api/reviews",{data:{card_id:id,rating:3,source:"study",
   kind:"self_rating",submission_id:crypto.randomUUID()}});
 }
 await page.goto(app.baseURL);
 await page.locator(".today-stats").click();
 await expect(page.getByTestId("streak")).toContainText("3");
 for(const day of ["28","29","30"])
  await expect(page.locator('[data-date="2026-10-'+day+'"]')).toHaveAttribute("data-count","1");
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-08
```

**预期失败原因：** 原统计界面消费被覆盖的记录，无法展示连续三天同卡活动。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
<div className="today-stats">
  今日完成 <b>{stats.reviewed_today}</b> 词 ·
  练习 <b>{stats.attempted_today}</b> 次 ·
  跳过 <b>{stats.skipped_today}</b> 次
</div>
{stats.history_incomplete && <p role="note">部分旧历史不可还原，图表只展示可确认的记录。</p>}
```

- [ ] **Step 4: 热力图格子data-date/data-count对应公开日数据，tooltip同时显示学习时区；不要从浏览器本地Date重新分日。**

- [ ] **Step 5: 保留返回与键盘操作；累计基线与已记录事件数使用不同文案。正确率UI分类下一票接入。**

- [ ] **Step 6: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-08 same-day-two-attempts-one-word",async({app,page})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
 const p={card_id:id,rating:3,source:"study",kind:"self_rating",submission_id:crypto.randomUUID()};
 await app.request.post("/api/reviews",{data:p});
 await app.request.post("/api/reviews",{data:p});
 await app.request.post("/api/reviews",{data:{...p,submission_id:crypto.randomUUID()}});
 await page.goto(app.baseURL);
 await expect(page.locator(".today-stats")).toContainText("完成 1 词");
 await expect(page.locator(".today-stats")).toContainText("练习 2 次");
});
```

使用含baseline无事件的ec08-legacy.json（card1和Review count=10/last_review固定）确认提示存在、旧累计10不画成10天；夹具经旧revision升级建立，不能把baseline伪造为真实事件。


- [ ] **Step 7: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-08
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 8: 同步文档或ADR**

README与ADR-0002同步学习日和历史不完整解释，不改旧数据来迎合界面。

- [ ] **Step 9: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/StatsPage.jsx' 'frontend/src/App.jsx' 'frontend/src/views/WordsPage.jsx' 'e2e/ec-08.spec.mjs'
git commit -m "feat: present honest activity counts and legacy history limits"
```

**回滚或兼容策略：** 可以隐藏新增分项，不能将未知历史显示成完整或重写事件日期。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
