FROM golang:1.25-alpine AS build

WORKDIR /src/server

RUN apk add --no-cache build-base

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.22

RUN addgroup -S app && adduser -S app -G app && \
  apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=build /out/server /app/server
COPY server/migrations /app/migrations
COPY api-docs /app/api-docs

RUN mkdir -p /app/log /app/data/push \
  && chmod 700 /app/data/push \
  && chown -R app:app /app

USER app

EXPOSE 20080

ENTRYPOINT ["/app/server"]
