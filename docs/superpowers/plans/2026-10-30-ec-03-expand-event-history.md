# EC-03 新增追加事件与兼容基线，评分轨迹可见，同时提供各后续迁移独立依赖的原子幂等契约。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增追加事件与兼容基线，评分轨迹可见，同时提供各后续迁移独立依赖的原子幂等契约。

**Architecture:** 复用Review保存当前状态，增加事件和旧行基线，保留所有既有URL与读取兼容。共享内核先实现，旧请求可标为未分类；不提前宣称所有练习已经迁移。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-03](../../tickets/reliability-and-daily-learning/03-expand-event-history.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/4#implementation-plan)。

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

- RF1: 相同ID同内容回放不重复排期。
- RF2: 相同ID不同内容返回409。
- RF3: 同卡旧多行可追溯且不伪造事件。
- RF4: 提交中途失败三类数据全部回滚。
- RF5: 删卡不留下新事件/基线悬空关系。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 扩展数据并交付统一原子提交接口

**Files:**
- **Create:** app/schemas/__init__.py; app/models/review_event.py; app/models/review_baseline.py; app/schemas/learning.py; app/services/learning.py; app/services/write_transaction.py
- **Create:** alembic/versions/b1c2d3e4f502_add_learning_events.py; tests/test_learning_events.py
- **Modify:** app/models/__init__.py; app/routers/reviews.py; app/routers/cards.py; tests/conftest.py

**Interfaces:**
- Consumes: EC-01 Runtime/Clock、Review/Card、schedule、record_error及现有毕业函数。
- Produces: 共享契约完整AttemptCommand/AttemptResult、run_write、canonical_attempt、classify_attempt、submit_attempt、get_memory_state/get_card_events；typed/choice入口将在05/06接线。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_learning_events.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4

def test_review_replay_has_one_event(ec):
    card_id = ec.seed_card()
    payload = {"card_id":card_id,"rating":3,"source":"study","kind":"self_rating",
               "submission_id":str(uuid4())}
    first = ec.client.post("/api/reviews", json=payload)
    second = ec.client.post("/api/reviews", json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["committed"] is True
    assert first.json() == second.json()
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["memory_state"]["review_count"] == 1
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_learning_events.py::test_review_replay_has_one_event -q
```

**预期失败原因：** 现有响应没有committed/event_id，且重复请求会再次推进FSRS；这应是业务红灯。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
from sqlalchemy import text

def run_write(db, operation):
    if db.in_transaction():
        raise RuntimeError("write module requires a clean request session")
    try:
        db.execute(text("BEGIN IMMEDIATE"))
        result = operation(db)
        db.commit()
        return result
    except BaseException:
        db.rollback()
        raise

def classify_attempt(cmd, expected):
    from app.services.scoring import normalize
    if cmd.skipped:
        return None, None
    if cmd.kind == "self_rating":
        return None, cmd.rating
    correct = normalize(cmd.answer or "") == normalize(expected)
    rating = (3 if correct else 1) if cmd.kind == "typed" and not cmd.assistance and cmd.source != "legacy" else None
    return correct, rating
```

- [ ] **Step 4: 迁移中先保存每个旧行完整JSON基线，再以last_review和id选当前行；保留累计来源，不从review_count生成事件。所有新增字段含session_id/stage，避免14再扩核心协议。**

- [ ] **Step 5: canonical_attempt对验证后的业务内容规范化取SHA256。submit_attempt在BEGIN IMMEDIATE内先查提交标识，匹配则返回缓存，冲突409；之后查卡404、判分、更新状态、错词，创建事件并缓存AttemptResult，最后一次commit。**

- [ ] **Step 6: 旧source=legacy只有自评分的原语义，不进入可靠指标。模型枚举严格校验；复用单一内核，批次06调用内核内部的无commit操作而非嵌套事务。**

- [ ] **Step 7: routes变薄，request进入前不查库；兼容fixtures每请求独立Session并expire观察Session。故障处理返回通用500，不在JSON里泄露内部异常。**

- [ ] **Step 8: AI升级在commit后以独立会话重查卡片；调用前与AI返回后都比较word/kind/created_at/example快照，ID复用或内容变化时丢弃过期结果，不能覆盖恢复后的不同内容。缓存的graduated/sentence_card_id与同步创建的兜底卡一致。删除词卡同时按既有级联语义删除事件/基线，测试外键开启。**

- [ ] **Step 9: ReviewEvent另保存command_json（已规范化业务命令、已验题目上下文和原请求token）。恢复映射后可重算fingerprint；相同原token的既有提交回放不再次要求旧签名密钥。**

- [ ] **Step 10: 钉住Review Focus及异常路径**

```python
from uuid import uuid4
import pytest

@pytest.mark.parametrize(("mutation", "status"), [
    ({"rating":1},409),
    ({"assistance":["unknown_hint"]},422),
    ({"rating":5},422),
])
def test_replay_conflict_and_invalid_payload(ec, mutation, status):
    card_id = ec.seed_card()
    command = {"submission_id":str(uuid4()),"card_id":card_id,"rating":3,
               "source":"study","kind":"self_rating"}
    assert ec.client.post("/api/reviews",json=command).status_code == 200
    assert ec.client.post("/api/reviews",json={**command,**mutation}).status_code == status
    assert len(ec.client.get(f"/api/cards/{card_id}").json()["learning_events"]) == 1
```

添加test_failed_commit_keeps_state_and_errors、test_baseline_preserves_multiple_old_rows、test_delete_card_clears_new_references；前者在seed后fail_commit_once，公开详情/错误列表不变；基线测试从Alembic旧revision插入两行后upgrade，事件空且baseline含两原行。


- [ ] **Step 11: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_learning_events.py tests/test_reviews.py tests/test_cards_api.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 12: 同步文档或ADR**

创建ADR-0001-current-memory-and-append-only-events，写明状态/事件分离、SQLite事务所有权、幂等回放、未知旧数据及保留旧形态；同步票03的职责澄清。

- [ ] **Step 13: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/schemas/__init__.py' 'app/models/review_event.py' 'app/models/review_baseline.py' 'app/schemas/learning.py' 'app/services/learning.py' 'app/services/write_transaction.py' 'alembic/versions/b1c2d3e4f502_add_learning_events.py' 'tests/test_learning_events.py' 'app/models/__init__.py' 'app/routers/reviews.py' 'app/routers/cards.py' 'tests/conftest.py'
git commit -m "feat: expand learning storage with atomic replayable events"
```

**回滚或兼容策略：** 保留加法式表、基线和已产生事件，旧状态保持可读；允许撤回适配但不drop新增数据。

---

### Task 2: 在详情展示追加轨迹并提供浏览器提交客户端

**Files:**
- **Create:** frontend/src/lib/learning.js; e2e/ec-03.spec.mjs
- **Modify:** app/routers/cards.py; frontend/src/views/WordsPage.jsx
- **Create:** frontend/src/lib/learning.test.mjs

**Interfaces:**
- Consumes: Task1公开详情memory_state/learning_events/history_incomplete与AttemptResult。
- Produces: makePending/sendPending；详情学习事件列表和旧历史提示；后续页面可只依赖03的客户端，不暗中依赖04的hook。 同票提供savePending/loadPending/clearPending含不可写storage内存降级，避免05/06隐含依赖04。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-03.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-03 appended-history", async ({app,page}) => {
  const [id] = await app.seedCards([{word:"apple",meaning:"苹果"}]);
  await app.request.post("/api/reviews",{data:{card_id:id,rating:1}});
  await app.request.post("/api/reviews",{data:{card_id:id,rating:3}});
  await page.goto(app.baseURL);
  await page.getByRole("button",{name:/单词本/}).click();
  await page.getByText("apple",{exact:true}).click();
  await expect(page.getByTestId("learning-event")).toHaveCount(2);
  await expect(page.getByText(/历史记录不完整/)).toBeVisible();
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-03
```

**预期失败原因：** 当前详情只能展示被覆盖的Review行，没有两条追加事件或不完整历史提示。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
import {api} from "./api.js";
export function makePending(path,payload) {
  return {path,payload:{...payload,submission_id:payload.submission_id ?? crypto.randomUUID()}};
}
export function sendPending(pending) {
  return api(pending.path,{method:"POST",body:JSON.stringify(pending.payload)});
}

const pendingKey=scope=>"ec.pending."+scope;
const memoryPending=new Map();
export function savePending(scope,pending){
 memoryPending.set(scope,pending);
 try{localStorage.setItem(pendingKey(scope),JSON.stringify(pending));return true;}
 catch{return false;}
}
export function loadPending(scope){
 if(memoryPending.has(scope)) return memoryPending.get(scope);
 try{return JSON.parse(localStorage.getItem(pendingKey(scope))||"null");}
 catch{return null;}
}
export function clearPending(scope){
 memoryPending.delete(scope);
 try{localStorage.removeItem(pendingKey(scope));}catch{}
}
```

- [ ] **Step 4: 详情只遍历learning_events显示时间、来源、提示、正误/自评与排期变化；baseline另列最后可知活动，不与事件混成同一数组。**

- [ ] **Step 5: 未分类旧请求明确标注，不把rating2画成客观答错；保留原reviews字段作兼容输出但新UI不再当完整历史。**

- [ ] **Step 6: UI新增testid只用于稳定定位事件行，文本含义对普通用户可见。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-03 unknown-is-not-objective-success",async({app,page})=>{
  const [id]=await app.seedCards([{word:"apple",meaning:"苹果"}]);
  await app.request.post("/api/reviews",{data:{card_id:id,rating:2}});
  await page.goto(app.baseURL);
  await page.getByRole("button",{name:/单词本/}).click();
  await page.getByText("apple",{exact:true}).click();
  await expect(page.getByTestId("learning-event")).toContainText("未分类");
  await expect(page.getByTestId("learning-event")).not.toContainText("答错");
});
```

新库仅有明确source事件时不显示虚假的旧历史；有旧baseline或未分类事件时显示覆盖说明，二者由详情history_incomplete的显式条件驱动。

补充测试文件：frontend/src/lib/learning.test.mjs

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {makePending,savePending,loadPending,clearPending} from "./learning.js";
test("denied storage keeps stable pending id",()=>{
 globalThis.localStorage={setItem(){throw Error("denied");},getItem(){throw Error("denied");},removeItem(){}};
 const p=makePending("/api/reviews",{card_id:1,rating:3});
 assert.equal(savePending("study",p),false);
 assert.deepEqual(loadPending("study"),p);
 clearPending("study");
 assert.equal(loadPending("study"),null);
});
```


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-03
python -m pytest -q
node --test frontend/src/lib/learning.test.mjs
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README新增旧历史不可还原的限制；ADR-0001补充可见轨迹与兼容字段，禁止把界面呈现当成旧数据已补全。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/lib/learning.js' 'e2e/ec-03.spec.mjs' 'app/routers/cards.py' 'frontend/src/views/WordsPage.jsx' 'frontend/src/lib/learning.test.mjs'
git commit -m "feat: expose appended learning history without inventing legacy events"
```

**回滚或兼容策略：** 回退详情新呈现保留事件数据与公开兼容字段；makePending/sendPending被后续票消费后不得直接删除。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
