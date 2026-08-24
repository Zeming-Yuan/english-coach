# EnglishCoach — 零基础英语 AI 学习工具

面向零基础英语学习者的 AI 个性化学习应用。核心闭环：**AI 生成词卡 → 间隔重复（FSRS）→ 产出型练习（拼写/听写/测验/混合）→ 情景记忆（语境/故事/记忆法）→ 学习科学持续优化**。全程发音（edge-tts 微软神经语音），本地运行。

## 学习科学设计（本项目的核心亮点）

| 科学原理 | 落地功能 |
|---|---|
| **间隔重复 / 遗忘曲线** | FSRS（py-fsrs）按个人记忆状态排下次复习，desired-retention 思想：近 7 天正确率自动调每日新词量（5/10/15） |
| **提取练习 (Retrieval)** | 拼写练习（Qwerty 式逐字反馈）、听写 4 选 1、测验逐题判分 |
| **生成效应 (Generation)** | 释义 → 主动拼写英文，比被动识别记忆深 |
| **错误增强 (Errorful Learning)** | 答错词加权入库（error_cards），优先重现，连续对 2 次减权 |
| **渐褪提示 (Fading Scaffolding)** | 拼写三档：教过（首字母）→ 提示（空格数）→ 独立（自由回忆） |
| **元认知校准 (JOL)** | 翻面前"先回想 3 秒"引导 + 过快翻面提醒，破除流畅性错觉 |
| **双重编码 (Dual Coding)** | AI 例句/故事强制"具体、有画面感、有情绪"（如 "The red apple rolled off the table into the dog's bowl."） |
| **交错练习 (Interleaving)** | 混合练习：拼写/听写/选择随机交错 |
| **自我解释 (Self-explanation)** | 每词可写自己的记忆法（谐音/联想），复习时展示 |
| **情绪记忆锚点** | streak、目标环、音效反馈、成绩单分享卡 |
| **睡眠巩固提醒** | 20 点后未学习时提示"睡前复习记忆最牢" |

## 功能全景（52 课迭代）

**核心学习**
- 今日队列：新词 + FSRS 到期卡 + 错词/困难词优先重现
- 课程式学习：AI 20 级递进（音标启蒙 → 高频词 → 简单句 → 场景对话）
- 闪卡学习：翻面对照 + 自动发音 + 语境气泡 + 评分（忘了/模糊/记得/太简单）
- 词毕业：复习 3 次 → 例句自动转句子卡继续学

**产出型练习**
- 拼写练习（三档难度、逐字绿/红校验、回车提交、音效）
- 听写练习（播发音 4 选 1）
- 测验（中译英×3 + 选词 + 填空，逐题判分、错题汇总可点进详情）
- 混合练习（三题型随机交错 + 完成页错题列表）

**内容与记忆**
- 故事模式：AI 用已学词编故事，整句朗读 + 点词弹卡评分
- 语境例句：两句对话体气泡（可"换一个"）
- 自我记忆法（谐音/联想/小故事）

**单词本**
- 搜索（词/释义/例句中文）+ A-Z 侧边导航 + 右键快速查阅
- 详情页：复习历史（评分标签）/毕业状态/错词数/困难词标记/例句发音
- 编辑/删除词卡（AI 生成错了可纠正）

**学习统计**
- 今日目标环（每日目标可设 5/10/15/20）、🔥 streak、错词入口
- 本周正确率 + 8 周趋势柱状
- GitHub 风格热力图（最近一年，hover 显示日期）
- 🏅 成绩单分享卡（canvas 生成，可存图进简历）

**数据与设置**
- 💾 全量备份 JSON 导出 + 📥 恢复导入（词库/复习/记忆法/错词）
- 🎴 Anki CSV 导出（UTF-8 BOM，无缝沉淀到你现有的 Anki 复习流）
- ⚙️ 设置：发音速度 / 每日新词量 / 暗色模式
- 新用户 5 分钟闭环：生成词后"马上学一学"不等明天

## 快速开始

```bash
# 1. 创建虚拟环境并安装依赖
python -m venv .venv
source .venv/Scripts/activate        # Windows Git Bash（PowerShell 用 .venv\Scripts\Activate.ps1）
pip install -r requirements.txt

# 2. 配置（复制模板并填入 DeepSeek API key）
cp .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY=sk-xxx

# 3. 初始化数据库
python -m alembic upgrade head

# 4. 启动（8001 是专有端口；8000 常被 WSL 占用）
python -m uvicorn app.main:app --reload --port 8001

# 5. 浏览器打开 http://localhost:8001
```

> 前端开发：`cd frontend && npm install && npm run dev`（Vite dev server，API 代理到 8001）
> 生产构建：`cd frontend && npm run build`（输出到 `app/static/`，FastAPI 直接挂载）

> 首次使用：进「加词」页输入几个单词（如 `apple, banana, teacher`）→ 点"马上学一学"立即开练；或从「开始零基础课程」走 20 级递进。

## 测试

```bash
python -m pytest                 # 106 个后端测试
node e2e_test.js                 # E2E（需 npx playwright + Edge）
node e2e_story.js                # 故事流程 E2E
```

## API 概览

启动后访问 `http://localhost:8001/docs`（FastAPI 自动生成）。

| 领域 | 端点 |
|---|---|
| 队列 | GET /api/today（含 error_cards 优先）、GET /api/stats /stats/history /stats/weekly |
| 学习 | POST /api/reviews（FSRS + 错词加权） |
| 词卡 | GET/POST/PUT/DELETE /api/cards/*、POST /api/cards/{id}/regenerate、/hard |
| 练习 | GET /api/quiz、POST /api/typing/check、GET/POST /api/listening* |
| 课程 | GET /api/lessons*（AI 20 级逐课生成） |
| 故事 | GET/POST/DELETE /api/stories* |
| 记忆法 | GET/PUT /api/memos/{card_id} |
| 发音 | GET /api/tts/audio/{word}（流式 + 缓存 + 预合成） |
| 数据 | GET /api/export/cards、/api/export/anki、POST /api/import/cards |

## 技术栈

FastAPI · SQLAlchemy 2.0 · SQLite · Alembic · DeepSeek API（OpenAI 兼容协议，deepseek-v4-flash / v4-pro 双模型路由）· py-fsrs（FSRS 间隔重复）· edge-tts（英音合成）· **React 19 + Vite**（Web Audio API 音效）· pytest（108 测试）· ruff · Playwright E2E

## 目录结构

```
app/
  models/       SQLAlchemy 模型（Card/Review/Story/StoryWord/Lesson/Memo/ErrorCard/HardCard）
  routers/      API 路由（today/reviews/quiz/cards/listening/lessons/stories/memos/tts/export）
  services/     业务层（生成器/FSRS/毕业/判分/错词追踪/模型路由）
  static/       构建产物（index.html + assets/），由 frontend/ 构建生成
frontend/       React 19 + Vite 源码（views/组件、lib/共享层）
tests/          pytest 测试
data/           SQLite 数据文件（不提交）
```

## 开发规范

- 分支：`main`（稳定）← `dev`（开发）← `feature/xxx`；提交用 Conventional Commits
- 前端静态资源改动后：`index.html` 里 `?v=N` 版本号必须递增（防浏览器缓存）
- `.env` 永不入库（安全红线）；模型名统一走 `app/services/model_router.py`
