# PostgreSQL 与数据库迁移

CertFlow 使用 PostgreSQL，并在 Control Plane 启动时通过 `golang-migrate` 自动应用数据库迁移。应用部署不需要手动执行业务 SQL。

## 初始化行为

使用 `deploy/compose/docker-compose.prod.yml` 的自带 PostgreSQL 时，`certflow-postgres` Docker Volume 首次为空，PostgreSQL 官方镜像会根据 `POSTGRES_DB`、`POSTGRES_USER` 与 `POSTGRES_PASSWORD` 创建数据库和用户。

Control Plane 连接成功后会：

1. 获取 PostgreSQL advisory lock，避免多实例同时迁移。
2. 创建或读取 `schema_migrations`。
3. 依版本顺序执行镜像内尚未应用的迁移。
4. 在数据库没有管理员时初始化首个管理员。

已有 Docker Volume 不会因为修改 `POSTGRES_*` 环境变量而重置或重建。

## 迁移规范

迁移文件位于：

```text
apps/control-plane/internal/store/migrations/
```

文件使用 `golang-migrate` 命名：

```text
024_add_example.up.sql
```

迁移被嵌入 Control Plane 二进制，因此生产服务器只需拉取镜像。发布新镜像并执行 `docker compose up -d` 后，Control Plane 会自动应用新版本。

不要修改已发布的迁移文件，也不要复用已使用的版本号。生产迁移默认只提供 `up` 文件；结构变更应采用向前兼容、可恢复的设计，而不是依赖自动 down migration。

迁移失败会被 `golang-migrate` 标记为 dirty，Control Plane 不会继续启动。此时应停止重复部署、确认数据库状态，从备份恢复或完成修复，再显式处理 dirty 状态。不要直接删除 `schema_migrations`。

## 外部 PostgreSQL 与阿里云 RDS

使用阿里云 RDS PostgreSQL 时，需要先在 RDS 创建数据库与应用用户。应用用户应拥有目标 schema 的创建表、修改表、创建索引及维护迁移台账的权限，并且应是自身创建对象的所有者。

推荐连接串：

```env
DATABASE_URL=postgres://certflow:<password>@pgm-xxxxxxxx.rds.aliyuncs.com:5432/certflow?sslmode=require
```

应用服务器应通过同一 VPC 的 RDS 内网地址访问数据库；配置 RDS 白名单或安全组允许应用服务器网段访问 PostgreSQL 端口。不要把生产数据库公开到互联网。

外部数据库 Compose 启动命令见 [部署文档](./deployment.md#使用阿里云-rds-postgresql)。

## 备份与恢复

每次生产数据库迁移前执行逻辑备份，并定期验证恢复流程：

```bash
docker compose --env-file .env.production -f deploy/compose/docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > certflow-$(date +%F).sql
```

使用 RDS 时优先启用自动备份、时间点恢复和跨可用区策略。备份必须与 `CERTFLOW_ENCRYPTION_KEY` 的受控副本共同纳入恢复演练，否则恢复后的凭证密文无法使用。
