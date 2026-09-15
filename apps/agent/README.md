# CertFlow Agent

CertFlow Agent 是未来部署在内网主机、Kubernetes 集群或受管服务器上的执行面。它将主动连接 Control Plane，领取经过授权的远程操作并回传执行结果。

该目录当前只建立独立模块与协议边界，不包含可部署 Agent 二进制，也不会在现有 Docker Compose 中启动。

实现时必须遵守：

- Agent 不直接访问 Control Plane 数据库，也不导入 `apps/control-plane/internal`。
- 身份注册、心跳、任务领取和结果回传必须使用 `contracts/agent/v1` 中版本化协议。
- 连接应由 Agent 主动发起，并使用短期凭证与 mTLS 或等价机制认证。
- 任务必须具备幂等键、超时、取消语义、最小权限和脱敏日志。
