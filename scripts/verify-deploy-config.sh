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

assert_file "compose.yml"
assert_file "server/Dockerfile"
assert_file "assistant/Dockerfile"
assert_file "deploy/nginx/Dockerfile"
assert_file "deploy/nginx/nginx.conf"
assert_file "deploy/nginx/templates/default.conf.template"
assert_file "deploy/assistant/config.example.yaml"
assert_file "deploy/server/config.example.yaml"
assert_file ".github/workflows/docker.yml"
assert_file ".dockerignore"

assert_contains "compose.yml" "ghcr.1ms.run"
assert_contains "compose.yml" "ghcr.1ms.run/chaitin/mygod"
assert_contains "compose.yml" "rustfs/rustfs"
assert_contains "compose.yml" "assistant:"
assert_contains "compose.yml" "container_name: mygod-postgres"
assert_contains "compose.yml" "container_name: mygod-rustfs"
assert_contains "compose.yml" "container_name: assistant"
assert_contains "compose.yml" "container_name: mygod-server"
assert_contains "compose.yml" "container_name: mygod-nginx"
assert_contains "compose.yml" '${IMAGE_REGISTRY:-ghcr.io/chaitin/mygod}/assistant:${IMAGE_TAG:-latest}'
assert_contains "compose.yml" 'RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:-mygod}'
assert_contains "compose.yml" 'RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:-change-me}'
assert_contains "compose.yml" 'CLIENT_HOSTNAME: ${CLIENT_HOSTNAME:-client.localhost}'
assert_contains "compose.yml" 'ADMIN_HOSTNAME: ${ADMIN_HOSTNAME:-admin.localhost}'
assert_contains "compose.yml" 'ASSETS_HOSTNAME: ${ASSETS_HOSTNAME:-assets.localhost}'
assert_contains "compose.yml" 'CONFIG: /app/config/config.yaml'
assert_contains "compose.yml" 'MYGOD_APP_SECRET: ${MYGOD_AI_ASSISTANT_SECRET:-change-me}'
assert_contains "compose.yml" "80:80"
assert_contains "compose.yml" "443:443"
assert_contains "compose.yml" "./data/postgres/data:/var/lib/postgresql/data"
assert_contains "compose.yml" "./data/rustfs/data:/data"
assert_contains "compose.yml" "./data/assistant/config:/app/config:ro"
assert_contains "compose.yml" "./data/server/config:/app/config:ro"
assert_contains "compose.yml" "./data/server/log:/app/log"
assert_contains "compose.yml" "./data/nginx/certs:/etc/nginx/certs:ro"
assert_contains "compose.yml" "./data/nginx/log:/var/log/nginx"

if grep -Fq -- "nginx.conf" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not mount nginx.conf; it must be baked into the nginx image"
fi
if grep -Fq -- "your-org" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not contain placeholder image namespace"
fi
if grep -Fq -- "MYGOD_LLM_" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not contain assistant LLM settings; use deploy/assistant/config.example.yaml"
fi
old_ai_assistant_name="god""dess"
if grep -Fqi -- "${old_ai_assistant_name}" "${ROOT_DIR}/compose.yml"; then
  fail "compose.yml should not contain old AI assistant naming"
fi

assert_contains ".dockerignore" "data"
assert_contains ".dockerignore" "**/node_modules"
assert_contains ".dockerignore" "**/dist"

assert_contains "deploy/assistant/config.example.yaml" 'id: "00000000-0000-0000-0000-000000000001"'
assert_contains "deploy/assistant/config.example.yaml" 'secret: "change-me"'
assert_contains "deploy/assistant/config.example.yaml" 'websocket_url: "ws://server:20080/api/app/ws"'
assert_contains "deploy/assistant/config.example.yaml" 'base_url: ""'
assert_contains "deploy/assistant/config.example.yaml" 'api_key: ""'
assert_contains "deploy/assistant/config.example.yaml" 'model_name: ""'
assert_contains "deploy/assistant/config.example.yaml" "max_turns: 20"
assert_contains "deploy/assistant/config.example.yaml" "servers: []"

assert_contains "deploy/server/config.example.yaml" "postgres://app:app@postgres:5432/app?sslmode=disable"
assert_contains "deploy/server/config.example.yaml" 'ai_assistant_secret: "change-me"'
assert_contains "deploy/server/config.example.yaml" "endpoint: \"http://rustfs:9000\""
assert_contains "deploy/server/config.example.yaml" "access_key_id: \"\""
assert_contains "deploy/server/config.example.yaml" "secret_access_key: \"\""
assert_contains "deploy/server/config.example.yaml" "public: \"mygod-public\""
assert_contains "deploy/server/config.example.yaml" "private: \"mygod-private\""
assert_contains "deploy/server/config.example.yaml" "temporary: \"mygod-temporary\""
assert_contains "deploy/server/config.example.yaml" "temporary_expire_days: 180"

assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf"
assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/templates /etc/nginx/templates"

assert_contains "deploy/nginx/nginx.conf" "upstream mygod_server"
assert_contains "deploy/nginx/nginx.conf" "upstream mygod_s3"
assert_contains "deploy/nginx/nginx.conf" "include /etc/nginx/conf.d/*.conf"

assert_contains "deploy/nginx/templates/default.conf.template" "listen 80 default_server"
assert_contains "deploy/nginx/templates/default.conf.template" 'server_name ${CLIENT_HOSTNAME} ${ADMIN_HOSTNAME} ${ASSETS_HOSTNAME}'
assert_contains "deploy/nginx/templates/default.conf.template" 'return 301 https://$host$request_uri'
assert_contains "deploy/nginx/templates/default.conf.template" 'server_name ${CLIENT_HOSTNAME}'
assert_contains "deploy/nginx/templates/default.conf.template" 'server_name ${ADMIN_HOSTNAME}'
assert_contains "deploy/nginx/templates/default.conf.template" 'server_name ${ASSETS_HOSTNAME}'
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/client.crt"
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/client.key"
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/admin.crt"
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/admin.key"
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/assets.crt"
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/assets.key"
assert_contains "deploy/nginx/templates/default.conf.template" "root /usr/share/nginx/client"
assert_contains "deploy/nginx/templates/default.conf.template" "root /usr/share/nginx/admin"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/client/ws"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/app/"
assert_contains "deploy/nginx/templates/default.conf.template" "proxy_set_header Upgrade"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/client/"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/admin/"
assert_contains "deploy/nginx/templates/default.conf.template" "proxy_pass http://mygod_s3"

assert_contains "server/Dockerfile" "go build"
assert_contains "server/Dockerfile" "COPY server/migrations"
assert_contains "server/Dockerfile" "COPY api-docs"
assert_contains "assistant/Dockerfile" "go build"

assert_contains "deploy/nginx/Dockerfile" "pnpm build"
assert_contains "deploy/nginx/Dockerfile" "COPY --from=client-build /src/client-web/dist /usr/share/nginx/client"
assert_contains "deploy/nginx/Dockerfile" "COPY --from=admin-build /src/admin-web/dist /usr/share/nginx/admin"

assert_contains ".github/workflows/docker.yml" "ghcr.io"
assert_contains ".github/workflows/docker.yml" "server/Dockerfile"
assert_contains ".github/workflows/docker.yml" "assistant/Dockerfile"
assert_contains ".github/workflows/docker.yml" "deploy/nginx/Dockerfile"
assert_contains ".github/workflows/docker.yml" "docker/build-push-action@v7"

echo "deploy config check passed"
