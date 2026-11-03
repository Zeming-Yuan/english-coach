# EL-14 用三轮买饮品任务建立首个可恢复的场景练习 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者用文字完成请求饮品、表达数量和礼貌确认三轮任务，看到流程完成与独立通过的差别，并能刷新后继续。

**Architecture:** 注册 purpose='scene'，创建体 {id,purpose,scene_id:'drinks'}；Session增加 task_goal/scene_id/rule_version，items.kind='scene_text'。submit_scene(db,session_id,item_id,payload,runtime)->dict；verdict=accepted/rejected/unknown。结果独立于ReviewEvent和FSRS。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-14](../../tickets/evidence-based-personalized-learning/14-three-turn-drink-scene.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-08。

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

- RF1：少于三轮不算完整；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：不能只完成一个任务；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：三轮首答独立才独立通过；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：合理但无法判定不冒充成功；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：显示标准表达后的通过是辅助；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/models/scene_attempt.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/services/scenes.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/data/scenes/drinks.json`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `frontend/src/views/ScenePage.jsx`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `alembic/versions/el14_scene_attempts.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/services/practice.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/learning_evidence.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/practice.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/App.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup_v3.py`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el14_three_turn_drink_scene.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-14.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0008-bounded-scene-evidence.md`：新增 docs/adr/0008-bounded-scene-evidence.md，明确规则权威、任务证据与FSRS分离；README写明文字首版。
- `README.md`：新增 docs/adr/0008-bounded-scene-evidence.md，明确规则权威、任务证据与FSRS分离；README写明文字首版。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/models/scene_attempt.py`
- `app/services/scenes.py`
- `app/data/scenes/drinks.json`
- `frontend/src/views/ScenePage.jsx`
- `alembic/versions/el14_scene_attempts.py`
- `app/services/practice.py`
- `app/services/learning_evidence.py`
- `app/routers/practice.py`
- `frontend/src/App.jsx`
- `app/schemas/backup_v3.py`
- `tests/test_el14_three_turn_drink_scene.py`
- `e2e/el-14.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-08及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 scene_status（见Task 1完整签名与实现片段）；注册 purpose='scene'，创建体 {id,purpose,scene_id:'drinks'}；Session增加 task_goal/scene_id/rule_version，items.kind='scene_text'。submit_scene(db,session_id,item_id,payload,runtime)->dict；verdict=accepted/rejected/unknown。结果独立于ReviewEvent和FSRS。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el14_scene_starts_without_word_scheduling(ec):
    response = ec.client.post("/api/practice-sessions", json={
        "id": str(uuid4()), "purpose": "scene", "scene_id": "drinks"
    })
    assert response.status_code == 200
    run = response.json()
    assert run["scene_id"] == "drinks"
    assert len(run["items"]) == 3
    assert run["status"] == "incomplete"
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0
```

写入`tests/test_el14_three_turn_drink_scene.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el14_three_turn_drink_scene.py::test_el14_scene_starts_without_word_scheduling -q
```

**预期失败原因：** 当前只存在词汇练习，没有scene用途/任务记录/独立通过语义。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/scenes.py`；scene_status的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def scene_status(rows: list[dict]) -> str:
    if len(rows) != 3 or any(not row.get("processed", False) for row in rows):
        return "incomplete"
    if all(row.get("verdict") == "accepted" and not row.get("assistance")
           and not row.get("skipped", False) for row in rows):
        return "independent"
    return "completed"
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：版本化drinks规则包含请求饮品/数量/礼貌确认三任务、认可表达及槽位，准备页仅中文目标和词汇准备状态；不足可继续挑战但不谎称已准备。
- [ ] 4.2：持久化SceneAttempt的题身份、首答/重试、帮助、规则verdict与目标映射；与PracticeSession推进在run_write内提交，不创建单词ReviewEvent。
- [ ] 4.3：确定性规则判定accepted/rejected/unknown，空答案不提交，显式跳过单列；未收录表达不能因为没有匹配就武断判错。
- [ ] 4.4：ScenePage复用useLearningAttempt，失败/刷新GET原轮次；先用核对模板，每轮最多一个关键纠正，TTS不控制保存。
- [ ] 4.5：把独立通过且与教学情境不同的覆盖目标接入application摘要，30天/失败/修订按相应维度处理；V3映射任务与规则身份。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-14 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "场景练习", exact: true}).click();
  await page.getByRole("button", {name: "买饮品", exact: true}).click();
  await expect(page.getByTestId("scene-session")).toContainText("买饮品");
});
```

精确testid属于本票要交付的可访问结果区：`scene-session`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

新增 docs/adr/0008-bounded-scene-evidence.md，明确规则权威、任务证据与FSRS分离；README写明文字首版。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el14_three_turn_drink_scene.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/models/scene_attempt.py app/services/scenes.py app/data/scenes/drinks.json frontend/src/views/ScenePage.jsx alembic/versions/el14_scene_attempts.py app/services/practice.py app/services/learning_evidence.py app/routers/practice.py frontend/src/App.jsx app/schemas/backup_v3.py tests/test_el14_three_turn_drink_scene.py e2e/el-14.spec.mjs e2e/spec-coverage.mjs docs/adr/0008-bounded-scene-evidence.md README.md
git diff --cached --check
git commit -m "feat: deliver el-14 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el14_three_turn_drink_scene.py`、`e2e/el-14.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、scene_status及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.scenes import scene_status

@pytest.mark.parametrize("arguments, expected", [
    ([[]], "incomplete"),
    ([[{"processed": True, "verdict": "accepted", "assistance": []}]], "incomplete"),
    ([[{"processed": True, "verdict": "accepted", "assistance": []}, {"processed": True, "verdict": "accepted", "assistance": []}, {"processed": True, "verdict": "accepted", "assistance": []}]], "independent"),
    ([[{"processed": True, "verdict": "unknown"}, {"processed": True, "verdict": "accepted", "assistance": []}, {"processed": True, "verdict": "accepted", "assistance": []}]], "completed"),
    ([[{"processed": True, "verdict": "accepted", "assistance": ["answer_visible"]}, {"processed": True, "verdict": "accepted", "assistance": []}, {"processed": True, "verdict": "accepted", "assistance": []}]], "completed"),
])
def test_el14_review_focus(arguments, expected):
    assert scene_status(*arguments) == expected
```

