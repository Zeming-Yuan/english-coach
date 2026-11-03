# 可靠性计划的共享接口契约

日期：2026-10-30。本文是 16 张已确认 ticket 的配套接口表，不是额外 ticket 或实施任务。接口尚未实现；按下列 owner 落地。执行单票时读取本表、该票计划及父规格。新增接口不得使无依赖关系的票互相等待。

## 公共约束与归属

- 当前记忆状态复用现有 Review 数据形态，增加 ReviewEvent 和 ReviewBaseline；不引入两张需要全局双写的状态表。EC-03 保存旧行基线并选择有效最新状态，EC-15 最终收紧单卡唯一约束。
- EC-03 产出事务与幂等内核、浏览器提交客户端及单次pending存储函数；EC-04 交付React状态机和显式自评分的等待确认、失败重试及刷新恢复闭环。这是技术归属澄清，不新增 ticket 或阻塞边。
- EC-01 Settings增加learning_timezone="Asia/Shanghai"并验证IANA名称，生产Runtime使用该值；测试MutableClock不成为生产HTTP控制接口。
- EC-01 的兼容修复迁移使用新 revision b1c2d3e4f501，前序 a9f3e7d1c2b4；EC-03 事件迁移 b1c2d3e4f502；EC-15 约束迁移 b1c2d3e4f503。均为计划分配值，实施前检查未被占用，调整时同步引用。
- 每次请求使用干净 Session；路由在写模块之前不查询数据库。写模块拥有 BEGIN IMMEDIATE、commit 和 rollback，持锁覆盖读当前状态与幂等检查，恢复与学习提交使用同一写事务机制。兼容测试夹具改为同一测试引擎、每请求新 Session，完成请求后使观察 Session 的缓存失效。
- 所有提交缓存结果、追加事件、FSRS 和错词变化位于同一事务；事务失败不能发出成功响应。外部 AI 工作在提交后执行，以独立会话重查数据，无网络 I/O 占用写事务。

## EC-01：运行与测试接口

新增 app/runtime.py、app/services/llm_client.py。保留各生成模块名为 client 的可替换代理，按需创建 OpenAI 客户端，避免破坏现有 patch(client) 测试。

- Clock.now() -> datetime：返回 aware UTC。SystemClock 为生产实现；MutableClock 只存在测试支持中。
- Runtime(clock: Clock, learning_timezone: str = "Asia/Shanghai")：由请求读取应用 state，不用跨实例全局时钟。
- create_app(*, settings: Settings | None = None, runtime: Runtime | None = None, static_dir: Path | None = None) -> FastAPI：保留 app = create_app()，静态目录用绝对路径。
- get_runtime(request: Request) -> Runtime；get_db 继续是现有依赖入口，测试应用覆写为自己的 sessionmaker。
- LazyLLMClient(settings: Settings)：chat 属性在真正请求时初始化客户端；缺少配置抛 LLMNotConfigured，统一映射 HTTP 503，不输出密钥。
- Python 新 fixture ec：ECEnv，位于 tests/support/ec_env.py，由 tests/conftest.py 导出。ECEnv.client 是 raise_server_exceptions=False 的真实 TestClient；数据库在 tmp_path，通过 Alembic upgrade head 创建。ECEnv.engine: Engine 仅供迁移、约束及测试前置数据使用。
- ECEnv.seed_card(word: str = "apple", kind: str = "word", **fields: object) -> int：用现有 Card 模型创建并提交测试前置数据，返回真实 ID；默认 meaning="苹果"、example/example_cn=None，避免不相关 AI 毕业调用。
- ECEnv.set_time(iso: str) -> None：修改实例的 MutableClock；仅测试调用，不创建 HTTP 调试端点。
- ECEnv.fail_commit_once() -> None：为该引擎的 Session before_commit 安装一次性故障，下一次实际写事务抛 OSError；先完成 seed 再启用。
- ECEnv.snapshot() -> dict：EC-10 之前仅用于调试，不用于验收；EC-10 起调用 GET /api/export/backup 并只移除 exported_at 后返回，供恢复行为比较。
- ec_factory() -> ECEnv：与 ec 同构但拥有独立数据库，用于双实例恢复；每个 fixture 关闭 TestClient、会话和引擎。
- ECEnv.restart() -> None：重建同一数据库上的 TestClient 与 app，保留时钟和已落库数据。
- E2E 导入 e2e/support/test.mjs 的 test/expect。app fixture 提供 baseURL: string、request: APIRequestContext、databasePath: string（只供测试支持使用）、seedCards(cards: Array<object>) -> Promise<Array<number>>、setTime(iso: string) -> Promise<void>、failCommitOnce() -> Promise<void>。seedCards 通过测试 Python 子进程写入该临时库；时钟/故障由测试应用启动配置的控制文件传递，不创建生产控制端点。
- appFactory({fixture?: string}) -> Promise<AppFixture>：启动第二个隔离实例；其资源由 fixture teardown 清理。fixture 为 e2e/fixtures 下的 JSON 文件名，数据仅在应用启动前建立。
- e2e/support/fixture_loader.py：load_fixture(engine, payload: dict) -> None；支持现有模型表名与记录数组，按父表→子表插入并将 ISO 日期转 datetime。未来事件表由 EC-03 加入映射。每票负责自己新增样本文件的实际内容。
- npm --prefix frontend run test:e2e -- --ticket EC-XX：由 e2e/run.mjs 将参数转为 Playwright --grep 的整词标签；未知/空匹配非零。无过滤执行全部已交付用例。真实浏览器使用随测试安装的 Chromium，不要求系统 Edge。
- 两个 Playwright project：mobile=420×880、desktop=1280×720。测试页面均从 app.baseURL 导航；保留 trace/screenshot on failure，无固定 sleep。

