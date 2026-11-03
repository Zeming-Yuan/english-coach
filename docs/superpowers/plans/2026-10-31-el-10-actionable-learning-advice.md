# EL-10 统计能解释薄弱项，并一键进入对应练习 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者看到具体依据后可直接练对应薄弱词，课程也能显示自己的短测与延迟回测结果。

**Architecture:** GET /api/learning/recommendations -> {suggestions:[{id,purpose,reason,card_ids,prompts_cn,window}]}；注册 purpose='targeted'，POST共用练习上下文带card_ids；目标变化不替换。课程learning_progress追加本课 retention 统计，不能使用全站总回测代替。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-10](../../tickets/evidence-based-personalized-learning/10-actionable-learning-advice.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-09。

**Status:** 计划已编写，产品未实现；以下代码块是未来实施内容，本次不把计划语法检查当作产品测试通过。

## Global Constraints

- 保留本地运行、React/FastAPI、SQLite 和现有 FSRS 调度方式。
- 浏览器用户操作 → 真实前端 → 真实 FastAPI → 真实 FSRS、事务 → 经 Alembic 迁移建立的隔离 SQLite。
- 已保存提交的同内容回放优先于题目失效检查。
- 提示一旦使用，本题持续属于辅助作答。
- 新课程生成结果先校验目标、唯一词形、必要释义、例句/翻译和对话中英配对，完整有效后再原子保存课程与新增词卡。
- 隔日窗口为至少 24 小时且不足 72 小时；一周窗口为至少七天且不足十四天。
- 有效样本为零时显示暂无数据；不足十个独立样本时标注样本较少，不输出确定的能力诊断。
- 首版提供买饮品、自我介绍、问路三种场景，每个场景固定三个用户应答轮次。
- 为包含新增集合的完整快照引入 V3 备份，登记全部新业务集合和引用。
- 任务范围以本票为限；全局规则对本票触及的路径生效，不能在本票建设所有后续功能。
- 每项新增持久数据在引入当票进入V3导出/校验/映射/恢复；旧V2/V1读取保持。新增记录不能先允许丢失、再等EL-21补救。
- 共享服务/迁移/视图串行集成；候选依赖图已确认，不因编辑冲突制造业务依赖。
- 回退保留已产生数据和必要兼容读取，不用旧快照覆盖新增学习。

## Review Focus

- RF1：无样本不诊断低能力；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：独立错误能指向实际词；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：同词跨理由去重；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：补救优先于机会回测；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：建议和词数有限；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/services/recommendations.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/routers/learning_advice.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `frontend/src/components/LearningAdvice.jsx`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/main.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/practice.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/lesson_progress.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/lessons.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/App.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/StatsPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/LessonsPage.jsx`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el10_actionable_learning_advice.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-10.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0002-learning-day-and-statistics.md`：ADR-0002/0005记录建议读取不排期与固定优先级；README新增统计到练习的路径。
- `README.md`：ADR-0002/0005记录建议读取不排期与固定优先级；README新增统计到练习的路径。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/services/recommendations.py`
- `app/routers/learning_advice.py`
- `frontend/src/components/LearningAdvice.jsx`
- `app/main.py`
- `app/services/practice.py`
- `app/services/lesson_progress.py`
- `app/routers/lessons.py`
- `frontend/src/App.jsx`
- `frontend/src/views/StatsPage.jsx`
- `frontend/src/views/LessonsPage.jsx`
- `tests/test_el10_actionable_learning_advice.py`
- `e2e/el-10.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-09及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 choose_advice（见Task 1完整签名与实现片段）；GET /api/learning/recommendations -> {suggestions:[{id,purpose,reason,card_ids,prompts_cn,window}]}；注册 purpose='targeted'，POST共用练习上下文带card_ids；目标变化不替换。课程learning_progress追加本课 retention 统计，不能使用全站总回测代替。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el10_advice_targets_actual_failed_card(ec):
    card_id = ec.seed_card()
    saved = ec.client.post("/api/typing/check", json={
        "card_id": card_id, "user_input": "wrong", "source": "spelling",
        "submission_id": str(uuid4()), "assistance": []
    })
    assert saved.status_code == 200
    response = ec.client.get("/api/learning/recommendations")
    assert response.status_code == 200
    suggestions = response.json()["suggestions"]
    assert suggestions[0]["card_ids"] == [card_id]
    assert suggestions[0]["purpose"] == "targeted"
    assert "apple" not in suggestions[0]["reason"]
```

写入`tests/test_el10_actionable_learning_advice.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el10_actionable_learning_advice.py::test_el10_advice_targets_actual_failed_card -q
```

**预期失败原因：** 当前没有建议API和绑定具体目标的行动入口；课程只看即时状态。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/recommendations.py`；choose_advice的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def choose_advice(candidates: list[dict]) -> list[dict]:
    seen = set()
    chosen = []
    priority = {"failed": 0, "assisted_only": 1, "delayed": 2}
    for item in sorted(candidates, key=lambda row: (priority[row["reason_kind"]], row["card_id"])):
        if item["card_id"] in seen:
            continue
        seen.add(item["card_id"])
        chosen.append(item)
        if len(chosen) == 3:
            break
    return chosen
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：从已存事件/当前证据/回测候选产生固定优先级理由，每次至多3项、每项至多3词；choose_advice作为选择边界，不能调用模型决定能力。
- [ ] 4.2：注册targeted用途，服务端验证指定集合仍存在/修订一致；删词404、变化409或空态，不能换另一词顶替。
- [ ] 4.3：LearningAdvice用中文释义、课名与数量展示回测目标，显式展开英文后触发接触并重算资格。
- [ ] 4.4：首页/统计按钮把建议用途与真实目标传给PracticePage；课程按已存lesson_id及本课目标关联回测，区分即时短测和保持。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-10 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("learning-advice")).toContainText("建议练习");
});
```

精确testid属于本票要交付的可访问结果区：`learning-advice`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

ADR-0002/0005记录建议读取不排期与固定优先级；README新增统计到练习的路径。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el10_actionable_learning_advice.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/services/recommendations.py app/routers/learning_advice.py frontend/src/components/LearningAdvice.jsx app/main.py app/services/practice.py app/services/lesson_progress.py app/routers/lessons.py frontend/src/App.jsx frontend/src/views/StatsPage.jsx frontend/src/views/LessonsPage.jsx tests/test_el10_actionable_learning_advice.py e2e/el-10.spec.mjs e2e/spec-coverage.mjs docs/adr/0002-learning-day-and-statistics.md README.md
git diff --cached --check
git commit -m "feat: deliver el-10 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el10_actionable_learning_advice.py`、`e2e/el-10.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、choose_advice及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.recommendations import choose_advice

@pytest.mark.parametrize("arguments, expected", [
    ([[]], []),
    ([[{"card_id": 1, "reason_kind": "failed"}]], [{"card_id": 1, "reason_kind": "failed"}]),
    ([[{"card_id": 1, "reason_kind": "delayed"}, {"card_id": 1, "reason_kind": "failed"}]], [{"card_id": 1, "reason_kind": "failed"}]),
    ([[{"card_id": 2, "reason_kind": "assisted_only"}, {"card_id": 1, "reason_kind": "failed"}]], [{"card_id": 1, "reason_kind": "failed"}, {"card_id": 2, "reason_kind": "assisted_only"}]),
    ([[{"card_id": 1, "reason_kind": "delayed"}, {"card_id": 2, "reason_kind": "delayed"}, {"card_id": 3, "reason_kind": "delayed"}, {"card_id": 4, "reason_kind": "delayed"}]], [{"card_id": 1, "reason_kind": "delayed"}, {"card_id": 2, "reason_kind": "delayed"}, {"card_id": 3, "reason_kind": "delayed"}]),
])
def test_el10_review_focus(arguments, expected):
    assert choose_advice(*arguments) == expected
```

