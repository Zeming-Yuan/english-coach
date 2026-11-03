# EC-12 完整备份能恢复到另一实例并继续学习，全部关联和幂等结果不串ID。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整备份能恢复到另一实例并继续学习，全部关联和幂等结果不串ID。

**Architecture:** 扩展11校验/事务协调器支持V2全量替换，保持旧格式路径。先完成数据图和回滚，再接双实例浏览器流程，不另建第二套恢复器。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-12](../../tickets/reliability-and-daily-learning/12-full-backup-restore.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/13#implementation-plan)。

**Status:** 实施计划已编写；已随对应ticket发布；未执行产品改动、未宣称产品测试已通过。

## Global Constraints

- 保留现有前后端结构与本地数据库方案，不重写应用。
- 新事件以 UTC 存储时间，按配置的学习时区归属学习日，默认 `Asia/Shanghai`。事件保存当时的学习时区，后续设置变化不重写历史日期。
- 使用本次运行独有的数据库、端口、下载目录和浏览器上下文；不接触用户数据库，不调用真实付费 AI。
- 必经步骤不可因队列为空、AI 超时或入口缺失而静默跳过。断言失败、未处理错误或流程中断必须使命令以非零状态退出，并保留诊断信息。
- 当前最高测试 seam：浏览器用户界面 → 真实 FastAPI → 通过 Alembic 迁移建立的隔离 SQLite。
- 单卡当前记忆状态与追加事件分离；旧历史未知就标注未知，不补造。
- 所有schema变更沿expand→迁移→contract，保留兼容读写；本票不能顺便删除公共URL或物理历史数据。

## Review Focus

以下五类输入在首个正常示例中未覆盖，已分别纳入下方Task的Review Focus代码、具名边界测试或故障演练步骤。不能只检查正常示例就完成本票。

- RF1: 同词两卡型和不同目标ID布局。
- RF2: cached response与command fingerprint中的活ID映射。
- RF3: 空备份替换和悬空关联区别。
- RF4: 中途/预备份失败原库完整。
- RF5: 恢复后旧提交重试不重复排期。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 全图校验与一次事务替换

**Files:**
- **Modify:** app/schemas/backup.py; app/services/restore.py; app/services/backup.py; app/routers/export.py
- **Create:** tests/test_full_restore.py

**Interfaces:**
- Consumes: 11恢复协调器、10V2字段白名单、04提交回放与03事件command_json。
- Produces: V2 full_replace有效实现；mode/impact预览、全实体映射和可用安全副本，旧格式不变。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_full_restore.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_restore_preserves_two_kinds_and_replay(ec,ec_factory):
 cid=ec.seed_card(word="apple",kind="word",id=101)
 ec.seed_card(word="apple",kind="sentence",id=202)
 sid=str(uuid4())
 ec.client.post("/api/reviews",json={"card_id":cid,"rating":3,"source":"study",
   "kind":"self_rating","submission_id":sid})
 backup=ec.client.get("/api/export/backup").json()
 other=ec_factory()
 preview=other.client.post("/api/import/preview",json=backup).json()
 result=other.client.post("/api/import/cards",json={"backup":backup,
   "expected_revision":preview["expected_revision"]})
 assert result.status_code==200
 cards=other.client.get("/api/cards").json()["cards"]
 assert sorted(c["kind"] for c in cards)==["sentence","word"]
 mapped=next(c["id"] for c in cards if c["kind"]=="word")
 replay=other.client.post("/api/reviews",json={"card_id":mapped,"rating":3,
   "source":"study","kind":"self_rating","submission_id":sid})
 assert replay.status_code==200
 assert len(other.client.get(f"/api/cards/{mapped}").json()["learning_events"])==1
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_full_restore.py::test_restore_preserves_two_kinds_and_replay -q
```

**预期失败原因：** 11明确拒绝V2；原导入也会按word合并两卡并无法恢复事件去重。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
def remap_cached_response(response,card_ids):
    result=dict(response)
    for key in ("card_id","sentence_card_id"):
        if result.get(key) is not None:
            result[key]=card_ids[result[key]]
    return result

def mapped_row(row,id_map,foreign_keys):
    result={key:value for key,value in row.items() if key!="id"}
    for key,table in foreign_keys.items():
        if result.get(key) is not None:
            result[key]=id_map[table][result[key]]
    return result
```

- [ ] **Step 4: validate_backup支持V2全部强类型集合和全图引用，严格拒绝未知版本、重复源ID、NaN/Infinity、坏日期/枚举/负计数；空集合合法但有悬空关联不合法。**

- [ ] **Step 5: write锁内复核revision，持久化完整安全副本，再按story_words/events/baselines/关联/状态→stories/lessons/cards删除；插入先cards/lessons/stories后状态/事件/关联。每个source ID映射插入后实际新ID。**

- [ ] **Step 6: ReviewEvent.command_json中活card_id、已验题目上下文的card_id及cache结果映射后重算规范化指纹；原始token可作为既有请求审计值保留，签名密钥不恢复。raw基线是原始证据，不改其历史源ID，外层活card引用映射。**

- [ ] **Step 7: 旧提交重试先比缓存中原已验上下文/原token与业务内容；已保存结果不重新要求旧token以新密钥验签，新的不同请求必须验签。否则重启/恢复会破坏幂等语义。**

- [ ] **Step 8: 失败全部rollback；安全副本即使本次写入失败也保留。外键和提交UUID约束不得通过关闭校验来绕过。**

- [ ] **Step 9: 钉住Review Focus及异常路径**

```python
import pytest
@pytest.mark.parametrize("mutate",["future","duplicate","dangling","nan","negative"])
def test_full_restore_review_focus_rejects(ec,mutate):
 cid=ec.seed_card()
 backup=ec.client.get("/api/export/backup").json()
 if mutate=="future": backup["version"]=99
 elif mutate=="duplicate": backup["cards"].append(dict(backup["cards"][0]))
 elif mutate=="dangling": backup["story_words"]=[{"id":1,"story_id":999,"card_id":cid}]
 elif mutate=="nan": backup["reviews"]=[{"id":1,"card_id":cid,"state":1,"step":0,
   "due":"2026-10-30T00:00:00+00:00","stability":"NaN","difficulty":1,
   "elapsed_days":0,"last_review":None,"review_count":1,"rating":3}]
 else: backup["errors"]=[{"id":1,"card_id":cid,"error_count":-1,
   "last_error_at":"2026-10-30T00:00:00+00:00"}]
 before=ec.snapshot()
 response=ec.client.post("/api/import/preview",json=backup)
 assert response.status_code==422
 assert ec.snapshot()==before
```

加安全副本磁盘错误、插完cards后注入SQL失败、提交失败、预览后新学习409四场景；全范围含memo/hard/error/lesson/story/chunks的往返比较排除非业务ID/导出时间但核对每条映射关系。补充恢复前已启动的AI响应在恢复后到达的测试，确认旧指纹结果不会覆盖新内容。


- [ ] **Step 10: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_full_restore.py tests/test_legacy_restore.py tests/test_backup_v2.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 11: 同步文档或ADR**

ADR-0003更新全量替换、ID映射、幂等恢复和旧/新语义差别；不新增第二个恢复API。

- [ ] **Step 12: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/schemas/backup.py' 'app/services/restore.py' 'app/services/backup.py' 'app/routers/export.py' 'tests/test_full_restore.py'
git commit -m "feat: restore full learning snapshots with remapped replay identities"
```

**回滚或兼容策略：** 关闭V2执行入口但保留旧恢复和数据读取；有恢复后新进度时先保全/前向修复，不能直接还原旧快照。

---

### Task 2: 浏览器在另一实例恢复并继续学习

**Files:**
- **Modify:** frontend/src/views/BackupPage.jsx
- **Create:** e2e/ec-12.spec.mjs; e2e/fixtures/ec12-full.json

**Interfaces:**
- Consumes: Task1 V2预览/恢复，04已确认保存闭环；10下载UI，11文件选择。
- Produces: 全量影响预览、显式替换确认和双实例旅程。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-12.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-12 restore-other-instance",async({appFactory,page})=>{
 const a=await appFactory({fixture:"ec12-full.json"});
 await page.goto(a.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 const downloadPromise=page.waitForEvent("download");
 await page.getByRole("button",{name:"下载完整备份",exact:true}).click();
 const file=await (await downloadPromise).path();
 const b=await appFactory({});
 await page.goto(b.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 await page.getByLabel("选择备份文件").setInputFiles(file);
 await expect(page.getByText("全量恢复",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"确认替换学习数据",exact:true}).click();
 await expect(page.getByRole("status")).toContainText("恢复成功");
 const cards=(await (await b.request.get("/api/cards")).json()).cards;
 expect(cards.filter(c=>c.word==="apple")).toHaveLength(2);
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-12
```

**预期失败原因：** 现有11只有旧版部分恢复，没有V2全量替换与成功结果。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const full=candidate.preview.mode==="full_replace";
return <section>
  <h2>{full?"全量恢复":"旧版部分恢复"}</h2>
  <p>{full?"现有数据库学习内容将被备份替换。":"仅恢复文件包含的内容。"}</p>
  <button onClick={confirmRestore} disabled={restoring}>
    {full?"确认替换学习数据":"确认恢复包含的内容"}
  </button>
  <button onClick={()=>setCandidate(null)} disabled={restoring}>取消</button>
</section>;
```

- [ ] **Step 4: ec12-full样本实际含word/sentence apple、memo、hard/error、lesson、story/link、已提交事件与baseline；用运行时真实模型构造其ID引用，不使用缺列的简化伪格式。**

- [ ] **Step 5: 成功后刷新所有页面状态，提供安全副本位置；响应失联显示恢复未确认并先重新读取/预览，不自动无脑再次替换新进度。**

- [ ] **Step 6: 同文件再导入业务等价；空备份预览显示将替换为0项，依旧要求显式确认。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-12 cancel-full-replace",async({app,page})=>{
 await app.seedCards([{word:"keep",meaning:"保留"}]);
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:"设置",exact:true}).click();
 await page.getByRole("button",{name:"备份与恢复",exact:true}).click();
 const empty={version:2,exported_at:"2026-10-30T00:00:00+00:00",learning_timezone:"Asia/Shanghai",
 cards:[],reviews:[],learning_events:[],review_baselines:[],memos:[],errors:[],hard_cards:[],
 lessons:[],stories:[],story_words:[]};
 await page.getByLabel("选择备份文件").setInputFiles({name:"empty.json",
 mimeType:"application/json",buffer:Buffer.from(JSON.stringify(empty))});
 await page.getByRole("button",{name:"取消",exact:true}).click();
 expect((await (await app.request.get("/api/cards")).json()).cards[0].word).toBe("keep");
});
```

双实例最终通过UI给恢复后的卡再评分，公开详情事件数只增一；再以导入前已有submission_id和映射后ID重试，事件数不变。两视口/键盘验证替换警示与取消。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-12
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README逐步说明下载、影响预览、安全副本、换设备恢复与异常409；明确不含密钥和浏览器偏好。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/BackupPage.jsx' 'e2e/ec-12.spec.mjs' 'e2e/fixtures/ec12-full.json'
git commit -m "feat: continue learning after browser-driven full backup restore"
```

**回滚或兼容策略：** 可关闭替换确认按钮，保留备份文件和新格式读取；不自动删除安全副本或回退用户数据。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
