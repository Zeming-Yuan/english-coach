"""模型路由：按任务类型自动选择 DeepSeek 模型。

规则（2026-08-17 新价生效后，白天使用 = 高峰价）：
- BULK：词卡/例句/翻译/分类/摘要等批量生成
    → deepseek-v4-flash（输入 3 元、输出 9 元/1M）
- REASONING：讲解、debug、复杂问答、Agent 工具循环
    → deepseek-v4-pro（输入 9 元、输出 27 元/1M）

用法：model=route(Task.BULK)。以后想换模型只改这一个文件。
"""

from enum import Enum


class Task(str, Enum):
    """任务类型：决定路由到哪个模型。"""

    BULK = "bulk"             # 批量生成类：量大、任务简单、对推理要求低
    REASONING = "reasoning"   # 推理类：任务难、需要多步推理或工具调用


FLASH_MODEL = "deepseek-v4-flash"
PRO_MODEL = "deepseek-v4-pro"

ROUTES = {
    Task.BULK: FLASH_MODEL,
    Task.REASONING: PRO_MODEL,
}


def route(task: Task) -> str:
    """按任务类型返回模型名。"""
    return ROUTES[task]
