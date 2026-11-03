# EC-06 测验和听力选择由服务端判分，一次保存结果且不把识别题当独立排期。 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 测验和听力选择由服务端判分，一次保存结果且不把识别题当独立排期。

**Architecture:** 用签名题目上下文绑定选项和标准答案，复用03提交内核。保留旧URL与成功字段，过期/重启上下文不可验证时明确要求重载。

**Tech Stack:** Python/FastAPI、SQLAlchemy/SQLite、Alembic、FSRS；React/Vite；pytest与Playwright。保持项目既有依赖方向，新增测试依赖仅在EC-01集中锁定。

**Spec:** [可靠性与每日学习闭环](../../specs/reliability-and-daily-learning.md)；[已确认ticket EC-06](../../tickets/reliability-and-daily-learning/06-recognition-practice.md)。执行者必须同时阅读规格与本票。

**Shared Interfaces:** [共享接口与owner](2026-10-30-reliability-contracts.md)。只消费本票前置或本任务定义的接口；无阻塞关系的后续票不能成为隐含依赖。

**GitHub:** [对应ticket与完整计划](https://github.com/Zeming-Yuan/english-coach/issues/7#implementation-plan)。

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

- RF1: 伪造correct_index不能造正确。
- RF2: 题目过期但已提交请求仍可幂等回放。
- RF3: 相关词答案不同于原词。
- RF4: 干扰项不足不造单选假题。
- RF5: 批次一个坏项导致全批回滚。

---

## 实施前与文件职责

- 在执行时检查ticket的Blocked by都已完成并读取其产出契约；需要隔离时依using-git-worktrees建立工作区，不在本计划编写阶段创建执行分支。
- 先核对当前HEAD与计划基线；文件以任务Files精确路径定位，原文件内以函数/组件名定位，不依赖易过期行号。
- Create文件的职责由其对应Task标题和Produces限定；Modify只改该任务所列行为，共享文件串行合入，不改批准的业务依赖图。
- 测试前置数据只用于准备真实数据库；验收必须验证公开行为，不能仅通过mock内部调用证明正确。
- EC-01之前，测试集合导入需要临时占位配置的情况已在其首条红灯命令中写明；EC-01之后回归自带测试配置，禁止要求真实密钥。

### Task 1: 可验证选择题与原子批次

**Files:**
- **Create:** app/services/questions.py; tests/test_recognition_attempts.py
- **Modify:** app/routers/quiz.py; app/routers/listening.py; app/services/learning.py; app/schemas/learning.py
- **Modify:** app/main.py; app/runtime.py

**Interfaces:**
- Consumes: 03核心和EC-01 Runtime；应用级question_secret为启动随机bytes，测试可注入固定值。
- Produces: issue_question/verify_question、submit_batch；选择/听力响应带question_token，答案以文本提交。

- [ ] **Step 1: 写第一条失败测试**

文件：tests/test_recognition_attempts.py。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```python
from uuid import uuid4
def test_listening_is_server_graded_without_scheduling(ec):
    for word in ["apple","book","cat","dog"]: ec.seed_card(word=word,meaning=word)
    question=ec.client.get("/api/listening?limit=1").json()["questions"][0]
    response=ec.client.post("/api/listening/score",json={
      "card_id":question["card_id"],"answer":"not-an-option",
      "question_token":question["question_token"],"source":"listening",
      "kind":"choice","correct_index":0,"selected_index":0,
      "submission_id":str(uuid4())})
    assert response.status_code==422
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
python -m pytest tests/test_recognition_attempts.py::test_listening_is_server_graded_without_scheduling -q
```

**预期失败原因：** 当前题目没有可验签token，并且只比较客户端给出的两个下标。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```python
import hashlib,hmac,json,base64
def sign_question(data,secret):
    raw=json.dumps(data,sort_keys=True,separators=(",",":")).encode()
    signature=hmac.new(secret,raw,hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(raw).decode()+"."+signature

def decode_question(token,secret):
    try:
        encoded,signature=token.rsplit(".",1)
        raw=base64.urlsafe_b64decode(encoded.encode())
    except (ValueError,TypeError) as error:
        raise ValueError("invalid question token") from error
    expected=hmac.new(secret,raw,hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature,expected):
        raise ValueError("invalid question token")
    return json.loads(raw)

# 对外签名函数使用上面已定义的编码器：
# issue_question构造强类型上下文后调用sign_question；verify_question调用decode_question后校验字段与过期。
```

- [ ] **Step 4: 完整issue_question/verify_question签名见共享契约，decode后再强类型校验card/kind/options/expected/expiry；过期409，坏签名/不在选项422，缺卡404。**

- [ ] **Step 5: 回放先按已验证业务指纹查成功事件，成功旧提交不因24小时过期再失败；第一次提交过期才409。不能只把随机token串当指纹。**

- [ ] **Step 6: 相关词选择题必须以题目上下文中的related answer判分，不把原词传给classify。有效干扰不足时不产题，响应questions为空。related题生成options并走quiz/score，不继续本地SpellingBoard比较q.answer。**

- [ ] **Step 7: submit_batch先校验全批再单次run_write，复用不含commit的提交操作；任一坏题或冲突全批回滚。兼容旧成功字段和数组details。**

- [ ] **Step 8: 钉住Review Focus及异常路径**

```python
import pytest
from uuid import uuid4
@pytest.mark.parametrize("mutation",[
 {"question_token":"broken"},
 {"answer":"not-an-option"},
 {"card_id":999999},
 {"kind":"unsupported"},
 {"assistance":["unsupported"]},
])
def test_recognition_review_focus_rejects_bad_context(ec,mutation):
    for word in ["apple","book","cat","dog"]: ec.seed_card(word=word)
    q=ec.client.get("/api/quiz/choice?limit=1").json()["questions"][0]
    payload={"card_id":q["card_id"],"answer":q["options"][0],
      "question_token":q["question_token"],"kind":"choice","source":"quiz",
      "submission_id":str(uuid4())}
    response=ec.client.post("/api/quiz/score",json={"answers":[{**payload,**mutation}]})
    assert response.status_code in (404,422)
```

添加已成功提交后推进25小时同ID回放测试、related期望为teacher而原卡teach的判分测试、两题批次后题非法无前题事件、单词库仅1词时无选择题；都通过真实ec服务请求。


- [ ] **Step 9: 从独立入口验证绿色及回归**

```bash
python -m pytest tests/test_recognition_attempts.py tests/test_listening.py tests/test_quiz.py -q
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 10: 同步文档或ADR**

ADR-0001补充识别不排期与题目上下文失效；README说明刷新旧题的409/422，不宣传防作弊系统。

- [ ] **Step 11: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'app/services/questions.py' 'tests/test_recognition_attempts.py' 'app/routers/quiz.py' 'app/routers/listening.py' 'app/services/learning.py' 'app/schemas/learning.py' 'app/main.py' 'app/runtime.py'
git commit -m "feat: grade recognition attempts with verified question context"
```

**回滚或兼容策略：** 保留新事件/签名响应协议；若关闭选择入口，独立输入继续工作，不退回信任客户端下标的写法。

---

### Task 2: 听力与测验选择保存后才反馈

**Files:**
- **Modify:** frontend/src/views/ListeningPage.jsx; frontend/src/views/QuizPage.jsx
- **Create:** e2e/ec-06.spec.mjs

**Interfaces:**
- Consumes: Task1题目token与AttemptResult，03持久化客户端；不依赖04hook。
- Produces: 听力和选择题等待保存、失败重试、过期重载以及非故障空态。

- [ ] **Step 1: 写第一条失败测试**

文件：e2e/ec-06.spec.mjs。以下测试按交付后接口书写，当前允许先失败；ec/app等夹具严格按共享契约的owner提供。

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-06 failed-choice-stays",async({app,page})=>{
 await app.seedCards(["apple","book","cat","dog"].map(word=>({word,meaning:word})));
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/听写练习/}).click();
 await page.route("**/api/listening/score",r=>r.abort("failed"),{times:1});
 await page.locator(".listening-option").first().click();
 await expect(page.getByRole("alert")).toContainText("尚未确认保存");
 await expect(page.locator(".study-count")).toContainText("1");
});
```

- [ ] **Step 2: 确认红灯命中预期行为**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-06
```

