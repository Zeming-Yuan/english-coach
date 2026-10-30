# 入门词卡内容核对记录（EC-02）

`starter_cards.json` 是随应用分发的固定入门内容，加载时不调用 AI。

- 词目（10 个，唯一）：apple、banana、teacher、dog、house、book、water、hello、cat、school。
- 音标统一采用英式（RP）记法；释义为常用中文义项；每条包含一个完整英文例句及对应中文。
- `kind`（word）与 `difficulty`（basic）由 `app/services/starter_cards.py` 控制系统写入，
  内容文件不接受卡型字段，避免内容决定数据语义。
- 修改词目、释义或例句时须同步核对本记录与 `tests/test_starter_cards.py` 的固定词目断言。
