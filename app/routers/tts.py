"""发音路由：用 edge-tts（微软 Edge 在线 TTS）合成单词/句子发音。

本地无英文语音包（Web Speech API 读成中文音）、外站音频 CDN 403/502，
所以选 edge-tts：免费、免 API key、音质接近真人。前端播同源音频字节流。

延迟优化：
1. 合成结果缓存（dict）——同一文本第二次起零等待
2. 完整合成后返回——避免把中途失败的音频当作成功交付
3. /preload 预合成——前端可提前暖缓存
"""

import io
import logging
import re
from collections import OrderedDict

import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter()

# 英文 TTS 音色（aria 女声）
VOICE = "en-US-AriaNeural"

# edge-tts 只适合短文本；句子限长，避免生成超长
MAX_TEXT_LEN = 200

# 合成结果 LRU 缓存（OrderedDict，满时淘汰最旧一半）
_cache: OrderedDict[str, bytes] = OrderedDict()
_CACHE_MAX = 500


async def _synthesize(text: str):
    """异步生成器：产出 mp3 分块（供流式发送）。"""
    communicate = edge_tts.Communicate(text, voice=VOICE)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            yield chunk["data"]


async def _synthesize_all(text: str) -> bytes:
    """一次性合成完整 mp3。"""
    buf = io.BytesIO()
    async for chunk in _synthesize(text):
        buf.write(chunk)
    return buf.getvalue()


def _cache_put(text: str, data: bytes) -> None:
    if len(_cache) >= _CACHE_MAX:
        # 淘汰最旧的一半（LRU）
        for _ in range(_CACHE_MAX // 2):
            _cache.popitem(last=False)
    _cache[text] = data
    _cache.move_to_end(text)


def _validate(text: str) -> str:
    """只允许字母/空格/常见标点（防注入超长文本）。"""
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    if len(text) > MAX_TEXT_LEN:
        raise HTTPException(status_code=400, detail="Text too long")
    # 冒号放行：对话体例句带 "A:/B:" 前缀，拒绝会让对话句无法朗读且预热报 400
    if not re.fullmatch(r"[A-Za-z0-9' ,.!?\-:]+", text):
        raise HTTPException(status_code=400, detail="Invalid characters")
    return text


@router.get("/tts/audio/{word}")
async def tts_audio(word: str):
    """合成单词发音；完整成功后才返回或缓存音频。"""
    text = _validate(word)
    cached = _cache.get(text)
    if cached is not None:
        _cache.move_to_end(text)
        return Response(content=cached, media_type="audio/mpeg")

    try:
        data = await _synthesize_all(text)
        if not data:
            raise ValueError("No audio returned")
    except Exception as exc:  # 外部合成故障必须在响应前报告
        logger.warning("TTS synthesis failed for %r: %s", text, exc)
        raise HTTPException(status_code=502, detail="Audio synthesis failed") from exc
    _cache_put(text, data)
    return Response(content=data, media_type="audio/mpeg")


@router.get("/tts/audio/{word}/preload")
async def tts_audio_preload(word: str):
    """预合成并入缓存（前端可提前调用，之后播放零延迟）。"""
    text = _validate(word)
    if text in _cache:
        _cache.move_to_end(text)
    else:
        try:
            data = await _synthesize_all(text)
            if data:
                _cache_put(text, data)
        except Exception as exc:  # noqa: BLE001 — 预热与播放使用相同的外部失败边界
            logger.warning("TTS preload failed for %r: %s", text, exc)
    return {"cached": text in _cache}
