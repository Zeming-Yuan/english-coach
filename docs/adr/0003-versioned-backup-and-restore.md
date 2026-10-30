# ADR-0003：版本化完整备份与恢复契约

- 状态：已采纳
- 日期：2026-10-30
- 票据：EC-10（导出）；EC-11/EC-12 复用本格式的恢复部分

## 背景

旧 `GET /api/export/cards` 只包含词卡、当前复习行、记忆法、错词四类数据，缺少学习事件、
迁移基线、困难词、课程、故事及词卡关联；导入侧按单词文本映射，会把同词的单词卡与句子卡
合并。恢复切片尚未实现，因此不能直接改变旧导出形状，否则会破坏既有往返测试与旧文件兼容。
备份需要一次逻辑一致的快照、稳定的实体标识和可比较的内容摘要，供后续恢复票复用。

## 决策

1. **新增 `GET /api/export/backup` 作为 V2 完整格式。** 顶层字段固定为
   `version=2`、`exported_at`、`learning_timezone`、`cards`、`reviews`、
   `learning_events`、`review_baselines`、`memos`、`errors`、`hard_cards`、
   `lessons`、`stories`、`story_words`。
2. **只导出白名单模型。** 集合与模型一一对应：`Card`、`Review`、`ReviewEvent`、
   `ReviewBaseline`、`Memo`、`ErrorCard`、`HardCard`、`Lesson`、`Story`、
   `StoryWord`。行字段与模型业务列一致，新增列自动进入备份；不遍历任意表，也不导出
   `Settings`、`alembic_version`、签名密钥、环境配置、语音缓存或浏览器偏好。
3. **实体标识用于引用。** 每个集合内 `id` 唯一；`reviews.card_id`、
   `learning_events.card_id`、`review_baselines.card_id`、`memos.card_id`、
   `errors.card_id`、`hard_cards.card_id`、`story_words.story_id/card_id` 均引用
   备份内的稳定 `id`。同词不同卡型是不同 `Card.id`，恢复时不得按单词文本合并。
   事件缓存响应与 `command_json` 保留原 ID 与题目 token，供恢复映射和回放；签名密钥
   不在数据库中，因此不进入备份。基线 `raw` 保持原始审计数据，活引用由外层 `card_id`
   单独映射。
4. **一次逻辑一致的快照。** 干净会话显式 `BEGIN` 读事务后读取全部集合；调用者已有
   事务时复用、不自行 commit。任何集合之间不提交，避免导出半份状态。
5. **导出时间与时区来自 Runtime。** `exported_at` 是 aware UTC ISO 时间，
   `learning_timezone` 是本次运行的学习时区；它们描述导出环境，不属于业务内容。
6. **语义比较与摘要。** `semantic_snapshot(payload)` 仅排除 `exported_at`；
   `snapshot_revision(payload)` 将各集合按 `id` 排序、剔除导出时间、按排序键序列化后
   取 SHA256。固定样本
   `{"version":2,"learning_timezone":"Asia/Shanghai","cards":[{"id":1,"word":"apple"}],...}`
   的摘要在 `tests/test_backup_v2.py` 固定为
   `4de0c10ff9d3247203427baba022721f1ae79c1e2092bb0eb92ecc405cdddca2`，
   后续恢复票必须使用同一契约。
7. **旧导出保留为兼容面。** `GET /api/export/cards` 与 Anki CSV 保持原形状，
   不宣称完整备份；EC-10 不改变旧导入行为，已有往返测试继续通过。
8. **本票只导出。** 恢复影响预览、校验与全量替换由 EC-11/EC-12 交付；界面不得把尚未
   实现的恢复按钮显示为可用。V2 是只读格式，撤回下载入口不删除用户已保存文件。

## 后果

- 备份文件体积随学习事件增长；这是完整历史可恢复的代价。
- 恢复逻辑必须按集合 ID 建立旧→新映射，并保留幂等提交标识；不能退回按单词文本恢复。
- 导出时间不参与业务等价比较；数据库内部自增 ID 在恢复后会重新映射，但备份内引用
  始终自洽。

## 回退

可隐藏设置中的下载入口或回到旧导出视图，但必须保留 V2 读取契约与已产生文件；
不得把旧的不完整导出重新标为完整备份，也不得以旧快照覆盖新学习数据。
