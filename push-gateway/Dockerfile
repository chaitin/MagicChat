FROM node:24-bookworm-slim AS admin-build
WORKDIR /src/push-gateway-web
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY push-gateway-web/package.json push-gateway-web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY push-gateway-web/ ./
ENV VITE_BASE_PATH=/admin/
RUN pnpm build

FROM golang:1.25.7-alpine AS gateway-build
WORKDIR /src/push-gateway
COPY push-gateway/go.mod push-gateway/go.sum ./
RUN go mod download
COPY push-gateway/ ./
COPY --from=admin-build /src/push-gateway-web/dist/ ./internal/httpserver/admin-dist/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/push-gateway ./cmd/gateway

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S gateway \
    && adduser -S -G gateway gateway
COPY --from=gateway-build /out/push-gateway /usr/local/bin/push-gateway
USER gateway
EXPOSE 20062
ENTRYPOINT ["/usr/local/bin/push-gateway"]
