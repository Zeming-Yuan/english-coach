# 可验证学习效果：跨票接口与所有权

- 日期：2026-10-31；基线 c43f54a；接口为本批已确认tickets的实施约定，不表示当前产品已实现。
- [完整规格](../../specs/evidence-based-personalized-learning.md)；[tickets](../../tickets/evidence-based-personalized-learning/README.md)。本文件不是额外ticket。
- 保留21张票与31条直接阻塞边，不新增业务边。EL-17独立于新观察API；其他只消费传递前置提供的能力。

## 公共数据形状

```python
from typing import Literal, TypedDict

class RevisionRef(TypedDict):
    identity: str
    version: int

class EvidenceDimension(TypedDict):
    status: Literal["insufficient", "verified", "weak", "stale", "history_incomplete"]
    count: int
    last_verified_at: str | None

class EvidenceSummary(TypedDict):
    revision: RevisionRef
    recall: EvidenceDimension
    retention: EvidenceDimension
    application: EvidenceDimension

class PracticeItemView(TypedDict):
    id: str
    card_id: int | None
    revision: RevisionRef | None
    prompt: str
    kind: Literal["typed", "reading_choice", "scene_text"]
    assistance: list[str]
    token: str | None
    status: Literal["unanswered", "saved", "unavailable"]

class PracticeSessionView(TypedDict):
    id: str
    purpose: str
    status: str
    items: list[PracticeItemView]
    counts: dict[str, int]
```

未知来源/旧修订一律不足，不能凭接口中出现字段就制造证据。以上DTO由EL-01提供RevisionRef，EL-02提供Evidence，EL-08提供Practice；后续票只增其用途，不重新命名基础字段。

## 持久数据与owner

| Owner | 集合 | 具体字段与约束 |
| --- | --- | --- |
| EL-01 | content_revisions | id:int；resource_kind:card/lesson/story；resource_id:int；identity:UUID string；version:int>=1。唯一(resource_kind,resource_id)，V3按资源类型映射ID；identity随实体恢复，恢复前旧后台任务必须持有恢复代次以被拒绝。 |
| EL-02 | review_events新增可空关联 | card_identity:string|null；card_revision:int|null。新提交取当前修订，旧事件保持null，不反向重写缓存响应或基线。 |
| EL-04 | learning_contacts | id:UUID；submission_id:UUID唯一；card_id:int；card_identity；card_revision；source；kind:answer_visible/answer_audio；occurred_at:UTC。server接收时间权威。 |
| EL-07 | lesson_progress | id:int；lesson_id:int；lesson_identity；lesson_revision；viewed_at:UTC|null；operation_id:UUID唯一。客观短测结果从关联会话/事件派生，不复制正误。 |
| EL-08 | practice_sessions | id:UUID；purpose；resource_kind/resource_id；resource_identity/resource_revision；snapshot:JSON冻结选择规则/课号/版本/窗口依据；created_at:UTC。状态由题目和真实结果派生。 |
| EL-08 | practice_items | id:UUID；session_id:UUID；order_index:int；card_id:int|null；card_identity/card_revision可空；kind；prompt:JSON；signed_context:JSON私有；assistance:JSON；first_event_id:UUID|null；first_task_attempt_id:UUID|null。session+order唯一。 |
| EL-11 | story_versions | id:UUID；story_id:int；parent_id:UUID|null；identity:UUID；version:int；mode:normal/short；material:JSON={title,sentences,targets,check}；target_card_ids:JSON list[int]；quality:JSON；created_at:UTC。 |
| EL-14 | scene_attempts | id:UUID；submission_id:UUID唯一；session_id/item_id:UUID；answer:string|null；skipped:bool；assistance:JSON；verdict:accepted/rejected/unknown；rule_version:string；task_key；target_mapping:JSON；response:JSON已存返回；fingerprint:string。 |
| EL-16 | scene_attempts追加反馈快照 | feedback_operation_id:UUID|null；feedback_text/correction/origin可空；同operation回放原反馈；反馈不修改verdict和任务首答。 |
| EL-18 | practice_durations | id:UUID(sample_id)；submission_id:UUID唯一关联真实review_events；kind:review/new/reinforcement；active_ms:int有限非负；occurred_at:UTC。 |

