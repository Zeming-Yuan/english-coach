# EL-13 读后两题检查区分理解、独立回忆和回看帮助 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者读完指定版本后能做一题理解选择和一题目标词输入，回看原文后会看到辅助说明，刷新后可继续原检查。

**Architecture:** 注册 purpose='story_check'，创建体 {id,purpose,story_id,version_id}；items.kind可为reading_choice/typed，reading_choice内部映射已验choice事件并按上下文purpose分列阅读结果，不影响FSRS。story_check_kinds(has_choice:bool,has_target:bool)->list[str]。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-13](../../tickets/evidence-based-personalized-learning/13-story-reading-check.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-08、EL-11。

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

- RF1：旧故事缺题保持可读；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：只存在理解题如实显示一题；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：只存在目标词不编造理解题；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：最多两题且用途分开；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：回看原文后输入属于辅助；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/services/story_checks.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/services/practice.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/questions.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/statistics.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/stories.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/StoriesPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/PracticePage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup_v3.py`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el13_story_reading_check.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-13.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0006-practice-context-and-course-progress.md`：ADR-0006登记story_check用途，ADR-0007说明材料版本和引用唯一性；README明确读后即时正确不等于延迟保持。
- `docs/adr/0007-bounded-learning-content.md`：ADR-0006登记story_check用途，ADR-0007说明材料版本和引用唯一性；README明确读后即时正确不等于延迟保持。
- `README.md`：ADR-0006登记story_check用途，ADR-0007说明材料版本和引用唯一性；README明确读后即时正确不等于延迟保持。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/services/story_checks.py`
- `app/services/practice.py`
- `app/services/questions.py`
- `app/services/statistics.py`
- `app/routers/stories.py`
- `frontend/src/views/StoriesPage.jsx`
- `frontend/src/views/PracticePage.jsx`
- `app/schemas/backup_v3.py`
- `tests/test_el13_story_reading_check.py`
- `e2e/el-13.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-08、EL-11及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 story_check_kinds（见Task 1完整签名与实现片段）；注册 purpose='story_check'，创建体 {id,purpose,story_id,version_id}；items.kind可为reading_choice/typed，reading_choice内部映射已验choice事件并按上下文purpose分列阅读结果，不影响FSRS。story_check_kinds(has_choice:bool,has_target:bool)->list[str]。

- [ ] **Step 1：写第一条失败测试。**

```python
def test_el13_reading_check_is_not_a_word_review(ec):
    response = ec.client.get("/api/stats")
    assert response.status_code == 200
    assert "reading_checks" in response.json()
    assert response.json()["reading_checks"]["independent_count"] == 0
```

写入`tests/test_el13_story_reading_check.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el13_story_reading_check.py::test_el13_reading_check_is_not_a_word_review -q
```

**预期失败原因：** 共用轮次尚不接受 story_check，故事阅读后无两题入口。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/story_checks.py`；story_check_kinds的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def story_check_kinds(has_choice: bool, has_target: bool) -> list[str]:
    result = []
    if has_choice:
        result.append("reading_choice")
    if has_target:
        result.append("typed")
    return result
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：story_check selector只消费已校验版本材料：选择题含证据句/签名上下文，词汇输入含真实目标card_id和revision；缺材料返回空态不即时调用模型判分。
- [ ] 4.2：reading_choice复用统一签名choice判分，source=story，stage=standalone，并通过PracticeItem用途关联归入reading_checks；不把它算独立提取。
- [ ] 4.3：PracticePage对reading_choice展示实际选项，对typed隐藏原文；返回原文前持久标记当前输入题的帮助。
- [ ] 4.4：完成页列阅读识别/词汇独立/辅助、实际题数和版本；V3登记用途及签名上下文映射，重启/恢复后未交题token重新获取。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

Create: e2e/fixtures/el13-story-version.json。这是准备内容版本的夹具，不伪造成功作答；恢复/生成/判分仍走真实接口。字段由EL-01/11已定义：

```json
{
  "tables": {
    "cards": [
      {
        "id": 1,
        "word": "apple",
        "kind": "word",
        "meaning": "苹果"
      }
    ],
    "stories": [
      {
        "id": 1,
        "title": "Apple Story",
        "title_cn": "苹果故事",
        "content": "An apple is on the small table near my book.\nAn apple is on the small table near my book.\nAn apple is on the small table near my book.\nAn apple is on the small table near my book.",
        "content_cn": "一个苹果在我的书旁边的小桌子上。\n一个苹果在我的书旁边的小桌子上。\n一个苹果在我的书旁边的小桌子上。\n一个苹果在我的书旁边的小桌子上。"
      }
    ],
    "story_words": [
      {
        "id": 1,
        "story_id": 1,
        "card_id": 1
      }
    ],
    "content_revisions": [
      {
        "id": 1,
        "resource_kind": "card",
        "resource_id": 1,
        "identity": "11111111-1111-4111-8111-111111111111",
        "version": 1
      },
      {
        "id": 2,
        "resource_kind": "story",
        "resource_id": 1,
        "identity": "22222222-2222-4222-8222-222222222222",
        "version": 1
      }
    ],
    "story_versions": [
      {
        "id": "33333333-3333-4333-8333-333333333333",
        "story_id": 1,
        "parent_id": null,
        "identity": "22222222-2222-4222-8222-222222222222",
        "version": 1,
        "mode": "normal",
        "material": {
          "title": "Apple",
          "sentences": [
            {
              "en": "An apple is on the small table near my book.",
              "cn": "一个苹果在我的书旁边的小桌子上。"
            },
            {
              "en": "An apple is on the small table near my book.",
              "cn": "一个苹果在我的书旁边的小桌子上。"
            },
            {
              "en": "An apple is on the small table near my book.",
              "cn": "一个苹果在我的书旁边的小桌子上。"
            },
            {
              "en": "An apple is on the small table near my book.",
              "cn": "一个苹果在我的书旁边的小桌子上。"
            }
          ],
          "targets": [
            "apple"
          ],
          "check": {
            "question": "What is on the table",
            "options": [
              "apple",
              "book",
              "water"
            ],
            "expected": "apple",
            "evidence_index": 0
          }
        },
        "target_card_ids": [
          1
        ],
        "quality": {
          "known_basis": "fixture",
          "passed": true
        }
      }
    ]
  },
  "llm_responses": [
    {
      "title": "Apple",
      "sentences": [
        {
          "en": "An apple is on my book.",
          "cn": "一个苹果在我的书上。"
        },
        {
          "en": "An apple is on my book.",
          "cn": "一个苹果在我的书上。"
        },
        {
          "en": "An apple is on my book.",
          "cn": "一个苹果在我的书上。"
        }
      ],
      "targets": [
        "apple"
      ],
      "check": {
        "question": "What is on my book",
        "options": [
          "apple",
          "book",
          "water"
        ],
        "expected": "apple",
        "evidence_index": 0
      }
    }
  ]
}
```


```javascript
import {test, expect} from "./support/test.mjs";

test("EL-13 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el13-story-version.json"});
  await page.goto(app.baseURL);
  await page.getByText("故事", {exact: true}).click();
  await page.getByText("Apple Story", {exact: true}).click();
  await page.getByRole("button", {name: "读后检查", exact: true}).click();
  await expect(page.getByTestId("practice-session")).toContainText("阅读理解");
});
```

读后检查先展示理解选项，点击后真实保存，再显示“下一题”；词汇页输入label为“你的答案”，提供“回看原文”“返回检查”“提交答案”，回看会在服务端持久标记帮助。

精确testid属于本票要交付的可访问结果区：`practice-session`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

ADR-0006登记story_check用途，ADR-0007说明材料版本和引用唯一性；README明确读后即时正确不等于延迟保持。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el13_story_reading_check.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/services/story_checks.py app/services/practice.py app/services/questions.py app/services/statistics.py app/routers/stories.py frontend/src/views/StoriesPage.jsx frontend/src/views/PracticePage.jsx app/schemas/backup_v3.py tests/test_el13_story_reading_check.py e2e/el-13.spec.mjs e2e/spec-coverage.mjs docs/adr/0006-practice-context-and-course-progress.md docs/adr/0007-bounded-learning-content.md README.md
git diff --cached --check
git commit -m "feat: deliver el-13 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el13_story_reading_check.py`、`e2e/el-13.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、story_check_kinds及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.story_checks import story_check_kinds

@pytest.mark.parametrize("arguments, expected", [
    ([False, False], []),
    ([True, False], ["reading_choice"]),
    ([False, True], ["typed"]),
    ([True, True], ["reading_choice", "typed"]),
])
def test_el13_review_focus(arguments, expected):
    assert story_check_kinds(*arguments) == expected
```

