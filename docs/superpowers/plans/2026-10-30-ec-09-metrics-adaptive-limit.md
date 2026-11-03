# EC-09 统计区分真实题型，新词推荐不被提示、未知历史或即时重做抬高。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统计区分真实题型，新词推荐不被提示、未知历史或即时重做抬高。

**Architecture:** 在08学习日聚合上增加指标分类和可排期首答采样，沿用5/10/15配额。界面明确指标含义与样本量，不把自评称为客观正确率。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-09](../../tickets/reliability-and-daily-learning/09-metrics-adaptive-limit.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/10#implementation-plan)。

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

- RF1: 零样本不是0%或100%。
- RF2: 19个通过样本不能上调。
- RF3: 恰好15%/30%错误的边界。
- RF4: 同日反复答对不能冲掉首答错误。
- RF5: 旧基线/提示/选择结果不进可排期样本。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 分类指标和新词采样

**Files:**
- **Modify:** app/services/statistics.py; app/routers/today.py
- **Create:** tests/test_learning_metrics.py

**Interfaces:**
- Consumes: 08固定学习日与05/06分类事件。
- Produces: metric(events,category)、adaptive_new_limit(events,today)及weekly兼容字段/分类字典，按共享契约。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_learning_metrics.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_sparse_success_does_not_raise_limit(ec):
 ec.set_time("2026-10-30T01:00:00+00:00")
 cid=ec.seed_card()
 ec.client.post("/api/reviews",json={"card_id":cid,"rating":3,"kind":"self_rating",
   "source":"study","submission_id":str(uuid4())})
 today=ec.client.get("/api/today").json()
 assert today["recommended_goal"]==10
 assert today["sample_count"]==1
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_learning_metrics.py::test_sparse_success_does_not_raise_limit -q
```

**预期失败原因：** 当前少量或未知样本会直接推高到15，而且没有可解释sample_count。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
def adaptive_new_limit(events,today):
    from datetime import date,timedelta
    start=(date.fromisoformat(today)-timedelta(days=6)).isoformat()
    first={}
    for e in sorted(events,key=lambda e:(e["occurred_at"],e["id"])):
        if (not e["scheduled"] or e["source"]=="legacy" or
            not start<=e["learning_day"]<=today):
            continue
        first.setdefault((e["card_id"],e["learning_day"]),e)
    sample=list(first.values())
    if not sample:return 10,None,0
    error=sum(e["fsrs_rating"]<=2 for e in sample)/len(sample)
    limit=5 if error>0.30 else 15 if len(sample)>=20 and error<0.15 else 10
    return limit,error,len(sample)
```

- [ ] **Step 4: metric先按category筛选；correct为空、skipped和legacy排除，self_report用rating>=3计通过，不与客观对错混合。返回percent=None时UI暂无数据。**

- [ ] **Step 5: weekly兼容accuracy/this_week明确作为review_pass_rate别名，追加accuracy_kind；独立/辅助/识别/自评使用各自metric。**

- [ ] **Step 6: today返回recommended_goal/error_rate/sample_count；每日保底不改new_limit。使用新模块替代旧_adaptive_new_limit重复逻辑。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
import pytest
from app.services.statistics import adaptive_new_limit
@pytest.mark.parametrize(("n","wrong","limit"),[(0,0,10),(19,0,10),(20,0,15),(20,3,10),(20,6,10),(20,7,5)])
def test_adaptive_review_focus(n,wrong,limit):
 events=[{"id":str(i),"card_id":i,"learning_day":"2026-10-30",
   "occurred_at":f"2026-10-30T01:00:{i:02d}+00:00","scheduled":True,
   "source":"study","fsrs_rating":1 if i<wrong else 3} for i in range(n)]
 assert adaptive_new_limit(events,"2026-10-30")[0]==limit
```

追加同卡同日先错后对保留首错、legacy/assistance/choice均不进采样；通过HTTP混合提交核对公开weekly与today，不仅测纯函数。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_learning_metrics.py tests/test_adaptive_limit.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

ADR-0002补充采样门槛20和产品阈值，不宣传为科学定论；README同步指标含义。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/services/statistics.py' 'app/routers/today.py' 'tests/test_learning_metrics.py'
git commit -m "fix: base adaptive limits on qualified first review events"
```

**回滚或兼容策略：** 可降级为固定10个新词，保留全部分类事件；不得用未知当正确恢复旧算法。

---

### Task 2: 可理解的指标与目标说明

**Files:**
- **Modify:** frontend/src/views/StatsPage.jsx; frontend/src/App.jsx; frontend/src/views/SettingsPage.jsx
- **Create:** e2e/ec-09.spec.mjs

**Interfaces:**
- Consumes: Task1分类metric和sample_count；08完成词/次数。
- Produces: 独立、辅助、识别、自评分别显示，目标设置不能抬高新词配额。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-09.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-09 no-samples",async({app,page})=>{
 await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.locator(".today-stats").click();
 await expect(page.getByTestId("retrieval-metric")).toContainText("暂无数据");
 await expect(page.getByTestId("self-report-metric")).toContainText("暂无数据");
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-09
```

**预期失败原因：** 原界面只显示笼统正确率，且队列文案包含未插值的模板占位符。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const percentText=value=>value===null?"暂无数据":value+"%";
return <section>
  <p data-testid="retrieval-metric">独立提取正确率：{percentText(metrics.retrieval.percent)}</p>
  <p data-testid="self-report-metric">自评通过率：{percentText(metrics.self_report.percent)}</p>
  <p data-testid="new-word-limit">新词建议 {today.recommended_goal} 个 · 有效样本 {today.sample_count}</p>
</section>;
```

- [ ] **Step 4: 补齐assisted与recognition两个同结构指标，显示successes/count；不把跳过塞入错误分母。**

- [ ] **Step 5: 最低目标设置文案与每日新词配额分别展示；选择20保底不把高错误下调5的新词抬回20。**

- [ ] **Step 6: 仅据API数值渲染，不拼接${...}字面量；两视口下样本说明和指标标签完整可见。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-09 target-does-not-override-new-limit",async({app,page})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"},...Array.from({length:6},(_,i)=>({word:"word"+i,meaning:"测试词"}))]);
 await app.request.post("/api/reviews",{data:{card_id:id,rating:1,source:"study",kind:"self_rating",
   submission_id:crypto.randomUUID()}});
 await page.goto(app.baseURL);
 await page.locator(".goal-daily-set").selectOption("20");
 await expect(page.getByTestId("new-word-limit")).toContainText("5");
 await expect(page.locator("body")).not.toContainText("${100 - data.error_rate}");
});
```

单词不足导致目标select隐藏时从Settings设置保底，回首页查看new-word-limit；测试应准备足量未学词使主断言入口存在，不允许条件skip。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-09
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

同步设置帮助、统计标签和样本不足提示，文案与ADR-0002一致。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/StatsPage.jsx' 'frontend/src/App.jsx' 'frontend/src/views/SettingsPage.jsx' 'e2e/ec-09.spec.mjs'
git commit -m "feat: explain learning metrics and independent new-word limits"
```

**回滚或兼容策略：** 隐藏细分指标仍保留真实数据；旧正确率标题不能用于新自评别名。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
