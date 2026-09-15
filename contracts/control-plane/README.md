# Control Plane 契约

此目录用于保存 Console 与 Control Plane 之间的版本化 API 契约。引入 OpenAPI 后，规范文件命名为 `openapi.v1.yaml`，并由 CI 生成 Console 类型和客户端代码。

在契约落地前，现有 Next.js BFF 路由只代理 `/api/v1`，不得把控制面内部数据库模型作为跨应用契约。