## 公开操作与owner

| Owner | 操作 | 合同 |
| --- | --- | --- |
| EL-01 | GET/PUT /api/cards/{id} | 增加content_revision，原字段保留；实质修改同事务递增。 |
| EL-01 | GET /api/export/backup；POST /api/import/preview；POST /api/import/cards | 当前完整快照V3，旧V2/V1适配。预览仍expected_revision，确认执行保持安全副本/单事务。 |
| EL-02/03 | GET /api/cards、/cards/{id}、/today、/stats | 增加learning_evidence/progress_label及聚合；不能把原正确率百分比一并删掉。 |
| EL-04 | POST /api/learning/contacts | {submission_id,card_id,revision,source,kind}；{committed,contact_id,occurred_at}。重复同内容回放，冲突409。 |
| EL-07 | POST /api/lessons/{level}/viewed | {submission_id,revision}；{committed,learning_progress}，GET课列表/详情增加goal与learning_progress。 |
| EL-08 | POST/GET /api/practice-sessions；GET /api/practice-sessions/{id} | 创建{id,purpose,...用途参数}，列表只返回已存会话；创建同id同内容幂等，同id不同内容409。 |
| EL-08 | POST /api/practice-sessions/{id}/items/{item_id}/help | {submission_id,kind}；保存帮助并返回更新Session；关闭提示不撤回帮助。 |
| EL-08 | POST /api/practice-sessions/{id}/items/{item_id}/attempts | {submission_id,answer,skipped,client_assistance?}；返回{committed,event_id?,verdict?,session}。client_assistance只可降低独立性，不能覆盖服务端提示或判分。 |
| EL-09 | 创建purpose=delayed_check | window=day/week；pending_contact_ids仅能降低完整性。响应items带gap_seconds/window/integrity。 |
| EL-10 | GET /api/learning/recommendations；创建purpose=targeted | 建议最多3项/每项3词；targeted带真实card_ids，不因目标失效暗换题。 |
| EL-11 | POST /api/stories/generate | 可选operation_id/include_new_target；正常StoryVersion或mode=starter的核对材料，quality.known_basis明确。 |
| EL-12 | POST /api/stories/{id}/simplify；GET /api/stories/{id}?version_id=UUID | 生成体operation_id+version_id，原版保持；指定版本返回该版材料与结果。 |
| EL-13 | 创建purpose=story_check | story_id+version_id；最多reading_choice/typed两题，选择题内部仍使用验签后的choice提交。 |
| EL-14 | 创建purpose=scene | scene_id=drinks；EL-15增加introduction/directions。Session三个items，各有task_key；结果不写ReviewEvent/FSRS。 |
| EL-16 | POST /api/practice-sessions/{id}/items/{item_id}/feedback | operation_id；已保存首答才可生成，返回text/correction/origin，模型verdict无权威。 |
| EL-17 | GET /api/today?budget_minutes=3\|8\|15 | plan预算说明，保持queue/target/remaining_due等旧字段；默认8分钟。 |
| EL-18 | POST /api/learning/durations | sample_id/submission_id/kind/active_ms；未知提交404，非有限或负数422，重复样本不累加。 |
| EL-19 | GET /api/today?budget_minutes=3&mode=recovery | 新增recovery_available，显式模式至多5到期、0新词。 |

## 服务接口与状态来源

