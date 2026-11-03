# EL-09 隔日和一周回测按真实记录间隔计分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者可从首页或统计进入最多三题的隔日/一周回测，查看实际间隔、首答样本及保持证据，期间再次看答案会改变资格。

**Architecture:** 注册 purpose='delayed_check'，创建体增加 window:'day'|'week'、pending_contact_ids:list[str]，后者只能降低完整性；Session增加 gap_seconds/window/integrity。GET /api/stats 增加 retention:{day,week,other}，各含 successes/count/assisted/skipped/covered。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-09](../../tickets/evidence-based-personalized-learning/09-delayed-recall-check.md)。执行者同时读取规格、本票与本计划。

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

- RF1：不足24小时无隔日证据；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：恰满24小时进入隔日；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：72小时不挪入隔日；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：恰满7天进入一周；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：14天及以上单列其他间隔；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/services/retention.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/services/practice.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/contacts.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/learning_evidence.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/statistics.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/today.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/App.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/StatsPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/PracticePage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup_v3.py`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el09_delayed_recall_check.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-09.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0002-learning-day-and-statistics.md`：ADR-0002增补延迟窗口、首答/学习日去重；ADR-0005说明应用内接触边界；README说明无样本与间隔标签。
- `docs/adr/0005-learning-evidence-and-contact.md`：ADR-0002增补延迟窗口、首答/学习日去重；ADR-0005说明应用内接触边界；README说明无样本与间隔标签。
- `README.md`：ADR-0002增补延迟窗口、首答/学习日去重；ADR-0005说明应用内接触边界；README说明无样本与间隔标签。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/services/retention.py`
- `app/services/practice.py`
- `app/services/contacts.py`
- `app/services/learning_evidence.py`
- `app/services/statistics.py`
- `app/routers/today.py`
- `frontend/src/App.jsx`
- `frontend/src/views/StatsPage.jsx`
- `frontend/src/views/PracticePage.jsx`
- `app/schemas/backup_v3.py`
- `tests/test_el09_delayed_recall_check.py`
- `e2e/el-09.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-08及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 window_for_gap（见Task 1完整签名与实现片段）；注册 purpose='delayed_check'，创建体增加 window:'day'|'week'、pending_contact_ids:list[str]，后者只能降低完整性；Session增加 gap_seconds/window/integrity。GET /api/stats 增加 retention:{day,week,other}，各含 successes/count/assisted/skipped/covered。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el09_week_check_uses_recorded_gap(ec):
    card_id = ec.seed_card()
    ec.set_time("2026-10-01T01:00:00Z")
    typed = ec.client.post("/api/typing/check", json={
        "card_id": card_id, "user_input": "apple", "source": "spelling",
        "submission_id": str(uuid4()), "assistance": []
    })
    assert typed.status_code == 200
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    contact = ec.client.post("/api/learning/contacts", json={
        "submission_id": str(uuid4()), "card_id": card_id, "revision": revision,
        "source": "card_detail", "kind": "answer_visible"
    })
    assert contact.status_code == 200
    ec.set_time("2026-10-08T01:00:00Z")
    response = ec.client.post("/api/practice-sessions", json={
        "id": str(uuid4()), "purpose": "delayed_check", "window": "week",
        "pending_contact_ids": []
    })
    assert response.status_code == 200
    assert response.json()["items"][0]["card_id"] == card_id
    assert response.json()["items"][0]["gap_seconds"] == 7 * 86400
