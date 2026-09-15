# 本地开发与测试

## 开发环境

```bash
make setup
make db-up
make control-plane-run
```

另开终端：

```bash
make console-dev
```

本地配置位于 `.env`，由 `.env.example` 创建模板。生成开发用加密密钥：

```bash
make gen-key
```

## 质量检查

```bash
make control-plane-test
make control-plane-lint
make console-lint
make console-build
git diff --check
```

Control Plane 全量测试也可直接执行：

```bash
cd apps/control-plane
go test ./...
go vet ./...
```

## 外部集成验证

真实 ACME、DNS、SSL 上传和 ALB 更新会修改外部资源。验证时应使用专用测试域名、Let's Encrypt staging、最小权限 RAM 凭证和非生产 ALB。

建议按以下顺序验证：

1. 创建并验证云凭证，确认 DNS Zone、RDS 或 ALB 发现接口可用。
2. 创建 DNS 账户并确认授权 Zone。
3. 创建 ACME 账户与测试证书，先使用手动 TXT 或 staging。
4. 验证证书版本、执行记录和 SSE 状态。
5. 再测试 SSL 上传和 ALB 监听器更新。

不要将真实 AccessKey、证书私钥、SMTP 密码或生产数据库连接串写进测试脚本、fixtures 或提交记录。