- **EL-01**：get_content_revision(db: Session, resource_kind: str, resource_id: int) -> dict；advance_content_revision(db: Session, resource_kind: str, resource_id: int, changes: dict) -> dict。返回 identity(UUID字符串)、version(整数)。GET /api/cards/{id} 增加 content_revision；V3 使用 features 与 extensions 显式登记集合，未知功能拒绝恢复。
- **EL-02**：evidence_summary(db: Session, card_id: int, runtime: Runtime) -> dict。learning_evidence={revision, recall:{status,count,last_verified_at}, retention:{status}, application:{status}}；status 为 insufficient/verified/weak/stale/history_incomplete。输入事件先限定当前 identity+revision；旧事件不补造关联。
- **EL-03**：复用 EL-02 evidence_summary 与 LearningEvidence({evidence})；evidence_label(status: str) -> str 产生统一展示标签，旧 graduated 仍保留为解锁。统计新增 evidence_counts，不把它替代原题型正确率。
- **EL-04**：POST /api/learning/contacts {submission_id,card_id,revision,source,kind} -> {committed,contact_id,occurred_at}；kind=answer_visible/answer_audio。record_contact(db,payload,runtime)->dict；前端 recordContact({cardId,revision,source,kind})->Promise，recordVisibleCards(cards,source)->Promise；speak(text,btn=null,onStarted=null) 保持旧调用兼容。
- **EL-05**：merge_assistance(previous: list[str], added: list[str]) -> list[str]；前端 assistanceFor(scope,itemId)->string[] 与 markAssistance(scope,itemId,kind)->string[] 在本票定义并持久化题身份；复用 EL-04 的 recordContact/recordVisibleCards，不创建未来课程练习上下文。
- **EL-06**：visible_card_ids(text: str,cards: list[dict])->list[int]；课程/故事详情的目标载荷带 content_revision。revision资源类型扩展为 lesson/story；沿用 EL-04 recordVisibleCards，文本中未能可靠匹配的词形不能宣称完整接触观测。
- **EL-07**：POST /api/lessons/{level}/viewed {submission_id,revision} -> {committed,learning_progress}；GET课程返回 goal 和 learning_progress:{status,browsed_at,checked_count,passed_count}。lesson_status(generated,browsed,checked,passed)->str；生成可选稳定 operation_id，原无body调用继续兼容。
- **EL-08**：POST /api/practice-sessions {id,purpose:'lesson_check',lesson_id} -> Session；GET /api/practice-sessions/{id} -> Session；POST /api/practice-sessions/{id}/items/{item_id}/attempts {submission_id,answer,skipped} -> {committed,event_id,session}。register_purpose(name: str, selector: Callable)->None 与 submit_practice(db,session_id,item_id,payload,runtime)->dict 由本票定义。Session={id,purpose,status,items:[{id,card_id,revision,prompt,kind,assistance,token,status}],counts}；响应不含未展示标准答案。
- **EL-09**：注册 purpose='delayed_check'，创建体增加 window:'day'|'week'、pending_contact_ids:list[str]，后者只能降低完整性；Session增加 gap_seconds/window/integrity。GET /api/stats 增加 retention:{day,week,other}，各含 successes/count/assisted/skipped/covered。
- **EL-10**：GET /api/learning/recommendations -> {suggestions:[{id,purpose,reason,card_ids,prompts_cn,window}]}；注册 purpose='targeted'，POST共用练习上下文带card_ids；目标变化不替换。课程learning_progress追加本课 retention 统计，不能使用全站总回测代替。
- **EL-11**：POST /api/stories/generate 可接 {operation_id,include_new_target:false}；响应追加 content_revision/version_id/quality/check_material。validate_story(data:dict,known:set[str],support:set[str],mode:str)->list[str]；story_profile(mode:str)->dict。EL-11只启用normal；short由EL-12加入。
- **EL-12**：POST /api/stories/{story_id}/simplify {operation_id,version_id} -> StoryVersion；story_profile 增加 short={20,40,8,2}；GET故事版本必须保留原version_id与题材料，结果通过version_id隔离。
- **EL-13**：注册 purpose='story_check'，创建体 {id,purpose,story_id,version_id}；items.kind可为reading_choice/typed，reading_choice内部映射已验choice事件并按上下文purpose分列阅读结果，不影响FSRS。story_check_kinds(has_choice:bool,has_target:bool)->list[str]。
- **EL-14**：注册 purpose='scene'，创建体 {id,purpose,scene_id:'drinks'}；Session增加 task_goal/scene_id/rule_version，items.kind='scene_text'。submit_scene(db,session_id,item_id,payload,runtime)->dict；verdict=accepted/rejected/unknown。结果独立于ReviewEvent和FSRS。
- **EL-15**：场景scene_id增加 introduction/directions，均复用EL-14 Session/SceneAttempt；scene_tasks(scene_id:str)->list[str]返回固定三任务，未知场景404。所有规则拥有version与content_hash，旧结果按原规则只读展示。
- **EL-16**：POST /api/practice-sessions/{id}/items/{item_id}/feedback {operation_id} -> {text,correction,origin}；origin=model/template；只允许读取已保存首答。build_scene_feedback(db,session_id,item_id,runtime)->dict；回复不包含或覆盖权威verdict。
- **EL-17**：GET /api/today?budget_minutes=3|8|15 增加 plan:{budget_minutes,estimated_seconds,estimate_basis,mode}，原queue/target/review_count/new_count/remaining_due保留。budget_plan(due:list[dict],new:list[dict],minutes:int,new_remaining:int)->dict。当前分支独立于EL-01/证据功能。
- **EL-18**：POST /api/learning/durations {sample_id,submission_id,kind,active_ms} -> {committed,sample_id}，submission_id必须指向真实已保存作答；kind=review/new/reinforcement；estimate_seconds(samples:list[float],default:float)->float；GET today.plan.estimate_basis=default/personal。
- **EL-19**：GET /api/today 增加 recovery_available；显式GET /api/today?budget_minutes=3&mode=recovery 返回 mode=recovery，最多5到期/零新词。recovery_available(inactive_days:int,due_count:int)->bool；活跃日沿ADR-0002的非跳过真实事件。
- **EL-20**：extension_names_match(declared:list[str],actual:list[str])->bool；V3 registry统一导出/校验/映射角色，各feature只登记一处。删除无消费者的内部次数掌握/接触旁路，不删除公开字段/URL/既有事件缓存。
- **EL-21**：完整覆盖要求新增命名空间 EL-JOURNEY（与旧T01–T21不冲突），至少包含新装学习、旧库升级、V3换设备续学和故障恢复四个具名真实用例；不建立生产资格查询API。

