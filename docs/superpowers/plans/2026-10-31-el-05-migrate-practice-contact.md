# EL-05 Migrate：闪卡与专项练习准确记录答案接触和提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者在闪卡、拼写、测验、听写和混合练习中使用提示或听答案，都会影响相应作答解释及之后的接触间隔依据。

**Architecture:** merge_assistance(previous: list[str], added: list[str]) -> list[str]；前端 assistanceFor(scope,itemId)->string[] 与 markAssistance(scope,itemId,kind)->string[] 在本票定义并持久化题身份；复用 EL-04 的 recordContact/recordVisibleCards，不创建未来课程练习上下文。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-05](../../tickets/evidence-based-personalized-learning/05-migrate-practice-contact.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-04。

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

- RF1：无提示仍独立；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：首字母后不算独立；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：关闭提示不能撤回帮助；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：重复提示不增加评分；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：答案音频与可见答案都保留；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `frontend/src/lib/assistance.js`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `frontend/src/views/StudyPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/SpellingPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/QuizPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/ListeningPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/MixedPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/DailySessionPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/lib/practiceSession.js`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/lib/tts.js`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el05_migrate_practice_contact.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-05.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

- Modify: `app/services/contacts.py`，接入本票核心规则并沿用其前置owner。

## 文档/ADR同步文件

- `docs/adr/0005-learning-evidence-and-contact.md`：ADR-0005 增补现有练习入口覆盖表；README 保留独立/辅助排期解释，不把接触算为作答。
- `README.md`：ADR-0005 增补现有练习入口覆盖表；README 保留独立/辅助排期解释，不把接触算为作答。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `frontend/src/lib/assistance.js`
- `frontend/src/views/StudyPage.jsx`
- `frontend/src/views/SpellingPage.jsx`
- `frontend/src/views/QuizPage.jsx`
- `frontend/src/views/ListeningPage.jsx`
- `frontend/src/views/MixedPage.jsx`
- `frontend/src/views/DailySessionPage.jsx`
- `frontend/src/lib/practiceSession.js`
- `frontend/src/lib/tts.js`
- `tests/test_el05_migrate_practice_contact.py`
- `e2e/el-05.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-04及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 merge_assistance（见Task 1完整签名与实现片段）；merge_assistance(previous: list[str], added: list[str]) -> list[str]；前端 assistanceFor(scope,itemId)->string[] 与 markAssistance(scope,itemId,kind)->string[] 在本票定义并持久化题身份；复用 EL-04 的 recordContact/recordVisibleCards，不创建未来课程练习上下文。

- [ ] **Step 1：写第一条失败测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-05 flashcard exposure reaches confirmed contact", async ({app, page}) => {
  const [id] = await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await expect.poll(async () => {
    const backup = await (await app.request.get("/api/export/backup")).json();
    return backup.extensions.learning_contacts.filter(
      row => row.card_id === id && row.source === "study"
    ).length;
  }).toBeGreaterThan(0);
});
```

该代码写入`e2e/el-05.spec.mjs`；下面HTTP片段是补充空态基线，不冒称新红灯。

```python
def test_el05_hidden_answer_is_not_retrieval_credit(ec):
    card_id = ec.seed_card()
    before = ec.client.get(f"/api/cards/{card_id}").json()
    assert before["last_contact"] is None
    assert before["contact_integrity"] in {"unknown", "complete"}
