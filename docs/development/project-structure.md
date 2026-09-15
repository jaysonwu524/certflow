# 项目结构

本页描述稳定的模块职责，不维护逐文件快照。具体文件请以仓库目录和 `rg --files` 为准。

```text
certflow/
  apps/
    control-plane/                 Go 控制面与数据库迁移
      cmd/certflow/                API、worker、调度器启动入口
      cmd/dbinit/                  外部 PostgreSQL 建库辅助命令
      internal/
        httpapi/                   REST、认证、SSE、设置与通知接口
        store/                     PostgreSQL 数据访问与 golang-migrate
        domain/                    领域模型
        issuance/ renewal/         证书签发与续期调度
        certupload/ deployment/    SSL 上传与 ALB 部署处理器
        cloudprovider/             云能力策略接口与阿里云实现
        dns/ alb/ cas/             阿里云适配器
        cryptobox/                 密文加解密
        job/                       持久化队列与 worker
        mailer/                    SMTP 投递
    console/                       Next.js 控制台与同源 BFF
      app/                         页面与 API route handlers
      components/
        layout/                    应用壳、页面标题、通知与实时事件
        providers/                 主题、国际化与客户端数据 Provider
        ui/                        可复用 Modal、表格、状态与空状态组件
        charts/                    概览图表与图表空状态
        marketing/                 官网展示组件
      features/
        auth/                      登录、注册和会话体验
        certificates/              证书列表、签发与手动验证
        automations/               自动化任务、部署目标与执行记录
        credentials/               云凭证、ACME 账户与 DNS 账户
        settings/                  管理员配置与个人设置
      lib/                         API 客户端、展示与营销文案工具
    agent/                         未来远程执行面，独立 Go Module
  contracts/
    control-plane/                 Console 与 Control Plane 的版本化 API 契约
    agent/v1/                      Agent 注册、任务与结果协议
  deploy/
    compose/                       本地、生产与外部数据库 Compose
    proxy/                         Caddy、Nginx 等反向代理模板
  tools/
    diagnostics/                   仅限受控运维的诊断工具
    scripts/                       发布、备份与恢复脚本
  docs/                            当前文档与历史归档
  .github/workflows/               CI 与 GHCR 镜像发布
```

## 边界

- 浏览器只访问 Console 的同源 API；ACME、DNS、云 API 与密钥加密逻辑只在 Control Plane 执行。
- `httpapi` 负责认证、授权、输入校验和请求编排；外部云操作由 worker 处理器执行。
- `store` 是数据库状态与迁移的唯一入口；迁移文件随 Control Plane 镜像发布。
- Console 基础控件优先使用 HeroUI，资源新增、编辑和详情通过统一 Modal 工作流实现。
- Console 业务组件、页面级状态和领域 DTO 映射归入对应 `features/`；不再在 `components/` 根目录新增业务组件。