## EC-03：学习提交数据与函数

新增 app/services/learning.py、app/schemas/learning.py、app/models/review_event.py、app/models/review_baseline.py、frontend/src/lib/learning.js。

AttemptCommand 的字段及类型：submission_id: UUID | None；card_id: int；source: Literal["study","lesson","story","card_detail","spelling","quiz","listening","mixed","reinforcement","legacy"]；kind: Literal["self_rating","typed","choice","related"]；answer: str | None；rating: Literal[1,2,3,4] | None；assistance: list[Literal["first_letter","length","live_feedback","answer_audio","answer_visible"]]；skipped: bool；question_token: str | None。默认 source=legacy、kind=self_rating、assistance=[]、skipped=False。严格拒绝未知枚举；self_rating 必须有 rating，非自评不得使用额外 rating 覆盖策略。

AttemptResult 字段：committed: Literal[True]；event_id: str；card_id: int；correct: bool | None；expected: str | None；scheduled: bool；next_due: str | None；graduated: bool；sentence_card_id: int | None。保留旧接口原有字段，适配器可以增补 normalized_answer、correct_word 或 details。

ReviewEvent 保存 command 的解释结果、aware UTC 对应时间、learning_timezone、learning_day、fingerprint、response JSON、command_json 及排期前后摘要。command_json 保存已规范化业务命令、已验题目上下文和原题目token，供恢复后重算指纹及安全回放。submission_id 唯一，旧调用自动生成随机 ID，但不声称旧调用跨请求幂等。ReviewBaseline 保存源旧行完整 JSON、选中当前状态依据、最后活动与累计次数；与真实事件分开。

物理字段由EC-03固定，后续迁移/恢复复用：

- review_events：id/submission_id为UUID字符串；card_id为活外键；source/kind/stage为协议枚举；occurred_at为UTC时间；learning_day为ISO日期字符串；learning_timezone为IANA名称；answer可空文本；correct可空布尔；skipped/scheduled布尔；assistance为JSON数组；self_rating/fsrs_rating可空整数；before/after为可空JSON；fingerprint字符串；command_json/response为JSON；session_id可空UUID字符串。
- review_baselines：id为UUID字符串；card_id活外键；source_review_id可空整数；source_kind为migration/legacy_import/contract_archive；raw为原始源行JSON；selected布尔；captured_at为UTC时间；last_activity可空UTC时间；cumulative_count非负整数；source_fingerprint为原始快照规范化hash且唯一。contract_archive仅审计，不再次加进迁移累计基数。
- 新表外键在既有删卡语义下级联删除；备份恢复保留raw原始源数据，映射外层card_id。历史中的未知日期不能从captured_at反推。

