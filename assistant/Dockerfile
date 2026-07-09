FROM golang:1.25-alpine AS build

WORKDIR /src/assistant

COPY assistant/go.mod assistant/go.sum ./
RUN go mod download

COPY assistant/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/assistant ./cmd/assistant

FROM alpine:3.22

RUN addgroup -S app && adduser -S app -G app && \
  apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=build /out/assistant /app/assistant

RUN mkdir -p /app/log && chown -R app:app /app

USER app

ENTRYPOINT ["/app/assistant"]
