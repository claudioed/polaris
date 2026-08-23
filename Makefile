.PHONY: generate test coverage integration mutation build run web-install web-test web-build web-dev

generate:
	go tool oapi-codegen -config api/oapi-codegen.yaml api/openapi.yaml

test:
	go test -race ./internal/...

coverage:
	@go test ./internal/domain/... ./internal/application/... ./internal/adapters/prometheus/... ./internal/adapters/httpapi/... \
	-coverpkg=./internal/domain/...,./internal/application/...,./internal/adapters/prometheus/...,./internal/adapters/httpapi/... \
	-covermode=atomic -coverprofile=coverage.out
	@go tool cover -func=coverage.out | awk '/^total:/ { gsub("%","",$$3); if ($$3+0 < 90) { print "coverage " $$3 "% is below 90%"; exit 1 }; print "coverage " $$3 "%" }'

integration:
	go test -tags=integration ./...

mutation:
	@go clean -testcache
	@go tool gremlins unleash ./internal/domain/fitness
	@go tool gremlins unleash ./internal/application

build:
	go build ./cmd/polaris

run:
	go run ./cmd/polaris

web-install:
	cd web && npm ci

web-test:
	cd web && npm run test && npm run lint

web-build:
	cd web && npm run build

web-dev:
	cd web && npm run dev
