# 开源准备清单

本文档记录了 CertFlow 项目开源到 GitHub 的准备工作。

## ✅ 已完成

### 1. 许可证和法律文件
- [x] **LICENSE** - Apache License 2.0
- [x] **NOTICE** - 版权声明和第三方依赖说明
- [x] **版权头文件模板** - `.copyright-header.go` 和 `.copyright-header.js`

### 2. 社区文件
- [x] **CONTRIBUTING.md** - 贡献指南
- [x] **CODE_OF_CONDUCT.md** - 行为准则（基于 Contributor Covenant 2.0）
- [x] **SECURITY.md** - 安全漏洞报告指南

### 3. 文档
- [x] **README.md** - 增强版，包含徽章、特性列表、许可证信息
- [x] **CHANGELOG.md** - 变更日志
- [x] **DESIGN.md** - 已存在，架构设计文档

### 4. GitHub 配置
- [x] **.github/workflows/**
  - [x] `backend-ci.yml` - Go 后端 CI/CD
  - [x] `frontend-ci.yml` - Next.js 前端 CI/CD
  - [x] `docker-build.yml` - Docker 镜像构建
- [x] **.github/ISSUE_TEMPLATE/**
  - [x] `bug_report.yml` - Bug 报告模板
  - [x] `feature_request.yml` - 功能请求模板
  - [x] `config.yml` - Issue 模板配置
- [x] **.github/PULL_REQUEST_TEMPLATE.md** - PR 模板

### 5. 配置文件
- [x] **.gitignore** - 完善的忽略规则（包含证书、密钥等敏感文件）
- [x] **.dockerignore** - Backend 和 Frontend 各自的 Docker 忽略文件
- [x] **.editorconfig** - 统一编辑器配置
- [x] **Makefile** - 简化常用命令

### 6. 环境配置
- [x] **.env.example** - 已存在

## ⚠️ 发布前检查清单

### 安全检查（重要！）
- [ ] 确认所有敏感信息已从代码中移除
  - [ ] 检查是否有硬编码的密钥、密码、Token
  - [ ] 检查是否有真实的阿里云凭证
  - [ ] 检查是否有真实的域名或 IP 地址
  - [ ] 检查 Git 历史中是否有敏感信息

- [ ] 运行安全扫描
  ```bash
  # 扫描 Git 历史中的密钥
  git secrets --scan-history
  
  # 或使用 gitleaks
  gitleaks detect --source . -v
  ```

### 代码质量
- [ ] 所有测试通过
  ```bash
  make test
  ```

- [ ] 代码格式化
  ```bash
  make format
  ```

- [ ] 代码检查通过
  ```bash
  make lint
  ```

### 文档完善
- [ ] 更新 README.md 中的占位符
  - [ ] 将 `yourusername` 替换为实际的 GitHub 用户名
  - [ ] 添加实际的项目 URL
  - [ ] 更新徽章 URL

- [ ] 更新 SECURITY.md 中的联系方式
  - [ ] 将 `security@yourdomain.com` 替换为实际邮箱

- [ ] 更新 CHANGELOG.md
  - [ ] 添加首次发布版本号
  - [ ] 更新 GitHub 链接

- [ ] 更新 .github/ISSUE_TEMPLATE/config.yml
  - [ ] 替换所有的 `yourusername/certflow` 为实际仓库路径

### 添加版权声明（可选但推荐）
- [ ] 为所有 Go 源文件添加版权头
  ```bash
  # 可以使用工具批量添加，例如：
  find backend -name "*.go" -exec sh -c 'cat .copyright-header.go "$1" > temp && mv temp "$1"' _ {} \;
  ```

- [ ] 为所有 TypeScript/JavaScript 文件添加版权头

## 📋 发布步骤

### 1. 创建 GitHub 仓库
```bash
# 在 GitHub 上创建新仓库，然后：
git remote add origin https://github.com/yourusername/certflow.git
git branch -M main
git push -u origin main
```

### 2. 配置仓库设置
- [ ] 启用 GitHub Actions
- [ ] 启用 Issues 和 Discussions
- [ ] 配置 Branch Protection（保护 main 分支）
  - [ ] 要求 PR review
  - [ ] 要求 CI 通过
  - [ ] 要求分支更新
- [ ] 添加仓库描述和标签
- [ ] 设置 GitHub Pages（如果需要文档网站）

### 3. 配置 Secrets
在仓库设置中添加必要的 Secrets：
- [ ] `CODECOV_TOKEN`（如果使用 Codecov）
- [ ] 其他 CI/CD 需要的密钥

### 4. 创建首个 Release
```bash
# 打标签
git tag -a v0.1.0 -m "Initial release"
git push origin v0.1.0

# 在 GitHub 上创建 Release，包含：
# - 版本说明
# - 安装指南链接
# - 已知限制
```

### 5. 宣传和推广
- [ ] 在社交媒体分享
- [ ] 提交到 awesome 列表
- [ ] 在相关社区发布
- [ ] 撰写博客文章介绍项目

## 🔄 持续维护

### 定期任务
- [ ] 每月检查依赖更新
- [ ] 每季度更新文档
- [ ] 及时回复 Issues 和 PR
- [ ] 定期发布新版本

### 监控
- [ ] 设置 GitHub Notifications
- [ ] 监控 CI/CD 状态
- [ ] 关注安全漏洞通知

## 📚 推荐阅读

- [开源指南](https://opensource.guide/zh-hans/)
- [语义化版本](https://semver.org/lang/zh-CN/)
- [如何维护开源项目](https://opensource.guide/zh-hans/best-practices/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)

## 🤝 获得帮助

如果在开源过程中遇到问题，可以参考：
- GitHub 官方文档
- 开源社区论坛
- 其他成功的开源项目案例

---

**准备就绪后，就可以向世界展示你的项目了！** 🚀
