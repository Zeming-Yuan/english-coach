# EC-15 删除已无人消费的旧业务写入与统计分支，保持公共协议和已产生数据兼容。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除已无人消费的旧业务写入与统计分支，保持公共协议和已产生数据兼容。

**Architecture:** 先审计全部读写消费者并验证备份，再收紧单卡当前状态唯一性。contract不删除公共URL、不物理删除兼容历史数据，始终保持绿色。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-15](../../tickets/reliability-and-daily-learning/15-contract-legacy-paths.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/16#implementation-plan)。

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

- RF1: 遗漏故事选词/推荐/毕业读取。
- RF2: 删卡遗漏事件或基线关联。
- RF3: 旧无标识请求兼容但不能冒充高质量样本。
- RF4: 旧多行未归档便收紧唯一约束。
- RF5: 新版备份与旧接口在清理后仍可用。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 归并有证据的旧状态并收紧唯一性

**Files:**
- **Create:** alembic/versions/b1c2d3e4f503_unique_current_memory.py; tests/test_memory_contract.py
- **Modify:** app/models/review.py; app/services/learning.py; app/services/graduation.py; app/routers/cards.py

**Interfaces:**
- Consumes: 03旧行baseline、全部已迁移写入与12恢复器。
- Produces: current state单card唯一约束；get_memory_state作为唯一规则读取，原Review字段仍保留。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_memory_contract.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.review import Review

def test_current_memory_rejects_second_state(ec):
 cid=ec.seed_card()
 ec.client.post("/api/reviews",json={"card_id":cid,"rating":3})
 with Session(ec.engine) as db:
  current=db.query(Review).filter_by(card_id=cid).one()
  duplicate=Review(card_id=cid,state=current.state,step=current.step,due=current.due,
    stability=current.stability,difficulty=current.difficulty,
    elapsed_days=current.elapsed_days,last_review=current.last_review,
    review_count=current.review_count,rating=current.rating)
  db.add(duplicate)
  with pytest.raises(IntegrityError):db.commit()
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_memory_contract.py::test_current_memory_rejects_second_state -q
```

**预期失败原因：** 原模型/迁移没有单卡当前状态唯一约束，可以静默插第二行。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
from alembic import op
import sqlalchemy as sa
revision="b1c2d3e4f503"
down_revision="b1c2d3e4f502"
branch_labels=None
depends_on=None

def upgrade():
    bind=op.get_bind()
    duplicate=bind.execute(sa.text(
      "SELECT card_id FROM reviews GROUP BY card_id HAVING COUNT(*) > 1 LIMIT 1"
    )).first()
    if duplicate is not None:
        raise RuntimeError("archive and normalize duplicate current states before contract")
    op.create_index("uq_reviews_current_card","reviews",["card_id"],unique=True)

def downgrade():
    op.drop_index("uq_reviews_current_card",table_name="reviews")
```

- [ ] **Step 4: 迁移前由受测试的归并步骤追加尚未归档旧行的完整baseline，选择有效最后时间/id当前行并清除其他当前行；无法安全归并时停止升级，不能凭空把重复旧行解释为作答事件。**

- [ ] **Step 5: 归并步骤放在同一向前迁移的显式预检/数据阶段，再运行约束片段；使用反射/Core列读写，不调用随产品变化的ORM行为。**

- [ ] **Step 6: 收紧后恢复校验同一卡不能有两条current review；现有公共字段和原表形态保留，降级只撤约束不抹数据。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
def test_contract_keeps_legacy_call_and_events(ec):
 cid=ec.seed_card()
 assert ec.client.post("/api/reviews",json={"card_id":cid,"rating":3}).status_code==200
 detail=ec.client.get(f"/api/cards/{cid}").json()
 assert detail["memory_state"]["review_count"]==1
 assert detail["learning_events"][0]["source"]=="legacy"
 backup=ec.client.get("/api/export/backup").json()
 assert backup["version"]==2
 assert len(backup["learning_events"])==1
```

新增旧重复行先归档后升级用例、删卡后所有公开关联无悬空、同一毕业规则在详情/统计一致；底层约束测试是数据完整性补充，最高主验收仍是浏览器。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_memory_contract.py tests/test_full_restore.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

ADR-0001写明约束收口及为何保留物理兼容字段；ADR-0003同步当前状态一对一卡的校验。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'alembic/versions/b1c2d3e4f503_unique_current_memory.py' 'tests/test_memory_contract.py' 'app/models/review.py' 'app/services/learning.py' 'app/services/graduation.py' 'app/routers/cards.py'
git commit -m "refactor: enforce one current memory state without deleting event history"
```

**回滚或兼容策略：** 可撤unique index恢复兼容结构，不能删除已归档baseline或新增事件；归并前有可恢复副本且不得覆盖归并后的新进度。

---

### Task 2: 删除重复业务分支并核对全部入口

**Files:**
- **Modify:** app/routers/reviews.py; app/routers/quiz.py; app/routers/listening.py; app/routers/today.py; app/routers/cards.py; app/routers/export.py
- **Modify:** app/services/scheduler.py; app/services/story_generator.py; app/services/graduation.py
- **Create:** e2e/ec-15.spec.mjs; tests/test_legacy_api_compatibility.py

**Interfaces:**
- Consumes: 已迁移的03–12模块接口；不要求02/13/14 UI收尾完成。
- Produces: 评分入口全部薄适配、当前状态读取统一、旧计算实现无消费者；公共URL和兼容响应仍在。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_legacy_api_compatibility.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
def test_old_review_response_remains_usable(ec):
 cid=ec.seed_card()
 response=ec.client.post("/api/reviews",json={"card_id":cid,"rating":3})
 assert response.status_code==200
 assert {"card_id","next_due","committed","event_id"}<=response.json().keys()
 assert ec.client.get("/api/cards").status_code==200
 assert ec.client.get(f"/api/cards/{cid}").status_code==200
 assert ec.client.get("/api/export/cards").status_code==200
 assert ec.client.get("/api/export/backup").status_code==200
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_legacy_api_compatibility.py::test_old_review_response_remains_usable -q
```

**预期失败原因：** 这是删除旧代码前的兼容锁定测试，先在故意去掉旧URL或字段的临时变更上确认会失败；若当前已经通过，记录green基线，不制造产品故障充当red。首条新增业务失败测试由Task1承担。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
# 协议字段转换由各端点既有请求模型提供；以下放在适配器函数体内：
result=submit_attempt(db,command,runtime)
return result.model_dump(mode="json")
```

- [ ] **Step 4: 逐项检查推荐、故事选词、批量卡列表、详情历史、编辑/删除、毕业与后台句子任务；删除它们内部重复的状态选择/评分/错误更新逻辑，使用已交付接口。**

- [ ] **Step 5: 没有消费者的legacy算法可删除；app/static/app.js等未被React入口引用的静态兼容文件若仍被旧资源测试依赖，本票不混入清理。**

- [ ] **Step 6: 薄适配保留API已承诺的响应别名；legacy未分类的事件继续排除可靠指标；只读V1导出、旧部分恢复、V2全量恢复都运行回归。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-15 details-stats-backup-agree",async({app,page})=>{
 const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"开始今天的学习",exact:true}).click();
 await page.locator(".flip-hint").first().click();
 await page.locator(".rating-3").click();
 const d=await (await app.request.get("/api/cards/"+id)).json();
 const b=await (await app.request.get("/api/export/backup")).json();
 expect(d.learning_events).toHaveLength(1);
 expect(b.learning_events).toHaveLength(1);
 expect((await (await app.request.get("/api/stats")).json()).reviewed_today).toBe(1);
});
```

同一集成用例再经旧API读词卡与story pick（外部LLM为替身）；删除卡后所有接口可正常读，恢复备份后再检查一次。代码搜索作为人工审计，不代替以上公开行为断言。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-15
python -m pytest tests/test_legacy_api_compatibility.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

ADR-0001记录已迁移消费者与兼容保留清单；README移除过期正确率/备份能力描述，不另开全仓格式化。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/routers/reviews.py' 'app/routers/quiz.py' 'app/routers/listening.py' 'app/routers/today.py' 'app/routers/cards.py' 'app/routers/export.py' 'app/services/scheduler.py' 'app/services/story_generator.py' 'app/services/graduation.py' 'e2e/ec-15.spec.mjs' 'tests/test_legacy_api_compatibility.py'
git commit -m "refactor: retire duplicate learning rules behind compatible endpoints"
```

**回滚或兼容策略：** 按模块恢复必要兼容实现，公共新契约仍保留；不得重启重复写入或把新事件压回单行历史。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
