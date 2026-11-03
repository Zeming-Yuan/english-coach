# EL-01 Expand：编辑词卡后仍能完整备份与恢复内容修订 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者修改词形或释义后能核对内容修订，并从设置导出 V3 完整备份、恢复到另一实例继续使用；已有 V1/V2 文件仍有明确的恢复预览。

**Architecture:** get_content_revision(db: Session, resource_kind: str, resource_id: int) -> dict；advance_content_revision(db: Session, resource_kind: str, resource_id: int, changes: dict) -> dict。返回 identity(UUID字符串)、version(整数)。GET /api/cards/{id} 增加 content_revision；V3 使用 features 与 extensions 显式登记集合，未知功能拒绝恢复。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-01](../../tickets/evidence-based-personalized-learning/01-expand-revisions-and-v3.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** None。

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

- RF1：相同释义保存保持同一修订；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：词义变化增加修订；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：词形改变不复用旧修订；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：记忆法变化不使词义证据失效；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：例句语义变化使旧题上下文失效；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/models/content_revision.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/services/content_revisions.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/schemas/backup_v3.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `alembic/versions/el01_content_revisions.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `tests/support/llm_queue.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/models/__init__.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/backup.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/services/restore.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/cards.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/WordsPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/BackupPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `e2e/support/server.py`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el01_expand_revisions_and_v3.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-01.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0004-content-revisions-and-v3.md`：新增 docs/adr/0004-content-revisions-and-v3.md，明确 V3 加法扩展、旧格式缺失及修订身份；更新 README 的完整备份版本。
- `README.md`：新增 docs/adr/0004-content-revisions-and-v3.md，明确 V3 加法扩展、旧格式缺失及修订身份；更新 README 的完整备份版本。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/models/content_revision.py`
- `app/services/content_revisions.py`
- `app/schemas/backup_v3.py`
- `alembic/versions/el01_content_revisions.py`
- `tests/support/llm_queue.py`
- `app/models/__init__.py`
- `app/services/backup.py`
- `app/services/restore.py`
- `app/schemas/backup.py`
- `app/routers/cards.py`
- `frontend/src/views/WordsPage.jsx`
- `frontend/src/views/BackupPage.jsx`
- `e2e/support/server.py`
- `tests/test_el01_expand_revisions_and_v3.py`
- `e2e/el-01.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 当前仓库既有公开接口；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 next_revision（见Task 1完整签名与实现片段）；get_content_revision(db: Session, resource_kind: str, resource_id: int) -> dict；advance_content_revision(db: Session, resource_kind: str, resource_id: int, changes: dict) -> dict。返回 identity(UUID字符串)、version(整数)。GET /api/cards/{id} 增加 content_revision；V3 使用 features 与 extensions 显式登记集合，未知功能拒绝恢复。

- [ ] **Step 1：写第一条失败测试。**

```python
from uuid import uuid4

def test_el01_edit_and_v3_contract(ec):
    card_id = ec.seed_card()
    before = ec.client.get(f"/api/cards/{card_id}").json()
    response = ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"})
    assert response.status_code == 200
    after = response.json()
    assert after["content_revision"]["version"] == before["content_revision"]["version"] + 1
    backup = ec.client.get("/api/export/backup").json()
    assert backup["version"] == 3
    assert "content_revisions" in backup["extensions"]
```

写入`tests/test_el01_expand_revisions_and_v3.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el01_expand_revisions_and_v3.py::test_el01_edit_and_v3_contract -q
```

**预期失败原因：** 现有详情没有 content_revision，完整备份仍为 version=2；不是测试环境导入错误。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/content_revisions.py`；next_revision的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def semantic_value(value):
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, list):
        return [semantic_value(item) for item in value]
    if isinstance(value, dict):
        return {key: semantic_value(item) for key, item in value.items()}
    return value