- app.services.write_transaction.run_write(db: Session, operation: Callable[[Session], T]) -> T：干净会话中先 BEGIN IMMEDIATE，operation 成功后 commit，异常 rollback 后原样抛出；不在路由中再提交。
- app.services.learning.canonical_attempt(cmd: AttemptCommand, *, verified_question: dict | None = None) -> str：对验证过且规范化的业务字段做排序 JSON 的 SHA256；不包含服务端时间、随机 event_id、题目随机签名或当前 due。需要验题时使用verified_question，不能相信请求自带的服务端上下文。
- app.services.learning.classify_attempt(cmd: AttemptCommand, expected: str) -> tuple[bool | None, int | None]：返回 correct 和 fsrs_rating。自评分返回 (None,rating)，typed 无辅助答对/错为 (True,3)/(False,1)，有辅助和选择题不排期，skipped 为 (None,None)。legacy 未分类事件不纳入可靠指标。
- app.services.learning.submit_attempt(db: Session, cmd: AttemptCommand, runtime: Runtime) -> AttemptResult：唯一原子业务入口，包含幂等回放/409、卡片404、标准答案、状态、事件与错词。只在提交后触发可选 AI。
- app.services.learning.apply_attempt_in_transaction(db: Session,cmd: AttemptCommand,runtime: Runtime,*,verified_question: dict | None = None) -> AttemptResult：由EC-03提供，要求调用者已在run_write内，不自行commit；EC-06批次调用它，避免嵌套事务。
- app.services.learning.get_memory_state(db: Session, card_id: int) -> Review | None；get_card_events(db: Session, card_id: int) -> list[dict]：只读接口。兼容期间仍能处理旧多行；所有选择规则集中在这两个接口。
- POST /api/reviews：旧 card_id/rating 仍可用；扩展字段按 AttemptCommand 解释。
- GET /api/cards/{id} 增加 memory_state: dict | null、learning_events: list、history_incomplete: bool，保留旧详情字段。learning_events 不把基线行装成真实作答。
- makePending(path: string, payload: object) -> {path: string,payload: object}：浏览器为缺少 submission_id 的 payload 设置 crypto.randomUUID()。
- sendPending(pending: {path: string,payload: object}) -> Promise<AttemptResult>：实际 fetch，失败抛含 status/detail 的 Error；同一个 pending 对象重试不换标识。

## EC-04：页面待确认记录

- EC-03已交付 savePending(scope: string,pending: object) -> boolean、loadPending(scope: string) -> object | null、clearPending(scope: string) -> void，属于 frontend/src/lib/learning.js；只保存单个待确认请求，不提供后台队列。savePending返回是否成功写入持久存储，失败仍保留内存请求。
- useLearningAttempt(scope: string) -> {phase: "idle" | "saving" | "saved" | "failed",result: AttemptResult | null,error: string | null,submit: (path:string,payload:object)=>Promise<AttemptResult>,retry: ()=>Promise<AttemptResult>,clear: ()=>void}，新增 frontend/src/hooks/useLearningAttempt.js。
- storage 失败时保留内存 pending，显示“本次操作尚未确认保存；刷新后可能需要重新核对”；不能因此换 ID 或伪造成功。
- 后续票不依赖此 hook：EC-05/06 可以直接使用 EC-03 的 makePending/sendPending 完成同等错误闭环；EC-04 若先落地可复用，但不得形成隐含阻塞。

## EC-05/06：客观题协议