```python
def test_el13_reopening_does_not_clear_assistance():
    from app.services.contacts import merge_assistance
    assert merge_assistance(["answer_visible"], []) == ["answer_visible"]
```

在`tests/test_el13_story_reading_check.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-13.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

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

def prepare_el13_request(ec):
    from tests.support.llm_queue import QueuedLLM
    seed_known_target(ec)
    ec.app.state.llm_client = QueuedLLM([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}])
    original = ec.client.post("/api/stories/generate", json={"operation_id": str(uuid4()), "include_new_target": False}).json()
    return "POST", "/api/practice-sessions", {"id": str(uuid4()), "purpose": "story_check", "story_id": original["id"], "version_id": original["version_id"]}

def test_el13_commit_failure_and_retry(ec):
    method, path, payload = prepare_el13_request(ec)
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

以下具名场景必须随本票实现（测试内容，不是已执行证据）：

```javascript
test("EL-13 reopening the story keeps typed answer assisted", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el13-story-version.json"});
  await page.goto(app.baseURL);
  await page.getByText("故事", {exact: true}).click();
  await page.getByText("Apple Story", {exact: true}).click();
  await page.getByRole("button", {name: "读后检查", exact: true}).click();
  await page.getByRole("button", {name: "apple", exact: true}).click();
  await page.getByRole("button", {name: "下一题", exact: true}).click();
  await page.getByRole("button", {name: "回看原文", exact: true}).click();
  await page.getByRole("button", {name: "返回检查", exact: true}).click();
  await page.getByRole("textbox", {name: "你的答案", exact: true}).fill("apple");
  await page.getByRole("button", {name: "提交答案", exact: true}).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const backup = await (await app.request.get("/api/export/backup")).json();
  const typed = backup.learning_events.filter(row => row.source === "story" && row.kind === "typed");
  expect(typed).toHaveLength(1);
  expect(typed[0].assistance).toContain("answer_visible");
  expect(typed[0].scheduled).toBe(false);
});
```

- [ ] **Step 3：逐项完成本票特有边界。**

- [ ] 3.1：复用持久练习上下文，默认最多两题；理解选择使用已校验证据句/选项及服务端判分上下文，未达到有效标准不发题。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：理解选择记录为阅读识别、不排期；词汇输入隐藏原文和目标词，独立才按既有输入规则排期，回看/提示为辅助。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：题目绑定故事版本，首次结果及回看帮助持久保存；即时正确不算延迟保持，也不把阅读次数计作词卡完成。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：缺检查题的旧故事仍可读，少题/空题明确；删除、版本变化、失效和网络失败可返回原文或恢复确认。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：读后题事件、上下文和版本关联进 V3；恢复后继续，选择题成功不能变成新的 FSRS 自评。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

隐藏读后入口并保留历史结果、版本、确认和恢复适配，原文继续可读。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el13_story_reading_check.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/services/story_checks.py app/services/practice.py app/services/questions.py app/services/statistics.py app/routers/stories.py frontend/src/views/StoriesPage.jsx frontend/src/views/PracticePage.jsx app/schemas/backup_v3.py tests/test_el13_story_reading_check.py e2e/el-13.spec.mjs e2e/spec-coverage.mjs docs/adr/0006-practice-context-and-course-progress.md docs/adr/0007-bounded-learning-content.md README.md
git diff --cached --check
git commit -m "test: qualify el-13 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC17、AC18、AC19、AC35、AC36、AC37、AC39。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
