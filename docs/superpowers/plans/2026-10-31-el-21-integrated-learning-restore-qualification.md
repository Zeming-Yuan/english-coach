# EL-21 完整演练六项学习、换设备恢复与继续学习 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 维护者能从新安装和旧库升级演示六项学习路径，导出后在另一实例恢复课测、回测、场景与估算依据，并继续真实学习。

**Architecture:** 完整覆盖要求新增命名空间 EL-JOURNEY（与旧T01–T21不冲突），至少包含新装学习、旧库升级、V3换设备续学和故障恢复四个具名真实用例；不建立生产资格查询API。 保留既有统一学习写事务与真实应用验收；本票只完成自身及前置已具备的行为，不把未来票当作隐含依赖。

**Tech Stack:** Python/FastAPI、SQLAlchemy 2/SQLite、Alembic、py-fsrs；React 19/Vite；pytest 与 Playwright。沿用现有依赖，不引入新的UI或任务框架。

**Spec:** [六项总规格](../../specs/evidence-based-personalized-learning.md)；[已确认EL-21](../../tickets/evidence-based-personalized-learning/21-integrated-learning-restore-qualification.md)。执行者同时读取规格、本票与本计划。

**Shared Interfaces:** [跨票接口归属](2026-10-31-learning-evidence-contracts.md)。只消费本票的传递前置或本任务明确产出的接口。

**Blocked by:** EL-20。

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

- RF1：缺一个新旅程分支必须失败；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF2：任一视口缺失不能算通过；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF3：跳过或失败后重试不能假绿；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF4：中断与数据恢复故障保留原数据；归属 Task 2 的具名边界/场景与下述验证步骤。
- RF5：人工内容核对不能被模型替身成绩替代；归属 Task 2 的具名边界/场景与下述验证步骤。

---

## 文件结构与职责

- Create: `e2e/el-21-journey.spec.mjs`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `tests/test_el21_release_qualification.py`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Create: `docs/el-release-evidence.md`，负责本票新增模块/材料/迁移，职责由下面 Interfaces 限定。
- Modify: `e2e/spec-coverage.mjs`，仅接入本票公开行为和兼容处理。
- Modify: `e2e/run.mjs`，仅接入本票公开行为和兼容处理。
- Modify: `e2e/support/contracts.py`，仅接入本票公开行为和兼容处理。
- Modify: `docs/release-compatibility.md`，仅接入本票公开行为和兼容处理。
- Test: `tests/test_el21_integrated_learning_restore_qualification.py`，公开HTTP/纯规则边界；复用真实迁移的ec/ec_factory。
- Test: `e2e/el-21.spec.mjs`，主验收从真实UI进入，使用既有appFactory。
- Modify: `e2e/spec-coverage.mjs`，随本票登记实际已实现分支，采用EL命名空间，保留旧T场景。
- 文档与提交边界随其行为任务完成；不为文案、链接或状态更新另建计划。

## 文档/ADR同步文件

- `docs/el-release-evidence.md`：新增 docs/el-release-evidence.md 保存同次源码/产物/报告与人工核对记录；更新release-compatibility的新格式边界，不冒称已部署。
- `docs/release-compatibility.md`：新增 docs/el-release-evidence.md 保存同次源码/产物/报告与人工核对记录；更新release-compatibility的新格式边界，不冒称已部署。

## 执行前检查

- [ ] 读取Blocked by的已完成结果，核对接口字段和当前源码漂移；不能把存在文档当作前置已实现。
- [ ] 在执行时按using-git-worktrees检查是否需要隔离；计划编写阶段不创建产品分支或工作树。
- [ ] 从仓库根目录使用`.venv/bin/python`，不要依赖当前不存在的系统python别名；不读取真实用户库或付费密钥。
- [ ] 既有EC过滤参数不接受EL标识。本计划定向Python用具体节点；E2E先使用未过滤命令，不编造可用过滤器。

### Task 1：交付本票最小可观察闭环

**Files:**
- `e2e/el-21-journey.spec.mjs`
- `tests/test_el21_release_qualification.py`
- `docs/el-release-evidence.md`
- `e2e/spec-coverage.mjs`
- `e2e/run.mjs`
- `e2e/support/contracts.py`
- `docs/release-compatibility.md`
- `tests/test_el21_integrated_learning_restore_qualification.py`
- `e2e/el-21.spec.mjs`