- EC-05 在 POST /api/typing/check 上支持 AttemptCommand 的 typed，保留 correct/expected/normalized_answer。提交前辅助必须带 assistance；独立输入不按目标词长度截断、不提前判色或播放答案。EC-06把相关词题按规格作为带options的related选择题走quiz/score，而非继续客户端本地比较。
- EC-06 新增 app/services/questions.py：issue_question(card: Card,kind: str,options: list[str],expected: str,secret: bytes) -> dict，verify_question(token: str,secret: bytes,now: datetime) -> dict。HMAC 签名题目上下文绑定 card_id、kind、options、expected、expires_at；密钥由应用启动生成，同实例各请求一致，不从客户端接收。有效期默认 24 小时，重启失效时返回 409 并提示重新加载；导出不包含签名密钥。
- GET /api/quiz、/quiz/choice、/listening 返回 question_token；提交选择项文本 answer，不信任 correct_index。旧下标调用只有在能验证对应题目上下文时受理；否则 422 提示刷新题目，不静默造正确答案。
- POST /api/listening/score 保留 correct/correct_word/graduated/next_due；识别题 scheduled=False。跳过记录 correct=null。
- EC-06 的 submit_batch(db: Session,commands: list[AttemptCommand],runtime: Runtime) -> list[AttemptResult]：先全量校验、单次 run_write；POST /api/quiz/score 逐项去重，任意坏项整批失败，保留 total/correct/score/details。
- 用于幂等指纹的题目内容是验签后的业务上下文，不包含随机签名；回放先验证标识/指纹，再处理题目过期。若请求使用事件已保存的原token，采用持久化的已验上下文比较其余业务字段，不要求重启或恢复后用新密钥重验旧token；若token变更则必须重新验签。不同业务内容仍返回409，不能仅凭submission_id跳过比较。

## EC-08/09：统计公开字段

- EC-08 新增 app/services/statistics.py：learning_day(when: datetime,tz: str) -> str、summarize_activity(events: list[dict],today: str) -> dict、history_days(events: list[dict],start: str,end: str) -> list[dict]。事件学习日创建时持久化，历史不重分日。
- GET /api/stats 保留 reviewed_today（成功排期的 distinct card_id）、total_cards、graduated、streak；增加 attempted_today（非跳过事件）、skipped_today、history_incomplete。
- GET /api/stats/history 的 days 元素保留 date/reviews/new_cards，并增加 reviewed_words/skipped；reviews 是非跳过次数，new_cards 只按本卡第一条排期事件计一次，迁移基线不冒充首次新学。
- EC-09 的 metric(events: list[dict],category: str) -> dict 返回 {successes:int,count:int,percent:int | null}；category 为 retrieval/assisted/recognition/self_report。review_pass_rate 独立统计可排期事件；旧 this_week/accuracy 字段作为 review_pass_rate 别名并附 accuracy_kind="review_pass_rate"，UI 不误标客观正确率。
- adaptive_new_limit(events: list[dict],today: str) -> tuple[int,float | None,int]：近7日、按卡/日首次可排期事件，返回 limit/error_rate/sample_count；样本不足20不升至15，错误率>0.3降5，否则低于0.15且至少20升15，其余10。

## EC-10/11/12：备份与恢复

