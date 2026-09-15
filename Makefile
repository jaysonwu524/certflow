COMPOSE_DEV = docker compose -f deploy/compose/docker-compose.yml
CONTROL_PLANE_DIR = apps/control-plane
CONSOLE_DIR = apps/console

.PHONY: help
help: ## 显示帮助信息
	@echo "CertFlow - 可用命令："
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

.PHONY: setup
setup: ## 初始化本地开发环境
	@if [ ! -f .env ]; then cp .env.example .env; echo "已创建 .env，请填写必要配置"; fi
	@chmod 600 .env
	cd $(CONSOLE_DIR) && npm install

.PHONY: db-up db-down db-reset
db-up: ## 启动本地 PostgreSQL
	$(COMPOSE_DEV) up -d postgres

db-down: ## 停止本地 Docker 开发环境
	$(COMPOSE_DEV) down

db-reset: ## 重置本地 PostgreSQL 数据（破坏性操作）
	$(COMPOSE_DEV) down -v
	$(COMPOSE_DEV) up -d postgres

.PHONY: control-plane-run control-plane-build control-plane-test control-plane-test-coverage control-plane-lint
control-plane-run: ## 运行 Control Plane
	@set -a; [ -f .env ] || { echo "缺少 .env，请先运行 make setup"; exit 1; }; . ./.env; set +a; cd $(CONTROL_PLANE_DIR) && go run ./cmd/certflow

control-plane-build: ## 构建 Control Plane 与 dbinit
	cd $(CONTROL_PLANE_DIR) && go build -o certflow ./cmd/certflow
	cd $(CONTROL_PLANE_DIR) && go build -o dbinit ./cmd/dbinit

control-plane-test: ## 运行 Control Plane 测试
	cd $(CONTROL_PLANE_DIR) && go test -v ./...

control-plane-test-coverage: ## 生成 Control Plane 覆盖率报告
	cd $(CONTROL_PLANE_DIR) && go test -v -race -coverprofile=coverage.out -covermode=atomic ./...
	cd $(CONTROL_PLANE_DIR) && go tool cover -html=coverage.out -o coverage.html

control-plane-lint: ## 运行 Control Plane 静态检查
	cd $(CONTROL_PLANE_DIR) && go vet ./...

.PHONY: dbinit-run
dbinit-run: ## 使用 .env 创建外部 PostgreSQL 数据库
	@set -a; [ -f .env ] || { echo "缺少 .env，请先运行 make setup"; exit 1; }; . ./.env; set +a; cd $(CONTROL_PLANE_DIR) && go run ./cmd/dbinit

.PHONY: console-dev console-build console-lint
console-dev: ## 运行 Console 开发服务器
	cd $(CONSOLE_DIR) && npm run dev

console-build: ## 构建 Console
	cd $(CONSOLE_DIR) && npm run build

console-lint: ## 检查 Console 代码
	cd $(CONSOLE_DIR) && npm run lint

.PHONY: run test lint build clean
run: db-up ## 启动本地数据库、Control Plane 和 Console
	@set -a; [ -f .env ] || { echo "缺少 .env，请先运行 make setup"; exit 1; }; . ./.env; set +a; (cd $(CONTROL_PLANE_DIR) && go run ./cmd/certflow) &
	@cd $(CONSOLE_DIR) && npm run dev

test: control-plane-test ## 运行当前自动化测试

lint: control-plane-lint console-lint ## 运行所有静态检查

build: control-plane-build console-build ## 构建所有可发布应用

clean: ## 清理本地构建产物
	rm -f $(CONTROL_PLANE_DIR)/certflow $(CONTROL_PLANE_DIR)/dbinit
	rm -f $(CONTROL_PLANE_DIR)/coverage.out $(CONTROL_PLANE_DIR)/coverage.html
	rm -rf $(CONSOLE_DIR)/.next $(CONSOLE_DIR)/out

.PHONY: docker-build docker-up docker-down docker-logs
docker-build: ## 构建本地 Docker 镜像
	$(COMPOSE_DEV) build

docker-up: ## 启动本地 Docker 开发环境
	$(COMPOSE_DEV) up -d

docker-down: ## 停止本地 Docker 开发环境
	$(COMPOSE_DEV) down

docker-logs: ## 查看本地 Docker 日志
	$(COMPOSE_DEV) logs -f

.PHONY: gen-key security-check deps-update format
gen-key: ## 生成 Base64 格式加密密钥
	@openssl rand -base64 32

security-check: ## 检查依赖安全问题
	cd $(CONTROL_PLANE_DIR) && go list -json -m all | docker run --rm -i sonatypecommunity/nancy:latest sleuth
	cd $(CONSOLE_DIR) && npm audit

deps-update: ## 更新应用依赖
	cd $(CONTROL_PLANE_DIR) && go get -u ./... && go mod tidy
	cd $(CONSOLE_DIR) && npm update

format: ## 格式化 Go 代码
	cd $(CONTROL_PLANE_DIR) && go fmt ./...

# 旧命令兼容别名，将在后续主版本移除。
.PHONY: backend-run backend-build backend-test backend-test-coverage backend-lint frontend-dev frontend-build frontend-lint
backend-run: control-plane-run
backend-build: control-plane-build
backend-test: control-plane-test
backend-test-coverage: control-plane-test-coverage
backend-lint: control-plane-lint
frontend-dev: console-dev
frontend-build: console-build
frontend-lint: console-lint

.DEFAULT_GOAL := help