**预期失败原因：** 当前听力先显示反馈并自动切题，即使后端保存失败也吞掉异常。

如先出现依赖/导入环境错误，先把准备条件修到能执行断言，再确认目标红灯；不得把没跑到断言当回归证据。

- [ ] **Step 3: 实施最小关键改动**

将下面核心片段放入Files指定模块/现有函数范围，导入或字段类型按Interfaces及共享契约提供。片段不是新建第二套程序；其余字段必须符合已列出的完整输入/输出契约。

```javascript
const payload={
  card_id:q.card_id,question_token:q.question_token,
  answer:q.options[index],source:"listening",kind:"choice",assistance:[],skipped:false
};
pendingRef.current ??= makePending("/api/listening/score",payload);
const result=await sendPending(pendingRef.current);
setFeedback({correct:result.correct,correctWord:result.correct_word,selected:index});
```

- [ ] **Step 4: 成功响应前不启动切题计时，不用本地q.correct_index作为最终反馈；保存失败沿用pending并保留选择。**

- [ ] **Step 5: 跳过发skipped事件且answer=null；过期409提供重载并说明本题未保存，用户明确重载才换提交ID。**

- [ ] **Step 6: 空questions和加载失败分别展示；音频失败给文本提示，避免按钮只用颜色表达可用状态。**

