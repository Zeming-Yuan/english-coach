# EL-13 实施与验证

日期：2026-11-02。票据：#49。固定审查基线：`6a6e41f6da0534099250d8f63b359e57f93e53c4`。
范围：F3/F4 的 AC17–19、AC35–37、AC39，仅本票路径。EL-08/#44、EL-11/#47 已关闭且实现存在于基线。
原工作区未提交的阅读器改版不进入本票；实现位于独立工作树 `codex/el13-story-check`。

测试 seam 沿用票据已确认边界：浏览器→真实 React→真实 FastAPI→真实迁移 SQLite/FSRS；
公开 HTTP 补充并发、事务故障、失效与恢复。只替换外部 AI/TTS 和时钟。
规格及实施计划采用 [GitHub #49](https://github.com/Zeming-Yuan/english-coach/issues/49) 正文，
本地源规划文件仍在原工作区，不将其他未提交规划文档混入功能提交。

## 执行裁定

- 现有 runner 已支持校验过的 `--ticket EL-NN`，故使用 EL-13 定向门禁；遵从用户只跑受影响部分的要求，不跑全库/未过滤发行门禁。
- 同轮同词唯一改为同轮同词同题型唯一，允许理解和输入各一道；增量迁移保留旧记录。
- 理解正常作答由服务端对冻结上下文重新签发 choice；已接受回放用原事件 token/业务上下文。
  跳过不判分，仍保存服务端冻结选项供反馈和恢复核对，密钥不备份。
- 新生成继续要求完整理解题；V3 兼容较早的缺题版本，只放宽缺少 check，仍验证正文/目标/覆盖/翻译。
- 轮次创建待确认使用独立 `ec.context.` 存储域；学习作答继续使用统一 `ec.pending.`，不把轮次创建伪装成学习事件。

## 红绿证据

- 首个 HTTP 闭环：422 不接受 story_check → 接通持久上下文与学习写事务后通过。
- V3 继续：预览拒绝新用途/版本字段 → 扩展 schema、图校验和映射后通过。
- 分类统计：缺 reading_checks → 从真实首答关联派生后通过。
- 浏览器闭环：双视口缺“读后检查”入口失败 → 两视口通过，确认输入时无原文/目标答案。
- 丢响应刷新：已保存答案没有可确认原题失败 → 优先恢复本题 pending 后通过。
- 跨故事复用同轮次最初返回 200 → 加入版本所属故事核对后 409。
- 缺理解材料版本不能恢复 → 保留严格生成校验并加缺题兼容读取后通过。
- 无效证据句/未校验依据仍发选择题 → 不发选择题、保留真实输入题。
- V3 首答修订/冻结题干被篡改仍被接受 → 恢复前拒绝；选项/版本断链同样拒绝。
- 跳过理解题原反馈使用卡片词形 → 改为故事正确选项，并保留统一跳过不排期。
- 回退配置测试的首次直接 CLI 运行缺少 EC_STATIC_DIR，随后误传 appFactory 不支持的 settings；
  两次均属准备错误，不计目标红灯。改用真实 fixture 后验证缺少配置注入会保留入口，补注入后复核。

## 验收映射

| 条件 | 自动证据 |
| --- | --- |
| AC17 最多两题、用途分开、辅助不独立 | HTTP 识别/输入排期、帮助恢复、首答保护；浏览器识别/独立结果、回看、首字母、choice-only/typed-only/empty |
| AC18 阅读/即时正确不计保持与每日词卡完成 | HTTP reviewed_words 与 retention 对比；旧故事浏览器无伪造题目；结果页明确即时检查 |
| AC19 原内容与失败恢复 | 既有 EL-11 缺 AI/非法内容/网络失败回归；本票创建/作答丢响应和 commit 故障 |
| AC35 原题、答案、身份 | 浏览器创建/答案两类故障均刷新后确认；已保存记录仅一条 |
| AC36 修订/删除/恢复 | HTTP 四类故事/词卡变化；浏览器拒绝旧答并返回原文；V3 另一实例继续原版本 |
| AC37 原子/幂等 | 创建/作答事务失败快照不变；并发同提交只一个事件；不同内容 409；跨故事/用途范围核对 |
| AC39 V3 业务等价 | 未答选择新实例签发；帮助/首答/版本/重映射恢复；非法图拒绝；旧格式缺失说明 |
| 回退 | HTTP 开关关闭创建但保留快照；双视口恢复历史后隐藏新入口；迁移拒绝删历史降级 |

## 已执行的阶段检查

- 受影响 Python 范围（EL-13/08/09/11、stories、full_restore、backup_v2、installation、release_coverage）：258 passed（284.55 秒）。后续收紧关联校验与跳过反馈的最终复核另记。
- EL-13 初始 11 分支：22 passed，`ec-e2e-static-ZsTwbn`。
- EL-08：16 passed，`ec-e2e-static-DRFrmW`；EL-11：38 passed，`ec-e2e-static-ZeG8Po`。
- 本票 HTTP 最后补强前：22 passed；受影响 Python pyright 0 errors/0 warnings；Ruff check/format 通过。
- 生产构建来自本工作树，更新已跟踪静态 JS/index；不混入原工作区设计产物。

## 最终门禁及审查

本票受影响门禁与双轴复审已完成，最终证据见末节；不扩展为父规格或全量发行门禁通过。

## 未验证 / N/A

本轮按用户要求未运行未过滤全量 pytest/E2E，不宣称父规格发行完成。
ESLint/前端类型配置、CI/Makefile、Docker Compose、独立安全扫描、变异测试、发布/部署：N/A（未配置或不涉及）。
权限模型沿用本地单用户；无新增账号、跨用户访问、依赖或付费调用。关联范围、错误码、并发和一致性由上述 HTTP/浏览器验证。
回退保留数据与恢复适配；没有不可逆业务数据迁移。真实付费模型语义质量未验证；自动规则不承诺理解全文。
原始日志在 `/tmp/el13-*.log`，正式双视口诊断在工作树 `e2e/release-results/`；准备失败/未过滤门禁未跑均不当作通过。

## 最终复核中的诊断

- 扩展检查共 329 项：326 passed、3 failed。其中本票测试错用历史接口字段 reviewed_words，
  已按真实 /api/stats 的 reviewed_today 更正，22 条本票 HTTP 重新通过。
- 另外两条旧迁移测试从当前 head 做破坏性 downgrade；在完全独立、由 `git archive 6a6e41f`
  导出的干净基线上复现同样两项失败（EL-11 的保护性拒绝）。对应既有后续票
  [#64](https://github.com/Zeming-Yuan/english-coach/issues/64)，保留原断言，不把基线故障算 EL-13 成功。
- 最终浏览器首轮 29 passed/1 failed：typed-only 的夹具替换与真实阅读接触写入竞争，
  预览修订正确返回 409。改为等待实际接触确认并离开原文后准备夹具；该分支双视口重跑 2 passed。
- 同浏览器恢复后，旧创建请求的 story_id 会过期；原本没有明确放弃入口，具名回归双视口失败。
  新增稳定确认/明确放弃创建控件后双视口 2 passed，可继续导入轮次且不追加重复轮次。

## 固定 diff 双轴审查与修复

首轮：`6a6e41f...c81f50e`，两个独立 reviewer（Standards / Spec）并行、只读审查。

### Standards

1 项 P2：恢复已保存的 pending 后，放弃仅清理子组件，父组件 activeItem 仍缓存旧题。
新增 choice/typed 两个具名分支，双视口先 4 failed，再通知父组件按已存轮次重选后 4 passed（39.3 秒）。
没有删除已存结果、重新判分或重复排期。同步 ADR、覆盖登记及生产构建。

### Spec

0 项发现。Reviewer 独立运行本票 HTTP 22 passed；未代替根代理浏览器/门禁证据。

汇总：首轮 Standards 1 项（最严重 P2，已修复），Spec 0 项；修复后在 46a8eb6 复审：Standards 0 项，Spec 0 项，无未处理的重要问题。

## 冻结实现的受影响验证

- `.venv/bin/python -m pytest tests/test_el13_story_reading_check.py tests/test_el08_lesson_recall_check.py tests/test_el09_delayed_recall_check.py tests/test_el11_bounded_personalized_story.py tests/test_stories.py tests/test_full_restore.py tests/test_backup_v2.py tests/test_installation.py tests/test_release_coverage.py tests/test_recognition_attempts.py tests/test_typed_attempts.py -q`：**305 passed**（326.82 秒）。两条历史 downgrade 问题仍明确归 #64，本轮未降低它们的断言。
- `c81f50e` 上正式 `npm --prefix frontend run test:e2e -- --ticket EL-13`：**32 passed**（16 分支×双视口，4.1 分钟），`ec-e2e-static-pBhtWV`。修复后新总数为 18 分支；最终完整本票结果见末节。
- 修复回归使用已构建静态产物的 Playwright 公开配置运行：choice/typed × mobile/desktop **4 passed**；对应 `/tmp/el13-review-abandon-{red,green}.log`，生产构建 `/tmp/el13-review-fix-build.log`。


## 最终结果

- 已验产品提交：`c81f50e`、`46a8eb6`。固定双轴复审范围：`6a6e41f...46a8eb6`。
- **Standards：0 项遗留发现**；首轮唯一 P2 已按浏览器红绿回归修复。
- **Spec：0 项发现**；独立复审无缺失、错误实现或范围扩张。
- 受影响 Python：**305 passed**。类型检查 **0 errors / 0 warnings**；Ruff check、format --check、覆盖校验器拒绝缺失/跳过/重试的自测与 diff --check 均通过。
- 最终正式命令 `npm --prefix frontend run test:e2e -- --ticket EL-13`：**36 passed**（18 个具名分支 × mobile/desktop，4.6 分钟）。
  报告 `e2e/release-results/ec-e2e-static-jx1yfM/`，`run.json status=passed`，每个分支每个视口恰一次通过，无缺失、跳过、失败或重试。
- 实际 HEAD：`46a8eb69d99ac2de871f65de4f9dac383e22318a`；源码 SHA256：`f3bc909aa52326c167c9f73c907684ad0469ab5a52f865d0dd2789e02e20c7c6`。
  独立按 `requirements.EL13` 和双视口清单核对全部 36 次执行，并逐文件比较验收构建资源与已提交 `app/static/assets`：**全部相同**。
- 生产构建通过，最终桌面与移动截图已检查。迁移、事务回滚、并发、恢复和功能回退均有真实隔离环境自动证据。
- 文档、上下文、ADR、源码与测试同步；没有新增账号权限、依赖、生产数据或密钥。原始工作区保留在原 `dev` / `6a6e41f`，本票工作树提交前无意外文件。
- 两条已在原基线复现的历史 downgrade 失败仍归 #64，不被隐藏、弱化或计作通过。本轮没有未完成的 EL-13 内容；未过滤全量门禁及 N/A 项保持上文说明。

本节之后的证据记录提交只修改此文档；产品源码与已验 `46a8eb6` 相同。

## 与已合入 EL-12 整合（2026-11-02）

来源：远端 `dev` 固定在 `76dbcfdf254d8686abb269ff211b827d3dd6f03b`（#67）。
九处文本冲突均保留两票意图；审查范围以该固定点到整合后的 HEAD 为准，只审计 EL-13 增量。

- 迁移头回归先断言失败（2 个 head），以不改旧 revision 的合流节点修复。
- 简化版读后题回归先得到 typed 一题，改用版本 mode 后同时得到理解选择和输入题。
- 版本导航在输入题暴露原文：浏览器双视口先 2 failed，导航移入回看保护后 2 passed（26.1 秒）。
- 原版/简化版各自检查身份和成绩隔离，简化版两题、首答及结果可跨实例 V3 恢复。
- 两侧旧迁移头分别向前升级、再次升级，原有词卡、练习轮次、冻结题目和帮助字段逐字段保持；单一 head。加强后的整合 HTTP/迁移测试 4 passed（5.08 秒）。
- 受影响 Python（原 11 个文件，加 EL-12 和整合文件）：342 passed，343.92 秒。
- 17 个本 PR 修改 Python 文件 Ruff check / format --check、Pyright：通过，0 errors / warnings。
- 生产构建、覆盖校验器自测、git diff --check 通过。冻结提交的正式浏览器与双轴审查结果另附。

未过滤全量门禁仍未验证；#64 两条历史 downgrade 夹具问题继续独立跟踪。
不新增账号/租户、生产数据、依赖或发布行为。入口功能回退与历史读取/V3 兼容保持。

### 整合后的冻结验收与复审

固定产品提交 `91221ab68883468b61fcd40a790b9f1b01a8d573`，源码指纹
`a99ec2af09c56006346a88d18bdeed4094057e0edaa0eddf5dc90d935a967f2b`。
三组正式命令均为 `npm --prefix frontend run test:e2e -- --ticket EL-NN`：

| 票 | 双视口执行 | 诊断目录 |
| --- | --- | --- |
| EL-11 | 38 passed | `e2e/release-results/ec-e2e-static-9ORJ6J` |
| EL-12 | 18 passed | `e2e/release-results/ec-e2e-static-0I576Y` |
| EL-13 | 38 passed | `e2e/release-results/ec-e2e-static-0STfDL` |

逐项核对 `requirements.EL11/EL12/EL13` 与实际 Playwright JSON：47 个具名分支 ×
mobile/desktop = 94 次，每项一次通过，无缺失、跳过、失败或重试；各 run.json 均 passed，
同一 HEAD/源码指纹。验收构建与生产 JS `index-BqXx22MY.js` 字节一致，SHA256
`eaca73a67c9570696532290d73cdeac7038815b3b7d7896b0e613230bc47d3ae`。
最终读后结果移动/桌面截图均已检查。

双轴审查固定非空范围 `76dbcfdf...91221ab`：Standards **0 findings**，Spec **0 findings**；
两名独立审查者分别运行整合 HTTP/迁移测试，各 **4 passed**。只审本 PR 增量，
未审全量仓库、未跑全量门禁。所有历史限制、#64、N/A 与功能回退说明继续有效。
后续证据提交只追加本节，产品源码与冻结验收提交相同。
