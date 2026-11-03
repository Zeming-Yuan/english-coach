# EL-11 根据已有学习依据生成难度受控的短故事 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者生成的故事主要复用已有回忆依据的词，能看到新词说明；词汇不足或生成不合格时有入门材料或明确结果。

**Architecture:** POST /api/stories/generate 可接 {operation_id,include_new_target:false}；响应追加 content_revision/version_id/quality/check_material。validate_story(data:dict,known:set[str],support:set[str],mode:str)->list[str]；story_profile(mode:str)->dict。EL-11只启用normal；short由EL-12加入。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-11](../../tickets/evidence-based-personalized-learning/11-bounded-personalized-story.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-02、EL-06。

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

- RF1：完整合格材料才能发布；由Task 2的validate_story参数用例验证。
- RF2：不足40词不能冒充标准故事；由Task 2的validate_story参数用例验证。
- RF3：中文缺失不留下半篇；由Task 2的validate_story参数用例验证。
- RF4：目标词未出现不能成题；由Task 2的validate_story参数用例验证。
- RF5：超过两个未知词形不能靠prompt放行；由Task 2的validate_story参数用例验证。

---

## 文件结构与职责

- Create: `app/services/story_quality.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/data/support_words.json`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/models/story_version.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `alembic/versions/el11_story_versions.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/services/story_generator.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/stories.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/StoriesPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup_v3.py`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el11_bounded_personalized_story.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-11.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0007-bounded-learning-content.md`：新增 docs/adr/0007-bounded-learning-content.md，记录词形而非理解保证、核对材料及生成事务；README说明入门兜底与不自动加词。
- `README.md`：新增 docs/adr/0007-bounded-learning-content.md，记录词形而非理解保证、核对材料及生成事务；README说明入门兜底与不自动加词。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/services/story_quality.py`
- `app/data/support_words.json`
- `app/models/story_version.py`
- `alembic/versions/el11_story_versions.py`
- `app/services/story_generator.py`
- `app/routers/stories.py`
- `frontend/src/views/StoriesPage.jsx`
- `app/schemas/backup_v3.py`
- `tests/test_el11_bounded_personalized_story.py`
- `e2e/el-11.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-02、EL-06及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 validate_story（见Task 1完整签名与实现片段）；POST /api/stories/generate 可接 {operation_id,include_new_target:false}；响应追加 content_revision/version_id/quality/check_material。validate_story(data:dict,known:set[str],support:set[str],mode:str)->list[str]；story_profile(mode:str)->dict。EL-11只启用normal；short由EL-12加入。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el11_insufficient_vocabulary_is_explained(ec):
    response = ec.client.post("/api/stories/generate", json={
        "operation_id": str(uuid4()), "include_new_target": False
    })
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "starter"
    assert data["quality"]["known_basis"] == "insufficient"
    assert ec.client.get("/api/cards").json()["cards"] == []
```

写入`tests/test_el11_bounded_personalized_story.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el11_bounded_personalized_story.py::test_el11_insufficient_vocabulary_is_explained -q
```

**预期失败原因：** 现有故事从未复习新词生成，无词形约束；词汇不足时不会返回明确的入门材料入口。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/story_quality.py`；story_profile的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
import re

def story_profile(mode: str) -> dict:
    if mode != "normal":
        raise ValueError("unsupported story mode")
    return {"min_words": 40, "max_words": 70, "max_sentence": 12, "max_unknown": 2}

def validate_story(data: dict, known: set[str], support: set[str], mode: str) -> list[str]:
    profile = story_profile(mode)
    if not isinstance(data, dict):
        return ["structure"]
    rows = data.get("sentences", [])
    check_value = data.get("check", {})
    if (not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
            or not isinstance(check_value, dict)
            or not isinstance(data.get("targets", []), list)
            or any(not isinstance(target, str) for target in data.get("targets", []))
            or not isinstance(data.get("title", ""), str)
            or not isinstance(check_value.get("question", ""), str)
            or not isinstance(check_value.get("options", []), list)
            or any(not isinstance(option, str) for option in check_value.get("options", []))
            or any(not isinstance(row.get("en", ""), str) or not isinstance(row.get("cn", ""), str) for row in rows)):
        return ["structure"]
    tokens = lambda text: re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())
    body = [word for row in rows for word in tokens(row.get("en", ""))]
    check = data.get("check", {})
    errors = []
    if not profile["min_words"] <= len(body) <= profile["max_words"]:
        errors.append("length")
    if any(len(tokens(row.get("en", ""))) > profile["max_sentence"] for row in rows):
        errors.append("sentence")
    if not rows or any(not row.get("en") or not row.get("cn") for row in rows):
        errors.append("translation")
    if any(target.lower() not in body for target in data.get("targets", [])):
        errors.append("target")
    texts = [data.get("title", ""), check.get("question", ""), *check.get("options", [])]
    all_words = set(body) | {word for text in texts for word in tokens(text)}
    if len(all_words - set(known) - set(support)) > profile["max_unknown"]:
        errors.append("unknown")
    index = check.get("evidence_index", -1)
    expected = check.get("expected")
    options = check.get("options", [])
    if (len(options) != 3 or len(set(options)) != 3 or expected not in options
            or type(index) is not int or not 0 <= index < len(rows)
            or not isinstance(expected, str)
            or expected.lower() not in tokens(rows[index]["en"])):
        errors.append("question")
    return errors
```

- [ ] **Step 4：接通持久化与公开边界。**

app/data/support_words.json 的首版最小内容如下；它是允许的支撑材料，不计作个人掌握，交付前需登记内容核对版本。

```json
{
  "version": "1",
  "words": [
    "an",
    "is",
    "on",
    "the",
    "small",
    "table",
    "near",
    "my",
    "book",
    "what",
    "water"
  ]
}
```


- [ ] 4.1：StoryVersion保存原故事关联、身份/版本、目标词、逐句中英和理解题材料；现有Story继续可读，旧内容不自动获得新题。
- [ ] 4.2：随应用分发核对过的support_words与短入门故事；不足依据直接返回starter材料且不加词。已知候选从EL-02有效证据读取。
- [ ] 4.3：实现validate_story：词形regex保留词内撇号，不隐式词形还原；检查正文词数、每句长度、标题/题干/选项覆盖、目标出现、中英配对和唯一证据句。
- [ ] 4.4：使用现有generate_json/模型路由；校验失败最多修正1次，仍错返回可解释失败；LLM锁外调用，落库时复核操作ID与内容身份。
- [ ] 4.5：新增V3版本/题材料与目标图映射；阅读UI展示词形覆盖、新词同意、starter或已存版本，后台晚到不能改当前选择。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-11 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByText("故事", {exact: true}).click();
  await page.getByRole("button", {name: "生成新故事", exact: true}).click();
  await expect(page.getByTestId("story-quality")).toContainText("词形覆盖");
});
```

精确testid属于本票要交付的可访问结果区：`story-quality`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

新增 docs/adr/0007-bounded-learning-content.md，记录词形而非理解保证、核对材料及生成事务；README说明入门兜底与不自动加词。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el11_bounded_personalized_story.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/services/story_quality.py app/data/support_words.json app/models/story_version.py alembic/versions/el11_story_versions.py app/services/story_generator.py app/routers/stories.py frontend/src/views/StoriesPage.jsx app/schemas/backup_v3.py tests/test_el11_bounded_personalized_story.py e2e/el-11.spec.mjs e2e/spec-coverage.mjs docs/adr/0007-bounded-learning-content.md README.md
git diff --cached --check
git commit -m "feat: deliver el-11 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el11_bounded_personalized_story.py`、`e2e/el-11.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、story_profile及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.story_quality import validate_story

@pytest.mark.parametrize("arguments, expected", [
    ([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, ["apple"], ["an", "is", "on", "the", "small", "table", "near", "my", "book", "what", "water"], "normal"], []),
    ([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, ["apple"], ["an", "is", "on", "the", "small", "table", "near", "my", "book", "what", "water"], "normal"], ["length"]),
    ([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": ""}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, ["apple"], ["an", "is", "on", "the", "small", "table", "near", "my", "book", "what", "water"], "normal"], ["translation"]),
    ([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["pear"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, ["apple"], ["an", "is", "on", "the", "small", "table", "near", "my", "book", "what", "water"], "normal"], ["target"]),
    ([{"title": "Apple", "sentences": [{"en": "An apple is on the galaxy nebula comet my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, ["apple"], ["an", "is", "on", "the", "small", "table", "near", "my", "book", "what", "water"], "normal"], ["unknown"]),
])
def test_el11_review_focus(arguments, expected):
    assert validate_story(*arguments) == expected
```

