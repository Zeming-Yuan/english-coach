# EL-12 把故事变简单，同时保留原版与各自结果 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者觉得故事太难时可得到独立的更简单版本，并能切回原版；两版内容和成绩不会串用。

**Architecture:** POST /api/stories/{story_id}/simplify {operation_id,version_id} -> StoryVersion；story_profile 增加 short={20,40,8,2}；GET故事版本必须保留原version_id与题材料，结果通过version_id隔离。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-12](../../tickets/evidence-based-personalized-learning/12-simpler-story-version.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-11。

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

- RF1：原标准版本不被覆盖；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：更短模式保留未知词上限；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：重复操作只得到同一版本；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：切换版本后晚到响应不能夺取当前选择；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：旧成绩不能迁移给简化版本；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责


- Modify: `app/services/story_quality.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/story_generator.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/stories.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/StoriesPage.jsx`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el12_simpler_story_version.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-12.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0007-bounded-learning-content.md`：ADR-0007增补标准/简化版本关系；README加入版本切换与历史成绩边界。
- `README.md`：ADR-0007增补标准/简化版本关系；README加入版本切换与历史成绩边界。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/services/story_quality.py`
- `app/services/story_generator.py`
- `app/routers/stories.py`
- `frontend/src/views/StoriesPage.jsx`
- `tests/test_el12_simpler_story_version.py`
- `e2e/el-12.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-11及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 story_profile（见Task 1完整签名与实现片段）；POST /api/stories/{story_id}/simplify {operation_id,version_id} -> StoryVersion；story_profile 增加 short={20,40,8,2}；GET故事版本必须保留原version_id与题材料，结果通过version_id隔离。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el12_short_profile_is_not_normal_profile():
    from app.services.story_quality import story_profile
    profile = story_profile("short")
    assert profile == {"min_words": 20, "max_words": 40, "max_sentence": 8, "max_unknown": 2}
```

写入`tests/test_el12_simpler_story_version.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el12_simpler_story_version.py::test_el12_short_profile_is_not_normal_profile -q
```

**预期失败原因：** EL-11只有标准版本，简化API尚不存在；旧实现也不会保留独立简化结果。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/story_quality.py`；story_profile的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def story_profile(mode: str) -> dict:
    profiles = {
        "normal": {"min_words": 40, "max_words": 70, "max_sentence": 12, "max_unknown": 2},
        "short": {"min_words": 20, "max_words": 40, "max_sentence": 8, "max_unknown": 2},
    }
    if mode not in profiles:
        raise ValueError("unsupported story mode")
    return profiles[mode].copy()
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：给既有story_profile加入short模式并复用全部结构/词形校验，不能让简化绕过目标词和中英要求。
- [ ] 4.2：简化路由使用原version_id+operation_id，复核原版本尚存在；新版本parent关联原版，不UPDATE原正文。
- [ ] 4.3：阅读页以version_id作为异步请求归属，按钮“更简单”与“查看原版”切换；显示真实版本接触并保留各自成绩。
- [ ] 4.4：V3恢复与重复操作测试包含parent版本图、删除和断连，非法父关联在预览前拒绝。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

Create: e2e/fixtures/el12-story-version.json。这是准备内容版本的夹具，不伪造成功作答；恢复/生成/判分仍走真实接口。字段由EL-01/11已定义：

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

test("EL-12 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-story-version.json"});
  await page.goto(app.baseURL);
  await page.getByText("故事", {exact: true}).click();
  await page.getByText("Apple Story", {exact: true}).click();
  await page.getByRole("button", {name: "更简单", exact: true}).click();
  await expect(page.getByTestId("story-version")).toContainText("版本");
});
```

故事版本结果元素同时提供data-version-id；用户显式切换版本递增请求sequence，晚到回包只有sequence与来源版本都仍匹配才更新。

精确testid属于本票要交付的可访问结果区：`story-version`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

ADR-0007增补标准/简化版本关系；README加入版本切换与历史成绩边界。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el12_simpler_story_version.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/services/story_quality.py app/services/story_generator.py app/routers/stories.py frontend/src/views/StoriesPage.jsx tests/test_el12_simpler_story_version.py e2e/el-12.spec.mjs e2e/spec-coverage.mjs docs/adr/0007-bounded-learning-content.md README.md
git diff --cached --check
git commit -m "feat: deliver el-12 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el12_simpler_story_version.py`、`e2e/el-12.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、story_profile及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.story_quality import story_profile

@pytest.mark.parametrize("arguments, expected", [
    (["normal"], {"min_words": 40, "max_words": 70, "max_sentence": 12, "max_unknown": 2}),
    (["short"], {"min_words": 20, "max_words": 40, "max_sentence": 8, "max_unknown": 2}),
])
def test_el12_review_focus(arguments, expected):
    assert story_profile(*arguments) == expected
```

```python
def test_el12_profiles_are_independent():
    from app.services.story_quality import story_profile
    normal = story_profile("normal")
    short = story_profile("short")
    short["max_words"] = 1
    assert story_profile("normal")["max_words"] == 70
    assert normal["max_words"] == 70

def test_el12_unknown_mode_is_explicit():
    import pytest
    from app.services.story_quality import story_profile
    with pytest.raises(ValueError, match="unsupported"):
        story_profile("free")
```

在`tests/test_el12_simpler_story_version.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-12.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

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

def prepare_el12_request(ec):
    from tests.support.llm_queue import QueuedLLM
    seed_known_target(ec)
    ec.app.state.llm_client = QueuedLLM([{"title": "Apple", "sentences": [{"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}, {"en": "An apple is on the small table near my book.", "cn": "一个苹果在我的书旁边的小桌子上。"}], "targets": ["apple"], "check": {"question": "What is on the table", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, {"title": "Apple", "sentences": [{"en": "An apple is on my book.", "cn": "一个苹果在我的书上。"}, {"en": "An apple is on my book.", "cn": "一个苹果在我的书上。"}, {"en": "An apple is on my book.", "cn": "一个苹果在我的书上。"}], "targets": ["apple"], "check": {"question": "What is on my book", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}, {"title": "Apple", "sentences": [{"en": "An apple is on my book.", "cn": "一个苹果在我的书上。"}, {"en": "An apple is on my book.", "cn": "一个苹果在我的书上。"}, {"en": "An apple is on my book.", "cn": "一个苹果在我的书上。"}], "targets": ["apple"], "check": {"question": "What is on my book", "options": ["apple", "book", "water"], "expected": "apple", "evidence_index": 0}}])
    original = ec.client.post("/api/stories/generate", json={"operation_id": str(uuid4()), "include_new_target": False}).json()
    return "POST", f"/api/stories/{original['id']}/simplify", {"operation_id": str(uuid4()), "version_id": original["version_id"]}

def test_el12_commit_failure_and_retry(ec):
    method, path, payload = prepare_el12_request(ec)
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
test("EL-12 a late simplification cannot replace selected original", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "el12-story-version.json"});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/stories/1/simplify", async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({response});
  }, {times: 1});
  await page.goto(app.baseURL);
  await page.getByText("故事", {exact: true}).click();
  await page.getByText("Apple Story", {exact: true}).click();
  const version = page.getByTestId("story-version");
  const original = await version.getAttribute("data-version-id");
  try {
    await page.getByRole("button", {name: "更简单", exact: true}).click();
    await page.getByRole("button", {name: "查看原版", exact: true}).click();
  } finally {
    release();
  }
  await expect(version).toHaveAttribute("data-version-id", original);
});
```

- [ ] **Step 3：逐项完成本票特有边界。**

- [ ] 3.1：显式“更简单”生成 20–40 词、句长最多八词、未覆盖词形最多两个的新版本，并沿用目标/中英/理解题校验。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：原版保留，版本切换明确；版本关联、理解题材料与操作身份进 V3，恢复后仍可区分。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：原文展示按当前版本记录接触，旧成绩不得转给新版本；没有成绩时如实显示未检查。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：重复确认、生成失败或后台晚到不产生重复版本，也不替换用户已选择的另一个版本。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

隐藏简化按钮，已生成版本仍可只读/导出，不删除原版或重新映射成绩。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el12_simpler_story_version.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/services/story_quality.py app/services/story_generator.py app/routers/stories.py frontend/src/views/StoriesPage.jsx tests/test_el12_simpler_story_version.py e2e/el-12.spec.mjs e2e/spec-coverage.mjs docs/adr/0007-bounded-learning-content.md README.md
git diff --cached --check
git commit -m "test: qualify el-12 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC16、AC18、AC19、AC36、AC39。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
