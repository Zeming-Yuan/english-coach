def normalize(text: str) -> str:
    """归一化判分：小写 + 只留 ASCII 字母数字和空白 + 收尾空格"""
    return "".join(
        ch for ch in text.lower() if (ch.isascii() and ch.isalnum()) or ch in "'-" or ch.isspace()
    ).strip()


def make_fill_prompt(example: str | None, word: str) -> str:
    """example 里挖掉第一次出现的 word，找不到就原样返回。"""
    if not example:
        return ""
    idx = example.lower().find(word.lower())
    if idx == -1:
        return example
    return example[:idx] + "_" * len(word) + example[idx + len(word) :]