在`tests/test_el11_bounded_personalized_story.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-11.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

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

def prepare_el11_request(ec):
    from tests.support.llm_queue import QueuedLLM
    seed_known_target(ec)
    ec.app.state.llm_client = QueuedLLM([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, {"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}])
    return "POST", "/api/stories/generate", {"operation_id": str(uuid4()), "include_new_target": False}

def test_el11_commit_failure_and_retry(ec):
    method, path, payload = prepare_el11_request(ec)
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

- [ ] 3.1：以当前有效回忆依据和有版本的基础支撑词表选材，目标一至三个已知依据词，可经显式同意加入零至一个新目标；不以自评或无记录词冒充已知。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：默认正文 40–70 词、每句最多十二词、未覆盖词形最多两个；标题/正文/题干/选项进行词形覆盖及句长检查，目标必须出现，中英成对。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：创建后端可检查的理解题材料：证据句、唯一答案、三选项和固定上下文。当前票可保存这些已校验材料，读后作答入口由后续票交付。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：最多修正重试一次；仍不合法、无 AI 或失败则保留旧内容，不半写故事或自动加入新词。词汇不足提供核对过的入门材料或明确空态。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：故事与题目材料具备版本身份，旧故事继续可读，新关联/操作身份完整进 V3；晚到响应不能覆盖当前选择。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

关闭新生成入口，已有新旧故事按版本只读保留；已有学习证据、题目材料和备份支持继续可读。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el11_bounded_personalized_story.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/services/story_quality.py app/data/support_words.json app/models/story_version.py alembic/versions/el11_story_versions.py app/services/story_generator.py app/routers/stories.py frontend/src/views/StoriesPage.jsx app/schemas/backup_v3.py tests/test_el11_bounded_personalized_story.py e2e/el-11.spec.mjs e2e/spec-coverage.mjs docs/adr/0007-bounded-learning-content.md README.md
git diff --cached --check
git commit -m "test: qualify el-11 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC14、AC15、AC18、AC19、AC35、AC36、AC37。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
