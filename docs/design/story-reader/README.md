# 故事阅读页：暖白与陶土色

2026-11-02，用户选定 `reference.png`。这次实现的边界是故事列表、故事阅读及它们的导航外壳；没有重做首页、练习题或课程功能。

## 实现入口

- `frontend/src/views/StoriesPage.jsx`：保留真实故事、查词、加词、评分和接触确认；新增正文旁注布局、字号与译文控件。长文朗读按句请求，只有实际播放且包含目标词的片段才记录语音接触。
- `frontend/src/views/story-reader.css`：以 `.story-workspace` 隔离主题，避免改变其他页面。桌面使用正文和旁注两列，1023px 及以下使用查词抽屉。
- `frontend/src/components/StoryNavigation.jsx`：复用现有视图入口，提供桌面侧栏和手机导航。
- `frontend/src/lib/storyAudio.js`：适配现有 TTS 的 ASCII 标点与 200 字符限制，不改变页面里的原文。
- `frontend/src/App.jsx`：仅增加故事页样式入口和导航回调；同文件中原有 EL-09 改动不属于本次设计任务。

没有新增数据库字段、API、故事生成策略、学习证据规则、云端发布或外部 tracker 写入。目标词词表可以展开查看。已学词继续使用原有显式评分与保存失败重试；不是用阅读次数推算掌握。

## 视觉材料

- `reference.png`：用户确认的原始视觉稿。
- `desktop.png` / `mobile.png` / `mobile-lookup.png`：实际浏览器截图。
- `comparison.png` / `compare-typography.png` / `compare-dictionary.png`：参考在左、实现在右。
- 项目根目录 `design-qa.md`：视觉验收结论及范围限制。
- `verification.json`：实际检查结果，包括未通过的全量回归；不能据此宣称项目已可发布。

图标采用 [Phosphor React](https://github.com/phosphor-icons/react)（MIT）；英文字体采用 [Tinos](https://fontsource.org/fonts/tinos)（自托管 Fontsource 包）。中文继续沿用项目已有 Noto Sans SC 和系统字体。没有把整张生成图切成页面或为普通图标手绘 SVG。

## 验证与回退

```bash
npm --prefix frontend run build
node --test frontend/src/lib/*.test.mjs
.venv/bin/python -m pytest -q tests/test_frontend.py tests/test_stories.py
```

需要独立运行阅读页浏览器验收时，先准备临时静态目录，避免覆盖用户的数据：

```bash
cd frontend
node node_modules/vite/bin/vite.js build --outDir /tmp/ec-reader-static --emptyOutDir
cp ../app/static/style.css ../app/static/favicon.svg /tmp/ec-reader-static/
cd ..
EC_STATIC_DIR=/tmp/ec-reader-static node frontend/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs e2e/reader-design.spec.mjs
```

验收会使用已有夹具启动独立的 FastAPI、迁移数据库和外部服务替身。`reader-design.json` 仅用于样例和测试，不写入用户数据库。重新运行全项目验收时应先协调并发开发，冻结源文件后再执行。

回退只需撤销本次故事页源文件和 App 的两处接入，再重新构建静态资源；没有 schema 迁移或学习数据回退步骤。App 中其他任务的未提交改动必须保留，不应对整个文件执行覆盖或 checkout。