- [ ] **Step 7: 钉住Review Focus及异常路径**

```javascript
import {test,expect} from "./support/test.mjs";
test("EC-06 choosing-does-not-change-due",async({app,page})=>{
 const ids=await app.seedCards(["apple","book","cat","dog"].map(word=>({word,meaning:word})));
 await page.goto(app.baseURL);
 await page.getByRole("button",{name:/听写练习/}).click();
 await page.locator(".listening-option").first().click();
 await expect(page.getByRole("status")).toContainText("已保存");
 const details=await Promise.all(ids.map(async id=>(await app.request.get("/api/cards/"+id)).json()));
 const events=details.flatMap(x=>x.learning_events);
 expect(events).toHaveLength(1);
 expect(events[0].scheduled).toBe(false);
});
```

补充加载API500不是空队列、TTS失败但可选答案、过期后重载、related显示服务器正确答案；在两视口运行。


- [ ] **Step 8: 从独立入口验证绿色及回归**

```bash
npm --prefix frontend run test:e2e -- --ticket EC-06
python -m pytest -q
```

预期：本任务场景与相关回归通过；E2E中阻塞/缺场景/失败必须非零，正常场景真实保存/读取经过应用与迁移库。记录真实输出，不预填通过结果。

- [ ] **Step 9: 同步文档或ADR**

README/API说明同步选择题不改排期、题目过期重载；测验输入分支留给05，不重复修改。

- [ ] **Step 10: 按独立提交边界提交绿色交付**

本提交仅包含本任务列明行为、测试及同步文档；若文档文件不在上方列表，显式追加到git add，不使用git add .。下列命令是执行计划时的操作，本次仅编写计划。

```bash
git add -- 'frontend/src/views/ListeningPage.jsx' 'frontend/src/views/QuizPage.jsx' 'e2e/ec-06.spec.mjs'
git commit -m "fix: confirm recognition persistence before feedback and navigation"
```

**回滚或兼容策略：** 关闭选择练习UI或保留兼容API，事件仍保留；不得恢复先反馈后忽略保存故障。


## 独立完成检查

- [ ] 本票验收条件全部有对应任务，文档/ADR同步，相关消费者保持可用。
- [ ] 第一条失败测试确实命中预期原因，之后相同测试通过；保存真实命令输出。
- [ ] 以本票逐票E2E入口演示已确认的用户行为，五项Review Focus均已验证。
- [ ] 每个任务在绿色状态下独立提交；前置能力不被未完成票反向依赖。
- [ ] 回退范围、不能降级的写路径与数据保护已演练或明确记录，不用旧快照覆盖新进度。
- [ ] 本ticket已发布；实施时不重复创建issue，无需重复triage。产品实现、PR与代码发布遵循后续授权。
