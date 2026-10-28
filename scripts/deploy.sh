#!/bin/zsh
# Build and deploy Naqsha (Nebius edition) to Cloud Run in its own GCP project. Keys come from Secret Manager.
# Scales to zero when idle; CPU stays allocated while an instance is up so a design run keeps going between requests.
set -e
cd "$(dirname "$0")/.."
export CLOUDSDK_ACTIVE_CONFIG_NAME=naqsha-nebius
P=naqsha-nebius-424e
gcloud run deploy naqsha --source . --region us-central1 --project $P \
  --service-account agent-runtime@$P.iam.gserviceaccount.com --allow-unauthenticated \
  --cpu 2 --memory 2Gi --timeout 3600 --concurrency 40 --min-instances 0 --max-instances 2 \
  --no-cpu-throttling --session-affinity \
  --set-env-vars GOOGLE_CLOUD_PROJECT=$P,GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_ENTERPRISE=TRUE,GOOGLE_GENAI_USE_VERTEXAI=TRUE \
  --set-secrets NEBIUS_API_KEY=nebius-api-key:latest,TAVILY_API_KEY=tavily-api-key:latest "$@"
