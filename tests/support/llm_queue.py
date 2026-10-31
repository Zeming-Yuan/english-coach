"""外部 AI 替身队列：只替换 app.state.llm_client，不伪造应用接口。

队列耗尽或显式放入异常时立即失败，绝不回落到真实网络。
"""

import json
from types import SimpleNamespace


class QueuedLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        if not self.responses:
            raise RuntimeError("external fixture exhausted")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(item)))]
        )
