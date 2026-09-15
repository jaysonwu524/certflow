# 部署、GHCR 与回滚

CertFlow 的 CI 与生产运行分离：GitHub Actions 只测试并发布 Docker 镜像到 GHCR；生产服务器由运维人员手动拉取已验证镜像并重建容器，不需要拉取业务源代码。

## 发布链路

```text
push main
  -> GitHub Actions: Control Plane test / vet、Console lint / build、Compose 校验
  -> GitHub Actions: 构建 Control Plane 与 Console 镜像
  -> GitHub Container Registry
  -> 人工在生产服务器 docker compose pull && up -d
```

工作流位于 `.github/workflows/docker-build.yml`。GitHub 仓库应在 `Settings -> Actions -> General` 开启 `Read and write permissions`，工作流使用自动提供的 `GITHUB_TOKEN` 写入 GHCR，不需要生产服务器 SSH 凭据。

`main` 发布的镜像标签：

```text
ghcr.io/jaysonwu524/certflow-control-plane:latest
ghcr.io/jaysonwu524/certflow-control-plane:sha-<commit>
ghcr.io/jaysonwu524/certflow-console:latest
ghcr.io/jaysonwu524/certflow-console:sha-<commit>
```

推送 `v1.2.0` 这类 Git 标签会生成同名镜像标签。

## 自带 PostgreSQL 的首次部署

确认 `main` 的 CI 已成功发布镜像后，在生产服务器执行：

```bash
sudo mkdir -p /opt/certflow
sudo chown "$USER":"$USER" /opt/certflow
cd /opt/certflow

mkdir -p deploy/compose
curl -fsSL https://raw.githubusercontent.com/jaysonwu524/certflow/main/deploy/compose/docker-compose.prod.yml -o deploy/compose/docker-compose.prod.yml
curl -fsSL https://raw.githubusercontent.com/jaysonwu524/certflow/main/.env.production.example -o .env.production.example
cp .env.production.example .env.production
chmod 600 .env.production
```

编辑 `.env.production`，替换 PostgreSQL 密码、加密密钥与管理员密码。生成加密密钥：

```bash
openssl rand -base64 32
```

启动：

```bash
docker compose --env-file .env.production -f deploy/compose/docker-compose.prod.yml up -d
docker compose --env-file .env.production -f deploy/compose/docker-compose.prod.yml ps
```

## 使用阿里云 RDS PostgreSQL

将以下三个文件放在 `/opt/certflow`：

```text
deploy/compose/docker-compose.prod.yml
deploy/compose/docker-compose.external-db.yml
.env.production.external-db.example
```

它们可从同一 Git 标签或 release 制品中取得；不要在生产服务器检出业务源代码。

创建生产配置：

```bash
cp .env.production.external-db.example .env.production
chmod 600 .env.production
```

编辑 `DATABASE_URL`、`CERTFLOW_ENCRYPTION_KEY` 和管理员账号后启动：

```bash
docker compose --env-file .env.production \
  -f deploy/compose/docker-compose.prod.yml \
  -f deploy/compose/docker-compose.external-db.yml \
  up -d
```

覆盖文件会禁用本地 PostgreSQL，并移除 Control Plane 对本地数据库健康检查的依赖。RDS 创建数据库、用户和网络白名单的要求见 [数据库文档](./database.md#外部-postgresql-与阿里云-rds)。

## 手动发布

普通 Control Plane 与 Console 代码更新后，生产服务器只需拉取新镜像：

```bash
cd /opt/certflow
docker compose --env-file .env.production -f deploy/compose/docker-compose.prod.yml pull
docker compose --env-file .env.production -f deploy/compose/docker-compose.prod.yml up -d --remove-orphans
docker image prune -f
```

外部数据库部署请在每条命令中额外使用：

```bash
-f deploy/compose/docker-compose.external-db.yml
```

只有 Compose 文件发生变化时，才需要人工替换服务器上的 Compose 文件；正常业务代码发布不需要同步源代码。

## GHCR 可见性

公开镜像可被服务器直接拉取。私有镜像需要在服务器使用仅具备 `read:packages` 权限的 GitHub Classic PAT 登录：

```bash
echo '<PAT>' | docker login ghcr.io -u <github-user> --password-stdin
```

不要把 PAT 写入 `.env.production`、GitHub Actions 日志或镜像层。

## 回滚

从 GHCR 选择上一版 `sha-<commit>` 镜像标签，将 `.env.production` 中的镜像地址固定到该版本：

```env
CERTFLOW_CONTROL_PLANE_IMAGE=ghcr.io/jaysonwu524/certflow-control-plane:sha-<commit>
CERTFLOW_CONSOLE_IMAGE=ghcr.io/jaysonwu524/certflow-console:sha-<commit>
```

再执行 `docker compose pull` 和 `docker compose up -d`。如果当前版本包含数据库迁移，回滚应用镜像前应先确认旧版本与新 schema 的兼容性；数据库恢复需要遵循 [数据库文档](./database.md#备份与恢复)。

## 网络边界

- 仅通过 Caddy、Nginx 或 Traefik 对外暴露 80/443，并代理到 `127.0.0.1:3000`。
- 不公开 5432 或 Control Plane 的 8080 端口。
- 启用 Docker 日志轮转、磁盘用量告警和数据库备份。
