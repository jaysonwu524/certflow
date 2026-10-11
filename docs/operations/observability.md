# 可观测性

CertFlow 通过标准输出写入结构化 JSON 日志，并在 Control Plane 同一监听端口提供 Prometheus 拉取端点。

## 端点

| 端点 | 用途 | 访问边界 |
| --- | --- | --- |
| `/healthz` | 进程存活检查，不访问数据库。 | 可用于容器 liveness probe。 |
| `/readyz` | 数据库连接就绪检查。 | 可用于反向代理或 orchestrator readiness probe。 |
| `/metrics` | Prometheus OpenMetrics/文本格式指标。 | 仅限私有网络或受限反向代理访问。 |

`/metrics` 无需业务登录，以便 Prometheus 拉取。因此生产环境不得将 Control Plane 的 8080 端口直接发布到公网。默认生产 Compose 仅将该端口暴露给 Compose 内部网络。

## Prometheus 示例

Prometheus 与 Control Plane 位于同一私有 Docker 网络时，可配置：

```yaml
scrape_configs:
  - job_name: certflow
    scrape_interval: 30s
    metrics_path: /metrics
    static_configs:
      - targets: ["control-plane:8080"]
```

外部 Prometheus 应通过 VPN、VPC 私网、服务网格或只允许 Prometheus 来源地址的反向代理访问，不能通过公开 DNS 直接暴露该端点。

## 指标

| 指标 | 标签 | 说明 |
| --- | --- | --- |
| `certflow_http_requests_total` | `method`、`route`、`status` | API 请求数量。按 chi 路由模板聚合，不包含 `/metrics` 自身抓取。 |
| `certflow_http_request_duration_seconds` | `method`、`route`、`status` | API 请求延迟直方图。 |
| `certflow_http_requests_in_flight` | `method` | 当前正在处理的请求数。 |
| `certflow_jobs_completed_total` | `kind`、`status` | 签发、续期、上传、部署等 worker job 的完成结果。 |
| `certflow_job_duration_seconds` | `kind`、`status` | 单次 worker job 尝试耗时。 |
| `certflow_jobs_in_flight` | `kind` | 当前正在执行的 worker job。 |
| `certflow_job_queue_depth` | 无 | worker 每 30 秒刷新的 queued job 数。 |
| `certflow_scheduler_runs_total` | `status` | 自动化调度扫描的结果。 |
| `certflow_scheduler_jobs_queued_total` | `type` | 调度器入队的任务数。 |
| `certflow_certificates_expiring_total` | `window` | 7 天和 30 天内到期的已签发证书数。 |
| `certflow_notification_deliveries_total` | `channel`、`status` | 邮件和 Webhook 通知投递结果。 |
| `certflow_provider_requests_total` | `provider`、`operation`、`status` | 阿里云 RPC 请求结果。 |

所有标签均为固定、低基数的系统维度。不会将用户、证书、任务、域名、IP、Webhook URL、AccessKey 或原始错误内容作为标签。

## 建议告警

- `up{job="certflow"} == 0` 持续 2 分钟：服务不可抓取。
- `rate(certflow_http_requests_total{status=~"5.."}[5m])` 出现持续增长：API 服务异常。
- `increase(certflow_jobs_completed_total{status="failed"}[15m]) > 0`：人工检查失败执行及通知通道。
- `certflow_job_queue_depth` 长时间高于日常基线：worker 或外部服务阻塞。
- `certflow_certificates_expiring_total{window="7d"} > 0`：核查续期自动化和 DNS 凭证。
- `increase(certflow_notification_deliveries_total{status="failed"}[15m]) > 0`：检查 SMTP 或 Webhook 可达性。

告警消息应包含 dashboard 链接与运行环境，不应包含任何请求体、凭证或私钥。

## 日志与关联

每个 HTTP 响应均会返回 `X-Request-ID`。已认证写请求的审计事件会保存同一 request ID，便于从用户操作追踪到结构化日志和审计记录。日志只写入 stdout，容器运行环境应负责轮转、保留期和集中收集。

发生未捕获的 HTTP panic 时，服务会记录 request ID、HTTP 方法和路径，并返回稳定的 `internal_error`；请求体和 Cookie 不会写入日志。
