"""外部 AI 替身队列：只替换 app.state.llm_client，不伪造应用接口。

队列耗尽或显式放入异常时立即失败，绝不回落到真实网络。
"""

import json
from types import SimpleNamespace


class QueuedLLM:
    def __init__(self, responses, *, background_sentence_response=None):
        self.responses = list(responses)
        self.background_sentence_response = background_sentence_response
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        system = (kwargs.get("messages") or [{}])[0].get("content", "")
        if self.background_sentence_response is not None and system.startswith(
            "你是零基础英语老师。为目标单词生成一个用于阅读练习的句子。"
        ):
            item = self.background_sentence_response
        else:
            if not self.responses:
                raise RuntimeError("external fixture exhausted")
            item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(item)))]
        )
