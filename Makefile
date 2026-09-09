.PHONY: help
help: ## 显示帮助信息
	@echo "CertFlow - 可用命令："
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: setup
setup: ## 初始化开发环境
	@echo "设置开发环境..."
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "已创建 .env 文件，请编辑并添加必要配置"; \
	fi
	cd frontend && npm install

.PHONY: db-up
db-up: ## 启动 PostgreSQL 数据库
	docker compose up -d postgres
	@echo "等待数据库就绪..."
	@sleep 3

.PHONY: db-down
db-down: ## 停止 PostgreSQL 数据库
	docker compose down

.PHONY: db-reset
db-reset: ## 重置数据库
	docker compose down -v
	docker compose up -d postgres
	@sleep 3

.PHONY: backend-run
backend-run: ## 运行后端服务
	cd backend && go run ./cmd/certflow

.PHONY: backend-build
backend-build: ## 构建后端二进制文件
	cd backend && go build -o certflow ./cmd/certflow
	cd backend && go build -o dbinit ./cmd/dbinit

.PHONY: backend-test
backend-test: ## 运行后端测试
	cd backend && go test -v ./...

.PHONY: backend-test-coverage
backend-test-coverage: ## 运行后端测试并生成覆盖率报告
	cd backend && go test -v -race -coverprofile=coverage.out -covermode=atomic ./...
	cd backend && go tool cover -html=coverage.out -o coverage.html
	@echo "覆盖率报告已生成：backend/coverage.html"

.PHONY: backend-lint
backend-lint: ## 运行后端代码检查
	cd backend && go vet ./...
	cd backend && go fmt ./...

.PHONY: frontend-dev
frontend-dev: ## 运行前端开发服务器
	cd frontend && npm run dev

.PHONY: frontend-build
frontend-build: ## 构建前端生产版本
	cd frontend && npm run build

.PHONY: frontend-lint
frontend-lint: ## 运行前端代码检查
	cd frontend && npm run lint

.PHONY: run
run: db-up ## 启动完整开发环境（数据库+后端+前端）
	@echo "启动后端服务..."
	@cd backend && go run ./cmd/certflow &
	@echo "等待后端启动..."
	@sleep 3
	@echo "启动前端服务..."
	@cd frontend && npm run dev

.PHONY: test
test: backend-test ## 运行所有测试
	@echo "所有测试完成"

.PHONY: lint
lint: backend-lint frontend-lint ## 运行所有代码检查

.PHONY: build
build: backend-build frontend-build ## 构建所有组件

.PHONY: clean
clean: ## 清理构建文件
	rm -f backend/certflow backend/dbinit
	rm -f backend/coverage.out backend/coverage.html
	rm -rf frontend/.next
	rm -rf frontend/out

.PHONY: docker-build
docker-build: ## 构建 Docker 镜像
	docker compose build

.PHONY: docker-up
docker-up: ## 启动所有 Docker 服务
	docker compose up -d

.PHONY: docker-down
docker-down: ## 停止所有 Docker 服务
	docker compose down

.PHONY: docker-logs
docker-logs: ## 查看 Docker 日志
	docker compose logs -f

.PHONY: gen-key
gen-key: ## 生成加密密钥
	@echo "生成新的加密密钥..."
	@openssl rand -base64 32

.PHONY: security-check
security-check: ## 检查安全问题
	@echo "检查 Go 依赖漏洞..."
	cd backend && go list -json -m all | docker run --rm -i sonatypecommunity/nancy:latest sleuth
	@echo "检查 npm 依赖漏洞..."
	cd frontend && npm audit

.PHONY: deps-update
deps-update: ## 更新依赖
	cd backend && go get -u ./...
	cd backend && go mod tidy
	cd frontend && npm update

.PHONY: format
format: ## 格式化代码
	cd backend && go fmt ./...
	cd frontend && npm run format || true

.DEFAULT_GOAL := help
