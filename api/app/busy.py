"""Surface model back-off waits to the person watching.

The google-genai client (also used inside ADK) retries 429 / 5xx with exponential backoff and logs each wait through
tenacity's before_sleep hook ("Retrying ... in 21.3 seconds as it raised ..."). A logging handler turns those log lines
into a callback on the current pipeline (a ContextVar set by the run driver or the SSE pump), which emits a stage event
such as "Busy right now, retrying in 20 s".
"""
from __future__ import annotations

import contextvars
import logging
import re
import time
from typing import Callable

Notify = Callable[[float | None, str], None]
_current: contextvars.ContextVar[Notify | None] = contextvars.ContextVar("naqsha_busy_notify", default=None)
_last: contextvars.ContextVar[float] = contextvars.ContextVar("naqsha_busy_last", default=0.0)


def set_notifier(fn: Notify | None) -> contextvars.Token:
    return _current.set(fn)


def notify(seconds: float | None, reason: str = "") -> None:
    fn = _current.get()
    if fn is None:
        return
    now = time.monotonic()
    if now - _last.get() < 2.0:  # parallel calls back off together; one message is enough
        return
    _last.set(now)
    try:
        fn(seconds, reason)
    except Exception:  # never let a progress message break the pipeline
        logging.getLogger("naqsha.busy").exception("notify failed")


def message(seconds: float | None) -> str:
    if not seconds:
        return "Busy right now, retrying in a moment…"
    s = max(1, int(round(seconds / 5.0) * 5) or round(seconds))
    return f"Busy right now, retrying in {s} s…"


class _RetryLogHandler(logging.Handler):
    PAT = re.compile(r"in ([\d.]+) seconds")

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = record.getMessage()
        except Exception:
            return
        if "Retrying" not in msg:
            return
        m = self.PAT.search(msg)
        notify(float(m.group(1)) if m else None, "429" if "429" in msg or "RESOURCE_EXHAUSTED" in msg else "retry")


_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    lg = logging.getLogger("google_genai._api_client")
    lg.addHandler(_RetryLogHandler(level=logging.INFO))
    if lg.level == logging.NOTSET or lg.level > logging.INFO:
        lg.setLevel(logging.INFO)
    _installed = True
