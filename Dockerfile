# ---- 1. Build the React SPA ----------------------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /src
COPY contracts ./contracts
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
RUN cd web && npm run build

# ---- 2. Python runtime: FastAPI + ADK, serves /api and the SPA -----------------------------------
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8080 WEB_DIST=/srv/web/dist
WORKDIR /srv
COPY api/requirements.txt ./api/requirements.txt
RUN pip install -r api/requirements.txt
COPY contracts ./contracts
COPY api ./api
COPY --from=web /src/web/dist ./web/dist
WORKDIR /srv/api
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