- 既有run_write(db: Session, operation: Callable[[Session], T])->T持有事务；路由在它之前不能启动不可清理的写事务。
- 词汇题使用现有apply_attempt_in_transaction(db, cmd: AttemptCommand, runtime: Runtime, *, verified_question:dict|None=None)->AttemptResult。外层练习事务在同一临界区保存首答关联；不能再调用会自行commit的submit_attempt造成双事务。
- 练习状态来自first_event_id/first_task_attempt_id，不再复制一份权威correct或计分计数。后续练习保留单独结果，不覆盖首答。
- 保存同一提交优先回放，随后才校验新题签名/修订。保持缓存原事实，当前证据由新读取计算；不让重试刷新证据日期。
- 资源的数字ID只用于映射，identity+version与恢复代次用于拒绝旧响应。新增集合必须提供父引用和删除后的不可用快照边界。

EL-01同时定义ensure_content_revisions(db: Session)->None，仅为当前已存在内容补缺失identity/version，不创建学习事件；测试seed_card和fixture载入后调用它，生产内容创建在本身写事务中初始化身份。EL-03批量读取可提供evidence_summaries(db: Session,card_ids:list[int],runtime:Runtime)->dict[int,dict]，避免N+1。

## V3扩展与兼容

1. EL-01先在app/schemas/backup_v3.py定义register_extension(name:str, schema:type, parents:tuple[str,...], remap:Callable)->None。注册项同时用于导出、校验、ID映射与删除/插入拓扑；重复注册拒绝。
2. V3保留现有核心集合，增加features:list[str]和extensions:dict[str,list[dict]]。features明确列出该快照包含的已登记扩展，键必须一致；未知功能明确拒绝，不能静默丢数据。
3. 后续票在引入当票登记自己的集合。新应用读早期V3未有的新集合时在预览明确将为空；旧应用拒绝不认识的后期V3 features。不能声称所有V3版本互相可写兼容。
4. V2保留原严格协议；V1部分恢复不清空无关记录，实际改内容后新修订使旧证据成为历史。完整替换旧版本前预览所有当前新集合缺失，先生成V3安全副本。
5. EL-20仅将登记与映射owner收口到app/services/backup_v3_registry.py，并从原导入位置重导出register_extension，保留前置消费者的Python接口。contract不物理删除公共URL、旧字段或缓存。
6. 每票自己验证新集合的完整恢复；EL-21用所有集合在一起的双实例旅程检查组合，不替前置补数据保护。

