# EnglishCoach 领域词汇

架构讨论（`/improve-codebase-architecture`、`/codebase-design`）用这套词；新增领域概念先加到这里。

## 学习内容

- **词卡**（`Card`，`kind=word`）：0-1 个单词的主体学习单元；正面词/音标/释义/例句/讲解/语境/相关词/意群
- **句子卡**（`Card`，`kind=sentence`）：词卡毕业后的延伸学习单元；关键词仍是 `word` 字段
  - **兜底句卡**：同步用词卡例句建的基础句卡（毫秒级，无 AI）
  - **阅读句**（`difficulty="reading"`）：后台 AI 升级后的复杂句（对话体优先 + 意群切分）；带 AI 生成的 `chunks`
- **意群**（`chunks`）：`{text, role}` 数组，`role ∈ subject | predicate | adverbial`；缺省前端启发式切分兜底
- **入门词卡**（starter cards）：随应用分发的 10 张固定词卡（`app/data/starter_cards.json`），只在用户显式点击时按 word+kind 幂等添加，不由 AI 生成，也不自动给老用户填充

## 运行与配置

- **运行环境**（Runtime，`app/runtime.py`）：一次应用运行的时钟 + 学习时区（默认 `Asia/Shanghai`）；生产用 `SystemClock`，测试注入 `MutableClock`，请求经 `get_runtime` 读 `app.state`，不使用全局时钟
- **升级前备份**：Alembic 升级已有业务表的 SQLite 前，用 backup API 生成 `.bak-<时间戳>` 并通过 `integrity_check`，才继续迁移

## 记忆与调度

- **复习记录**（`Review`）：FSRS 的当前记忆状态入库形态（state/step/due/stability/difficulty/rating/review_count）；迁移 `b1c2d3e4f503` 先归档旧重复行，再以单卡唯一索引收口；`get_memory_state` 只读唯一当前行，旧行仍可从基线追溯
- **学习事件**（`ReviewEvent`）：每次被接受的学习提交追加一行（来源/题型/提示/可空正误/自评/排期摘要/提交标识）；只追加，不覆盖历史；`submission_id` 唯一保证重试幂等
- **迁移基线**（`ReviewBaseline`）：升级前旧 Review 行的原始快照，`selected` 标出当前状态来源；不是作答事件，不纳入客观正确率
- **学习提交**（LearningSubmission，`app/services/learning.py`）：所有评分入口的统一原子写模块——判分、事件、FSRS、错词与幂等回放；`run_write` 持有 `BEGIN IMMEDIATE`，路由不提交
- **复习提交适配器**（ReviewSubmission，`app/services/review_submission.py`）：旧函数签名（闪卡/听写）与后台升级接缝，内部委托学习提交模块
- **毕业**（Graduation）：词卡 → 句子卡的触发；**全库唯一口径** `card_is_graduated` = word 卡且（FSRS state==2 或 review_count>=3），句子卡永不毕业（`app/services/graduation.py`）；毕业 ≠ 已建句卡（兜底先行，AI 升级幂等）
- **今日队列**（TodayQueue）：单词卡的每日主队列，先取最多 20 张到期词，再取建议配额内新词；错词/困难标记只影响各组内优先级，未到期词不因此进入主队列。句子卡**不进**队列（2026-09-02 决策）
- **每日学习轮次**（DailySession）：开始时冻结去重队列、本轮目标与会话标识；已确认保存才推进，刷新可继续剩余卡片，剩余到期词另开下一轮。每日最低完成目标不改变本轮目标或新词配额
- **错词追踪**（ErrorCard）：答错加权、答对清权，错误增强效应

## 练习

- **练习会话**（PracticeSession）：拼写与测验的共享编排（`frontend/src/lib/practiceSession.js`）；听写与混合页各自管理保存确认、失败重试和推进。混合页将唯一 pending 与原队列保存在 `ec.mixed.pending`，重新进入该页后继续确认，不交给全局自评恢复条。
- **答案效果**（AnswerEffect）：服务端学习提交一次完成判分、事件与错词；无提示输入题按正误采用 FSRS 3/1，提示题和选择/听写只记事件与错词，跳过正误为空且不排期。混合入口仅增加 mixed 来源，不改变规则。

## 数据与复用

- **全量恢复**（V2 full_replace）：先校验完整备份数据图、预览数量与替换影响；写锁内复核修订、持久化安全副本后一次事务替换全部学习内容。活实体引用与提交缓存一起映射，原始迁移基线证据不改写；词卡 ID 由原生持久化分配器退役，空替换和重启后也不复用，防止旧后台响应写入恢复后的内容。旧版无版本号备份继续部分恢复。

- **卡片载荷**（CardPayload）：卡片对外形状的单一来源（`app/services/card_payload.py`）——队列版（轻量）/ 全量版（含毕业/错词/困难标记）/ 备份版（数据库列同构，导入导出对称）
- **AI 调用**（`app/services/llm.py`）：`generate_json(system, user, task)` → `dict | None`；**None 契约**：网络/超时/解析失败返回 None，调用方决定兜底；唯一例外是未配置密钥时的 `LLMNotConfigured`，统一映射 503；客户端/timeout/模型路由只在此处，每个应用实例独立绑定

## 历史决策（勿再重提）

- 2026-09-02 句子卡退出今日队列（语境复现职责归故事页）
- 2026-09-03 LLM 从 DeepSeek 切换 MiMo Token Plan（`model_router`：BULK=mimo-v2.5 / REASONING=mimo-v2.5-pro）
