# CertFlow

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Go Report Card](https://goreportcard.com/badge/github.com/yourusername/certflow)](https://goreportcard.com/report/github.com/yourusername/certflow)

CertFlow 是一个 Go 实现的 TLS 证书生命周期与部署自动化服务。详细架构见 [架构设计文档](./docs/ARCHITECTURE.md)。

## ✨ 特性

- 🔐 **自动化证书管理** - 支持 ACME 协议（Let's Encrypt）自动签发和续期
- 🌐 **DNS-01 验证** - 集成阿里云 DNS API，支持通配符证书
- 🚀 **自动部署** - 证书签发后自动部署到阿里云 ALB/SLB
- 🔒 **安全存储** - 所有私钥和凭证使用 AES-256-GCM 加密存储
- 📊 **可视化管理** - Next.js + React 管理界面
- 🔄 **任务队列** - 基于 PostgreSQL 的持久化任务队列，支持重试和幂等
- 📝 **完整审计** - 详细的执行记录和步骤日志
- 🎯 **多域名支持** - 单域名、多 SAN、通配符证书全支持

## 当前实现

- PostgreSQL 初始迁移：账户、云凭证版本、DNS、证书版本、任务、执行记录、outbox 和审计模型。
- Go API：`/healthz`、`/readyz`、仪表盘、证书列表、执行记录，以及证书草稿创建。
- Next.js + React + HeroUI 3.0 管理台：概览、证书、执行记录和多 SAN/通配符证书草稿表单。
- ALB 部署目标管理：先按云凭证查询地域、ALB 和监听器，只允许 HTTPS/QUIC 监听器保存为目标；证书签发成功后可自动或手动排队部署。
- Docker Compose：PostgreSQL 与 Go API 的本地编排。

ACME/DNS 账户 CRUD 与 PostgreSQL 持久化 worker 已实现。worker 会原子领取任务、记录每次执行与步骤、回收过期租约并按错误类别重试。签发 worker 支持 ACME DNS-01：注册或复用 ACME 账户、阿里云 DNS TXT 验证、证书下载校验，以及加密保存不可变证书版本。创建证书后会对已配置的域名和阿里云账号执行真实外部操作；建议先使用 Let's Encrypt staging、专用测试域名和最小权限 RAM 凭证验证。

证书支持自动 DNS 与手动 DNS 两种验证方式。手动模式会把 ACME 订单和 TXT 值保存到数据库，任务进入 `waiting_user`，用户写入 TXT 后通过管理台继续；手动写入的记录不会由 CertFlow 删除。自动模式在写入前复用同值 TXT，只有本次实际创建的记录才会清理。

ALB 部署 worker 会解密证书版本，调用阿里云 SSL 证书管理 `UploadUserCertificate`，再读取目标监听器并更新默认证书；原有 SNI 证书集合会保留。部署失败会保留现网证书并记录失败执行，任务按 worker 重试策略处理。当前测试 ALB `alb-u5hoj02nip460yu3zv` 位于 `cn-hangzhou`，查询结果没有可用的 HTTPS/QUIC 监听器，因此本次只完成发现验证，未执行写入。

服务启动后会立即扫描、随后每小时扫描一次已签发证书；在有效期进入 `renew_before_days` 窗口时，以当前证书版本为幂等边界创建续期任务。

## 本地启动

需要 Docker Desktop 运行后，再执行：

```bash
docker compose up -d postgres
cd backend
go run ./cmd/certflow
```

另开终端启动管理台：

```bash
cd frontend
npm install
npm run dev
```

管理台默认地址为 `http://localhost:3000`，Go API 默认地址为 `http://localhost:8080`。

若使用已有 PostgreSQL，可先创建独立数据库，再将 `DATABASE_URL` 指向它：

```bash
cd backend
CERTFLOW_ADMIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/postgres?sslmode=disable' go run ./cmd/dbinit
DATABASE_URL='postgres://<user>:<password>@<host>:5432/certflow?sslmode=disable' go run ./cmd/certflow
```

`CERTFLOW_ENCRYPTION_KEY` 是必需配置，格式为 Base64 编码的 32 字节随机值。开发环境可生成后保存至被 Git 忽略且权限为 `0600` 的 `.env` 文件：

```bash
openssl rand -base64 32
```

生产环境应从 KMS、Vault 或部署平台的密钥注入机制提供该值，不应将其保存到工作区。

## 验证

```bash
cd backend
GOSUMDB=off go test ./...

cd ../frontend
npm run build
```

## 📄 许可证

本项目采用 Apache License 2.0 开源协议 - 详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与项目。

## 📮 联系方式

如果你发现安全漏洞，请查看 [SECURITY.md](SECURITY.md) 了解如何负责任地报告。

## 🙏 致谢

感谢所有为本项目做出贡献的开发者。
