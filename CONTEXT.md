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
- **学习事件**（`ReviewEvent`）：每次被接受的学习提交追加一行（来源/题型/提示/可空正误/自评/排期摘要/提交标识/当前修订身份与版本）；只追加，不覆盖历史；`submission_id` 唯一保证重试幂等；升级前旧事件的修订关联为空，不补造
- **回忆证据**（LearningEvidence）：按当前内容修订的独立 typed 首答计算——同学习日只取首答，两个不同学习日且相隔 ≥24 小时才 `verified`；最近独立首答错误为 `weak`，超过 30 天为 `stale`，存在基线/legacy 事件/未绑定修订事件为 `history_incomplete`；辅助、识别、自评、跳过不进入独立样本；`retention` 只认有效一周回测独立首测成功；新独立错误待巩固，超过 30 天待复测；`application` 在对应功能前显式 `insufficient`
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

- **内容修订**（ContentRevision）：可编辑实体（card/lesson/story）的当前修订身份；`identity`（UUID）随实体保留，`version` 仅在词卡词形/释义/例句/语境、课程 title/content 或故事 title/content/翻译实质变化时递增（按资源类型取值），改排版、音标、讲解或记忆法不增加；迁移只为现有实体补当前身份，不造历史；作为 V3 扩展集合 `content_revisions` 导出/校验/重映射/恢复

- **练习轮次**（PracticeSession / PracticeItem）：持久短测轮次冻结用途、题序、内容修订与规则；题目只通过真实学习事件记录首答结果，未作答不暴露答案/长度/音频；提示持久标记为辅助，首答无提示全部正确才通过；作为 V3 扩展 `practice_sessions` / `practice_items` 导出/恢复。读后检查（story_check）绑定不可变故事版本，最多阅读识别与词汇输入各一道；回看先保存辅助标记，即时正确不等于延迟保持

- **课程进度**（LessonProgress）：每课一行 `lesson_progress`，记录生成身份/时间、显式浏览确认与后续检查计数；生成和浏览都不等于掌握，尚无短测时保持待检查；作为 V3 扩展 `lesson_progress` 导出/恢复，旧课缺行保持状态未记录

- **全量恢复**（full_replace）：V3 为当前导出；先校验完整备份数据图与扩展登记、预览数量、缺失集合与替换影响；写锁内复核修订、持久化 V3 安全副本后一次事务替换全部学习内容。扩展集合按登记表重映射 `resource_id` 并保留修订身份；V2/V1 恢复为新增内容建立新身份。活实体引用与提交缓存一起映射，原始迁移基线证据不改写；词卡 ID 由原生持久化分配器退役，空替换和重启后也不复用，防止旧后台响应写入恢复后的内容。旧版无版本号备份继续部分恢复。

- **卡片载荷**（CardPayload）：卡片对外形状的单一来源（`app/services/card_payload.py`）——队列版（轻量）/ 全量版（含毕业/错词/困难标记）/ 备份版（数据库列同构，导入导出对称）
- **AI 调用**（`app/services/llm.py`）：`generate_json(system, user, task)` → `dict | None`；**None 契约**：网络/超时/解析失败返回 None，调用方决定兜底；唯一例外是未配置密钥时的 `LLMNotConfigured`，统一映射 503；客户端/timeout/模型路由只在此处，每个应用实例独立绑定

## 历史决策（勿再重提）

- 2026-09-02 句子卡退出今日队列（语境复现职责归故事页）
- 2026-09-03 LLM 从 DeepSeek 切换 MiMo Token Plan（`model_router`：BULK=mimo-v2.5 / REASONING=mimo-v2.5-pro）
- **有限巩固**（Reinforcement）：主队列结束后，为本轮已保存的低分、答错或跳过词提供最多三道输入题；同卡只占一个槽位，可跳过整个阶段。辅助/识别答对不等于独立掌握；仍需复习项只有后续独立答对或明确高分才清除。本轮反馈只读取已保存事件与实际排期。

## 发行验收与回退

- EC-16 主命令从实际 Playwright/JUnit 结果核对 T01–T21 的具名分支和两个视口；开发票号过滤不代表整体验收。构建在本次临时目录生成，持久诊断记录 HEAD、工作区内容摘要和构建时间。
- 实际 `5868cd1` 只在 SQLite 备份副本上、SQLite 只读连接和 HTTP 修改保护下演练；旧 GET 自动翻译的隐式写入也会明确失败。原版不能承接新学习写入。
- [发行证据](docs/release-evidence.md) 与 [兼容边界](docs/release-compatibility.md) 是交接依据；最终集成全套命令未完成前不宣称父规格完成。

- 2026-10-31 最终集成验收：冻结实现 `3d1c453` 的完整 pytest 416 项、未过滤双视口 E2E 244 项及 T01–T21 全分支通过；生产构建/Ruff/audit 已验证，具体来源和未验证边界见发行证据。验后记录提交只改文档，不替代测试版本。

- 分票发布：EC12/EC07/EC13/EC15/EC14 已按序通过 PR31–35 合并；EC16 候选核心/测试/锁/样式/JS 与已验 d0351fb 相同，缓存元数据递增至 v8。完整 416/244 仍归原冻结 3d1c453；本次定向 34 pytest/14 双视口场景、构建与 HTTP smoke 另见发行证据。合并记录以 GitHub 为准，未部署。

- **延迟回测**（DelayedCheck）：最多三道当前修订词题，按距应用内最后确认接触/非跳过作答的 UTC 实际间隔分隔日 `[24,72)` 小时、一周 `[7,14)` 天和其他；每词/学习日/窗口首测冻结，辅助/跳过不能被重做换成独立样本；轮次及真实锚点随 V3 恢复。

- EL-12：原版可显式生成独立简化版（20–40 词/句长 8/未知词形 2）；StoryVersion 增加 mode 与原版 UUID parent_version_id，原文/题目/操作独立且进入 V3。旧字段缺失为 normal/null，非法父图预览拒绝，删除保留墓碑。两版按实际展示记录词卡接触，EL-13 接通后各版独立检查，无轮次时显示未检查，有轮次时显示已有检查记录。SIMPLER_STORIES_ENABLED=false 可回退入口并保留读取/导出/恢复。
