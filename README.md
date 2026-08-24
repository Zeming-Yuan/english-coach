# EnglishCoach — 零基础英语 AI 学习工具

面向零基础英语学习者的 AI 个性化学习应用：AI 按需生成单词卡（音标/释义/对话体语境例句/讲解）→ 闪卡学习 + FSRS 间隔重复复习 → 课程式学习 → 产出型测验 → 学过的词 AI 编成故事阅读。全程发音（edge-tts 微软神经语音）。

## 功能

- **今日队列**：新词 + 按 FSRS 排期的复习卡，每日自动安排
- **闪卡学习**：翻面看释义 / 例句 / **AI 生成的两句对话语境**（聊天气泡样）
- **评分**：忘了 / 模糊 / 记得 / 太简单 → FSRS 决定下次复习时间；学习途中可随时退出
- **词毕业**：复习 3 次后例句自动变成句子卡继续学
- **课程式学习**：AI 20 级递进（音标启蒙→高频词→简单句→初级对话），词表点词评分、对话点句发音
- **测验**：中译英×3 + 选词 + 填空，**逐题判分 + 即时反馈 + 正确答案提示 + 错题汇总**
- **拼写练习**：Qwerty 风格——显示释义，键盘拼写，逐字实时校验（对绿错红）+ 音效
- **听写练习**：播发音 → 4 选 1，答对/答错都有音效反馈
- **单词本**：全部学过的词 + 搜索（词/释义/例句中文）+ A-Z 侧边快速导航 + **右键快速查阅浮层** + 点击进详情页（复习历史/毕业状态/语境气泡）
- **故事模式**：AI 用你学过的词编一篇英文小故事，点词看释义、评分、发音
- **加词**：输入想学的词（逗号分隔），AI 生成完整学习卡片
- **学习统计**：今日已学、累计词汇、🔥连续学习天数（streak）+ **GitHub 风格热力图**（最近 3 个月打卡日历）
- **发音**：edge-tts 英文神经语音，流式合成 + 缓存 + 单词本预加热，点击即播

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

> 首次使用：进「加词」页输入几个单词（如 `apple, banana, teacher`），AI 生成词卡后明天开始进入队列。也可以立即点「课程」从第 1 课开始零基础递进学习，或点「拼写练习」「听写练习」打开即练。

## 测试

```bash
python -m pytest                 # 83 个后端测试
node e2e_test.js                 # E2E（需 npx playwright + Edge）
node e2e_story.js                # 故事流程 E2E
```

## API 文档

启动后访问 `http://localhost:8001/docs`（FastAPI 自动生成）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/today | 今日队列（新词 + 到期卡） |
| GET | /api/stats / GET /api/stats/history | 学习统计 + streak / 历史热力图数据 |
| POST | /api/reviews | 评分提交（FSRS 调度） |
| GET | /api/quiz / POST | 测验题 / 逐题判分（typing/check） |
| POST | /api/typing/check | 打字判分 |
| GET | /api/cards / POST /api/cards/generate / GET /api/cards/{id} | 单词本 / AI 生成词卡 / 单词详情 |
| GET | /api/listening / POST /api/listening/score | 听写题 / 听写评分 |
| GET | /api/lessons / POST /api/lessons/next / GET /api/lessons/{level} | 课程进度 / 生成下一课 / 课程详情 |
| GET | /api/stories / POST /api/stories/generate / GET /api/stories/{id} | 故事 |
| GET | /api/tts/audio/{word} | 发音合成（流式 + 缓存） |

## 技术栈

FastAPI · SQLAlchemy 2.0 · SQLite · Alembic · DeepSeek API（OpenAI 兼容协议，模型 deepseek-v4-flash）· py-fsrs（FSRS 间隔重复）· edge-tts（英音合成）· 原生 JS 前端 · pytest · ruff · Playwright E2E

## 目录结构

```
app/
  models/       SQLAlchemy 模型（Card / Review / Story / StoryWord / Lesson）
  routers/      API 路由（today / reviews / quiz / cards / listening / lessons / stories / tts / health）
  services/     业务层（词卡生成 / FSRS 调度 / 毕业 / 故事生成 / 课程生成 / 判分 / 模型路由）
  static/       前端单页（index.html / style.css / app.js）
tests/          pytest 测试
data/           SQLite 数据文件（不提交）
```

## 开发规范

- 分支：`main`（稳定）← `dev`（开发）← `feature/xxx`；提交用 Conventional Commits
- 前端静态资源改动后：`index.html` 里 `?v=N` 版本号必须递增（防浏览器缓存）
- `.env` 永不入库（安全红线）；模型名统一走 `app/services/model_router.py`
