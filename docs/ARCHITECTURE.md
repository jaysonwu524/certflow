# CertFlow 设计文档

## 1. 目标与边界

CertFlow 是一个以 Go 实现的 TLS 证书生命周期和部署自动化服务。它负责管理 ACME 账户、DNS 凭证、证书配置与续期，并将已签发证书安全地部署至目标系统。

首个可交付版本（MVP）覆盖：

- ACME 账户管理，优先兼容 Let's Encrypt。
- 阿里云 DNS 凭证管理，以及 DNS-01 域名验证。
- 单域名、多 SAN 域名和多通配符证书的签发、查看、吊销与自动续期。
- RSA 与 ECDSA 密钥算法选择。
- 阿里云 SSL 证书管理上传，以及阿里云 ALB HTTPS 监听器证书更新。
- 手动和定时触发的任务执行记录。
- 失败 Webhook 通知；失败脚本执行预留接口，但不纳入 MVP。
- 基础权限、审计、加密存储、幂等和并发控制。

MVP 不实现 HTTP-01、任意脚本执行、可视化流程 DSL、多租户、其他 DNS 云厂商和其他部署目标。设计上保留扩展点，避免这些后续能力改变核心数据模型。

通配符遵循 X.509 和 ACME 的标准语义：`*.example.com` 只匹配一个左侧标签，例如 `api.example.com`；它不匹配 `example.com`，也不匹配 `v1.api.example.com`。若一张证书需要覆盖根域、一层子域和某个二层子域，应将 `example.com`、`*.example.com`、`*.api.example.com` 同时作为 SAN 标识符申请。所有通配符标识符必须使用 DNS-01 验证。

## 2. 架构原则

1. **证书签发与部署解耦。** 一张证书可被部署到零个或多个目标；证书续期成功后可触发关联目标更新。
2. **后台任务优先。** 签发、续期、DNS 等待和部署均通过持久化任务运行，HTTP 请求不直接等待外部操作完成。
3. **插件接口稳定，配置可演进。** DNS 和部署提供者均通过 Go interface 扩展，配置采用带版本号的 JSON。
4. **默认安全。** 所有私钥和云凭证均加密保存，日志和 API 均不得回显敏感值。
5. **可重试且可审计。** 外部副作用步骤必须尽量幂等；每次执行和关键步骤都有可查询记录。
6. **先以单体服务交付。** API、调度器和 worker 可作为同一二进制的不同运行模式部署；未来再拆分而不改变领域接口。
7. **版本不可变，任务输入冻结。** 每次签发生成不可变证书版本；任务在创建时锁定证书版本、目标配置和凭证引用，重试不会悄然使用新配置。
8. **数据库事务是事件边界。** 领域状态变更和后续异步工作通过 transactional outbox 原子提交；worker 只处理已持久化事件。

## 3. 逻辑架构

```text
                           +--------------------+
                           | 管理 UI / REST API  |
                           +---------+----------+
                                     |
                            +--------v---------+
                            |  CertFlow API     |
                            | RBAC / 审计 / 校验 |
                            +--------+---------+
                                     |
              +----------------------+-----------------------+
              |                                              |
     +--------v---------+                          +---------v---------+
     | PostgreSQL       |                          | 任务调度与 Worker   |
     | 配置/密文/记录   |<------------------------>| 签发/续期/部署/通知 |
     +------------------+                          +---------+---------+
                                                               |
            +---------------------+--------------------------+----------------------+
            |                     |                                                 |
   +--------v--------+   +--------v--------+                               +--------v--------+
   | ACME Provider   |   | DNS Provider    |                               | Deploy Provider |
   | Let's Encrypt   |   | Aliyun DNS      |                               | Aliyun ALB      |
   +-----------------+   +-----------------+                               +-----------------+
```

建议技术选型：

| 层次 | 建议 |
| --- | --- |
| HTTP | `chi` 或 `gin`，JSON REST API |
| 数据库 | PostgreSQL 16+ |
| 数据访问 | `sqlc` 或 `ent`；避免业务逻辑散落在 handler |
| ACME | `golang.org/x/crypto/acme` 或经评估的成熟客户端库 |
| 阿里云 | 官方 Go SDK v2 |
| 迁移 | `goose` 或 `atlas` |
| 日志 | 标准库 `log/slog`，结构化 JSON 输出 |
| 指标 | Prometheus `/metrics` |
| 管理前端 | Next.js + React + HeroUI 3.0 |

## 4. 模块与目录建议

