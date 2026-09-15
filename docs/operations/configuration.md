# 配置与 Secret

CertFlow 从环境变量读取运行时基础配置。账号、SMTP 与个人 Webhook 等可运行时管理的配置保存在数据库中，并使用 `CERTFLOW_ENCRYPTION_KEY` 加密敏感字段。

## Control Plane 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `CERTFLOW_ADDR` | 否 | `:8080` | Go HTTP 服务监听地址。 |
| `DATABASE_URL` | 是 | 本地开发 URL | PostgreSQL 连接串，支持 `postgres://` 和 `postgresql://`。 |
| `CERTFLOW_ENCRYPTION_KEY` | 是 | 无 | Base64 编码的 32 字节密钥，用于加密数据库中的私钥和凭证。 |
| `CERTFLOW_ADMIN_EMAIL` | 首次启动 | `admin@localhost` | 数据库没有管理员时创建的首个管理员邮箱。 |
| `CERTFLOW_ADMIN_PASSWORD` | 首次启动 | `admin` | 数据库没有管理员时创建的首个管理员密码。 |
| `CERTFLOW_SESSION_TTL_HOURS` | 否 | `8` | 登录会话绝对有效期，范围 1-720 小时。 |
| `CERTFLOW_SESSION_IDLE_MINUTES` | 否 | `30` | 登录会话空闲超时，范围 1-1440 分钟。 |

`CERTFLOW_ADMIN_EMAIL` 与 `CERTFLOW_ADMIN_PASSWORD` 仅在数据库尚无管理员时生效。修改环境变量不会覆盖现有管理员密码。

## Compose 变量

自带 PostgreSQL 的生产 Compose 还需要：

| 变量 | 说明 |
| --- | --- |
| `CERTFLOW_CONTROL_PLANE_IMAGE` | Control Plane GHCR 镜像，例如 `ghcr.io/jaysonwu524/certflow-control-plane:latest`。 |
| `CERTFLOW_CONSOLE_IMAGE` | Console GHCR 镜像。 |
| `POSTGRES_DB` | 首次初始化时创建的数据库名。 |
| `POSTGRES_USER` | 首次初始化时创建的数据库用户。 |
| `POSTGRES_PASSWORD` | PostgreSQL 用户密码，必须使用高强度随机值。 |

外部 PostgreSQL 模式以 `DATABASE_URL` 为准。示例见 [部署文档](./deployment.md#使用阿里云-rds-postgresql)。

## 密钥要求

生成加密密钥：

```bash
openssl rand -base64 32
```

生产环境的加密密钥必须存放于部署平台 Secret、KMS 或 Vault；不应提交到 Git、镜像层、日志或 GitHub Actions 输出中。密钥更换会导致旧密文无法读取，必须先完成密钥轮换设计和恢复演练。

`.env`、`.env.production` 和私钥文件已被 `.gitignore` 忽略。模板文件只允许包含占位符。

## 运行时配置

- SMTP 由管理员在控制台“系统设置”配置，SMTP 密码只写入、不回显。
- 用户可在个人中心配置失败通知 Webhook；Webhook 仅允许公网 HTTPS 端点。
- 云凭证、DNS 账户和 ACME 账户在控制台中创建，私钥和 Secret 不回显。