**Interfaces:**
- Consumes: 前置EL-20及其传递前置；真实ec/appFactory、run_write、submit_attempt/apply_attempt_in_transaction；仅在需要评分时调用，不用于接触/时长/纯读取。
- Produces: 核心算法 qualification_keys（见Task 1完整签名与实现片段）；完整覆盖要求新增命名空间 EL-JOURNEY（与旧T01–T21不冲突），至少包含新装学习、旧库升级、V3换设备续学和故障恢复四个具名真实用例；不建立生产资格查询API。

- [ ] **Step 1：写第一条失败测试。**

```python
import json
import subprocess

def test_el21_release_requires_new_journey():
    script = (
        "import {requirements} from './e2e/spec-coverage.mjs';"
        "process.stdout.write(JSON.stringify(Object.keys(requirements)));"
    )
    result = subprocess.run(["node", "--input-type=module", "-e", script],
                            check=True, capture_output=True, text=True)
    assert "EL-JOURNEY" in json.loads(result.stdout)
```

写入`tests/test_el21_integrated_learning_restore_qualification.py`。数据模型只用于准备旧课程/词库，实际被测行为走公开HTTP。

- [ ] **Step 2：运行并确认预期红灯。**

```bash
.venv/bin/python -m pytest tests/test_el21_integrated_learning_restore_qualification.py::test_el21_release_requires_new_journey -q
```

**预期失败原因：** 现有覆盖门禁没有已确认的EL-JOURNEY分支，未执行新旅程也可能通过旧门禁；前置票不得提前登记未来集成用例。
第一条红灯针对缺失的发行门禁覆盖；现有产品行为可能已被前置票实现，不能以此谎称整套新旅程已执行。

- [ ] **Step 3：实现最小规则核心。**

位置：`e2e/spec-coverage.mjs`；qualification_keys的输入输出由下列完整片段定义，调用者必须使用同一字段和状态名。

```javascript
export function qualification_keys(requirements) {
  return Object.keys(requirements).filter(key => key.startsWith("EL-")).sort();
}
```

- [ ] **Step 4：接通持久化与公开边界。**

- [ ] 4.1：补双真实迁移实例旅程：词卡证据/课测/故事简化读后/回测建议/预算恢复/三个场景，所有前置已有必需分支照常运行。
- [ ] 4.2：用UI下载并在第二实例选择V3预览恢复，继续已存课测和场景、重新签发未提交题；比较公开结果与业务语义，ID重映射允许不同。
- [ ] 4.3：扩充覆盖校验只接纳新旅程真实执行结果；在自检报告中删除分支/视口、插入跳过/重试/中断均拒绝。
- [ ] 4.4：真实旧库升级与旧备份缺失预览、事务故障、预览后新学习、旧后台响应等具名边界纳入同次运行证据。
- [ ] 4.5：生成内容按三种词汇准备状态各三例人工核对，三类场景规则/模板/支撑词表记录版本；未有人核对则发行资格未完成。

上述步骤是完整的接入范围；核心片段不替代路由、事务、关联校验或可见反馈。路由注册复用create_app，不增生产测试端点。

- [ ] **Step 5：实现实际可见UI并加主seam测试。**

```javascript
import {test, expect} from "./support/test.mjs";

test("EL-21 new install starts a real saved journey", async ({app, page}) => {
  await page.goto(app.baseURL);
  await page.getByRole("button", {name: "体验入门词卡", exact: true}).click();
  await page.getByRole("button", {name: "开始今天的学习", exact: true}).click();
  await page.locator(".flip-hint").first().click();
  await page.locator(".rating-3").click();
  const backup = await (await app.request.get("/api/export/backup")).json();
  expect(backup.version).toBe(3);
  expect(backup.learning_events.length).toBeGreaterThan(0);
});
```

精确testid属于本票要交付的可访问结果区：`release-journey`。把它加到真实现有视图/新视图对应结果元素，不建立只供测试显示的假页面。操作按钮名称以本计划固定文案为准；新增按钮使用原生button/label，状态用role=status、失败用role=alert，输入保留可访问名称。

- [ ] **Step 6：同步文档/ADR，并验证闭环。**

新增 docs/el-release-evidence.md 保存同次源码/产物/报告与人工核对记录；更新release-compatibility的新格式边界，不冒称已部署。
先运行首条节点，再运行本票测试和完整入口：

```bash
.venv/bin/python -m pytest tests/test_el21_integrated_learning_restore_qualification.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
```

预期：对应行为真实通过，正常成功不伪造应用API；E2E主入口已包含新构建与双视口。若有失败必须修复或准确记录阻塞，不声称完成。

- [ ] **Step 7：提交独立边界一。**

只暂存本任务实际新增/修改文件与对应文档，避免把工作区已有未跟踪计划或他人改动一并纳入：

