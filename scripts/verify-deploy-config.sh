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
assert_file "deploy/nginx/templates/default.conf.template"
assert_file "deploy/assistant/config.example.yaml"
assert_file "deploy/server/config.example.yaml"
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
assert_contains "compose.yml" '${IMAGE_REGISTRY:-ghcr.1ms.run/chaitin/magicchat}/assistant:${IMAGE_TAG:-latest}'
assert_contains "compose.yml" 'AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-change-me}'
assert_contains "compose.yml" 'AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-change-me}'
assert_contains "compose.yml" 'PUBLIC_HOSTNAME: ${PUBLIC_HOSTNAME:-localhost}'
assert_contains "compose.yml" 'CLIENT_HTTPS_PORT: ${CLIENT_HTTPS_PORT:-443}'
assert_contains "compose.yml" 'ADMIN_HTTPS_PORT: ${ADMIN_HTTPS_PORT:-1443}'
assert_contains "compose.yml" 'ASSETS_HOSTNAME: ${ASSETS_HOSTNAME:-assets.localhost}'
assert_contains "compose.yml" 'CONFIG: /app/config/config.yaml'
assert_contains "compose.yml" 'MYGOD_APP_SECRET: ${MYGOD_AI_ASSISTANT_SECRET:-change-me}'
assert_contains "compose.yml" "80:80"
assert_contains "compose.yml" '${CLIENT_HTTPS_PORT:-443}:${CLIENT_HTTPS_PORT:-443}'
assert_contains "compose.yml" '${ADMIN_HTTPS_PORT:-1443}:${ADMIN_HTTPS_PORT:-1443}'
assert_contains "compose.yml" "./data/postgres/data:/var/lib/postgresql/data"
assert_contains "compose.yml" "./data/assistant/config:/app/config:ro"
assert_contains "compose.yml" "./data/server/config:/app/config:ro"
assert_contains "compose.yml" "./data/server/log:/app/log"
assert_contains "compose.yml" "./data/nginx/certs:/etc/nginx/certs:ro"
assert_contains "compose.yml" "./data/nginx/log:/var/log/nginx"

assert_not_contains "compose.yml" "rustfs"
assert_not_contains "compose.yml" "RUSTFS_"
assert_not_contains "compose.yml" "CLIENT_HOSTNAME"
assert_not_contains "compose.yml" "ADMIN_HOSTNAME"
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

assert_contains ".env.example" "PUBLIC_HOSTNAME=localhost"
assert_contains ".env.example" "CLIENT_HTTPS_PORT=443"
assert_contains ".env.example" "ADMIN_HTTPS_PORT=1443"

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
assert_contains "deploy/server/config.example.yaml" "endpoint: \"https://s3.example.com\""
assert_contains "deploy/server/config.example.yaml" "access_key_id: \"\""
assert_contains "deploy/server/config.example.yaml" "secret_access_key: \"\""
assert_contains "deploy/server/config.example.yaml" "public: \"magicchat-public\""
assert_contains "deploy/server/config.example.yaml" "private: \"magicchat-private\""
assert_contains "deploy/server/config.example.yaml" "temporary: \"magicchat-temporary\""
assert_contains "deploy/server/config.example.yaml" "temporary_expire_days: 180"

assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf"
assert_contains "deploy/nginx/Dockerfile" "COPY deploy/nginx/templates /etc/nginx/templates"
assert_contains "deploy/nginx/Dockerfile" "EXPOSE 80 443 1443"

assert_contains "deploy/nginx/nginx.conf" "upstream mygod_server"
assert_contains "deploy/nginx/nginx.conf" "include /etc/nginx/conf.d/*.conf"
assert_not_contains "deploy/nginx/nginx.conf" "rustfs"
assert_not_contains "deploy/nginx/nginx.conf" "mygod_s3"

assert_contains "deploy/nginx/templates/default.conf.template" "listen 80 default_server"
assert_contains "deploy/nginx/templates/default.conf.template" 'listen ${CLIENT_HTTPS_PORT} ssl default_server'
assert_contains "deploy/nginx/templates/default.conf.template" 'listen ${ADMIN_HTTPS_PORT} ssl'
assert_contains "deploy/nginx/templates/default.conf.template" 'server_name ${PUBLIC_HOSTNAME}'
assert_contains "deploy/nginx/templates/default.conf.template" 'return 301 https://${PUBLIC_HOSTNAME}$client_https_port_suffix$request_uri'
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/tls.crt"
assert_contains "deploy/nginx/templates/default.conf.template" "/etc/nginx/certs/tls.key"
assert_contains "deploy/nginx/templates/default.conf.template" 'proxy_set_header Host $http_host'
assert_contains "deploy/nginx/templates/default.conf.template" 'proxy_set_header X-Forwarded-Host $http_host'
assert_contains "deploy/nginx/templates/default.conf.template" "root /usr/share/nginx/client"
assert_contains "deploy/nginx/templates/default.conf.template" "root /usr/share/nginx/admin"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/client/ws"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/app/"
assert_contains "deploy/nginx/templates/default.conf.template" "proxy_set_header Upgrade"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/client/"
assert_contains "deploy/nginx/templates/default.conf.template" "location /api/admin/"
assert_not_contains "deploy/nginx/templates/default.conf.template" 'server_name ${ASSETS_HOSTNAME}'
assert_not_contains "deploy/nginx/templates/default.conf.template" "proxy_pass http://mygod_s3"
assert_not_contains "deploy/nginx/templates/default.conf.template" 'CLIENT_HOSTNAME'
assert_not_contains "deploy/nginx/templates/default.conf.template" 'ADMIN_HOSTNAME'

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
