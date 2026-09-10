FROM golang:1.25.7-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/push-gateway ./cmd/gateway

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S gateway \
    && adduser -S -G gateway gateway
COPY --from=build /out/push-gateway /usr/local/bin/push-gateway
USER gateway
EXPOSE 20062
ENTRYPOINT ["/usr/local/bin/push-gateway"]
