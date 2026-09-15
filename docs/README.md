# CertFlow 文档

本文档目录以“当前规范优先、历史记录归档”为原则维护。根目录 [README](../README.md) 只保留项目介绍和快速开始；具体设计、开发和运维说明在此处维护。

## 架构与产品

- [架构概览](./architecture/overview.md)：边界、领域模型、任务模型、安全原则和 API 契约。
- [证书生命周期与自动化](./product/certificate-lifecycle.md)：SAN 与通配符、DNS 验证、续期、SSL 上传和 ALB 更新。

## 开发

- [测试与本地开发](./development/testing.md)：开发启动、质量检查与外部集成验证。
- [Console 工程规范](./development/console.md)：信息架构、HeroUI、主题、国际化与响应式规范。
- [项目结构](./development/project-structure.md)：当前代码模块的职责边界。

## 运行与安全

- [部署](./operations/deployment.md)：GitHub Actions、GHCR、Docker Compose、手动发布和回滚。
- [数据库](./operations/database.md)：PostgreSQL 初始化、`golang-migrate`、阿里云 RDS 与备份。
- [配置](./operations/configuration.md)：环境变量、管理员初始化和 Secret 管理。
- [安全策略](../SECURITY.md)：漏洞报告和安全响应。

## 品牌与历史资料

- [Logo 设计简报](./brand/logo-brief.md)
- [历史归档](./archive/README.md)：阶段性重构报告、旧测试清单与开源准备记录。归档资料不代表当前实现或运行规范。

## 文档维护规则

1. 同一主题只保留一个当前权威文档，避免 README、设计稿和总结文件重复描述。
2. 影响接口、配置、迁移、部署或安全边界的代码变更，必须同步更新对应当前文档。
3. 阶段总结、已关闭的检查单和一次性测试记录移入 `archive/`，不作为实施依据。
4. 新的长期架构决策应记录在 `architecture/decisions/`；目录尚未创建时先在架构概览中补充，再随首个 ADR 建立。
