"""Text and vision models on Nebius Token Factory (NVIDIA Nemotron, OpenAI-compatible API).

Callers keep building prompts with google-genai `Content`/`Part` objects (the image models are still Gemini), and this module
turns them into chat messages for Token Factory. A request that carries images goes to the vision model (Nemotron 3.5
Super VL) when the chosen model is text-only.

Robust JSON generation: streaming with a degeneration guard (e.g. `35.0000000…` loops), output caps, timeouts and retries.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import AsyncIterator

from google.genai import types
from openai import APIStatusError, AsyncOpenAI

from . import config

log = logging.getLogger("naqsha.llm")
NUM_RULE = "Write numbers with at most 2 decimal places (e.g. 35 or 52.5, never 35.000000)."


@lru_cache(maxsize=1)
def nebius() -> AsyncOpenAI:
    return AsyncOpenAI(base_url=config.NEBIUS_BASE_URL, api_key=config.NEBIUS_API_KEY, max_retries=4, timeout=600)


# ---- genai contents -> chat messages ---------------------------------------------------------------------------------
def _part_items(part) -> list[dict]:
    if isinstance(part, str):
        return [{"type": "text", "text": part}]
    if isinstance(part, types.Part):
        if part.text:
            return [{"type": "text", "text": part.text}]
        if part.inline_data and part.inline_data.data:
            b64 = base64.b64encode(part.inline_data.data).decode()
            return [{"type": "image_url", "image_url": {"url": f"data:{part.inline_data.mime_type or 'image/png'};base64,{b64}"}}]
    return []


def to_messages(contents, system: str | None) -> list[dict]:
    """str | Part | Content | a list of them -> chat messages (loose parts gather into one user turn)."""
    msgs: list[dict] = [{"role": "system", "content": system}] if system else []
    loose: list[dict] = []
    items = contents if isinstance(contents, list) else [contents]
    for it in items:
        if isinstance(it, types.Content):
            if loose:
                msgs.append({"role": "user", "content": loose})
                loose = []
            role = "assistant" if it.role == "model" else "user"
            parts = [x for p in it.parts or [] for x in _part_items(p)]
            if role == "assistant":
                msgs.append({"role": role, "content": "".join(x.get("text", "") for x in parts)})
            else:
                msgs.append({"role": role, "content": parts})
        else:
            loose += _part_items(it)
    if loose:
        msgs.append({"role": "user", "content": loose})
    # text-only user turns as plain strings (every model accepts that form)
    for m in msgs:
        if isinstance(m["content"], list) and all(x["type"] == "text" for x in m["content"]):
            m["content"] = "\n".join(x["text"] for x in m["content"])
    return msgs


def has_images(msgs: list[dict]) -> bool:
    return any(isinstance(m["content"], list) and any(x["type"] == "image_url" for x in m["content"]) for m in msgs)


def route(model: str, msgs: list[dict]) -> str:
    """A text-only model can't see images: such a request goes to the vision model."""
    if has_images(msgs) and model not in config.VISION_MODELS:
        return config.MODEL_VISION
    return model


def _cfg_get(cfg, name, default=None):
    v = getattr(cfg, name, None) if cfg is not None else None
    return default if v is None else v


def _system_text(si) -> str | None:
    if si is None or isinstance(si, str):
        return si
    if isinstance(si, types.Content):
        return "\n".join(p.text for p in si.parts or [] if p.text)
    return str(si)


def _thinking_off(cfg) -> bool:
    tc = _cfg_get(cfg, "thinking_config")
    return bool(tc and str(getattr(tc, "thinking_level", "") or "").upper() in ("LOW", "MINIMAL", "OFF"))


