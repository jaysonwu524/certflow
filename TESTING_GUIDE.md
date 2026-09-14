# CertFlow 多云平台重构 - 验证和测试指南

## 编译和基础验证

### 1. 编译测试
```bash
cd backend
go build -o certflow ./cmd/certflow

# 如果编译成功，应该没有错误输出
```

### 2. 运行单元测试
```bash
cd backend
go test ./internal/cloudprovider/...
go test ./internal/store/...
go test ./internal/httpapi/...
```

## 功能测试清单

### 阶段 1: 基础功能测试

#### 1.1 数据库迁移测试
- [ ] 启动应用，确认迁移 011 自动执行
- [ ] 检查 `cloud_credentials` 表的 `provider` 字段已更新
- [ ] 验证现有阿里云凭证的 provider 字段为 'aliyun'

```sql
-- 验证迁移
SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;

-- 检查 provider 字段
SELECT id, name, provider, status FROM cloud_credentials;

-- 验证约束
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name = 'cloud_credentials_provider_check';
```

#### 1.2 创建云凭证 - 新格式
使用前端或 API 创建阿里云凭证：

```bash
curl -X POST http://localhost:8080/api/v1/cloud-credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "测试阿里云凭证",
    "provider": "aliyun",
    "credentials": {
      "access_key_id": "LTAI...",
      "access_key_secret": "your_secret"
    }
  }'
```

预期结果：
- ✅ 返回 201 Created
- ✅ 返回凭证 ID
- ✅ 数据库中 provider = 'aliyun'
- ✅ 凭证已加密存储

#### 1.3 创建云凭证 - 旧格式（向后兼容）
```bash
curl -X POST http://localhost:8080/api/v1/cloud-credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "兼容性测试凭证",
    "accessKeyId": "LTAI...",
    "accessKeySecret": "your_secret"
  }'
```

预期结果：
- ✅ 返回 201 Created
- ✅ 自动识别为 aliyun provider
- ✅ 转换为新格式存储

#### 1.4 更新云凭证
```bash
curl -X PATCH http://localhost:8080/api/v1/cloud-credentials/{id} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "更新后的名称",
    "credentials": {
      "access_key_id": "LTAI_NEW...",
      "access_key_secret": "new_secret"
    }
  }'
```

预期结果：
- ✅ 返回 204 No Content
- ✅ 凭证已轮换
- ✅ 新版本已创建

### 阶段 2: 集成功能测试

#### 2.1 DNS 账户创建
- [ ] 使用新创建的云凭证创建 DNS 账户
- [ ] 验证可以列出 DNS zones
- [ ] 检查 allowedZones 正确保存

#### 2.2 部署目标创建
- [ ] 使用新创建的云凭证创建部署目标
- [ ] 验证可以列出 regions
- [ ] 验证可以列出 load balancers
- [ ] 验证可以列出 listeners

#### 2.3 证书签发流程
- [ ] 创建 ACME 账户
- [ ] 创建证书（使用 DNS 验证）
- [ ] 验证签发成功
- [ ] 检查 DNS 记录正确创建和清理

#### 2.4 证书部署流程
- [ ] 创建证书部署配置
- [ ] 手动触发部署
- [ ] 验证证书上传到阿里云 CAS
- [ ] 验证 ALB listener 证书已更新
- [ ] 检查部署状态正确记录

#### 2.5 自动化任务
- [ ] 创建证书续签自动化任务
- [ ] 创建证书上传自动化任务
- [ ] 创建证书部署自动化任务
- [ ] 验证任务正常运行
- [ ] 检查执行记录

### 阶段 3: 前端测试

#### 3.1 云凭证列表页面
- [ ] 显示云平台图标/标识
- [ ] 显示凭证提示信息
- [ ] 状态标签显示正确

#### 3.2 创建云凭证表单
- [ ] 平台下拉选择器显示正确
- [ ] 选择"阿里云"显示 AccessKey ID 和 Secret 字段
- [ ] 选择"AWS"显示 Access Key ID 和 Secret Access Key 字段
- [ ] 选择"腾讯云"显示 SecretId 和 SecretKey 字段
- [ ] 切换平台时字段动态更新
- [ ] 提交表单成功

#### 3.3 编辑云凭证表单
- [ ] 平台选择器被禁用
- [ ] 显示提示"编辑时不可修改云平台类型"
- [ ] 凭证字段可以更新
- [ ] 空字段保持原值

### 阶段 4: 错误处理测试

#### 4.1 验证错误
- [ ] 创建凭证时 provider 为空 → 返回错误
- [ ] credentials 为空 → 返回错误
- [ ] 阿里云凭证缺少 access_key_id → 返回错误
- [ ] 不支持的 provider → 返回错误

#### 4.2 权限错误
- [ ] 使用无效凭证创建 DNS 账户 → 返回错误
- [ ] 使用无效凭证部署证书 → 返回错误

#### 4.3 删除约束
- [ ] 删除被 DNS 账户引用的凭证 → 返回 409
- [ ] 删除被部署目标引用的凭证 → 返回 409
- [ ] 删除被自动化任务引用的凭证 → 返回 409

## 性能测试

### 凭证操作性能
- [ ] 创建凭证响应时间 < 500ms
- [ ] 加载凭证列表响应时间 < 200ms
- [ ] 轮换凭证响应时间 < 500ms

### Worker 处理性能
- [ ] 证书部署完成时间与重构前相近
- [ ] 证书上传完成时间与重构前相近
- [ ] 内存使用无明显增加

## 安全性验证

### 凭证安全
- [ ] 凭证始终加密存储
- [ ] API 响应不返回明文凭证
- [ ] 日志中不包含明文凭证
- [ ] 错误信息不泄露凭证

### 权限控制
- [ ] 普通用户只能访问自己的凭证
- [ ] 管理员可以访问所有凭证
- [ ] 多租户隔离正常工作

## 回滚计划

如果测试失败，回滚步骤：

1. **数据库回滚**
```sql
-- 回滚迁移 011
DELETE FROM schema_migrations WHERE version = 11;
ALTER TABLE cloud_credentials DROP CONSTRAINT IF EXISTS cloud_credentials_provider_check;
```

2. **代码回滚**
```bash
git revert <commit-hash>
# 或者
git checkout <previous-tag>
```

3. **验证回滚**
- 编译成功
- 现有功能正常
- 数据完整性

## 监控指标

### 关键指标
- 凭证创建成功率
- 凭证验证失败率
- 部署任务成功率
- API 响应时间
- Worker 处理时间

### 告警规则
- 凭证验证失败率 > 10%
- 部署任务失败率 > 5%
- API 响应时间 > 1s
- Worker 任务积压 > 100

## 文档更新

- [ ] 更新 API 文档
- [ ] 更新用户手册
- [ ] 更新运维文档
- [ ] 更新开发者文档
- [ ] 添加多云平台支持说明

## 后续工作

### 短期 (1-2 周)
- [ ] 实现 AWS 提供商
- [ ] 添加提供商能力检测
- [ ] 完善错误提示信息

### 中期 (1-2 月)
- [ ] 实现腾讯云提供商
- [ ] 实现华为云提供商
- [ ] 添加凭证自动验证

### 长期 (3+ 月)
- [ ] 支持更多云平台
- [ ] 提供商健康检查
- [ ] 凭证管理最佳实践

## 联系人

- 架构问题: [架构师姓名]
- 测试问题: [测试负责人姓名]
- 部署问题: [运维负责人姓名]
