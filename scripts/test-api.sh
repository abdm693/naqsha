#!/bin/zsh
# A second local API on :8081 without auto-reload, for long end-to-end runs while the code is being edited.
cd "$(dirname "$0")/../api"
set -a; source ../.env; set +a
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8081
