#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "deploy config check failed: $*" >&2
  exit 1
}

assert_file() {
  local path="$1"
  [[ -f "${ROOT_DIR}/${path}" ]] || fail "missing ${path}"
}

assert_contains() {
  local path="$1"
  local expected="$2"

  grep -Fq -- "${expected}" "${ROOT_DIR}/${path}" ||
    fail "${path} does not contain: ${expected}"
}

assert_not_contains() {
  local path="$1"
  local unexpected="$2"

  if grep -Fq -- "${unexpected}" "${ROOT_DIR}/${path}"; then
    fail "${path} must not contain: ${unexpected}"
  fi
}

assert_file "compose.yml"
assert_file "server/Dockerfile"
assert_file "assistant/Dockerfile"
assert_file "deploy/nginx/Dockerfile"
assert_file "deploy/nginx/nginx.conf"
assert_file "deploy/nginx/default.conf"
assert_file ".env.example"
assert_file ".github/workflows/docker.yml"
assert_file ".dockerignore"

assert_contains "compose.yml" "ghcr.1ms.run"
assert_contains "compose.yml" "ghcr.1ms.run/chaitin/magicchat"
assert_contains "compose.yml" "assistant:"
assert_contains "compose.yml" "container_name: mygod-postgres"
assert_contains "compose.yml" "container_name: assistant"
assert_contains "compose.yml" "container_name: mygod-server"
assert_contains "compose.yml" "container_name: mygod-nginx"
assert_contains "compose.yml" 'POSTGRES_DB: ${POSTGRES_DB:-magic-chat}'
assert_contains "compose.yml" 'POSTGRES_USER: ${POSTGRES_USER:-magic-chat}'
assert_contains "compose.yml" '${IMAGE_REGISTRY:-ghcr.1ms.run/chaitin/magicchat}/assistant:${IMAGE_TAG:-latest}'
assert_contains "compose.yml" 'AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-change-me}'
assert_contains "compose.yml" 'AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-change-me}'
assert_contains "compose.yml" 'AWS_ENDPOINT_URL_S3: ${AWS_ENDPOINT_URL_S3:-https://s3.example.com}'
assert_contains "compose.yml" 'AWS_REGION: ${AWS_REGION:-us-east-1}'
assert_contains "compose.yml" 'S3_BOOTSTRAP_ENABLED: ${S3_BOOTSTRAP_ENABLED:-false}'
assert_contains "compose.yml" 'POSTGRES_HOST: ${POSTGRES_HOST:-postgres}'
assert_contains "compose.yml" 'ADMIN_PASSWORD: ${ADMIN_PASSWORD:-change-me}'
assert_contains "compose.yml" 'PUBLIC_HOSTNAME: ${PUBLIC_HOSTNAME:-localhost}'
assert_contains "compose.yml" 'CLIENT_HTTPS_PORT: ${CLIENT_HTTPS_PORT:-443}'
assert_contains "compose.yml" 'ADMIN_HTTPS_PORT: ${ADMIN_HTTPS_PORT:-1443}'
assert_contains "compose.yml" 'PUBLIC_ASSETS_HOSTNAME: ${PUBLIC_ASSETS_HOSTNAME:-public-assets.localhost}'
assert_contains "compose.yml" 'PRIVATE_ASSETS_HOSTNAME: ${PRIVATE_ASSETS_HOSTNAME:-private-assets.localhost}'
assert_contains "compose.yml" 'TEMPORARY_ASSETS_HOSTNAME: ${TEMPORARY_ASSETS_HOSTNAME:-temporary-assets.localhost}'
assert_contains "compose.yml" 'AI_ASSISTANT_SECRET: ${AI_ASSISTANT_SECRET:-change-me}'
assert_contains "compose.yml" 'ASSISTANT_WEBSOCKET_URL: ${ASSISTANT_WEBSOCKET_URL:-ws://server:20080/api/app/ws}'
assert_contains "compose.yml" 'AGENT_MAX_TURNS: ${AGENT_MAX_TURNS:-50}'
assert_contains "compose.yml" 'LLM_BASE_URL: ${LLM_BASE_URL:-https://api.example.com}'
assert_contains "compose.yml" 'LLM_API_KEY: ${LLM_API_KEY:-change-me}'
assert_contains "compose.yml" 'LLM_MODEL_NAME: ${LLM_MODEL_NAME:-change-me}'
assert_contains "compose.yml" 'MCP_GATEWAY_URL: ${MCP_GATEWAY_URL:-https://mcp.example.com/mcp}'
assert_contains "compose.yml" 'MCP_GATEWAY_KEY: ${MCP_GATEWAY_KEY:-change-me}'
assert_contains "compose.yml" 'S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-false}'
assert_contains "compose.yml" 'PUBLIC_ASSETS_BUCKET: ${PUBLIC_ASSETS_BUCKET:-magicchat-public}'
assert_contains "compose.yml" 'PRIVATE_ASSETS_BUCKET: ${PRIVATE_ASSETS_BUCKET:-magicchat-private}'
assert_contains "compose.yml" 'TEMPORARY_ASSETS_BUCKET: ${TEMPORARY_ASSETS_BUCKET:-magicchat-temporary}'
assert_contains "compose.yml" 'TEMPORARY_ASSETS_EXPIRE_DAYS: ${TEMPORARY_ASSETS_EXPIRE_DAYS:-180}'
assert_contains "compose.yml" 'S3_ABORT_MULTIPART_DAYS: ${S3_ABORT_MULTIPART_DAYS:-7}'
assert_not_contains "compose.yml" "MYGOD_AI_ASSISTANT_SECRET"
assert_not_contains "compose.yml" "MYGOD_APP_SECRET"
assert_contains "compose.yml" "80:80"
assert_contains "compose.yml" '${CLIENT_HTTPS_PORT:-443}:443'
assert_contains "compose.yml" '${ADMIN_HTTPS_PORT:-1443}:1443'
assert_contains "compose.yml" 'https://127.0.0.1:443/nginx-healthz'
assert_not_contains "compose.yml" '${CLIENT_HTTPS_PORT:-443}:${CLIENT_HTTPS_PORT:-443}'
assert_not_contains "compose.yml" '${ADMIN_HTTPS_PORT:-1443}:${ADMIN_HTTPS_PORT:-1443}'
assert_contains "compose.yml" "./data/postgres/data:/var/lib/postgresql/data"
assert_not_contains "compose.yml" "./data/assistant/config:/app/config:ro"
assert_not_contains "compose.yml" "./data/server/config:/app/config:ro"
assert_contains "compose.yml" "./data/server/log:/app/log"
assert_contains "compose.yml" "./data/nginx/certs:/etc/nginx/certs:ro"
assert_contains "compose.yml" "./data/nginx/log:/var/log/nginx"