```bash
git add -- e2e/el-21-journey.spec.mjs tests/test_el21_release_qualification.py docs/el-release-evidence.md e2e/spec-coverage.mjs e2e/run.mjs e2e/support/contracts.py docs/release-compatibility.md tests/test_el21_integrated_learning_restore_qualification.py e2e/el-21.spec.mjs
git diff --cached --check
git commit -m "feat: deliver el-21 observable learning path"
```

此提交必须独立可验证本票最小用户路径；不把纯schema或未注册API留成必须依赖下一提交才能启动的状态。

### Task 2：钉住边界、恢复与兼容，并完成独立验收

**Files:**
- Modify: `tests/test_el21_integrated_learning_restore_qualification.py`、`e2e/el-21.spec.mjs`、Task 1对应模块。
- Modify: 本票列出的文档/ADR、V3适配和必要的测试夹具；仅补本票异常与兼容，不承担未来票。

**Interfaces:**
- Consumes: Task 1的真实公开响应、qualification_keys及前置的V3/提交确认契约。
- Produces: 本票五项Review Focus的具名回归、失败/恢复/回退证据；不新增另一套业务接口。

- [ ] **Step 1：先写规则边界测试，运行到预期断言。**

```python
import json
import subprocess

def test_el21_gate_has_no_old_namespace_substitution():
    script = (
        "import {requirements} from './e2e/spec-coverage.mjs';"
        "process.stdout.write(JSON.stringify(requirements['EL-JOURNEY'] || []));"
    )
    result = subprocess.run(["node", "--input-type=module", "-e", script],
                            check=True, capture_output=True, text=True)
    assert len(json.loads(result.stdout)) >= 4
```

在`tests/test_el21_integrated_learning_restore_qualification.py`追加。规则测试只补充输入边界，不能替代Task 1的真实浏览器/HTTP链路。对于同一纯规则不止一个行为的Review Focus，按下列场景代码及验收勾选条件补足公开操作。

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

将帮助函数放在`e2e/el-21.spec.mjs`的test外；在真实点击提交前调用loseOneResponse，刷新后点击“继续确认保存”，再用实际同一submission_id核对学习事件/接触记录。operation_id/sample_id类型的集合应核对其已定义唯一键，不把它们硬改成学习提交字段。

具体的事务故障/重复读取用例（追加到本票Python测试文件）：

```python
from uuid import uuid4


def prepare_el21_request(ec):
    ec.seed_card()
    return "GET", "/api/export/backup", None

def test_el21_reading_is_not_learning(ec):
    method, path, payload = prepare_el21_request(ec)
    before = ec.snapshot()
    first = ec.client.request(method, path)
    second = ec.client.request(method, path)
    assert first.status_code == second.status_code == 200
    assert ec.snapshot() == before
```

以下具名场景必须随本票实现（测试内容，不是已执行证据）：

```python
import json
import subprocess

def test_el21_every_missing_or_failed_journey_is_rejected():
    script = "import {requirements, projects, assertSpecCoverage} from \"./e2e/spec-coverage.mjs\";\nconst build = () => ({\n  errors: [],\n  suites: [{specs: [...new Set(Object.values(requirements).flat())].map(title => ({\n    title,\n    tests: projects.map(projectName => ({\n      projectName, expectedStatus: \"passed\", status: \"expected\",\n      results: [{status: \"passed\"}]\n    }))\n  }))}]\n});\nconst title = requirements[\"EL-JOURNEY\"][0];\nconst mutants = {\n  missing: report => { report.suites[0].specs = report.suites[0].specs.filter(row => row.title !== title); },\n  mobile: report => { report.suites[0].specs.find(row => row.title === title).tests = report.suites[0].specs.find(row => row.title === title).tests.filter(row => row.projectName !== \"mobile\"); },\n  skipped: report => { report.suites[0].specs.find(row => row.title === title).tests[0].results[0].status = \"skipped\"; },\n  retry: report => { report.suites[0].specs.find(row => row.title === title).tests[0].results.unshift({status: \"failed\"}); },\n  interrupted: report => { report.errors.push({message: \"interrupted\"}); }\n};\nconst rejected = [];\nfor (const [name, mutate] of Object.entries(mutants)) {\n  const report = build();\n  mutate(report);\n  try { assertSpecCoverage(report); } catch { rejected.push(name); }\n}\nprocess.stdout.write(JSON.stringify(rejected.sort()));\n"
    result = subprocess.run(['node', '--input-type=module', '-e', script], check=True, capture_output=True, text=True)
    assert json.loads(result.stdout) == ['interrupted', 'missing', 'mobile', 'retry', 'skipped']
```