## 前端职责和可访问入口

- EL-02的LearningEvidence({evidence})是统一证据视图；EL-03迁移各入口，不复制次数/概率推断。
- EL-04的recordContact/recordVisibleCards在真实显示或play开始后调用。pending独立存储命名空间，不把接触混进评分恢复入口。
- EL-05提供assistanceFor(scope,itemId)和markAssistance(scope,itemId,kind)。同一题帮助单向累积，刷新或关闭气泡不能清除。
- EL-07添加首页课程按钮data-testid=open-lessons，EL-08复用；EL-08 PracticePage处理词汇/选择，EL-14 ScenePage处理任务，均复用useLearningAttempt的真实保存确认。
- 新面板testid只是可访问结果元素定位，不能为测试添加伪造数据面板或生产调试端点。错误role=alert，保存状态role=status，输入有label。
- 现有底部导航包含emoji图标，测试优先按精确文本span“单词本”“故事”点击，不假设现有button完整可访问名只有中文。

## 测试支持接口

既有ec/ec_factory来自tests/conftest.py，ECEnv支持seed_card、set_time、fail_commit_once、snapshot、restart。appFactory已有fixture、seedCards、setTime、failCommitOnce、request，不新增虚构的seed_lesson方法。

EL-01为恢复时旧后台响应新增tests/support/llm_queue.py，最小内容：

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

e2e/support/server.py只在fixture含llm_responses时绑定QueuedLLM(fixture['llm_responses'])，每个应用独立队列，正常路由/事务仍真实。Python测试直接绑定ec.app.state.llm_client。场景超时可用QueuedLLM([TimeoutError('fixture timeout')])，绝不回退到真实网络。

夹具tables用于准备内容，不代表已完成学习。课程可用已有ec04-lesson.json；故事检查/简化需用各计划给出的含story_versions材料，不能用缺题旧故事假绿。Playwright普通成功调用不拦截伪造API响应。

## 规则和小提交

- EL-02仅当前修订、不同学习日首答至少两次且相隔24小时；旧来源不足；30天提示复测。
- EL-09窗口严格[24,72)小时/[7,14)天；新接触重分，当前题反馈不反过来取消自己；首处理辅助或跳过不得靠重试补独立分母。
- EL-11长度40–70、句长12、未知词形2；EL-12为20–40、句长8、未知词形仍2，支撑表不是个人已掌握证明。
- EL-17仅默认估算即可独立交付；EL-18主动时长至少5条、最近30条中位数、2–180秒；EL-19至少3个中断学习日且有到期才推荐。
- EL-14/15三轮规则判定；EL-16只增强表达，模型判分字段一律不进入能力/FSRS。
- 每计划两个可独立审查提交：真实可见闭环、边界恢复与兼容。纯文案/链接/状态更新并入对应任务，不另建计划。

## 执行与发布边界

当前授权是编写计划并发布GitHub Issues，不执行产品代码、真实迁移或部署。后续启动实施时再确认执行方法，按当时适用工作流执行；不要把本批文档检查当作RED/GREEN实际执行证据。