assert_not_contains "compose.yml" "rustfs"
assert_not_contains "compose.yml" "RUSTFS_"
assert_not_contains "compose.yml" "CLIENT_HOSTNAME"
assert_not_contains "compose.yml" "ADMIN_HOSTNAME"
assert_not_contains "compose.yml" "CONFIG:"
if grep -Fq -- "nginx.conf" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not mount nginx.conf; it must be baked into the nginx image"
fi
if grep -Fq -- "your-org" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not contain placeholder image namespace"
fi
assert_not_contains "compose.yml" "MYGOD_LLM_"
assert_not_contains "compose.yml" "APP_ID"
old_ai_assistant_name="god""dess"
if grep -Fqi -- "${old_ai_assistant_name}" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not contain old AI assistant naming"
fi

assert_contains ".dockerignore" "data"
assert_contains ".dockerignore" "**/node_modules"
assert_contains ".dockerignore" "**/dist"

assert_contains ".env.example" "PUBLIC_HOSTNAME=localhost"
assert_contains ".env.example" "CLIENT_HTTPS_PORT=443"
assert_contains ".env.example" "ADMIN_HTTPS_PORT=1443"
assert_contains ".env.example" "POSTGRES_DB=magic-chat"
assert_contains ".env.example" "POSTGRES_USER=magic-chat"
assert_contains ".env.example" "POSTGRES_HOST=postgres"
assert_contains ".env.example" "ADMIN_PASSWORD=change-me"
assert_contains ".env.example" "AWS_ENDPOINT_URL_S3=https://s3.example.com"
assert_contains ".env.example" "AWS_REGION=us-east-1"
assert_contains ".env.example" "S3_BOOTSTRAP_ENABLED=false"
assert_contains ".env.example" "S3_FORCE_PATH_STYLE=false"
assert_contains ".env.example" "PUBLIC_ASSETS_BUCKET=magicchat-public"
assert_contains ".env.example" "PRIVATE_ASSETS_BUCKET=magicchat-private"
assert_contains ".env.example" "TEMPORARY_ASSETS_BUCKET=magicchat-temporary"
assert_contains ".env.example" "TEMPORARY_ASSETS_EXPIRE_DAYS=180"
assert_contains ".env.example" "S3_ABORT_MULTIPART_DAYS=7"
assert_contains ".env.example" "PUBLIC_ASSETS_HOSTNAME=public-assets.localhost"
assert_contains ".env.example" "PRIVATE_ASSETS_HOSTNAME=private-assets.localhost"
assert_contains ".env.example" "TEMPORARY_ASSETS_HOSTNAME=temporary-assets.localhost"
assert_contains ".env.example" "ASSISTANT_WEBSOCKET_URL=ws://server:20080/api/app/ws"
assert_contains ".env.example" "AGENT_MAX_TURNS=50"
assert_contains ".env.example" "LLM_BASE_URL=https://api.example.com"
assert_contains ".env.example" "LLM_API_KEY=change-me"
assert_contains ".env.example" "LLM_MODEL_NAME=change-me"
assert_contains ".env.example" "MCP_GATEWAY_URL=https://mcp.example.com/mcp"
assert_contains ".env.example" "MCP_GATEWAY_KEY=change-me"

assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf"
assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf"
assert_not_contains "deploy/nginx/Dockerfile" "/etc/nginx/templates"
assert_contains "deploy/nginx/Dockerfile" "EXPOSE 80 443 1443"

assert_contains "deploy/nginx/nginx.conf" "upstream mygod_server"
assert_contains "deploy/nginx/nginx.conf" "include /etc/nginx/conf.d/*.conf"
assert_not_contains "deploy/nginx/nginx.conf" "rustfs"
assert_not_contains "deploy/nginx/nginx.conf" "mygod_s3"

assert_contains "deploy/nginx/default.conf" "listen 80 default_server"
assert_contains "deploy/nginx/default.conf" "listen 443 ssl default_server"
assert_contains "deploy/nginx/default.conf" "listen 1443 ssl default_server"
assert_contains "deploy/nginx/default.conf" "server_name _"
assert_contains "deploy/nginx/default.conf" 'return 301 https://$host$request_uri'
assert_contains "deploy/nginx/default.conf" "/etc/nginx/certs/tls.crt"
assert_contains "deploy/nginx/default.conf" "/etc/nginx/certs/tls.key"
assert_contains "deploy/nginx/default.conf" 'proxy_set_header Host $http_host'
assert_contains "deploy/nginx/default.conf" 'proxy_set_header X-Forwarded-Host $http_host'
assert_contains "deploy/nginx/default.conf" "root /usr/share/nginx/client"
assert_contains "deploy/nginx/default.conf" "root /usr/share/nginx/admin"
assert_contains "deploy/nginx/default.conf" "location /api/client/ws"
assert_contains "deploy/nginx/default.conf" "location /api/app/"
assert_contains "deploy/nginx/default.conf" "proxy_set_header Upgrade"
assert_contains "deploy/nginx/default.conf" "location /api/client/"
assert_contains "deploy/nginx/default.conf" "location /api/ {"
assert_not_contains "deploy/nginx/default.conf" '${CLIENT_HTTPS_PORT}'
assert_not_contains "deploy/nginx/default.conf" '${ADMIN_HTTPS_PORT}'
assert_not_contains "deploy/nginx/default.conf" '${PUBLIC_HOSTNAME}'
assert_not_contains "deploy/nginx/default.conf" "proxy_pass http://mygod_s3"
if [[ -e "${ROOT_DIR}/deploy/nginx/templates/default.conf.template" ]]; then
  fail "legacy nginx template must be removed"
fi

assert_contains "server/Dockerfile" "go build"
assert_contains "server/Dockerfile" "COPY server/migrations"
assert_contains "server/Dockerfile" "COPY api-docs"
assert_not_contains "server/Dockerfile" "config.example.yaml"
assert_contains "assistant/Dockerfile" "go build"
assert_contains "assistant/internal/config/config.go" 'AIAssistantAppID     = "00000000-0000-0000-0000-000000000001"'
assert_contains "assistant/internal/config/config.go" "DefaultAgentMaxTurns = 50"
assert_contains "server/internal/appregistry/ai_assistant.go" 'AIAssistantAppID          = "00000000-0000-0000-0000-000000000001"'

assert_contains "deploy/nginx/Dockerfile" "pnpm build"
assert_contains "deploy/nginx/Dockerfile" "COPY --from=client-build /src/client-web/dist /usr/share/nginx/client"
assert_contains "deploy/nginx/Dockerfile" "COPY --from=admin-build /src/admin-web/dist /usr/share/nginx/admin"

assert_contains ".github/workflows/docker.yml" "ghcr.io"
assert_contains ".github/workflows/docker.yml" "server/Dockerfile"
assert_contains ".github/workflows/docker.yml" "assistant/Dockerfile"
assert_contains ".github/workflows/docker.yml" "deploy/nginx/Dockerfile"
assert_contains ".github/workflows/docker.yml" "docker/build-push-action@v7"

echo "deploy config check passed"
