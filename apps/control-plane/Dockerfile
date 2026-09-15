FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/certflow ./cmd/certflow

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/certflow /certflow
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/certflow"]