```text
certflow/
  backend/
    cmd/
      certflow/            # API、调度器、worker 的启动入口
    internal/
      api/                 # HTTP 路由、认证、请求/响应 DTO
      app/                 # 用例编排：签发、续期、部署、通知
      domain/              # 实体、状态机、领域接口、领域错误
      store/               # PostgreSQL repository 和迁移
      job/                 # 队列、worker、锁、重试和调度器
      acme/                # ACME provider adapter
      dns/aliyun/          # Aliyun DNS adapter
      deploy/aliyun/       # SSL 管理与 ALB adapter
      crypto/              # envelope encryption、密文编解码、脱敏
      notify/              # Webhook sender
      audit/               # 审计事件写入
    migrations/
  frontend/
    app/                   # App Router 页面、布局与 route handlers
    components/            # 基于 HeroUI 3.0 的领域组件
    lib/                   # Go API client、认证与格式化工具
    types/                 # 由 OpenAPI 生成或维护的 API 类型
    public/
  configs/
  docs/
  docker-compose.yml
```

Go 后端位于 `backend/`，Next.js 管理台位于 `frontend/`；二者独立构建和部署。后端不将 ACME、DNS 或阿里云 SDK 调用直接放入 HTTP handler。handler 只负责鉴权、参数校验、创建用例请求和返回任务 ID。

### 4.1 管理前端

管理后台使用 Next.js、React 与 HeroUI 3.0。前端是受 RBAC 保护的操作界面，不承载证书签发、DNS 验证、续期、部署或密钥加密等业务逻辑；这些操作全部由 Go API 和 worker 执行。

前端采用 Next.js App Router。优先使用 React Server Components 获取首次页面数据，仅将筛选、表单、确认弹窗、轮询中的执行详情等需要浏览器交互的区域实现为 Client Components。HeroUI 3.0 提供表格、表单、Select、Modal、Drawer、Tabs、Toast、Badge 和 Skeleton 等基础 UI，领域组件封装在 `frontend/components/`，避免在页面中散落重复的状态样式和表单逻辑。

MVP 页面与主要交互：

| 路由 | 内容 |
| --- | --- |
| `/dashboard` | 证书总数、即将到期数、最近失败任务、近期执行动态 |
| `/cloud-credentials` | 阿里云凭证列表、创建、轮换、验证与禁用；仅展示脱敏摘要 |
| `/acme-accounts` | ACME 账户列表、创建、验证、禁用 |
| `/dns-accounts` | DNS 账户列表、创建、凭证连通性验证、禁用 |
| `/certificates` | 证书列表，展示域名、有效期、续期状态、最近部署状态 |
| `/certificates/new` | 分步创建：ACME、逐 SAN 的 DNS/Zone 选择、域名与通配符、密钥算法、DNS-01、自动续期、部署关联 |
| `/certificates/[id]` | 证书详情、SAN 域名、有效期、关联目标、执行记录；可手动签发、续期和部署 |
| `/deployment-targets` | 阿里云 ALB 目标的创建、验证、启停与证书关联 |
| `/executions` | 可按状态、任务类型、证书、部署目标、时间筛选的执行记录 |
| `/executions/[id]` | 工作流步骤、耗时、脱敏错误和重试操作 |
| `/notification-endpoints` | 失败 Webhook 的配置、启停与测试投递 |

UI 行为约束：

- 任何触发签发、续期、部署、重试、禁用或删除的操作均使用确认弹窗；成功后跳转或订阅对应执行记录，而不在浏览器中等待长任务完成。
- 私钥、证书 PEM、AccessKey Secret、Webhook secret 均只提供写入控件，不存在回显控件；编辑时空值表示保持现有 secret。
- 域名表单逐项校验通配符只在最左侧单标签；提交前提示 `*.example.com` 不覆盖根域和更深层子域，并允许将 `example.com`、`*.example.com`、`*.api.example.com` 添加为同一证书的多个 SAN。
- 每个 SAN 可继承默认 DNS 账户或选择其 Zone 对应的账户；前端仅展示后端已验证可管理的 Zone，不自行推断 DNS 归属。
- 凭证类资源在列表和详情中仅显示脱敏摘要、验证状态、最后验证时间和最近错误摘要。
- 状态使用固定语义颜色和文字，不能只依赖颜色：成功、运行中、等待、告警、失败、已禁用。
- 表格支持服务端分页、排序和筛选。执行记录默认按最近更新时间倒序，并可从证书或目标详情直达筛选后的列表。
- 首版不引入前端状态管理库。服务端数据以 Next.js cache/revalidation 为主，交互突变后精确刷新对应资源；执行详情可使用短间隔轮询，后续再按需要增加 SSE。

前端与后端通过版本化 REST API 通信：浏览器不直接请求 ACME、阿里云 DNS、SSL 管理或 ALB API。推荐由 Next.js BFF route handler 代理同源请求，并使用 `httpOnly`、`secure`、`sameSite=lax` session cookie；后端根据 session 或 Bearer token 进行 RBAC 判定。若前后端以不同域名部署，必须配置精确 CORS allowlist 和 CSRF 防护，不能使用通配符来源。

Go API 应维护 OpenAPI 规范，前端从规范生成 TypeScript 类型和 API client，避免手写 DTO 漂移。错误响应包含稳定 `code`、用户可读 `message` 与 `request_id`；前端将 `request_id` 展示在可复制的错误详情中，便于排障。

