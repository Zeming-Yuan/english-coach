"""模型路由：按任务类型自动选择 MiMo 模型（Token Plan 包月订阅，无按量费用）。

规则（2026-09-03 从 DeepSeek 切换到 MiMo Token Plan）：
- BULK：词卡/例句/翻译/分类/摘要等批量生成
    → mimo-v2.5（轻快档，批量生成够用）
- REASONING：讲解、debug、复杂问答、Agent 工具循环
    → mimo-v2.5-pro（推理档）

用法：model=route(Task.BULK)。默认按任务路由；调用方传入
model_override（来自 LLM_MODEL 或设置页）可统一覆盖，换供应商只改配置。
"""

from enum import Enum


class Task(str, Enum):
    """任务类型：决定路由到哪个模型。"""

    BULK = "bulk"  # 批量生成类：量大、任务简单、对推理要求低
    REASONING = "reasoning"  # 推理类：任务难、需要多步推理或工具调用


FLASH_MODEL = "mimo-v2.5"
PRO_MODEL = "mimo-v2.5-pro"

ROUTES = {
    Task.BULK: FLASH_MODEL,
    Task.REASONING: PRO_MODEL,
}


def route(task: Task, *, model_override: str = "") -> str:
    """按任务类型返回模型名；显式覆盖优先。"""
    configured = model_override.strip()
    if configured:
        return configured
    return ROUTES[task]
