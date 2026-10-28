"""Detached runs: long agent pipelines (design, revise) keep going if the browser disconnects, and a client can re-attach
and replay every event so far (GET /api/projects/{pid}/run). One active run per project per instance; Cloud Run session
affinity routes the returning browser to the same instance.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import AsyncIterator, Callable

from . import busy

log = logging.getLogger("naqsha.runs")


class Run:
    def __init__(self, pid: str, kind: str):
        self.pid, self.kind = pid, kind
        self.started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.t0 = time.monotonic()
        self.last_stage: str | None = None
        self.events: list[tuple[str, dict]] = []
        self.done = False
        self._cond = asyncio.Condition()
        self.task: asyncio.Task | None = None

    async def _push(self, ev: tuple[str, dict]) -> None:
        async with self._cond:
            self.events.append(ev)
            self._cond.notify_all()

    async def _finish(self) -> None:
        async with self._cond:
            self.done = True
            self._cond.notify_all()

    def header(self) -> tuple[str, dict]:
        """The `run` event that starts every stream of this run (fresh or re-attached), so the client can reset its view and
        keep its timer: {kind, started_at, elapsed_s}."""
        return "run", {"kind": self.kind, "started_at": self.started_at, "elapsed_s": round(time.monotonic() - self.t0)}

    async def follow(self, start: int = 0, header: bool = True) -> AsyncIterator[tuple[str, dict]]:
        if header:
            yield self.header()
        i = start
        while True:
            async with self._cond:
                while i >= len(self.events) and not self.done:
                    await self._cond.wait()
                batch, i, done = self.events[i:], len(self.events), self.done
            for ev in batch:
                yield ev
            if done and i >= len(self.events):
                return


RUNS: dict[str, Run] = {}


def active(pid: str, kind: str | None = None) -> Run | None:
    r = RUNS.get(pid)
    return r if r and not r.done and (kind is None or r.kind == kind) else None


def start(pid: str, kind: str, make_gen: Callable[[], AsyncIterator[tuple[str, dict]]]) -> Run:
    run = Run(pid, kind)
    RUNS[pid] = run

    async def driver():
        loop = asyncio.get_running_loop()

        def on_busy(seconds, _reason):  # model back-off (429) -> a calm stage message instead of a silent wait
            ev = ("stage", {"stage": run.last_stage or "plan", "message": busy.message(seconds), "busy": True,
                            "retry_in": round(seconds) if seconds else None})
            loop.create_task(run._push(ev))

        busy.set_notifier(on_busy)
        try:
            async for ev in make_gen():
                if ev[0] == "stage" and not ev[1].get("busy"):
                    run.last_stage = ev[1].get("stage")
                await run._push(ev)
        except Exception as e:  # surfaced to every follower
            log.exception("run %s/%s failed", pid, kind)
            await run._push(("error", {"message": f"{type(e).__name__}: {e}", "recoverable": True}))
        finally:
            await run._finish()

    run.task = asyncio.create_task(driver())
    return run