- [ ] **Step 3：逐项完成本票特有边界。**

- [ ] 3.1：在新实例与代表性升级实例贯穿词卡证据、课程短测、故事/简化/读后、延迟回测/建议、时间计划/恢复模式和三类场景。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.2：通过 UI 下载 V3、在第二个真实迁移实例预览恢复，核对所有新记录、规则/修订、引用、真实间隔、已保存上下文以及继续操作。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.3：交叉覆盖 V1/V2 缺失预览、预览后新学习、损坏图、执行故障、旧题失效、签名不入备份、缓存清理与旧后台响应隔离。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.4：既有发行门禁和本规格全部必要分支在同一源码/产物的未过滤双视口运行中实际通过；缺场景、跳过、重试后才成功或中断不能算通过。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.5：三类场景规则/表达、基础支撑词和模板有人工核对记录；真实生成材料按三种词汇准备状态各三例检查语义/翻译/唯一答案，错误材料修正后重验。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.6：保存源码含工作区身份、产物摘要、报告、trace/截图和 HTTP/迁移补充证据；不把历史门禁或小样本试用推断为教学提升证明。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.7：本票路径的保存失败、重复确认、内容修订/删除及恢复边界有可观察结果；不依赖尚未实施的票兜底。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.8：若引入新的持久记录或用途，本票同步实现 V3 导出、校验、引用映射、恢复及旧格式缺失解释；不能只加表后等待最后集成票。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。
- [ ] 3.9：本票新增具名用户级测试分支并登记到完整覆盖门禁，同时维护受影响的现有场景，不降低原有验收要求。 对应测试必须从实际输入触发并断言公开结果；以Task 1/2代码为测试起点，成功/失败都保留其真实记录。

- [ ] **Step 4：执行本票独立演示与功能回退。**

撤回发行资格/默认新入口并保留所有学习记录和可用 V3 恢复工具；有新学习时保留能读取新数据的应用版本，不能拿旧快照覆盖。

共同边界：已新增的学习、上下文、修订与备份数据继续可读；有后继消费者时按依赖逆序撤回，或保留它们依赖的 API/数据适配。功能回退与事务回滚分别验收。不得以恢复旧快照、删除新字段或清空事件来冒充回退成功。

除失败事务回滚外，再演练隐藏新入口/恢复兼容适配后旧数据可读、新记录可导出。若已有后继，逆依赖撤回或保留其契约，不执行删除列/清库式回退。

- [ ] **Step 5：运行验证并保存证据。**

```bash
.venv/bin/python -m pytest tests/test_el21_integrated_learning_restore_qualification.py -q
.venv/bin/python -m pytest -q
npm --prefix frontend run test:e2e
git diff --check
```

每项Review Focus要能指向实际新增测试；仅有说明或手动点过不算自动覆盖。记录当次源码身份、双视口结果、HTTP/迁移补充与回退结果；缺样本/跳过/失败后重试不当通过。

- [ ] **Step 6：提交独立边界二。**

```bash
git add -- e2e/el-21-journey.spec.mjs tests/test_el21_release_qualification.py docs/el-release-evidence.md e2e/spec-coverage.mjs e2e/run.mjs e2e/support/contracts.py docs/release-compatibility.md tests/test_el21_integrated_learning_restore_qualification.py e2e/el-21.spec.mjs
git diff --cached --check
git commit -m "test: qualify el-21 recovery and compatibility"
```

文档/ADR改动按所属任务显式暂存，不使用git add .。这两次提交分别是可运行闭环和其边界加固；不制造额外的纯准备提交。

## 规格覆盖与自检

- 本票对应：AC01、AC02、AC03、AC04、AC05、AC06、AC07、AC08、AC09、AC10、AC11、AC12、AC13、AC14、AC15、AC16、AC17、AC18、AC19、AC20、AC21、AC22、AC23、AC24、AC25、AC26、AC27、AC28、AC29、AC30、AC31、AC32、AC33、AC34、AC35、AC36、AC37、AC38、AC39、AC40、AC41、AC42、AC43。Task 1负责用户可见闭环，Task 2负责相关异常/兼容/回退；EL-21只检查组合完整性。
- 自检：规格范围与所有勾选条件已进入接入步骤；方法/字段按Shared Interfaces；Review Focus在Task 2具有规则输入或公开场景归属。
- 执行时若首条已由前置正确实现，记录实际绿灯并补真正未覆盖的边界，不人为破坏产品造红灯。
- 当前产物是计划，不把其中未来测试命令或示例片段称为已经实现/通过。