## 5. 核心领域模型

### 5.1 ACME 账户

`acme_accounts` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 用户可读名称，唯一 |
| `directory_url` | ACME directory URL |
| `email` | 注册联系方式 |
| `account_url` | ACME 服务端账户 URL |
| `private_key_ciphertext` | 加密后的账户私钥 |
| `private_key_algorithm` | 账户密钥算法 |
| `eab_kid` | 可选 EAB Key ID |
| `eab_hmac_ciphertext` | 可选、加密后的 EAB HMAC key |
| `status` | `active`、`disabled`、`error` |
| `created_at` / `updated_at` | 审计时间 |

账户删除采用软删除或禁用。若仍被证书引用，拒绝物理删除。

### 5.2 DNS 账户

`dns_accounts` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 用户可读名称，唯一 |
| `provider` | MVP 为 `aliyun` |
| `cloud_credential_id` | 阿里云云凭证引用 |
| `config_version` | 非敏感 DNS 配置的 schema 版本 |
| `allowed_zones` | 可管理 Zone allowlist |
| `status` | `active`、`disabled`、`invalid` |
| `last_verified_at` | 最近连通性验证时间 |
| `last_error` | 脱敏后的最近错误 |

DNS 账户的非敏感配置逻辑结构：

```json
{
  "cloud_credential_id": "cloud_credential_uuid",
  "allowed_zones": ["example.com", "example.net"]
}
```

AccessKey 或角色配置只存在于 `cloud_credentials` 的密文和短暂内存中。建议为 RAM 用户或角色授予最小 DNS 修改权限，并限制到 `allowed_zones` 中的实际托管域名。

### 5.3 证书与域名

`certificates` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 证书配置名称 |
| `acme_account_id` | 关联 ACME 账户 |
| `default_dns_account_id` | 默认 DNS-01 账户；域名验证可单独覆盖 |
| `key_algorithm` | `rsa_2048`、`rsa_4096`、`ecdsa_p256`、`ecdsa_p384` |
| `challenge_type` | MVP 固定 `dns_01` |
| `renew_enabled` | 自动续期开关 |
| `renew_before_days` | 剩余多少天内开始续期，默认 30 |
| `status` | 见 6.1 |
| `current_certificate_version_id` | 当前可用的不可变证书版本 |
| `last_issued_at` | 最近签发成功时间 |
| `last_error` | 脱敏后的最近失败原因 |
| `version` | 乐观锁版本 |

`certificate_versions` 表保存不可变的签发结果：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `certificate_id` | 所属证书配置 |
| `issued_by_execution_id` | 产生该版本的签发或续期执行 |
| `certificate_ciphertext` | 加密的 PEM leaf 证书 |
| `private_key_ciphertext` | 加密的 PEM 私钥 |
| `chain_ciphertext` | 加密的 PEM 中间证书链 |
| `serial_number` | 证书序列号 |
| `sha256_fingerprint` | leaf 证书 SHA-256 指纹，唯一 |
| `not_before` / `not_after` | 有效期 |
| `created_at` | 写入时间 |
| `revoked_at` / `revocation_reason` | 可选撤销状态 |

新版本经完整校验后写入，再在同一事务中更新 `current_certificate_version_id` 并写入 outbox 事件。旧版本保留，直至满足数据保留与远端部署引用清理策略；绝不被续期流程覆盖。

`certificate_domains` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `certificate_id` | 证书 ID |
| `domain` | FQDN 或通配符名称 |
| `position` | 域名顺序，首个为主域名 |

`certificate_domain_validations` 表定义每个 SAN 的 DNS-01 归属：

| 字段 | 说明 |
| --- | --- |
| `certificate_domain_id` | 对应 SAN |
| `dns_account_id` | 该 SAN 使用的 DNS 账户；为空时继承默认账户 |
| `managed_zone` | 经验证的可写 Zone，例如 `example.com` |
| `challenge_fqdn` | 实际写入的 challenge 名称，可为 CNAME 委托目标 |
| `validation_mode` | MVP 为 `direct`；预留 `cname_delegated` |

数据库约束：一张证书至少包含一个域名；同一证书内域名不重复；域名统一转小写、去末尾点后保存。通配符只允许最左侧单个 `*` 标签，例如 `*.example.com`；拒绝 `foo.*.example.com`、`*.*.example.com` 与裸 `*`。根域必须作为独立 SAN 加入。创建或修改时，服务必须对每个 SAN 计算 `_acme-challenge` 名称、解析可管理 Zone，并验证选定 DNS 账户拥有该 Zone 的写权限。MVP 明确不支持 CNAME 委托；后续实现前不得将其作为已支持能力展示。

### 5.4 云凭证

