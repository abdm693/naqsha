#!/bin/zsh
# Creates the PUBLIC GitHub repo abdm693/naqsha (AGPL-3.0, detected from LICENSE) from this folder and pushes main.
set -e
cd "$(dirname "$0")/.."
export GH_TOKEN=$(gh auth token -u abdm693)
gh repo create abdm693/naqsha --public \
  --description "Describe a home or upload a drawing: Nemotron agents on Nebius Token Factory design a bylaw-checked floor plan, a walkable 3D model and photos from every angle." \
  --homepage "https://naqsha-963839790554.us-central1.run.app" --source . --remote origin --push
gh repo edit abdm693/naqsha --add-topic nemotron --add-topic nebius --add-topic ai-agents --add-topic architecture --add-topic threejs --add-topic tavily
print "license: $(gh api repos/abdm693/naqsha --jq .license.spdx_id)"
