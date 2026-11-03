# EC-02 用户主动添加入门词卡后无需AI即可完成第一轮真实学习。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户主动添加入门词卡后无需AI即可完成第一轮真实学习。

**Architecture:** 在现有词卡API旁加入固定内容导入，沿用当前学习入口。这个票虽窄，仍涉及数据、API、UI与去重，使用两个有独立验收的任务，不为静态文案单独建计划。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-02](../../tickets/reliability-and-daily-learning/02-starter-cards.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/3#implementation-plan)。

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

- RF1: 重复点击不重复加词。
- RF2: 同名自定义单词不被覆盖。
- RF3: 同词句子卡不阻止新增单词卡。
- RF4: 没有AI密钥仍能完整操作。
- RF5: 添加失败不显示成功且能重试。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 固定词卡的幂等添加

**Files:**
- **Create:** app/data/starter_cards.json; app/services/starter_cards.py; tests/test_starter_cards.py
- **Modify:** app/routers/cards.py

**Interfaces:**
- Consumes: Card、get_db、现有 card_to_dict；不消费EC-03未来接口。
- Produces: POST /api/cards/starter -> {generated:int,skipped:int,cards:list[dict]}；load_starter_cards(db:Session)->list[Card]。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_starter_cards.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
def test_starter_can_be_added_without_ai(ec):
    first = ec.client.post("/api/cards/starter")
    assert first.status_code == 200
    assert first.json()["generated"] == 10
    second = ec.client.post("/api/cards/starter")
    assert second.status_code == 200
    assert second.json()["generated"] == 0
    assert len(ec.client.get("/api/cards").json()["cards"]) == 10
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_starter_cards.py::test_starter_can_be_added_without_ai -q
```

**预期失败原因：** 现有没有 starter 路由，返回404/405而非十张固定词卡。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
import json
from pathlib import Path
from sqlalchemy import select
from app.models.card import Card

def load_starter_cards(db):
    data = json.loads((Path(__file__).parents[1] / "data" / "starter_cards.json").read_text())
    added = []
    for row in data:
        existing = db.scalar(select(Card).where(Card.word == row["word"], Card.kind == "word"))
        if existing is None:
            card = Card(**row, kind="word", difficulty="basic")
            db.add(card)
            added.append(card)
    db.commit()
    return added
```

- [ ] **Step 4: 固定内容词目为 apple、banana、teacher、dog、house、book、water、hello、cat、school；每条给出英式或美式一致的音标、中文释义、至少一个完整例句及对应中文，核对后提交，不运行AI生成。**

- [ ] **Step 5: 路由事务覆盖存在检查和插入；SQLite写入串行化，EC-03尚不存在时本票本地使用干净会话BEGIN IMMEDIATE，后续共享模块替换时保留行为。**

- [ ] **Step 6: 只返回本次新增卡并计算skipped；已存在单词不写回任何字段，句子卡按kind独立。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```python
import pytest

@pytest.mark.parametrize("kind", ["word", "sentence"])
def test_starter_preserves_existing_card(ec, kind):
    card_id = ec.seed_card(word="apple", kind=kind, meaning="我的自定义内容")
    response = ec.client.post("/api/cards/starter")
    assert response.status_code == 200
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["meaning"] == "我的自定义内容"
    words = [c for c in ec.client.get("/api/cards").json()["cards"]
             if c["word"] == "apple" and c["kind"] == "word"]
    assert len(words) == 1
```

以并发两请求和fail_commit_once覆盖重复点击/事务失败：失败后卡片总数不变，重试后恰好10张。固定内容测试断言十个词目唯一、必要字段非空与kind系统控制。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_starter_cards.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README说明入门包为显式添加、覆盖范围和无AI体验；内容核对记录在入门JSON旁的说明，不新增领域ADR。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/data/starter_cards.json' 'app/services/starter_cards.py' 'tests/test_starter_cards.py' 'app/routers/cards.py'
git commit -m "feat: add offline starter cards without overwriting user content"
```

**回滚或兼容策略：** 关闭新路由或入口，保留已经添加的词卡及其排期；不得按词目批删可能被用户编辑的卡。

---

### Task 2: 从空词库立即进入学习

**Files:**
- **Modify:** frontend/src/App.jsx; frontend/src/views/AddPage.jsx
- **Create:** e2e/ec-02.spec.mjs

**Interfaces:**
- Consumes: Task1 starter响应与现有setStudyQueue/onStartStudy；EC-01浏览器夹具。
- Produces: 首页“体验入门词卡”按钮，成功进入已有StudyPage，失败停留并重试。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-02.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import { test, expect } from "./support/test.mjs";
test("EC-02 first-learning", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name:"体验入门词卡", exact:true}).click();
  await expect(page.locator(".study-count")).toContainText("1");
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  await expect.poll(async () => (await app.request.get("/api/cards")).json()
    .then(d => d.cards.filter(c => c.review_count > 0).length)).toBe(1);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-02
```

**预期失败原因：** 当前空态没有体验入门词卡按钮。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const [starterLoading, setStarterLoading] = useState(false);
const [starterError, setStarterError] = useState("");
const startStarter = async () => {
  setStarterLoading(true);
  setStarterError("");
  try {
    const data = await api("/api/cards/starter", {method:"POST"});
    if (data.cards.length) {
      setStudyQueue(data.cards);
      setView("study");
    } else {
      setView("words");
    }
  } catch (error) {
    setStarterError(error.message);
  } finally {
    setStarterLoading(false);
  }
};
```

- [ ] **Step 4: 首页与AddPage使用同一个添加动作，后者通过现有onStartStudy传新卡；无新增卡时说明已存在并进入单词本，不打开空学习页。**

- [ ] **Step 5: 按钮disabled绑定loading，错误以role=alert展示；不等待TTS或AI才显示第一张卡。**

- [ ] **Step 6: 钉住Review Focus及异常路径**

```javascript
import { test, expect } from "./support/test.mjs";
test("EC-02 retry-after-failure", async ({app,page}) => {
  await page.route("**/api/cards/starter", route => route.abort("failed"), {times:1});
  await page.goto(app.baseURL);
  await page.getByRole("button", {name:"体验入门词卡",exact:true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", {name:"体验入门词卡",exact:true}).click();
  await expect(page.locator(".study-count")).toBeVisible();
});
```

两视口均从空库无密钥运行；再通过seedCards准备一个自定义apple，操作后从单词本确认其含义未变。无真实AI调用。


- [ ] **Step 7: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-02
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 8: 同步文档或ADR**

更新README首次体验路径，票02验收记录加无密钥截图；无需单独文案提交。

- [ ] **Step 9: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/App.jsx' 'frontend/src/views/AddPage.jsx' 'e2e/ec-02.spec.mjs'
git commit -m "feat: start first learning from offline starter cards"
```

**回滚或兼容策略：** 隐藏体验按钮；Task1已创建的真实内容继续可从单词本和队列访问。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
