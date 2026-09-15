# Agent v1 契约

此目录预留 Agent 注册、身份轮换、能力上报、心跳、任务领取、取消和结果回传协议。

协议应保持向后兼容并明确版本。传输层可在实施时选择 gRPC/Protobuf 或 HTTPS JSON，但不能让 Agent 共享控制面的内部 Go 类型或数据库。
