"""Shared Gemini client (Gemini Enterprise Agent Platform / Vertex AI, `global` location)."""
from functools import lru_cache

from google import genai
from google.genai import types

from . import config

# Shared-quota 429s (and transient 5xx) on the `global` endpoint are retried with exponential backoff + jitter.
RETRY = types.HttpRetryOptions(attempts=6, initial_delay=4.0, max_delay=60.0, exp_base=2.0, jitter=1.0,
                               http_status_codes=[408, 429, 500, 502, 503, 504])


@lru_cache(maxsize=1)
def client() -> genai.Client:
    try:
        return genai.Client(enterprise=True, project=config.PROJECT, location=config.LOCATION,
                            http_options=types.HttpOptions(retry_options=RETRY))
    except TypeError:  # older SDKs
        return genai.Client(vertexai=True, project=config.PROJECT, location=config.LOCATION,
                            http_options=types.HttpOptions(retry_options=RETRY))
