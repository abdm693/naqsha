"""Server-Sent Events over POST: an async generator of (event, data) tuples → text/event-stream with keepalive pings."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi.responses import StreamingResponse

from . import busy

log = logging.getLogger("naqsha.sse")


def _fmt(event: str, data) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n".encode()


def stream(gen: AsyncIterator[tuple[str, dict]], ping_every: float = 15.0) -> StreamingResponse:
    async def body():
        queue: asyncio.Queue = asyncio.Queue()

        async def pump():
            busy.set_notifier(lambda secs, _r: queue.put_nowait(("stage", {"stage": "wait", "message": busy.message(secs),
                                                                             "busy": True, "retry_in": round(secs) if secs else None})))
            try:
                async for ev in gen:
                    await queue.put(ev)
                await queue.put(("done", {}))
            except Exception as e:  # surface errors to the client as a final event
                log.exception("stream failed")
                await queue.put(("error", {"message": f"{type(e).__name__}: {e}", "recoverable": True}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(pump())
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=ping_every)
                except asyncio.TimeoutError:
                    yield _fmt("ping", {})
                    continue
                if ev is None:
                    break
                yield _fmt(*ev)
        finally:
            task.cancel()

    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