阿里云 DNS 与 ALB 使用同一种 `cloud_credentials` 资源，避免把 AccessKey 嵌入 DNS 账户或部署目标配置。DNS 账户和部署目标只引用凭证 ID，并各自验证所需的最小权限。

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 用户可读名称 |
| `provider` | MVP 为 `aliyun` |
| `credential_hint` | 只读脱敏摘要 |
| `status` | `active`、`disabled`、`invalid`、`rotating` |
| `last_verified_at` / `last_error` | 最近验证结果 |
| `current_version_id` | 当前可用凭证版本 |

`cloud_credential_versions` 表保存不可变的凭证版本，包含 `id`、`cloud_credential_id`、`credentials_ciphertext`、`credential_hint`、`created_at`、`retired_at` 与 `version`。凭证密文仅存在于该表，绝不覆盖更新。

DNS 账户使用 `cloud_credential_id`，部署目标也使用该外键。首版要求单一 RAM 用户或角色同时具备所需 DNS/SSL/ALB 最小权限；生产部署应优先使用可轮换的 STS AssumeRole，而不是长期 AccessKey。凭证轮换创建新版本并原子切换 `current_version_id`；已排队任务引用精确的 `cloud_credential_version_id`，不会因为轮换而悄然改用新凭证。

### 5.5 部署目标与关联

`deployment_targets` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 用户可读名称 |
| `type` | MVP 为 `aliyun_alb` |
| `cloud_credential_id` | 阿里云凭证引用 |
| `config_version` | 配置 schema 版本 |
| `config` | 非敏感、版本化的部署配置 JSON |
| `status` | `active`、`disabled`、`invalid` |
| `last_verified_at` | 最近验证时间 |

`certificate_deployments` 表连接证书与目标：

| 字段 | 说明 |
| --- | --- |
| `certificate_id` | 证书 ID |
| `deployment_target_id` | 部署目标 ID |
| `auto_deploy` | 签发或续期成功后是否自动部署 |
| `enabled` | 关联开关 |
| `version` | 关联配置版本，用于任务快照 |
| `last_deployed_fingerprint` | 成功部署的证书指纹 |
| `last_deployed_at` | 最近成功部署时间 |
| `last_error` | 脱敏后的最近部署错误 |

阿里云 ALB 配置必须显式指定绑定模式，避免把 SNI 证书误更新为默认服务器证书：

```json
{
  "region_id": "cn-hangzhou",
  "load_balancer_id": "alb-xxxxxxxx",
  "listener_id": "lsn-xxxxxxxx",
  "certificate_binding": "default",
  "server_name": null
}
```

`certificate_binding` 只允许 `default` 或 `sni`；`sni` 必须填写 `server_name`。实现前须完成阿里云技术验证，确认实际 API、证书资源类型、跨区域限制、证书状态、默认/SNI 绑定语义以及可读取的远端证书标识。该验证结果将固化为 adapter 契约和集成测试，不以 fingerprint 查询能力作为未经验证的前提。

### 5.6 自动化、通知与执行

MVP 不实现任意流程图，而用明确的触发规则：证书签发或续期成功后，对所有 `auto_deploy=true` 的关联创建部署任务。

`notification_endpoints` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `name` | 名称 |
| `type` | MVP 为 `webhook` |
| `url_ciphertext` | 加密 Webhook URL |
| `secret_ciphertext` | 可选 HMAC secret |
| `enabled` | 开关 |
| `event_filter` | 事件类型 JSON 数组 |

`jobs` 是持久化队列表，一条记录对应一次可领取的后台工作：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `kind` | `issue`、`renew`、`deploy`、`notify`、`cleanup_dns` |
| `status` | `queued`、`running`、`succeeded`、`failed`、`cancelled` |
| `idempotency_scope` / `idempotency_key` | 作用域内唯一的去重键 |
| `payload` | 不可变 JSON 快照，不含明文 secret |
| `next_run_at` | 可领取时间 |
| `attempt` / `max_attempts` | 重试信息 |
| `lease_owner` / `lease_expires_at` | worker 领取租约 |
| `cancel_requested_at` | 取消请求时间 |
| `created_at` / `updated_at` | 任务时间 |

`payload` 对部署任务包含 `certificate_version_id`、`certificate_deployment_id`、关联版本、部署目标的完整非敏感配置快照、`cloud_credential_version_id` 和绑定模式。签发任务包含证书配置、SAN 与验证配置的完整非敏感快照、不可变 ACME 账户 ID 和 DNS 凭证版本引用。ACME 账户私钥创建后不可原地替换；需要更换时创建新账户资源。payload 可以引用密文资源，但不能复制 secret。任务创建后不得修改 payload；修改配置应创建新任务。

`workflow_executions` 是面向用户的执行尝试记录，与 `jobs` 一对多关联：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `job_id` | 所属后台任务 |
| `kind` | `issue`、`renew`、`deploy`、`notify` |
| `certificate_id` | 可选关联证书 |
| `deployment_target_id` | 可选关联目标 |
| `trigger_type` | `manual`、`scheduler`、`certificate_issued`、`retry` |
| `idempotency_key` | 同一作用域唯一的幂等键 |
| `status` | `queued`、`running`、`succeeded`、`failed`、`cancelled` |
| `attempt` / `max_attempts` | 重试信息 |
| `started_at` / `finished_at` | 执行时间 |
| `error_code` / `error_message` | 标准错误与脱敏描述 |
| `summary` | 非敏感 JSON 摘要 |

