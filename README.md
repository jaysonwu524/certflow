# CertFlow

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

CertFlow 是一个以 Go 实现的 TLS 证书生命周期与部署自动化服务。它集中管理 ACME 账户、DNS 账户、云凭证、证书版本与自动化任务，并将证书安全地部署到阿里云 SSL 证书管理和 ALB。

## 能力概览

- ACME DNS-01 签发，支持单域名、多 SAN 与通配符证书。
- 自动 DNS 与手动 TXT 验证。
- 阿里云 DNS、SSL 证书管理与 ALB HTTPS/QUIC 监听器集成。
- 定期续期、SSL 上传、ALB 更新三类自动化任务。
- 执行记录、SSE 实时状态、站内信、邮件和 Webhook 通知。
- 管理员与普通用户隔离；私钥、AccessKey、SMTP 密码均加密保存。
- Go Control Plane、Next.js + React + HeroUI 3 Console、PostgreSQL 持久化任务队列。

## 快速开始

### 本地开发

```bash
git clone https://github.com/jaysonwu524/certflow.git
cd certflow
make setup
```

编辑 `.env`，至少设置 `CERTFLOW_ENCRYPTION_KEY`：

```bash
openssl rand -base64 32
```

启动本地 PostgreSQL 与 Control Plane：

```bash
make db-up
make control-plane-run
```

另开一个终端启动 Console：

```bash
make console-dev
```

打开 `http://localhost:3000`。首次启动会创建 `.env` 中指定的管理员；开发环境默认账号为 `admin@localhost` / `admin`，请勿用于生产。

### Docker 开发环境

```bash
CERTFLOW_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  docker compose -f deploy/compose/docker-compose.yml up -d --build
```

## 文档

- [架构与核心模型](./docs/architecture/overview.md)
- [证书生命周期与自动化](./docs/product/certificate-lifecycle.md)
- [本地开发与测试](./docs/development/testing.md)
- [Console 工程规范](./docs/development/console.md)
- [部署、GHCR 与回滚](./docs/operations/deployment.md)
- [PostgreSQL 与数据库迁移](./docs/operations/database.md)
- [配置与 Secret 说明](./docs/operations/configuration.md)
- [完整文档索引](./docs/README.md)

## 验证

```bash
make control-plane-test
make console-lint
make console-build
```

## 贡献与安全

- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)
- [变更日志](./CHANGELOG.md)
- [行为准则](./CODE_OF_CONDUCT.md)

项目采用 [Apache License 2.0](./LICENSE)。
