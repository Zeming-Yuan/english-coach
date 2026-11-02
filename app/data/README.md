# 入门词卡内容核对记录（EC-02）

`starter_cards.json` 是随应用分发的固定入门内容，加载时不调用 AI。

- 词目（10 个，唯一）：apple、banana、teacher、dog、house、book、water、hello、cat、school。
- 音标统一采用英式（RP）记法；释义为常用中文义项；每条包含一个完整英文例句及对应中文。
- `kind`（word）与 `difficulty`（basic）由 `app/services/starter_cards.py` 控制系统写入，
  内容文件不接受卡型字段，避免内容决定数据语义。
- 修改词目、释义或例句时须同步核对本记录与 `tests/test_starter_cards.py` 的固定词目断言。

## EL-11 故事支撑与入门材料（核对版本 2026-11-02）

- `support_words.json` 的 `el11-support-v1` 明确列出允许词形；它是教学支撑，不是个人已知词。大小写折叠，撇号保留，不扩展时态、复数或缩写。
- `app/services/story_quality.py` 的 `el11-starter-v1`：My small book / 我的小书，六组英文句子与自然中文逐句核对；标准词数和逐句长度通过确定校验，所有词形均来自该支撑表。理解题书/水/杯子以第一句书为唯一可定位答案；本票入门阅读不开放该题作答，不伪造结果。
- 正常生成的理解题须同时提供中文题干及三选项译文；原文、覆盖结果、证据句与题目材料以不可变版本保留。外部模型语义质量仍需独立评估，确定校验不代替理解保证。