`workflow_execution_steps` 记录可排障的细粒度步骤，包含 `name`、`sequence`、`status`、`started_at`、`finished_at`、`summary`、`error_message`。密钥、完整证书私钥、AccessKey Secret、Webhook secret 永不写入步骤记录。

`outbox_events` 保存与领域状态同事务写入的事件，例如 `certificate.version.issued`、`certificate.renewal.failed`、`deployment.failed`。outbox publisher 以至少一次投递语义创建下游 job 或通知 job；所有消费者通过幂等键去重。这样“新证书版本已提交”和“自动部署已排队”不会发生半成功。

## 6. 状态机与关键流程

### 6.1 证书状态机

```text
draft -> pending -> issuing -> issued
                         |        |
                         v        v
                       failed   renewing -> issued
                                             |
                                             v
                                         expiring/expired

issued -> revoked
issued -> disabled
```

说明：

- `draft`：配置尚未完成或未保存。
- `pending`：已保存，等待首次签发。
- `issuing` / `renewing`：存在运行中的排他任务。
- `issued`：`current_certificate_version_id` 指向当前可用版本。
- `failed`：首次签发失败；续期失败时仍保持 `issued`，错误记录在 `last_error`，避免掩盖当前仍可用的证书。
- `expiring` / `expired`：由调度器或查询时根据 `not_after` 派生或定期更新。

状态更新必须由应用服务在数据库事务中执行，并配合 `version` 乐观锁或 PostgreSQL advisory lock，防止同一证书被同时签发和续期。

### 6.2 DNS-01 签发流程

```text
创建签发任务
  -> 获取证书锁
  -> 读取并解密 ACME / DNS 凭证
  -> 创建 ACME Order
  -> 为每个授权创建 _acme-challenge TXT 记录
  -> 轮询权威/递归 DNS，确认记录传播
  -> 通知 ACME 验证 challenge
  -> 轮询授权与订单状态
  -> 生成私钥、提交 CSR、下载证书链
  -> 校验证书域名、有效期和私钥匹配
  -> 写入不可变证书版本并原子切换当前版本
  -> 清理此次创建的 TXT 记录
  -> 创建关联的自动部署任务
```

异常处理：

- TXT 记录创建成功后，立即把其标识写入执行步骤摘要，保证 worker 重启后可恢复清理。
- 多个证书同时验证同一域名时，不得删除其他任务创建的 TXT 值；删除操作必须按具体记录值执行。
- DNS 传播检测设定总超时、轮询间隔和指数退避；超时后记录明确错误码。
- ACME 订单、授权 URL 和 challenge URL 保存于任务 `summary`，用于恢复与诊断。
- 只在新证书完整校验后创建新版本并切换当前版本，失败时始终保留旧版本。
- 同一个 challenge FQDN 的多个 TXT 值必须并存；清理只删除本执行创建的值。MVP 在解析到 CNAME 委托时返回明确的“不支持”配置错误，不得向错误 Zone 写入记录。

### 6.3 自动续期

调度器每小时扫描一次满足以下条件的证书：

```text
renew_enabled = true
AND status IN ('issued', 'expiring')
AND current_certificate_version.not_after <= now() + renew_before_days
AND 当前无运行中的 issue/renew 任务
```

扫描结果创建带确定性幂等键的 `renew` 任务，例如：

```text
renew:<certificate_id>:<current_certificate_version_id>:<not_after_date>
```

调度创建时间加入小范围随机抖动，避免大量证书在固定时刻访问 ACME。续期失败按错误类型重试；当剩余有效期低于预警阈值时发出失败事件。

### 6.4 阿里云 ALB 部署流程

```text
创建部署任务
  -> 获取“目标 + 监听器”排他锁
  -> 读取并验证任务快照中的证书版本
  -> 按已验证的远端证书标识/指纹能力查询比对阿里云已上传证书
  -> 若不存在则上传到阿里云 SSL 证书管理
  -> 轮询上传结果直至可用或超时
  -> 更新指定 ALB HTTPS Listener 的服务器证书
  -> 读取 Listener 配置，确认目标证书已生效
  -> 保存部署指纹和成功时间
```

约束：

- 更新前读取监听器当前证书信息，保存到步骤摘要用于人工回滚。
- 上传或绑定失败时不得先删除旧证书或清空监听器证书配置。
- 若监听器已绑定同一证书版本对应的远端证书标识（或经技术验证可用的同一 SHA-256 指纹），任务直接成功，满足幂等性。
- 同一 listener 只能有一个运行中的部署任务。证书续期后的重复事件可合并为最近版本的部署任务。
- 成功部署后不立即删除阿里云旧证书。清理应由独立、保守的保留策略执行。