def next_revision(before: dict, changes: dict, current: int) -> int:
    semantic = {"word", "meaning", "example", "example_cn", "contexts"}
    changed = any(
        key in semantic and semantic_value(before.get(key)) != semantic_value(value)
        for key, value in changes.items()
    )
    return current + int(changed)
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：扩展 tests/support/ec_env.py 的 seed_card 和 e2e/support/fixture_loader.py 的内容准备，使测试夹具也初始化当前修订；初始化函数 ensure_content_revisions(db: Session)->None 在content_revisions模块定义，仅补缺失实体身份，不造学习事件。创建 ContentRevision 的 identity、resource_kind、resource_id、version，唯一约束(resource_kind,resource_id)，存活实体身份不可在恢复后误用；迁移旧实体只建当前未知基线，不填事件历史。
- [ ] 4.2：修改卡片更新路径，在同一个写事务中更新内容和修订；新增详情 revision 响应。为后续新事件预留可空的 card_identity/card_revision，不给旧行填假修订。
- [ ] 4.3：在 backup_v3 与恢复协调器中实现 typed extensions 注册表：每个集合声明 schema、父引用、导出顺序、ID重映射与完整性校验；先只登记 content_revisions。V3 features 必须与集合声明一致，后续票增量登记。
- [ ] 4.4：V2 validator 保持原字段协议，V3 单独扩展；V1部分恢复与V2全量恢复补缺失新集合预览，保持安全副本、expected_revision 和原子替换。
- [ ] 4.5：词卡详情展示内容修订，备份页展示格式版本/缺失影响；添加实际 V3 下载→第二实例恢复→编辑/评分续用的浏览器分支。
- [ ] 4.6：在tests/support/llm_queue.py提供QueuedLLM成功/超时/无效响应替身，e2e支持fixture的llm_responses数组；只替换app.state.llm_client，用于恢复期间旧后台生成晚到的真实边界，后续票直接复用。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-01 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: "apple", meaning: "苹果"}]);
  await page.goto(app.baseURL);
  await page.getByText("单词本", {exact: true}).click();
  await page.getByText("apple", {exact: true}).first().click();
  await expect(page.getByTestId("revision-panel")).toContainText("内容修订");
});
```

精确testid属于本票要交付的可访问结果区：`revision-panel`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

新增 docs/adr/0004-content-revisions-and-v3.md，明确 V3 加法扩展、旧格式缺失及修订身份；更新 README 的完整备份版本。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el01_expand_revisions_and_v3.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- tests/support/ec_env.py e2e/support/fixture_loader.py app/models/content_revision.py app/services/content_revisions.py app/schemas/backup_v3.py alembic/versions/el01_content_revisions.py tests/support/llm_queue.py app/models/__init__.py app/services/backup.py app/services/restore.py app/schemas/backup.py app/routers/cards.py frontend/src/views/WordsPage.jsx frontend/src/views/BackupPage.jsx e2e/support/server.py tests/test_el01_expand_revisions_and_v3.py e2e/el-01.spec.mjs e2e/spec-coverage.mjs docs/adr/0004-content-revisions-and-v3.md README.md
git diff --cached --check
git commit -m "feat: deliver el-01 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el01_expand_revisions_and_v3.py`、`e2e/el-01.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、next_revision及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.content_revisions import next_revision

@pytest.mark.parametrize("arguments, expected", [
    ([{"meaning": "苹果"}, {"meaning": "苹果"}, 1], 1),
    ([{"meaning": "苹果"}, {"meaning": "一个苹果"}, 1], 2),
    ([{"word": "apple"}, {"word": "pear"}, 4], 5),
    ([{"meaning": "苹果"}, {"memo": "红色"}, 3], 3),
    ([{"example": "A"}, {"example": "B"}, 8], 9),
    ([{"example": "A small apple."}, {"example": " A  small\n apple. "}, 8], 8),
    ([{"contexts": [{"en": "An apple"}]}, {"contexts": [{"en": "An  apple "}]}, 8], 8),
])
def test_el01_review_focus(arguments, expected):
    assert next_revision(*arguments) == expected
```

在`tests/test_el01_expand_revisions_and_v3.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-01.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el01_request(ec):
    card_id = ec.seed_card()
    return "PUT", f"/api/cards/{card_id}", {"meaning": "一个苹果"}

def test_el01_commit_failure_and_retry(ec):
    method, path, payload = prepare_el01_request(ec)
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

为恢复期间的旧后台请求提供测试用外部成功替身，文件 tests/support/llm_queue.py：

```python
import json
from types import SimpleNamespace

class QueuedLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        if not self.responses:
            raise RuntimeError("external fixture exhausted")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(choices=[
            SimpleNamespace(message=SimpleNamespace(content=json.dumps(item)))
        ])
```

e2e/support/server.py只在fixture有llm_responses时绑定QueuedLLM；外部fixture耗尽必须显式失败，不能回落到真实网络。fixture_loader继续只载入tables；不新增生产调试端点。

- [ ] 3.1：加法引入内容修订身份及可扩展的新业务集合登记约定；词形/释义实质变化增加修订，仅改排版或记忆法不增加。旧历史保留为依据不足，升级不生成旧成绩。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：当前阶段已有数据可经 V3 下载、预览、原子恢复；新单元后续引入的每个集合必须在该单元同步登记导出、验证、映射和恢复，不得推迟到最终票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：V2 恢复预览明确提示缺少新记录及替换影响；V1 仍按部分恢复处理。执行先生成 V3 安全副本，非法图、保存副本失败、修订冲突或提交失败保留原数据。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：恢复后 ID 映射、原提交确认、签名失效和浏览器缓存清理具有明确结果；恢复前后台结果不能覆盖恢复后实体。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：用空库和代表性旧库走真实向前迁移，保留词卡、排期、事件、基线、课程与故事；新增接口与旧字段并存，记录 ADR-0003 的 V3 扩展。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

关闭新增修订展示或新版编辑入口，保留已落地的修订、V3 导出/恢复和兼容读取。回退应用时保留能理解新格式的数据适配；不降级删除列/记录，不把旧库覆盖到已有新学习的实例。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el01_expand_revisions_and_v3.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- tests/support/ec_env.py e2e/support/fixture_loader.py app/models/content_revision.py app/services/content_revisions.py app/schemas/backup_v3.py alembic/versions/el01_content_revisions.py tests/support/llm_queue.py app/models/__init__.py app/services/backup.py app/services/restore.py app/schemas/backup.py app/routers/cards.py frontend/src/views/WordsPage.jsx frontend/src/views/BackupPage.jsx e2e/support/server.py tests/test_el01_expand_revisions_and_v3.py e2e/el-01.spec.mjs e2e/spec-coverage.mjs docs/adr/0004-content-revisions-and-v3.md README.md
git diff --cached --check
git commit -m "test: qualify el-01 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC07、AC38、AC39、AC40、AC41、AC42。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
