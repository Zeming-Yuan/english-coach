# EL-07 课程有明确目标，生成、浏览和待检查分别记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学习者生成课程后看到本课目标和待学习状态，明确标记看完后成为已浏览，也可稍后检查并继续生成下一课。

**Architecture:** POST /api/lessons/{level}/viewed {submission_id,revision} -> {committed,learning_progress}；GET课程返回 goal 和 learning_progress:{status,browsed_at,checked_count,passed_count}。lesson_status(generated,browsed,checked,passed)->str；生成可选稳定 operation_id，原无body调用继续兼容。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-07](../../tickets/evidence-based-personalized-learning/07-lesson-goals-and-progress.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-06。

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

- RF1：没有内容不生成虚假状态；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：仅生成不等于学习；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：显式看完才已浏览；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：有错误不能通过；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：全题通过也仅证明所测内容；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `app/models/lesson_progress.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `app/services/lesson_progress.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `alembic/versions/el07_lesson_progress.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `app/services/lesson_generator.py`，仅接入本票公开行为和兼容处理。
- Modify: `app/routers/lessons.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/views/LessonsPage.jsx`，仅接入本票公开行为和兼容处理。
- Modify: `app/schemas/backup_v3.py`，仅接入本票公开行为和兼容处理。
- Modify: `frontend/src/App.jsx`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el07_lesson_goals_and_progress.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-07.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/adr/0006-practice-context-and-course-progress.md`：新增 docs/adr/0006-practice-context-and-course-progress.md 的课程生成/浏览语义；更新README课程进度说明。
- `README.md`：新增 docs/adr/0006-practice-context-and-course-progress.md 的课程生成/浏览语义；更新README课程进度说明。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `app/models/lesson_progress.py`
- `app/services/lesson_progress.py`
- `alembic/versions/el07_lesson_progress.py`
- `app/services/lesson_generator.py`
- `app/routers/lessons.py`
- `frontend/src/views/LessonsPage.jsx`
- `app/schemas/backup_v3.py`
- `frontend/src/App.jsx`
- `tests/test_el07_lesson_goals_and_progress.py`
- `e2e/el-07.spec.mjs`
- `e2e/spec-coverage.mjs`

**Interfaces:**
- Consumes: 前置EL-06及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 lesson_status（见Task 1完整签名与实现片段）；POST /api/lessons/{level}/viewed {submission_id,revision} -> {committed,learning_progress}；GET课程返回 goal 和 learning_progress:{status,browsed_at,checked_count,passed_count}。lesson_status(generated,browsed,checked,passed)->str；生成可选稳定 operation_id，原无body调用继续兼容。

- [ ] **Step 1：写第一条失败测试。**

```python
from app.models.lesson import Lesson

def test_el07_generation_is_not_course_completion(ec):
    with ec.SessionLocal() as db:
        db.add(Lesson(level=1, title="问候", content={"words": [], "dialogue": [], "tips": []}))
        db.commit()
    course = ec.client.get("/api/lessons/1").json()
    assert course["learning_progress"]["status"] == "unrecorded"
    assert course["learning_progress"]["passed_count"] == 0
```

写入`tests/test_el07_lesson_goals_and_progress.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el07_lesson_goals_and_progress.py::test_el07_generation_is_not_course_completion -q
```

**预期失败原因：** 现有课程详情没有 learning_progress，生成数量直接显示已完成；浏览确认端点不存在。
若先出现依赖、导入或fixture准备错误，先修到断言能执行；那种准备失败不是目标红灯。

- [ ] **Step 3：实现最小规则核心。**

位置：`app/services/lesson_progress.py`；lesson_status的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```python
def lesson_status(generated: bool, browsed: bool, checked: int, passed: int) -> str:
    if not generated:
        return "unavailable"
    if checked > 0:
        return "passed" if passed == checked else "weak"
    return "browsed" if browsed else "unrecorded"
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：持久化每课浏览确认身份/修订/时间，目标由版本化的主题说明提供；缺目标旧课使用主题说明，不依赖AI补目标。
- [ ] 4.2：把generate_lesson的两次commit改为调用方写模块的单一原子写入：LLM与校验在锁外，落库时复核下一level、去重词与operation_id；并发冲突返回409。
- [ ] 4.3：生成结构先校验唯一词、必填释义/例句/翻译与中英对话；不合法返回可解释失败且不消费级别。
- [ ] 4.4：课程列表拆生成/浏览/短测计数，新增“内容已看完”和“稍后检查，继续下一课”，此票尚无短测时显示待检查。
- [ ] 4.5：V3登记lesson_progress，旧文件预览说明缺失，浏览确认失败/回放可恢复。
- [ ] 4.6：在现有首页课程入口按钮添加data-testid="open-lessons"，仍由用户点击展开“专项练习”后进入；供EL-08复用，不增加生产调试入口。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-07 visible vertical result", async ({appFactory, page}) => {
  const app = await appFactory({fixture: "ec04-lesson.json"});
  await page.goto(app.baseURL);
  await page.locator("summary").filter({hasText: "专项练习"}).click();
  await page.getByTestId("open-lessons").click();
  await expect(page.getByTestId("lesson-progress")).toContainText("待检查");
});
```

精确testid属于本票要交付的可访问结果区：`lesson-progress`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

新增 docs/adr/0006-practice-context-and-course-progress.md 的课程生成/浏览语义；更新README课程进度说明。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el07_lesson_goals_and_progress.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- app/models/lesson_progress.py app/services/lesson_progress.py alembic/versions/el07_lesson_progress.py app/services/lesson_generator.py app/routers/lessons.py frontend/src/views/LessonsPage.jsx app/schemas/backup_v3.py frontend/src/App.jsx tests/test_el07_lesson_goals_and_progress.py e2e/el-07.spec.mjs e2e/spec-coverage.mjs docs/adr/0006-practice-context-and-course-progress.md README.md
git diff --cached --check
git commit -m "feat: deliver el-07 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el07_lesson_goals_and_progress.py`、`e2e/el-07.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、lesson_status及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import pytest
from app.services.lesson_progress import lesson_status

@pytest.mark.parametrize("arguments, expected", [
    ([False, False, 0, 0], "unavailable"),
    ([True, False, 0, 0], "unrecorded"),
    ([True, True, 0, 0], "browsed"),
    ([True, True, 3, 2], "weak"),
    ([True, True, 3, 3], "passed"),
])
def test_el07_review_focus(arguments, expected):
    assert lesson_status(*arguments) == expected
```

在`tests/test_el07_lesson_goals_and_progress.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-07.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4

def seeded_lesson(ec):
    from app.models.lesson import Lesson
    from app.services.content_revisions import ensure_content_revisions
    card_id = ec.seed_card()
    with ec.SessionLocal() as db:
        lesson = Lesson(level=1, title="水果", content={
            "words": [{"word": "apple", "meaning": "苹果"}],
            "dialogue": [], "tips": []
        })
        db.add(lesson)
        db.flush()
        ensure_content_revisions(db)
        db.commit()
        return lesson.id

def prepare_el07_request(ec):
    seeded_lesson(ec)
    revision = ec.client.get("/api/lessons/1").json()["content_revision"]
    return "POST", "/api/lessons/1/viewed", {"submission_id": str(uuid4()), "revision": revision}

def test_el07_commit_failure_and_retry(ec):
    method, path, payload = prepare_el07_request(ec)
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

- [ ] 3.1：新增显式课程浏览记录和用户可理解目标，生成、打开、浏览完成与待检查含义分开；旧课程标为已有内容/状态未记录。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：课程生成校验唯一词、释义、例句翻译与对话配对，课程与新增词卡原子保存；非法内容、写入失败或重复确认不留下半课或跳级。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：列表分别展示生成/浏览数量，生成二十课不再显示已学完；尚无短测时明确待检查，不伪造通过。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：浏览确认和继续下一课有保存确认/重复请求边界；课程状态、操作身份及新增关联随 V3 恢复。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：生成上限与旧兼容字段继续说明生成进度，记录新增状态的领域决策，不将旧级别反推学习结果。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

保留生成、浏览和操作记录，关闭新的确认入口时展示已有内容与真实状态；不恢复生成即完成的文案。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el07_lesson_goals_and_progress.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- app/models/lesson_progress.py app/services/lesson_progress.py alembic/versions/el07_lesson_progress.py app/services/lesson_generator.py app/routers/lessons.py frontend/src/views/LessonsPage.jsx app/schemas/backup_v3.py frontend/src/App.jsx tests/test_el07_lesson_goals_and_progress.py e2e/el-07.spec.mjs e2e/spec-coverage.mjs docs/adr/0006-practice-context-and-course-progress.md README.md
git diff --cached --check
git commit -m "test: qualify el-07 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC08、AC09、AC11、AC13、AC35、AC36、AC37。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
