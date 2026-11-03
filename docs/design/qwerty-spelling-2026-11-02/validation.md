# 拼写交互验证记录

2026-11-02。当前预览为隔离样例 SQLite，不访问用户学习数据库。

## 已通过

- 最新 origin/dev 基线检查：7cfbafec2730294a6e74ed0d445bb9b5e79ffad9。
- Vite 生产构建通过，静态产物在 /tmp/ec-qwerty-final-static；字体随本地依赖提供。构建时提示 /static/style.css 在运行时加载，实际服务器已提供该文件和字体。
- 40 项相关浏览器检查通过，涵盖两种视口的 Qwerty 新交互、EC-05、EL-05 和 EC-07 单词详情拼写一致性。
- 前端库测试结果见 frontend-library-tests.log；本次没有执行全量后端 pytest。
- 原生 Chromium/CDP Enter/keyCode=229、合成 composition Enter 均不提前提交；普通 Enter 和提交按钮能提交，已保存后 Enter 继续下一题。没有宣称验证了真实系统输入法或读屏软件。
- 独立输入隐藏音标、长度和逐字正误；提示档逐字反馈只进入辅助记录，不更新排期。延迟响应期间不显示保存成功；失败保留输入，重试只写一次。
- 减少动态效果关闭反馈移动；桌面1488×1056与窄屏420×880实拍未见横向溢出；正常提交路径控制台与页面异常均为空。没有量化宣称60fps。
- 独立审查三项问题均先复现为失败测试，再修复并复查：IME默认提交、首字母读屏描述、已保存计数。

## 全站回归未通过

尝试执行未筛选的全站浏览器测试集（536项，4 workers）。中止前168项通过，22项失败，4项运行中被中断，其余未执行；没有全站全绿结论。随后使用本轮拼写修改之前构建的同一视觉基线，对这22个用例逐项复核，22项仍失败。基线复核将单例上限缩短为15秒，不能据此断言所有失败根因完全相同；其中听写用例可直接观察到首页已展开区域被旧测试再次点击收起，随后无法找到听写入口。

这些是带入的全站视觉基线及旧用例的未解决事项，未在本轮动画变更中扩大修复范围。旧构建重现失败的具体用例：

- EC-16 TTS provider timeout preserves saved learning
- EC-16 TTS provider error preserves saved learning
- EC-12 confirmed restore discards frozen daily and single-card practice
- EC-13 small library completes with keyboard and keeps specialist practice
- EC-13 specialist detour preserves the suspended daily round
- EC-13 standalone pending for the same card cannot count toward the daily session
- EC-14 unrelated late confirmation preserves saved reinforcement feedback
- EC-15 legacy-restore-then-input-and-choice-share-current-state
- EL-01 visible revision panel tracks semantic edits
- EL-01 v3 roundtrip preserves revision and keeps working
- EL-01 lost edit response replays without double revision
- EL-02 visible evidence panel states insufficient evidence
- EL-02 independent cross-day answers show verified recall
- EL-02 new failure changes verified recall to weak
- EL-02 assisted answers never become independent evidence
- EL-02 meaning edit moves old evidence to history
- EL-02 weak evidence never reads as mastery
- EL-07 twenty generated lessons never read as completed
- EL-09 pending contact refresh on form confirmation
- EL-09 pending contact refresh on global confirmation
- EL-09 pending contact refresh on accepted-replay confirmation
- EL-09 another tab seeing the answer reclassifies the result

## 本次执行入口

在本工作区，以外部目录提供本轮构建的静态产物：

```sh
EC_STATIC_DIR=/tmp/ec-qwerty-final-static EC_CHROMIUM_EXECUTABLE=/home/clusteradmin/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs --workers 4 --grep 'Qwerty |EC-05 |EL-05 |EC-07 single-card-independent-and-assisted-spelling-parity'
node --test frontend/src/lib/*.test.mjs
```

修改产品代码前先记录了失败测试，第一次失败为独立模式仍显示音标。新交互10项检查曾发现减少动态效果和按钮名称问题；后续12项专项及40项相关回归通过。全站中断运行期间源码保持冻结；最后仅收紧拼写页留白与跳过按钮宽度，并以新构建重新执行40项相关检查及截图/录屏。
