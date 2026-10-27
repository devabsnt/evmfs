FROM node:22.23.4-alpine AS web-builder
RUN apk add --no-cache ca-certificates && apk upgrade --no-cache ca-certificates && update-ca-certificates
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27.3-alpine AS gateway-builder
RUN apk add --no-cache ca-certificates && apk upgrade --no-cache ca-certificates && update-ca-certificates
WORKDIR /app
COPY gateway/go.mod gateway/go.sum ./
RUN go mod download
COPY gateway/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /gateway .

FROM alpine:latest
RUN apk add --no-cache ca-certificates && apk upgrade --no-cache ca-certificates && update-ca-certificates
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=gateway-builder /gateway /app/gateway
COPY --from=web-builder /web/dist /app/web-dist
ENV STATIC_DIR=/app/web-dist
EXPOSE 8080
ENTRYPOINT ["/app/gateway"]