在`tests/test_el10_actionable_learning_advice.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

- [ ] **Step 2：为可恢复写路径钉住响应丢失。**

适用本票实际会写入的公开操作（纯读取入口则验证重复读取不改变快照）。用以下真实传输注入，保留第一次已提交结果：

```javascript
async function loseOneResponse(page, pattern) {
  await page.route(pattern, async route => {
    await route.fetch();
    await route.abort("failed");
  }, {times: 1});
}

async function assertOneSavedRecord(app, collection, submissionId) {
  const payload = await (await app.request.get("/api/export/backup")).json();
  const rows = payload[collection] || payload.extensions?.[collection] || [];
  expect(rows.filter(row => row.submission_id === submissionId)).toHaveLength(1);
}
```

将帮助函数放在`e2e/el-10.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el10_request(ec):
    card_id = ec.seed_card()
    ec.client.post("/api/typing/check", json={"card_id": card_id, "user_input": "wrong", "source": "spelling", "submission_id": str(uuid4()), "assistance": []})
    return "GET", "/api/learning/recommendations", None

def test_el10_reading_is_not_learning(ec):
    method, path, payload = prepare_el10_request(ec)
    before = ec.snapshot()
    first = ec.client.request(method, path)
    second = ec.client.request(method, path)
    assert first.status_code == second.status_code == 200
    assert ec.snapshot() == before
```

- [ ] **Step 3：逐项完成本票特有边界。**

- [ ] 3.1：建议按独立首答失败、仅辅助成功、合格延迟候选的固定优先级产生；同词去重，最多三项、每项最多三个词，并展示依据。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：无样本不当作能力不足，阅读识别建议不冒充独立提取失败；建议读取不改变排期，未到期专项由用户显式启动。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：入口绑定真实目标集合和题型；目标删去或修订变化解释原目标不可用，不悄悄换词，空池有明确返回入口。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：延迟建议以数量/中文释义/课名定位目标，不能提前泄露英文答案；展开答案后按接触规则重算。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：课程列表/详情能区分本课短测和实际延迟回测结果，不把总回测成绩或生成数量当成本课通过。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

隐藏建议行动入口，保留分类指标、课测/回测记录与既有练习读取；不回退真实已产生排期。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el10_actionable_learning_advice.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/services/recommendations.py app/routers/learning_advice.py frontend/src/components/LearningAdvice.jsx app/main.py app/services/practice.py app/services/lesson_progress.py app/routers/lessons.py frontend/src/App.jsx frontend/src/views/StatsPage.jsx frontend/src/views/LessonsPage.jsx tests/test_el10_actionable_learning_advice.py e2e/el-10.spec.mjs e2e/spec-coverage.mjs docs/adr/0002-learning-day-and-statistics.md README.md
git diff --cached --check
git commit -m "test: qualify el-10 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC08、AC24、AC25、AC35、AC36。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