## 7. Provider 接口

领域接口只暴露 CertFlow 需要的能力，供应商 SDK 类型不得泄漏到 `domain` 包。

```go
type DNSProvider interface {
    Provider() string
    Validate(ctx context.Context, account DNSAccount) error
    ResolveZone(ctx context.Context, account DNSAccount, fqdn string) (ZoneRef, error)
    PresentTXT(ctx context.Context, account DNSAccount, fqdn, value string) (RecordRef, error)
    CleanupTXT(ctx context.Context, account DNSAccount, ref RecordRef) error
}

type CertificateDeployer interface {
    Type() string
    Validate(ctx context.Context, target DeploymentTarget) error
    Deploy(ctx context.Context, target DeploymentTarget, cert CertificateMaterial) (DeploymentResult, error)
}
```

`ZoneRef` 必须包含根 Zone、相对记录名与权限验证结果；不能仅以字符串后缀猜测 Zone。`RecordRef` 必须保存提供者记录 ID、名称和值等足以精确删除本次记录的信息。`DeploymentResult` 包含远端证书 ID、监听器 ID、绑定模式、绑定状态、最终指纹和非敏感元数据。

## 8. 任务队列、重试和锁

MVP 使用 PostgreSQL 的 `jobs`、`workflow_executions` 和 `outbox_events` 表，不引入外部消息队列。所有“变更领域状态并创建异步后续工作”的操作在同一数据库事务中写入状态与 outbox。

worker 使用 `FOR UPDATE SKIP LOCKED` 拉取 `next_run_at <= now()` 的到期任务；领取操作需在短事务中设置：

- `status=running`
- `worker_id`
- `lease_expires_at`
- `started_at`

worker 定期续租。进程崩溃后，reaper 将过期 lease 的任务归还队列或标记失败后重试。取消是协作式的：worker 在外部 API 调用和长轮询间隙检查 `cancel_requested_at`，并优先清理已创建的 DNS 记录。

调度器与 outbox publisher 可多副本运行，但每轮扫描通过 PostgreSQL advisory lock 选出 leader；唯一幂等约束仍是第二道防线。所有时间由数据库 `now()` 决定，避免应用容器时钟漂移导致重复续期或过早领取。

建议错误分类：

| 分类 | 示例 | 策略 |
| --- | --- | --- |
| `transient` | DNS API 超时、阿里云 5xx | 指数退避重试 |
| `rate_limited` | ACME 或云 API 限流 | 依据 Retry-After 或延后重试 |
| `configuration` | 凭证错误、Listener ID 不存在 | 不自动无限重试，通知用户 |
| `validation` | 域名不匹配、证书材料无效 | 终止任务 |
| `conflict` | 同一证书正在签发 | 合并或返回已有执行 ID |

建议退避为 1 分钟、5 分钟、15 分钟、1 小时、4 小时，最多 5 次；DNS 传播的内部轮询不计入工作流重试次数。

## 9. REST API 草案