```

- [ ] **Step 2：运行并确认预期红灯。**

```bash
npm --prefix frontend run test:e2e
```

**预期失败原因：** EL-04仅接入词表/详情与播放，闪卡翻面尚无study来源接触；首条红灯采用真实浏览器操作后的公开备份断言。补充HTTP空态测试可能已经通过，不能冒称它是新红灯。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/contacts.py`；merge_assistance的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def merge_assistance(previous: list[str], added: list[str]) -> list[str]:
    allowed = {"first_letter", "length", "live_feedback", "answer_audio", "answer_visible"}
    values = set(previous) | set(added)
    if not values <= allowed:
        raise ValueError("unknown assistance")
    return sorted(values)
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：在 assistance.js 为稳定题身份保存帮助集合，提交/失败重试读取同一集合；新抽取题与原题ID区分，不能把重挂载解释为清除提示。
- [ ] 4.2：闪卡翻面、听答案和专项题答案回显逐入口调用 recordContact；识别选项中显示了目标英文也属于接触。
- [ ] 4.3：SpellingBoard的帮助按钮先标记本题再展现提示；保存失败不清状态，确认或显式放弃后才结束题身份。
- [ ] 4.4：有限巩固与混合练习复用相同帮助集合，既有独立/辅助/识别/跳过与排期规则保持。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-05 visible vertical result", async ({appFactory, page}) => {
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

ADR-0005 增补现有练习入口覆盖表；README 保留独立/辅助排期解释，不把接触算为作答。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el05_migrate_practice_contact.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- frontend/src/lib/assistance.js frontend/src/views/StudyPage.jsx frontend/src/views/SpellingPage.jsx frontend/src/views/QuizPage.jsx frontend/src/views/ListeningPage.jsx frontend/src/views/MixedPage.jsx frontend/src/views/DailySessionPage.jsx frontend/src/lib/practiceSession.js frontend/src/lib/tts.js tests/test_el05_migrate_practice_contact.py e2e/el-05.spec.mjs e2e/spec-coverage.mjs docs/adr/0005-learning-evidence-and-contact.md README.md app/services/contacts.py
git diff --cached --check
git commit -m "feat: deliver el-05 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el05_migrate_practice_contact.py`、`e2e/el-05.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、merge_assistance及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.contacts import merge_assistance

@pytest.mark.parametrize("arguments, expected", [
    ([[], []], []),
    ([[], ["first_letter"]], ["first_letter"]),
    ([["first_letter"], []], ["first_letter"]),
    ([["length"], ["length"]], ["length"]),
    ([["answer_visible"], ["answer_audio"]], ["answer_audio", "answer_visible"]),
])
def test_el05_review_focus(arguments, expected):
    assert merge_assistance(*arguments) == expected
```

在`tests/test_el05_migrate_practice_contact.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-05.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el05_request(ec):
    card_id = ec.seed_card()
    return "POST", "/api/typing/check", {"card_id": card_id, "user_input": "apple", "source": "spelling", "submission_id": str(uuid4()), "assistance": ["answer_visible"]}

def test_el05_commit_failure_and_retry(ec):
    method, path, payload = prepare_el05_request(ec)
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

- [ ] 3.1：将既有闪卡、拼写、测验、听写、混合和有限巩固的答案展示/答案音频接入统一接触记录；无答案提示不伪造接触。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：当前题一旦使用提示即保持辅助，关闭提示、切换页面或恢复同一待确认题不能转回独立；新抽取题与旧题身份明确区分。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：原有独立输入、辅助、识别、显式跳过各按既有事件和排期规则保存，单次操作只影响一次；页面离开不凭空加答错。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：保存/接触确认失败保留当前题及帮助状态，接触与作答各自的幂等身份不混用。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

保留接触与提示记录；暂撤某入口接入时把该来源的间隔可靠性降为不足，已保存作答仍可读与确认。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el05_migrate_practice_contact.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- frontend/src/lib/assistance.js frontend/src/views/StudyPage.jsx frontend/src/views/SpellingPage.jsx frontend/src/views/QuizPage.jsx frontend/src/views/ListeningPage.jsx frontend/src/views/MixedPage.jsx frontend/src/views/DailySessionPage.jsx frontend/src/lib/practiceSession.js frontend/src/lib/tts.js tests/test_el05_migrate_practice_contact.py e2e/el-05.spec.mjs e2e/spec-coverage.mjs docs/adr/0005-learning-evidence-and-contact.md README.md app/services/contacts.py
git diff --cached --check
git commit -m "test: qualify el-05 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC03、AC21、AC35、AC36、AC37。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
