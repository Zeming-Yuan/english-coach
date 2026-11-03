# EL-04 Expand：看词卡或听答案后，能核对最近一次应用内接触 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者在详情或词表实际看到目标词、实际播放答案后，能够核对应用内接触依据；接触记录不被当作作答或完成量。

**Architecture:** POST /api/learning/contacts {submission_id,card_id,revision,source,kind} -> {committed,contact_id,occurred_at}；kind=answer_visible/answer_audio。record_contact(db,payload,runtime)->dict；前端 recordContact({cardId,revision,source,kind})->Promise，recordVisibleCards(cards,source)->Promise；speak(text,btn=null,onStarted=null) 保持旧调用兼容。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-04](../../tickets/evidence-based-personalized-learning/04-expand-contact-recording.md)。执行者同时读取规格、本票与本计划。

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

- RF1：确认时间由服务端决定；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：客户端回填旧日期不能造长间隔；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：仅预取未展示不计接触；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：语音预热不算实际播放；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：失败播放未展示时不计接触；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/models/learning_contact.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/services/contacts.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/routers/learning_observations.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `frontend/src/lib/contacts.js`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/main.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/cards.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/models/__init__.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/WordsPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/lib/tts.js`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup_v3.py`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el04_expand_contact_recording.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-04.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

- Create: `alembic/versions/el04_learning_contacts.py`，在当前单一迁移head之后增加接触记录及唯一提交约束。

## 文档/ADR同步文件

- `docs/adr/0005-learning-evidence-and-contact.md`：补充 ADR-0005 的接触与失败确认规则，ADR-0004 登记 contacts 扩展；README 说明应用内记录边界。
- `docs/adr/0004-content-revisions-and-v3.md`：补充 ADR-0005 的接触与失败确认规则，ADR-0004 登记 contacts 扩展；README 说明应用内记录边界。
- `README.md`：补充 ADR-0005 的接触与失败确认规则，ADR-0004 登记 contacts 扩展；README 说明应用内记录边界。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/models/learning_contact.py`
- `app/services/contacts.py`
- `app/routers/learning_observations.py`
- `frontend/src/lib/contacts.js`
- `app/main.py`
- `app/routers/cards.py`
- `app/models/__init__.py`
- `frontend/src/views/WordsPage.jsx`
- `frontend/src/lib/tts.js`
- `app/schemas/backup_v3.py`
- `tests/test_el04_expand_contact_recording.py`
- `e2e/el-04.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-01及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 contact_time（见Task 1完整签名与实现片段）；POST /api/learning/contacts {submission_id,card_id,revision,source,kind} -> {committed,contact_id,occurred_at}；kind=answer_visible/answer_audio。record_contact(db,payload,runtime)->dict；前端 recordContact({cardId,revision,source,kind})->Promise，recordVisibleCards(cards,source)->Promise；speak(text,btn=null,onStarted=null) 保持旧调用兼容。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el04_confirmed_contact_is_not_an_attempt(ec):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    saved = ec.client.post("/api/learning/contacts", json={
        "submission_id": str(uuid4()), "card_id": card_id,
        "revision": revision, "source": "card_detail", "kind": "answer_visible"
    })
    assert saved.status_code == 200
    assert saved.json()["committed"] is True
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["last_contact"]["occurred_at"] == saved.json()["occurred_at"]
    assert detail["learning_events"] == []