所有写入接口要求身份认证、RBAC 和审计记录。可能造成外部副作用的接口支持 `Idempotency-Key` 请求头。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` / `GET` | `/api/v1/acme-accounts` | 创建、查询 ACME 账户 |
| `POST` | `/api/v1/acme-accounts/{id}/verify` | 验证/注册 ACME 账户 |
| `POST` / `GET` | `/api/v1/cloud-credentials` | 创建、查询云凭证逻辑资源 |
| `POST` | `/api/v1/cloud-credentials/{id}/rotate` | 创建新凭证版本并切换当前版本 |
| `POST` | `/api/v1/cloud-credentials/{id}/verify` | 验证云凭证及所需最小权限 |
| `POST` / `GET` | `/api/v1/dns-accounts` | 创建、查询 DNS 账户 |
| `POST` | `/api/v1/dns-accounts/{id}/verify` | 校验 DNS 凭证 |
| `POST` / `GET` | `/api/v1/certificates` | 创建、查询证书配置 |
| `PATCH` / `DELETE` | `/api/v1/certificates/{id}` | 修改、禁用或删除证书配置 |
| `POST` | `/api/v1/certificates/{id}/issue` | 创建首次签发任务 |
| `POST` | `/api/v1/certificates/{id}/renew` | 创建续期任务 |
| `POST` | `/api/v1/certificates/{id}/revoke` | 撤销当前版本；需理由和强确认 |
| `POST` / `GET` | `/api/v1/deployment-targets` | 创建、查询部署目标 |
| `POST` | `/api/v1/certificates/{id}/deployments` | 绑定部署目标 |
| `POST` | `/api/v1/certificate-deployments/{id}/deploy` | 手动创建部署任务 |
| `GET` | `/api/v1/executions` | 按证书、目标、状态查询记录 |
| `GET` | `/api/v1/executions/{id}` | 获取执行与步骤详情 |
| `POST` | `/api/v1/executions/{id}/cancel` | 协作式取消可取消任务 |
| `POST` / `GET` | `/api/v1/notification-endpoints` | 配置通知端点 |
| `POST` | `/api/v1/notification-endpoints/{id}/test` | 发送脱敏测试事件 |
敏感请求字段只可写不可读。`GET` 只返回 `credential_hint`、`has_private_key`、`fingerprint` 等摘要。

撤销、禁用与删除必须区分：撤销是对 ACME 与证书版本的不可逆外部操作，不自动移除 ALB 上的已部署版本；禁用停止续期与自动部署，但不删除材料；删除仅允许无活动 job 且无启用关联的资源，并默认软删除。撤销请求必须携带 `reason`、通过强确认并记录审计事件；撤销后将当前版本标记为已撤销，是否切换部署目标由操作者显式发起独立部署任务。

## 10. Webhook 通知

MVP 通知事件：

- `certificate.issue.failed`
- `certificate.renew.failed`
- `certificate.expiring`
- `deployment.failed`
- `notification.failed`

发送 HTTP `POST`，请求体为 JSON。若端点配置 secret，附带：

```text
X-CertFlow-Event: deployment.failed
X-CertFlow-Delivery: <delivery-id>
X-CertFlow-Timestamp: <unix-seconds>
X-CertFlow-Signature: sha256=<hmac>
```

HMAC 输入为 `timestamp + "." + raw_body`。接收方应拒绝时间窗外的请求，并根据 delivery ID 去重。

Webhook 需要 SSRF 防护：只允许 `https`（开发环境可显式启用 `http`）、解析并阻止 loopback/link-local/private 网络地址、限制重定向、设置连接与总超时、限制响应体读取大小。通知失败也必须写入执行记录，但不能递归触发无限通知。

## 11. 安全与权限

### 11.1 密钥保护

- 账户私钥、DNS 凭证、云凭证、证书私钥、Webhook secret 均使用 AES-256-GCM 加密后入库。
- 生产环境使用 KMS 或 Vault 进行 envelope encryption：数据库保存数据密钥加密的密文与 key version，主密钥不进入数据库。
- 开发环境允许从环境变量读取本地主密钥；启动时拒绝短于 32 字节的密钥。
- 每个密文携带版本、nonce、AAD 和 key version；AAD 至少绑定资源类型与资源 ID，避免密文跨资源替换。
- 支持主密钥轮换和按读取重加密。

### 11.2 RBAC

MVP 的身份来源必须明确为企业 OIDC Provider。Go API 校验 issuer、audience、签名和过期时间，并以不可变的 `issuer + subject` 映射本地用户与角色；不以邮箱作为授权主键。Next.js BFF 仅保存 `httpOnly`、`secure`、`sameSite=lax` 会话 cookie，并使用短期、受限 audience 的 token 调用 Go API。浏览器不得持有云凭证、ACME 私钥或后端服务 token。

开发环境可显式启用本地 bootstrap 管理员，生产环境启动时拒绝该模式。需定义 OIDC 断连、登出、会话失效、角色变更生效时间，以及 API/worker 使用的独立 service principal。所有状态改变请求都必须具备 CSRF 防护、请求 ID 和操作者身份。

最小角色：

| 角色 | 权限 |
| --- | --- |
| `admin` | 管理账户、凭证、证书、目标、通知及用户 |
| `operator` | 管理证书和部署，查看执行记录；不可读取或导出密钥 |
| `viewer` | 只读查看非敏感配置、状态和记录 |

所有创建、修改、禁用、删除、手动签发、手动续期、手动部署、通知测试均写入只追加的审计事件。审计表只授予应用 append 权限，运维查看通过受控只读角色；审计字段包括操作者、动作、资源、请求 ID、来源 IP、前后非敏感摘要和时间。

### 11.3 日志与错误

- 所有日志通过统一脱敏器处理，禁止记录 PEM、Authorization、Cookie、Secret、AccessKey Secret 和完整 Webhook URL。
- API 向普通用户返回稳定错误码和可操作的简短说明；内部错误详情只留在受限日志和执行步骤中。
- 证书下载接口如未来需要，必须有显式权限、审计和短期下载令牌；MVP 不提供私钥下载。

## 12. 可观测性与运维

最少指标：

- `certflow_executions_total{kind,status}`
- `certflow_execution_duration_seconds{kind}`
- `certflow_certificates_expiring_total{window}`
- `certflow_job_queue_depth`
- `certflow_webhook_deliveries_total{status}`
- `certflow_provider_requests_total{provider,operation,status}`

健康检查：

- `/healthz`：进程存活。
- `/readyz`：数据库、加密器和必要配置可用。
- worker 启动时检查数据库迁移版本和加密 key version。

备份需包含 PostgreSQL 数据及 KMS/Vault 密钥恢复方案。仅备份数据库而无法恢复加密主密钥，会导致所有证书和凭证不可用。

数据保留策略必须配置化并在上线前确定：执行步骤与非敏感日志默认保留 180 天，审计事件默认保留 1 年，已替换但仍被部署引用的证书版本或被 job 引用的凭证版本不得清理。清理作业只能删除超过保留期、未被 job/执行/部署引用且非当前版本的记录，并产生审计事件。生产环境至少每季度完成一次“数据库备份 + KMS/Vault 密钥材料”恢复演练，记录 RPO、RTO 和结果；仅验证备份存在不视为验收通过。

## 13. MVP 交付顺序

1. 单仓库骨架：Go `backend/`、Next.js `frontend/`、本地 Docker Compose、配置加载、PostgreSQL 迁移、OIDC 认证、service principal 和 envelope encryption。
2. `cloud_credentials`、ACME 账户、阿里云 DNS 账户的 CRUD、最小权限验证与凭证轮换。
3. 证书配置、不可变证书版本、逐 SAN DNS/Zone 验证和 DNS-01 首次签发；支持多个 DNS-01 SAN 及多个一层通配符。
4. PostgreSQL `jobs`、执行记录、outbox、锁、取消、重试与手动重试接口。
5. 续期调度器与到期预警。
6. 阿里云技术验证：证书上传 API、ALB 默认/SNI 绑定、证书状态、区域限制、读取验证与回滚边界；将结果写成 adapter 契约测试。
7. 阿里云 SSL 上传和 ALB Listener 更新；以冻结版本和目标快照实现远端状态验证和幂等部署。
8. Next.js + React + HeroUI 3.0 管理台：认证保护、证书/账户/目标 CRUD、执行记录和错误展示；以 OpenAPI 类型生成对接 Go API。
9. 失败 Webhook、审计日志、指标、告警、备份恢复演练和端到端测试。

每一步应提供集成测试：ACME 使用 Pebble/Boulder 测试环境，Aliyun SDK 使用接口 mock；第 6 步和最终端到端测试使用专用阿里云测试账号与测试 ALB。测试必须覆盖多 SAN、`example.com` + `*.example.com`、`*.api.example.com`、同一 challenge FQDN 的多 TXT 值、失败清理、worker 崩溃恢复和配置变更后的任务快照隔离。

## 14. 后续演进

- HTTP-01：增加 challenge responder 组件，而不是挤入 DNS adapter。
- 其他 DNS provider：实现 `DNSProvider`，保留统一 DNS TXT 清理语义。
- Nginx、Kubernetes Ingress、CDN：实现 `CertificateDeployer`。
- CNAME 委托 DNS-01：在完成委托目标验证和权限模型后，支持跨账户 challenge Zone。
- 脚本通知：只能调用经过管理员审核的脚本 ID，在受限用户、限时、限资源和隔离工作目录中执行。
- 多租户：在所有领域表加入 `tenant_id`，并将其放入加密 AAD、锁键和所有唯一索引。
- 工作流编排：当存在三个以上需组合的部署/检查步骤时，再引入版本化流程定义；不要在 MVP 建造通用 DSL。

## 15. 关键验收标准

1. 管理员可创建、验证和轮换阿里云凭证，再创建 ACME 与阿里云 DNS 账户；API 不回显 secret。
2. 操作员可通过 DNS-01 签发含通配符的 ECDSA 或 RSA 证书。
3. 证书材料仅以密文存储；日志、执行记录和 API 响应中没有私钥或 AccessKey Secret。
4. 自动续期在阈值内只创建一个有效任务，重复调度不会造成重复签发。
5. 新证书可上传至阿里云 SSL 证书管理，并绑定到指定 ALB Listener；重复部署同一指纹不产生破坏性修改。
6. 任一失败可在执行详情中看到失败步骤、稳定错误码和脱敏上下文。
7. 失败事件可可靠投递 Webhook，并具备签名、超时、重试、去重和 SSRF 防护。
8. 服务或 worker 意外重启后，租约过期任务可恢复处理；遗留 DNS TXT 记录可被后续恢复任务清理。
9. 管理台可完成 MVP 资源管理与任务触发；敏感字段不回显，长任务跳转至可轮询的执行详情，且 UI 权限与后端 RBAC 一致。
10. 一次续期创建不可变的新证书版本；已经排队的部署任务仍使用创建时冻结的证书版本、目标配置和凭证版本，能够准确审计和安全重试。
11. 同一张证书可签发 `example.com`、`*.example.com`、`*.api.example.com` 等多个 SAN；系统拒绝将 `*.example.com` 错误描述为覆盖 `v1.api.example.com`。
12. 阿里云 adapter 契约测试验证默认和 SNI 绑定语义、远端证书状态读取与重复部署幂等性；未经验证的云 API 假设不得进入生产逻辑。
13. 生产认证仅接受配置的 OIDC issuer；本地 bootstrap 管理员、无 CSRF 防护的写操作和长期后端服务 token 均不能启用。
