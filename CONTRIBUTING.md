# 贡献指南

感谢你考虑为 CertFlow 做出贡献！

## 行为准则

本项目遵循 [行为准则](CODE_OF_CONDUCT.md)，参与者应遵守该准则。请阅读并理解其中的内容。

## 如何贡献

### 报告 Bug

如果你发现了 bug，请通过 GitHub Issues 报告：

1. 使用清晰描述性的标题
2. 详细描述复现步骤
3. 提供期望的行为和实际行为
4. 包含环境信息（操作系统、Go 版本、Node.js 版本等）
5. 如果可能，提供最小可复现示例

### 提出功能建议

我们欢迎新功能建议：

1. 使用清晰描述性的标题
2. 详细说明该功能的用途和价值
3. 如果可能，提供使用场景示例
4. 说明该功能是否已在其他工具中实现

### 提交代码

#### 准备工作

1. Fork 本仓库
2. Clone 你的 fork：
   ```bash
   git clone https://github.com/your-username/certflow.git
   cd certflow
   ```
3. 添加上游仓库：
   ```bash
   git remote add upstream https://github.com/original-owner/certflow.git
   ```

#### 开发流程

1. 创建新分支：
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

2. 进行修改，确保：
   - 代码风格一致
   - 添加适当的测试
   - 更新相关文档
   - 提交信息清晰

3. 运行测试：
   ```bash
   # 后端测试
   cd backend
   go test ./...
   go vet ./...
   
   # 前端测试
   cd ../frontend
   npm run build
   npm run lint
   ```

4. 提交更改：
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. 推送到你的 fork：
   ```bash
   git push origin feature/your-feature-name
   ```

6. 创建 Pull Request

#### 提交信息规范

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建/工具相关

示例：
```
feat: add support for wildcard certificates
fix: resolve DNS propagation timeout issue
docs: update installation guide
```

#### Pull Request 要求

- 清晰描述你的更改和原因
- 关联相关的 Issue（如果有）
- 确保所有测试通过
- 更新相关文档
- 保持提交历史清晰（必要时使用 rebase）

### 代码风格

#### Go 代码

- 遵循 [Effective Go](https://golang.org/doc/effective_go.html)
- 使用 `gofmt` 格式化代码
- 使用 `golint` 检查代码
- 每个导出的函数和类型都应有注释

#### TypeScript/JavaScript 代码

- 遵循项目的 ESLint 配置
- 使用 TypeScript 类型注解
- 组件应有清晰的 Props 类型定义

## 开发环境设置

### 必需工具

- Go 1.21+
- Node.js 18+
- Docker Desktop
- PostgreSQL 16+

### 本地开发

1. 启动 PostgreSQL：
   ```bash
   docker compose up -d postgres
   ```

2. 配置环境变量：
   ```bash
   cp .env.example .env
   # 编辑 .env 添加必需配置
   ```

3. 启动后端：
   ```bash
   cd backend
   go run ./cmd/certflow
   ```

4. 启动前端：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 测试

### 后端测试

```bash
cd backend
go test ./... -v
go test ./... -race
go test ./... -cover
```

### 前端测试

```bash
cd frontend
npm run build
npm run type-check
```

## 文档

如果你的更改影响用户使用，请更新相应文档：

- `README.md` - 项目概览和快速开始
- `DESIGN.md` - 架构设计
- `docs/` - 详细文档

## 许可证

通过贡献代码，你同意你的贡献将按照 [Apache License 2.0](LICENSE) 授权。

## 获得帮助

如果你有任何问题：

- 查看现有的 Issues 和 Discussions
- 创建新的 Issue 提问
- 在 Pull Request 中 @ 维护者

## 感谢

感谢你为 CertFlow 做出贡献！每一个贡献都很重要。