```

写入`tests/test_el09_delayed_recall_check.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el09_delayed_recall_check.py::test_el09_week_check_uses_recorded_gap -q
```

**预期失败原因：** EL-08只注册课后用途，delayed_check尚未支持；当前统计没有真实间隔回测。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/retention.py`；window_for_gap的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def window_for_gap(seconds: int) -> str:
    if 24 * 3600 <= seconds < 72 * 3600:
        return "day"
    if 7 * 86400 <= seconds < 14 * 86400:
        return "week"
    return "other"
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：取当前修订中最后确认接触/非跳过作答作为截止锚，候选最多3题，到期/薄弱优先；无完整记录与pending接触不进入窗口。
- [ ] 4.2：发题冻结锚点，保存时在同一事务复核新接触，重新分类或标辅助；本题提交后的答案回显不反向取消已成立资格。
- [ ] 4.3：按词/学习日/窗口冻结第一次处理：辅助/跳过单列，重试不替换独立分母；聚合样本数、覆盖和实际时长，少于10项提示较少。
- [ ] 4.4：首页与统计回测入口不展示待测英文；当前已有英文推荐chip若暴露同目标，应记录接触后剔除资格，而不是忽略该曝光。
- [ ] 4.5：V3保存锚点/用途/首次处理依据并严格校验；一周合格独立成功更新对应保持证据，不重复FSRS。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-09 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.locator(".today-stats").click();
  await expect(page.getByTestId("retention-overview")).toContainText("一周回测");
});
```

精确testid属于本票要交付的可访问结果区：`retention-overview`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

ADR-0002增补延迟窗口、首答/学习日去重；ADR-0005说明应用内接触边界；README说明无样本与间隔标签。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el09_delayed_recall_check.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/services/retention.py app/services/practice.py app/services/contacts.py app/services/learning_evidence.py app/services/statistics.py app/routers/today.py frontend/src/App.jsx frontend/src/views/StatsPage.jsx frontend/src/views/PracticePage.jsx app/schemas/backup_v3.py tests/test_el09_delayed_recall_check.py e2e/el-09.spec.mjs e2e/spec-coverage.mjs docs/adr/0002-learning-day-and-statistics.md docs/adr/0005-learning-evidence-and-contact.md README.md
git diff --cached --check
git commit -m "feat: deliver el-09 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el09_delayed_recall_check.py`、`e2e/el-09.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、window_for_gap及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.retention import window_for_gap

@pytest.mark.parametrize("arguments, expected", [
    ([86399], "other"),
    ([86400], "day"),
    ([259200], "other"),
    ([604800], "week"),
    ([1209600], "other"),
])
def test_el09_review_focus(arguments, expected):
    assert window_for_gap(*arguments) == expected
```

在`tests/test_el09_delayed_recall_check.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-09.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4

def seed_known_target(ec):
    card_id = ec.seed_card()
    for now in ["2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"]:
        ec.set_time(now)
        result = ec.client.post("/api/typing/check", json={
            "card_id": card_id, "user_input": "apple", "source": "spelling",
            "submission_id": str(uuid4()), "assistance": []
        })
        assert result.status_code == 200
    return card_id

def prepare_el09_request(ec):
    card_id = seed_known_target(ec)
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    observed = ec.client.post("/api/learning/contacts", json={"submission_id": str(uuid4()), "card_id": card_id, "revision": revision, "source": "card_detail", "kind": "answer_visible"})
    assert observed.status_code == 200
    ec.set_time("2026-10-09T01:00:00Z")
    return "POST", "/api/practice-sessions", {"id": str(uuid4()), "purpose": "delayed_check", "window": "week", "pending_contact_ids": []}

def test_el09_commit_failure_and_retry(ec):
    method, path, payload = prepare_el09_request(ec)
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

- [ ] 3.1：复用共用练习上下文，候选要求当前修订及完整应用内接触依据，不为收集样本推迟正常 FSRS；无候选和旧记录不足有普通练习入口。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：按 UTC 实际时长严格区分 [24,72) 小时、[7,14) 天及其他间隔；发题冻结依据，提交前其他标签页新接触按最新记录重分。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：每词每学习日每窗口只用首次处理结果：独立正确/错误进入独立比例，辅助/跳过单列且不能靠当天重做补入独立分母。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：入口、候选预览和测试前界面不提前展示英文答案；需要标识目标时用中文释义/课程名。用户展开英文则记录接触并重新判断资格。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：有效一周独立成功更新相应长间隔证据，统计展示成功/样本、辅助、跳过、覆盖量、实际间隔；零样本及不足十个有明确说明。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：新增轮次用途/依据随 V3 保存；回测通过统一输入提交仅排期一次，提示、失效、失败和恢复不制造长间隔成功。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.9：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

关闭延迟入口并将当前保持状态退回历史依据展示，保留结果和真实排期；不要将已接受回测转换为另一份自评。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el09_delayed_recall_check.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/services/retention.py app/services/practice.py app/services/contacts.py app/services/learning_evidence.py app/services/statistics.py app/routers/today.py frontend/src/App.jsx frontend/src/views/StatsPage.jsx frontend/src/views/PracticePage.jsx app/schemas/backup_v3.py tests/test_el09_delayed_recall_check.py e2e/el-09.spec.mjs e2e/spec-coverage.mjs docs/adr/0002-learning-day-and-statistics.md docs/adr/0005-learning-evidence-and-contact.md README.md
git diff --cached --check
git commit -m "test: qualify el-09 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC06、AC20、AC21、AC22、AC23、AC35、AC36、AC37。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