- EC-10 新增 GET /api/export/backup 为新版完整格式；保留原 GET /api/export/cards 的旧格式兼容（不标为完整），这样 EC-10/11 期间已有旧 roundtrip 测试仍可通过。
- 新增 app/services/backup.py：export_backup(db: Session,runtime: Runtime) -> dict；semantic_snapshot(payload: dict) -> dict，仅排除 exported_at；snapshot_revision(payload: dict) -> str，规范化排序数据后做 SHA256。
- V2 顶层字段固定：version=2、exported_at、learning_timezone、cards、reviews（当前状态）、learning_events、review_baselines、memos、errors、hard_cards、lessons、stories、story_words。行字段与对应模型业务列一致，导出所有当前 Card 字段和全部关联；id 在备份中唯一且用于引用。
- EC-11 新增 app/schemas/backup.py 和 app/services/restore.py：validate_backup(payload: dict) -> ValidatedBackup、preview_restore(db: Session,payload: dict,runtime: Runtime) -> dict、restore_backup(db: Session,payload: dict,expected_revision: str | None,runtime: Runtime) -> dict。
- ValidatedBackup 包含 version: Literal[1,2]、mode: Literal["legacy_partial","full_replace"]、tables: dict[str,list[dict]]、payload_digest: str。每种表字段按实际模型列定义强类型 Pydantic 模型；校验时间、枚举、有限数值、计数非负、ID唯一及全图引用。返回422时 detail包含 collection/index/field/reason。
- EC-11 只支持 version=1 的旧格式，V2 先明确422；EC-12 实现 V2。POST /api/import/preview 只校验并返回 {mode,counts,impact,expected_revision,payload_digest}；POST /api/import/cards 接受 {backup:dict,expected_revision:str} 的新界面请求，同时保留旧无版本平铺请求的兼容分支。
- V2 执行必须携带预览 revision；legacy 界面也携带。写锁内复核 revision；预览后数据库有新进度返回409并重新预览，不覆盖新活动。兼容旧平铺请求仍完整校验和原子保护，不获预览一致性承诺。
- persist_safety_backup(payload: dict,directory: Path) -> Path：写同目录临时文件、flush/fsync、os.replace 成最终文件，成功才执行替换；失败不修改数据库。保留全部安全备份，不自动清理。
- V2 替换先删子后删父、再父后子恢复；旧→新实体 ID 全表映射；事件 cached response 中 card_id/sentence_card_id 也映射，提交 UUID 不变。Legacy 对覆盖卡按 source id→(word,kind)→目标 id 映射，只恢复实际字段，不删未覆盖的内容；歧义安全拒绝。
- 成功结果包含 imported_words、requests（兼容旧字段）、mode、safety_backup_path。安全备份通过本机文件路径展示或提供受限下载（仅目录内已登记文件，不接收任意路径）。

## EC-13/14：每日会话

- EC-13 新增 app/services/daily_session.py：build_daily_queue(db: Session,limit: int,runtime: Runtime) -> dict，返回 {queue:list[dict],review_count:int,new_count:int,remaining_due:int,target:int}；review优先、同组错误/困难优先，排期到期排序稳定，单轮最多20。限制limit取5/10/15，不能用每日完成目标抬高新词配额。
- GET /api/today 保留 error_cards/new_cards/due_cards，并增加上述 queue 与计数；前端固定保存本轮 queue、target、session_id=crypto.randomUUID()，进度期间不重算目标。
- DailySession的前端形状为{id:string,queue:Array<Card>,target:number}。EC-13的StudyPage可选session:DailySession，EC-14增补onMainDone:(sessionId:string)=>Promise<void>；DailySessionPage({session:DailySession,onExit:()=>void})只做main/reinforcement/summary编排。EC-04独立于13，自己产生standalone session ID；13接入时使用传入会话ID和stage=main。
- EC-14 新增 build_reinforcement(events: list[dict],max_items: int=3) -> list[dict]：本轮按低分/错/跳过筛选，按card去重，最多3。选择原题的可用typed场景，预答辅助按真实规则标记。
- AttemptCommand 在 EC-03 预留 session_id: UUID | None 和 stage: Literal["main","reinforcement","standalone"]（默认standalone），事件/备份同时包含；这样 EC-14 不再改一次核心数据形状。
- GET /api/sessions/{session_id}/summary 和 /reinforcement：只从已提交事件计算；对未知会话返回404，零薄弱词返回空列表而非失败。完成页只使用 summary 读取结果。

## 文件归属与并发合入

共享文件按票顺序串行合入；不因文件重叠新增业务依赖。EC-05/06 都改 QuizPage，分别只迁移输入/选择分支；EC-08/09 只改统计各自职责；EC-10/11/12 复用同一 BackupPage，分别接导出/旧恢复/全量恢复。提交中不可夹带其他票未验收改动。

## 引用核对

浏览器 fixture、路由 abort/真实 fetch 再丢响应的用法按 [Playwright fixtures](https://playwright.dev/docs/test-fixtures)、[网络控制](https://playwright.dev/docs/network)；SQLite 写事务按 [SQLAlchemy SQLite 文档](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html)。使用这些文档核对适配方式，不把文档引用当作已运行验证。
