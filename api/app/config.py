"""Runtime configuration (env vars, with defaults for this project)."""
import os

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "naqsha-nebius-424e")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")  # newest Gemini image models are served only from "global"
BUCKET = os.environ.get("ASSETS_BUCKET", f"{PROJECT}-assets")

# Every text and vision model runs on Nebius Token Factory: NVIDIA Nemotron open models (OpenAI-compatible API).
NEBIUS_BASE_URL = os.environ.get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/")
NEBIUS_API_KEY = os.environ.get("NEBIUS_API_KEY", "")
MODEL_ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b"
MODEL_SUPER = "nvidia/nemotron-3-super-120b-a12b"
MODEL_VISION = os.environ.get("MODEL_VISION", "nvidia/Nemotron-3.5-Super-VL")   # sees concept images, drawings, screenshots
VISION_MODELS = {MODEL_VISION, "nvidia/Nemotron-3.5-Super-VL"}
FALLBACKS = {MODEL_ULTRA: MODEL_SUPER, MODEL_SUPER: "nvidia/Nemotron-3_5-Lightning"}

MODEL_INTAKE = os.environ.get("MODEL_INTAKE", MODEL_SUPER)
MODEL_ARCHITECT = os.environ.get("MODEL_ARCHITECT", MODEL_ULTRA)
# Images stay on Gemini (Vertex AI): Token Factory serves no image-generation model.
MODEL_IMAGE = os.environ.get("MODEL_IMAGE", "gemini-nano-banana-2.1")
MODEL_IMAGE_HERO = os.environ.get("MODEL_IMAGE_HERO", "gemini-nano-banana-2.1")
# Fallbacks when the primary image model is rate-limited (each model has its own quota).
MODEL_IMAGE_FALLBACKS = os.environ.get("MODEL_IMAGE_FALLBACKS", "gemini-3-pro-image,gemini-3.1-flash-image")

# Web research for bylaws of cities Naqsha has no rule pack for yet.
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

MODEL_REVIEW = os.environ.get("MODEL_REVIEW", MODEL_VISION)         # the architect's self-review of the drawn plan (images)
MODEL_SETUP = os.environ.get("MODEL_SETUP", MODEL_INTAKE)           # the conversational setup agent (ADK)

PLAN_MAX_ATTEMPTS = int(os.environ.get("PLAN_MAX_ATTEMPTS", "3"))
# Big briefs: keep fixing past PLAN_MAX_ATTEMPTS (up to the hard cap) while every extra round still improves the best plan,
# and only within the planning time budget.
PLAN_MAX_ATTEMPTS_HARD = int(os.environ.get("PLAN_MAX_ATTEMPTS_HARD", "5"))
PLAN_EXTRA_BUDGET_S = float(os.environ.get("PLAN_EXTRA_BUDGET_S", "420"))
# Thinking level for fix rounds ("" = the model's default). MEDIUM was tried: a 1 kanal fix round came back fast but with 45
# failures, so fix rounds keep full thinking; time is saved by fewer rounds, the shorter review and the parallel build.
FIX_THINKING = os.environ.get("FIX_THINKING", "") or None
# Nemotron's reasoning for the plan JSON ("LOW" = off). Off by default: Ultra reasons at length before a 20k-token plan.
PLAN_THINKING = os.environ.get("PLAN_THINKING", "LOW") or None
SELF_REVIEW = os.environ.get("SELF_REVIEW", "1") not in ("0", "false", "no")
REVIEW_BUDGET_S = float(os.environ.get("REVIEW_BUDGET_S", "150"))  # the optional post-review revision never costs more
# The post-review revision edits a checked plan against a concrete list, and is checked again: it thinks less to land in time.
REVIEW_THINKING = os.environ.get("REVIEW_THINKING", "LOW") or None
# When planning already took this long or used every attempt, the review still critiques the drawings (its open issues are
# listed with the checks) but makes no revision: the checked plan is built as it is.
REVIEW_SKIP_AFTER_S = float(os.environ.get("REVIEW_SKIP_AFTER_S", "360"))
# The critique (Argon looking at the drawn floors) has its own timeout; it overlaps the 3D build, and the run goes on without
# it when it runs over.
REVIEW_CRITIQUE_S = float(os.environ.get("REVIEW_CRITIQUE_S", "90"))

# Identity Platform (email + password). The browser key is public by design (it identifies the project, not a secret),
# but it is still never committed: it comes from the environment.
AUTH_API_KEY = os.environ.get("NAQSHA_AUTH_API_KEY", "")
AUTH_PROJECT = os.environ.get("NAQSHA_AUTH_PROJECT", PROJECT)
# Key for the opaque comment-author handles in share payloads (set it in production; the fallback still never reveals ids).
HANDLE_SECRET = os.environ.get("NAQSHA_HANDLE_SECRET", "")

# ADK builds its own google-genai client from the environment; make local runs match Cloud Run.
os.environ.setdefault("GOOGLE_GENAI_USE_ENTERPRISE", "TRUE")
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", PROJECT)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", LOCATION)

# The plan fixer (agents/fixer.py): Nemotron edits the drafted plan with tools against the rules engine.
MODEL_FIXER = os.environ.get("MODEL_FIXER", MODEL_ULTRA)
FIXER_THINK = os.environ.get("FIXER_THINK", "1") not in ("0", "false", "no")
FIX_BUDGET_S = float(os.environ.get("FIX_BUDGET_S", "420"))
PLAN_DRAFTS = int(os.environ.get("PLAN_DRAFTS", "3"))   # quick drafts in parallel; the one with the fewest failures is fixed
REVIEW_MAX_ISSUES = int(os.environ.get("REVIEW_MAX_ISSUES", "4"))
PARALLEL_FIXERS = int(os.environ.get("PARALLEL_FIXERS", "2"))  # fixer agents on the best drafts at once; the better plan wins