在`tests/test_el14_three_turn_drink_scene.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-14.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el14_request(ec):
    return "POST", "/api/practice-sessions", {"id": str(uuid4()), "purpose": "scene", "scene_id": "drinks"}

def test_el14_commit_failure_and_retry(ec):
    method, path, payload = prepare_el14_request(ec)
    before = ec.snapshot()
    ec.fail_commit_once()
    failed = ec.client.request(method, path, json=payload)
    assert failed.status_code == 500
    assert ec.snapshot() == before
    saved = ec.client.request(method, path, json=payload)
    assert saved.status_code == 200
    after = ec.snapshot()
    replay = ec.client.request(method, path, json=payload)
    assert replay.status_code == 200
    assert ec.snapshot() == after
```

- [ ] **Step 3：逐项完成本票特有边界。**

- [ ] 3.1：先用人工核对的角色模板、规则和槽位交付完整三轮买饮品任务，展示中文目标和词汇准备状态，不提前展开英文标准应答。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：规则认可、明确不满足、未判定三类结果分开；合理但未收录表达不能武断判错，空答案继续输入，显式跳过单列。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：首答全为规则认可且无帮助才独立通过；提示/标准表达/答案泄露持续标记辅助，三轮处理完成不等于独立通过。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：应用结果含规则版本、内容修订、目标映射与教学情境依据；照抄已教例句不能证明新情境，失败只影响相应维度。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：场景结果持久化并纳入 V3，不拆成单词 FSRS 评分，不混入词卡指标/连续学习日；每轮提交与推进原子、可重试和刷新继续。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：每轮最多一个关键纠正，TTS 失败不破坏已存结果，未接入 AI 时模板仍可完成任务。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.9：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

关闭场景启动入口，保留已存对话/规则/任务证据与恢复读取；应用摘要转历史说明，不删除已存结果或重写 FSRS。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el14_three_turn_drink_scene.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/models/scene_attempt.py app/services/scenes.py app/data/scenes/drinks.json frontend/src/views/ScenePage.jsx alembic/versions/el14_scene_attempts.py app/services/practice.py app/services/learning_evidence.py app/routers/practice.py frontend/src/App.jsx app/schemas/backup_v3.py tests/test_el14_three_turn_drink_scene.py e2e/el-14.spec.mjs e2e/spec-coverage.mjs docs/adr/0008-bounded-scene-evidence.md README.md
git diff --cached --check
git commit -m "test: qualify el-14 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC31、AC32、AC33、AC34、AC35、AC36、AC37、AC39。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
