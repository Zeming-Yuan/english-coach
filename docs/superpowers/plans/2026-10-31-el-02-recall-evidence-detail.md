# EL-02 独立作答后，在词卡详情看到有依据的回忆状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者完成独立拼写后，在词卡详情看到真实样本、日期和当前适用性；反复答错、同日重试或自评高分不会显示成掌握。

**Architecture:** evidence_summary(db: Session, card_id: int, runtime: Runtime) -> dict。learning_evidence={revision, recall:{status,count,last_verified_at}, retention:{status}, application:{status}}；status 为 insufficient/verified/weak/stale/history_incomplete。输入事件先限定当前 identity+revision；旧事件不补造关联。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-02](../../tickets/evidence-based-personalized-learning/02-recall-evidence-detail.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-01。

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

- RF1：恰满24小时且不同学习日才验证；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：跨午夜但不足24小时不验证；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：同日重试不增加独立学习日；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：新错误撤回当前有效回忆标记；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：超过30天仅提示复测不造失败；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/services/learning_evidence.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `frontend/src/components/LearningEvidence.jsx`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/services/learning.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/card_payload.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/cards.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/models/review_event.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/WordsPage.jsx`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el02_recall_evidence_detail.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-02.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0005-learning-evidence-and-contact.md`：新增 docs/adr/0005-learning-evidence-and-contact.md 的证据部分；明确 graduated 是解锁兼容值、回忆规则为产品阈值。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/services/learning_evidence.py`
- `frontend/src/components/LearningEvidence.jsx`
- `app/services/learning.py`
- `app/services/card_payload.py`
- `app/routers/cards.py`
- `app/models/review_event.py`
- `frontend/src/views/WordsPage.jsx`
- `tests/test_el02_recall_evidence_detail.py`
- `e2e/el-02.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-01及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 recall_status（见Task 1完整签名与实现片段）；evidence_summary(db: Session, card_id: int, runtime: Runtime) -> dict。learning_evidence={revision, recall:{status,count,last_verified_at}, retention:{status}, application:{status}}；status 为 insufficient/verified/weak/stale/history_incomplete。输入事件先限定当前 identity+revision；旧事件不补造关联。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el02_independent_cross_day_recall(ec):
    card_id = ec.seed_card()
    for now in ["2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"]:
        ec.set_time(now)
        saved = ec.client.post("/api/typing/check", json={
            "card_id": card_id, "user_input": "apple", "source": "spelling",
            "submission_id": str(uuid4()), "assistance": []
        })
        assert saved.status_code == 200
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["learning_evidence"]["recall"]["status"] == "verified"
```

写入`tests/test_el02_recall_evidence_detail.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el02_recall_evidence_detail.py::test_el02_independent_cross_day_recall -q
```

**预期失败原因：** 当前详情没有 learning_evidence，仍用复习次数计算掌握；两次跨日的客观证据未被聚合。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/learning_evidence.py`；recall_status的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def recall_status(day_count: int, span_seconds: int, last_correct: bool | None,
                  age_seconds: int, history_complete: bool) -> str:
    if not history_complete:
        return "history_incomplete"
    if last_correct is False:
        return "weak"
    if day_count < 2 or span_seconds < 86400:
        return "insufficient"
    if age_seconds > 30 * 86400:
        return "stale"
    return "verified"
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：在学习提交事务里为新事件写入当前卡片 identity/revision；get_card_events 保留真实存储次序，不把原缓存结果改成新时间。
- [ ] 4.2：批量查询当前修订的非legacy独立typed首答，按学习日保留首答，在最近独立失败之后累计成功；辅助、识别、自评、跳过排除。
- [ ] 4.3：以 recall_status 生成摘要并接入详情载荷；retention/application 尚无有效数据时显式 insufficient，不偷读毕业。
- [ ] 4.4：新增 LearningEvidence 组件，显示类别、日期、样本及原因；详情移除次数掌握百分比；修订后展示旧结果为历史。
- [ ] 4.5：把新增事件字段与规则版本纳入 V3，补旧V2导入空修订、失败/回放与内容修改的公开HTTP用例。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-02 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByText("单词本", {exact: true}).click();
  await page.getByText("apple", {exact: true}).first().click();
  await expect(page.getByTestId("learning-evidence")).toContainText("独立回忆");
});
```

精确testid属于本票要交付的可访问结果区：`learning-evidence`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

新增 docs/adr/0005-learning-evidence-and-contact.md 的证据部分；明确 graduated 是解锁兼容值、回忆规则为产品阈值。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el02_recall_evidence_detail.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/services/learning_evidence.py frontend/src/components/LearningEvidence.jsx app/services/learning.py app/services/card_payload.py app/routers/cards.py app/models/review_event.py frontend/src/views/WordsPage.jsx tests/test_el02_recall_evidence_detail.py e2e/el-02.spec.mjs e2e/spec-coverage.mjs docs/adr/0005-learning-evidence-and-contact.md
git diff --cached --check
git commit -m "feat: deliver el-02 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el02_recall_evidence_detail.py`、`e2e/el-02.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、recall_status及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.learning_evidence import recall_status

@pytest.mark.parametrize("arguments, expected", [
    ([2, 86400, True, 0, True], "verified"),
    ([2, 86399, True, 0, True], "insufficient"),
    ([1, 90000, True, 0, True], "insufficient"),
    ([3, 172800, False, 0, True], "weak"),
    ([2, 86400, True, 2592001, True], "stale"),
])
def test_el02_review_focus(arguments, expected):
    assert recall_status(*arguments) == expected
```

在`tests/test_el02_recall_evidence_detail.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-02.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el02_request(ec):
    card_id = ec.seed_card()
    return "POST", "/api/typing/check", {"card_id": card_id, "user_input": "apple", "source": "spelling", "submission_id": str(uuid4()), "assistance": []}

def test_el02_commit_failure_and_retry(ec):
    method, path, payload = prepare_el02_request(ec)
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

- [ ] 3.1：服务端从当前内容修订的真实事件生成证据摘要；两次不同学习日首答独立正确且相隔至少 24 小时，才显示回忆已有证据。只有一次则显示仍需验证。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：首字母/长度/实时反馈/答案音频等帮助、识别、自评及迁移基线分别解释，不满足独立回忆门槛；三次失败不能显示 100% 掌握。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：新独立失败使当前回忆证据待巩固，超过三十天提示待复测，历史成功仍可查看；词义修改后旧证据不证明新修订。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：详情并列显示真实 FSRS 到期和证据日期/数量；兼容毕业字段仍表达句子练习解锁。尚无长间隔或应用功能时相应维度为暂无证据。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：新写入所需的修订关联、规则版本和可重算依据同步进入 V3；保存失败、失效题与原提交回放不会重复产生或刷新证据。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

详情退回真实原始事件与“依据不足”的保守展示，保留证据 API、规则版本和原事件，不恢复按次数计算的 100% 掌握。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el02_recall_evidence_detail.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/services/learning_evidence.py frontend/src/components/LearningEvidence.jsx app/services/learning.py app/services/card_payload.py app/routers/cards.py app/models/review_event.py frontend/src/views/WordsPage.jsx tests/test_el02_recall_evidence_detail.py e2e/el-02.spec.mjs e2e/spec-coverage.mjs docs/adr/0005-learning-evidence-and-contact.md
git diff --cached --check
git commit -m "test: qualify el-02 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC01、AC03、AC04、AC05、AC06、AC07。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
