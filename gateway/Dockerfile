FROM golang:1.27.3-alpine AS builder
RUN apk add --no-cache ca-certificates && apk upgrade --no-cache ca-certificates && update-ca-certificates

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /gateway .

FROM alpine:latest
RUN apk add --no-cache ca-certificates && apk upgrade --no-cache ca-certificates && update-ca-certificates

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /gateway /app/gateway

EXPOSE 8080

ENTRYPOINT ["/app/gateway"]
