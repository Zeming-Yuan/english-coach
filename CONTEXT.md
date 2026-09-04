# EnglishCoach 领域词汇

架构讨论（`/improve-codebase-architecture`、`/codebase-design`）用这套词；新增领域概念先加到这里。

## 学习内容

- **词卡**（`Card`，`kind=word`）：0-1 个单词的主体学习单元；正面词/音标/释义/例句/讲解/语境/相关词/意群
- **句子卡**（`Card`，`kind=sentence`）：词卡毕业后的延伸学习单元；关键词仍是 `word` 字段
  - **兜底句卡**：同步用词卡例句建的基础句卡（毫秒级，无 AI）
  - **阅读句**（`difficulty="reading"`）：后台 AI 升级后的复杂句（对话体优先 + 意群切分）；带 AI 生成的 `chunks`
- **意群**（`chunks`）：`{text, role}` 数组，`role ∈ subject | predicate | adverbial`；缺省前端启发式切分兜底

## 记忆与调度

- **复习记录**（`Review`）：FSRS 的入库形态（state/step/due/stability/difficulty/rating/review_count）
- **复习提交**（ReviewSubmission）：一次"提交复习"的完整语义域（`app/services/review_submission.py`）——FSRS 写回 + 错词追踪 + 毕业策略；**全库唯一的 Review 调度字段写回点**
- **毕业**（Graduation）：词卡 → 句子卡的触发；**全库唯一口径** `is_graduated` = FSRS state==2 或 review_count>=3（`app/services/graduation.py`）；毕业 ≠ 已建句卡（兜底先行，AI 升级幂等）
- **今日队列**（TodayQueue）：新课/到期卡/错词优先/困难词；句子卡**不进**队列（2026-09-02 决策，词库过 200 词可评估恢复）
- **错词追踪**（ErrorCard）：答错加权、答对清权，错误增强效应

## 练习

- **练习会话**（PracticeSession）：拼写/听写/测验/混合四种练习的会话状态机（`frontend/src/lib/practiceSession.js`）——装配、判分、反馈、切题、统计都在此；视图只渲染题型 UI
- **答案效果**（AnswerEffect）：题型 → 后端效果的策略（PracticeSession 内部）：听写=记一次复习（FSRS）；拼写/选择/填空=只记错词；**专属拼写练习例外** = 另记一次复习（rating 3/1）

## 数据与复用

- **卡片载荷**（CardPayload）：卡片对外形状的单一来源（`app/services/card_payload.py`）——队列版（轻量）/ 全量版（含毕业/错词/困难标记）/ 备份版（数据库列同构，导入导出对称）
- **AI 调用**（`app/services/llm.py`）：`generate_json(system, user, task)` → `dict | None`；**None 契约**：永不抛异常，调用方决定兜底/报错；客户端/timeout/模型路由只在此处

## 历史决策（勿再重提）

- 2026-09-02 句子卡退出今日队列（语境复现职责归故事页）
- 2026-09-03 LLM 从 DeepSeek 切换 MiMo Token Plan（`model_router`：BULK=mimo-v2.5 / REASONING=mimo-v2.5-pro）