def _request(model: str, contents, cfg, system: str | None = None, max_tokens: int | None = None, json_mode: bool | None = None,
             thinking: bool | None = None) -> dict:
    system = system or _system_text(_cfg_get(cfg, "system_instruction"))
    msgs = to_messages(contents, system)
    model = route(model, msgs)
    req: dict = {"model": model, "messages": msgs, "max_tokens": max_tokens or _cfg_get(cfg, "max_output_tokens", 16384)}
    if json_mode if json_mode is not None else _cfg_get(cfg, "response_mime_type") == "application/json":
        req["response_format"] = {"type": "json_object"}
    think = (not _thinking_off(cfg)) if thinking is None else thinking
    if not think:
        req["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
    return req


@dataclass
class Chunk:
    """The slice of a genai stream chunk callers read: `.text` (empty while the model is reasoning)."""
    text: str = ""


class Degenerate(RuntimeError):
    pass


def degenerate(text: str) -> bool:
    tail = text[-160:]
    return len(tail) >= 160 and (len(set(tail)) <= 2 or re.search(r"(\d)\1{40,}$", tail) is not None)


def parse_json(text: str):
    t = text.strip()
    t = re.sub(r"^<think>.*?</think>\s*", "", t, flags=re.S)
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        s, e = t.find("{"), t.rfind("}")
        if s >= 0 and e > s:
            return json.loads(t[s:e + 1])
        raise


START_TIMEOUT = 420.0   # waiting for the stream to open (includes the client's own retries)
FIRST_CHUNK_TIMEOUT = 240.0
IDLE_TIMEOUT = 90.0     # between chunks once tokens are flowing (reasoning tokens count)


class Stalled(RuntimeError):
    pass


BUSY = (404, 429, 500, 502, 503, 504)


async def _create(req: dict, **kw):
    """One request; a model that is busy (after the client's own retries) is swapped for its fallback once."""
    try:
        return await nebius().chat.completions.create(**req, **kw)
    except APIStatusError as e:
        alt = config.FALLBACKS.get(req["model"])
        if alt and e.status_code in BUSY:
            log.warning("%s unavailable (%s); falling back to %s", req["model"], e.status_code, alt)
            return await nebius().chat.completions.create(**{**req, "model": alt}, **kw)
        raise


async def guarded_stream(model: str, contents, config_=None, **kw) -> AsyncIterator[Chunk]:
    """A streamed completion with timeouts, so a stalled stream is retried instead of hanging a run. Yields Chunk(text)."""
    req = _request(model, contents, config_, **kw)
    try:
        stream = await asyncio.wait_for(_create(req, stream=True), timeout=START_TIMEOUT)
    except asyncio.TimeoutError as e:
        raise Stalled("the model didn't start answering") from e
    it = stream.__aiter__()
    first = True
    while True:
        try:
            ch = await asyncio.wait_for(it.__anext__(), timeout=FIRST_CHUNK_TIMEOUT if first else IDLE_TIMEOUT)
        except StopAsyncIteration:
            return
        except asyncio.TimeoutError as e:
            raise Stalled("the model stopped answering") from e
        first = False
        if not ch.choices:
            continue
        yield Chunk(ch.choices[0].delta.content or "")


async def generate_text(model: str, contents, system: str | None = None, max_tokens: int = 16384, json_mode: bool = False,
                        thinking: bool = True) -> str:
    """One completion's text (non-streaming)."""
    req = _request(model, contents, None, system=system, max_tokens=max_tokens, json_mode=json_mode, thinking=thinking)
    resp = await _create(req)
    return resp.choices[0].message.content or ""


async def stream_json(model: str, contents, system: str, max_tokens: int, attempts: int = 2,
                      on_progress=None, thinking: str | None = None) -> AsyncIterator[tuple[str, object]]:
    """Yields ("progress", chars) while streaming and finally ("result", (obj, text)). `thinking` "LOW" turns the model's
    reasoning off for quick calls. Degenerate, unparsable or stalled output is retried."""
    last_err: Exception | None = None
    think = not (thinking and thinking.upper() in ("LOW", "MINIMAL", "OFF"))
    for attempt in range(attempts):
        text = ""
        try:
            async for chunk in guarded_stream(model, contents, None, system=system + "\n" + NUM_RULE, max_tokens=max_tokens,
                                              json_mode=True, thinking=think):
                if not chunk.text:
                    continue
                text += chunk.text
                if degenerate(text):
                    raise Degenerate(f"degenerate output after {len(text)} chars")
                if len(text) // 2000 != (len(text) - len(chunk.text)) // 2000:
                    yield "progress", len(text)
            yield "result", (parse_json(text), text)
            return
        except (Degenerate, Stalled, json.JSONDecodeError) as e:
            log.warning("model output attempt %d failed: %s", attempt + 1, e)
            last_err = e
            continue
    raise RuntimeError(f"model output unusable after {attempts} attempts: {last_err}")


def adk_model(model: str, think: bool = True):
    """A Token Factory model for a Google ADK agent (through LiteLLM's OpenAI-compatible provider). `think=False` turns
    Nemotron's reasoning off for quick conversational turns."""
    from google.adk.models.lite_llm import LiteLlm
    extra = {} if think else {"extra_body": {"chat_template_kwargs": {"enable_thinking": False}}}
    return LiteLlm(model=f"openai/{model}", api_base=config.NEBIUS_BASE_URL, api_key=config.NEBIUS_API_KEY, num_retries=4, **extra)


async def describe_images(parts: list, ask: str) -> str:
    """Vision model's plain description of the image parts (for a text-only agent that needs to know what they show)."""
    imgs = [p for p in parts if isinstance(p, types.Part) and p.inline_data]
    if not imgs:
        return ""
    try:
        return await generate_text(config.MODEL_VISION, imgs + [ask], max_tokens=1500, thinking=False)
    except Exception:
        log.exception("describing images failed")
        return ""