```

写入`tests/test_el04_expand_contact_recording.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el04_expand_contact_recording.py::test_el04_confirmed_contact_is_not_an_attempt -q
```

**预期失败原因：** 当前没有接触确认路由，正常POST得到404；详情没有 last_contact。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/contacts.py`；contact_time的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def contact_time(confirmed_at: str, client_at: str | None, displayed: bool,
                 prefetch: bool) -> str | None:
    if not displayed or prefetch:
        return None
    return confirmed_at
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：持久化 LearningContact 的提交ID/目标身份/修订/来源/种类/服务端UTC时刻，唯一提交约束；record_contact 由 run_write 包住校验、幂等比对和插入。
- [ ] 4.2：新建只处理观察请求的路由，422非法组合、404目标删除、409修订/同ID冲突；GET详情返回 last_contact 与 contact_integrity。
- [ ] 4.3：contacts.js 用 makePending/savePending/sendPending 存在确认前的稳定请求；不同存储前缀避免被评分恢复UI误当评分；存储失败将相关间隔置不足。
- [ ] 4.4：WordsPage 只在可见目标真正呈现后调用 recordVisibleCards；TTS给实际play开始增加可选回调，预热、下载、失败均不回调。
- [ ] 4.5：V3登记 learning_contacts 及其卡片身份映射，旧V2缺记录为unknown；测试重启、恢复和删除后引用。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-04 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByText("单词本", {exact: true}).click();
  await page.getByText("apple", {exact: true}).first().click();
  await expect(page.getByTestId("last-contact")).toContainText("最近应用内接触");
});
```

精确testid属于本票要交付的可访问结果区：`last-contact`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

补充 ADR-0005 的接触与失败确认规则，ADR-0004 登记 contacts 扩展；README 说明应用内记录边界。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el04_expand_contact_recording.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- alembic/versions/el04_learning_contacts.py app/models/learning_contact.py app/services/contacts.py app/routers/learning_observations.py frontend/src/lib/contacts.js app/main.py app/routers/cards.py app/models/__init__.py frontend/src/views/WordsPage.jsx frontend/src/lib/tts.js app/schemas/backup_v3.py tests/test_el04_expand_contact_recording.py e2e/el-04.spec.mjs e2e/spec-coverage.mjs docs/adr/0005-learning-evidence-and-contact.md docs/adr/0004-content-revisions-and-v3.md README.md
git diff --cached --check
git commit -m "feat: deliver el-04 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el04_expand_contact_recording.py`、`e2e/el-04.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、contact_time及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.contacts import contact_time

@pytest.mark.parametrize("arguments, expected", [
    (["2026-10-31T00:00:00Z", None, True, False], "2026-10-31T00:00:00Z"),
    (["2026-10-31T00:00:00Z", "2026-10-01T00:00:00Z", True, False], "2026-10-31T00:00:00Z"),
    (["now", None, False, False], None),
    (["now", None, True, True], None),
    (["now", None, False, True], None),
])
def test_el04_review_focus(arguments, expected):
    assert contact_time(*arguments) == expected
```

在`tests/test_el04_expand_contact_recording.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-04.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el04_request(ec):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    return "POST", "/api/learning/contacts", {"card_id": card_id, "revision": revision, "source": "card_detail", "kind": "answer_visible", "submission_id": str(uuid4())}

def test_el04_commit_failure_and_retry(ec):
    method, path, payload = prepare_el04_request(ec)
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

- [ ] 3.1：增加接触记录的服务端确认能力，记录目标身份、修订、来源及服务端时间；以词卡详情/词表实际展示和答案播放完成首条垂直路径。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：预取、缓存预热和未展示内容不算接触；真实播放与失败播放有明确处理，不用请求音频本身伪造用户听过。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：发送前保存本地待确认标记，成功后清理；重复确认去重，刷新后可继续确认。失败或存储不可用时标注间隔依据不完整。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：延迟确认以服务端确认时间作为保守依据，不让客户端回填更早日期制造长间隔；接触不写 FSRS、正确率、连续学习日或每日完成。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：接触记录及确认身份完整纳入 V3，恢复后时间依据可解释，旧数据缺记录保持未知。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

停止新增接触上报时将相关间隔展示降为依据不足，保留已确认记录和恢复适配；不把停止记录当作没有接触。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el04_expand_contact_recording.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- alembic/versions/el04_learning_contacts.py app/models/learning_contact.py app/services/contacts.py app/routers/learning_observations.py frontend/src/lib/contacts.js app/main.py app/routers/cards.py app/models/__init__.py frontend/src/views/WordsPage.jsx frontend/src/lib/tts.js app/schemas/backup_v3.py tests/test_el04_expand_contact_recording.py e2e/el-04.spec.mjs e2e/spec-coverage.mjs docs/adr/0005-learning-evidence-and-contact.md docs/adr/0004-content-revisions-and-v3.md README.md
git diff --cached --check
git commit -m "test: qualify el-04 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC21、AC23、AC35、AC36、AC37、AC39。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
