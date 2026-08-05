# EnglishCoach — 零基础英语 AI 学习工具

面向零基础英语学习者的 AI 个性化学习应用：AI 按需生成单词卡（音标/释义/例句/讲解）+ 测验 + FSRS 间隔重复复习。

> 项目文档（需求 / 技术方案 / 开发规范 / 迭代计划）：见桌面 `EnglishCoach项目/` 文件夹

## 快速开始

```bash
# 1. 创建虚拟环境并安装依赖
python -m venv .venv
source .venv/Scripts/activate        # Windows Git Bash
pip install -r requirements.txt

# 2. 配置（复制模板并填入真实 API key）
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

# 3. 初始化数据库
alembic upgrade head

# 4. 启动
uvicorn app.main:app --reload

# 5. 打开 http://localhost:8000/docs 看 API 文档
```

## 测试

```bash
pytest
```

## 技术栈

FastAPI · SQLAlchemy 2.0 · SQLite · Alembic · Claude API · py-fsrs

## 目录结构

```
app/         后端（models / routers / services）
static/      前端单页
tests/       pytest 测试
data/        SQLite 数据文件（不提交）
```
