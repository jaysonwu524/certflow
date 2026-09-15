# Console Features

`features/` 是 Console 的业务垂直模块边界。业务组件、页面级状态和领域 API 映射应按领域归属，而不是页面名称归档：

- `certificates/`：证书列表、签发和手动验证；
- `automations/`：自动化任务、部署目标和执行记录；
- `credentials/`：云凭证、ACME 账户和 DNS 账户；
- `auth/`：登录、注册和会话体验；
- `settings/`：管理员配置与个人设置。

每个 Feature 自行持有业务组件、表单 schema、Query Key 和 API DTO 映射；跨领域可复用的展示组件放在 `components/ui/`，布局组件放在 `components/layout/`。新增业务代码不得重新放回 `components/` 根目录。
