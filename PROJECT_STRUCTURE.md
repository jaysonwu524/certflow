# CertFlow 项目结构

```
certflow/
├── 📄 核心文档
│   ├── README.md                    # 项目主页和快速开始
│   ├── LICENSE                      # Apache 2.0 许可证
│   ├── NOTICE                       # 版权声明和第三方依赖
│   ├── CHANGELOG.md                 # 版本变更日志
│   ├── CONTRIBUTING.md              # 贡献指南
│   ├── CODE_OF_CONDUCT.md          # 社区行为准则
│   ├── SECURITY.md                  # 安全策略
│   └── Makefile                     # 便捷命令工具
│
├── 📁 docs/                         # 📚 文档目录
│   ├── README.md                    # 文档索引
│   ├── ARCHITECTURE.md              # 系统架构设计文档
│   ├── LOGO_DESIGN_BRIEF.md        # Logo 设计简报
│   ├── OPENSOURCE_SUMMARY.md        # 开源工作总结
│   └── OPENSOURCE_CHECKLIST.md      # 开源发布清单
│
├── 📁 backend/                      # 🔧 Go 后端
│   ├── cmd/
│   │   ├── certflow/                # 主服务入口
│   │   └── dbinit/                  # 数据库初始化
│   ├── internal/
│   │   ├── api/                     # HTTP API
│   │   ├── store/                   # 数据访问层
│   │   ├── domain/                  # 领域模型
│   │   ├── job/                     # 任务队列 Worker
│   │   ├── issuance/                # 证书签发处理器
│   │   ├── renewal/                 # 自动续期调度器
│   │   ├── deployment/              # 证书部署处理器
│   │   ├── dns/aliyun/              # 阿里云 DNS 适配器
│   │   ├── alb/                     # 阿里云 ALB 客户端
│   │   ├── cas/                     # 阿里云证书管理
│   │   ├── cryptobox/               # 加密/解密
│   │   ├── aliyunrpc/               # 阿里云 RPC 客户端
│   │   ├── config/                  # 配置管理
│   │   └── id/                      # ID 生成
│   ├── go.mod                       # Go 依赖管理
│   ├── go.sum
│   ├── Dockerfile                   # 后端 Docker 镜像
│   └── .dockerignore
│
├── 📁 frontend/                     # 🎨 Next.js 前端
│   ├── app/                         # App Router 页面
│   │   ├── dashboard/               # 仪表盘
│   │   ├── certificates/            # 证书管理
│   │   ├── executions/              # 执行记录
│   │   ├── deployments/             # 部署管理
│   │   ├── api/                     # API 路由
│   │   └── layout.tsx
│   ├── components/                  # React 组件
│   ├── lib/                         # 工具函数和客户端
│   ├── public/                      # 静态资源
│   ├── package.json                 # npm 依赖管理
│   ├── tsconfig.json                # TypeScript 配置
│   ├── next.config.ts               # Next.js 配置
│   ├── postcss.config.mjs           # PostCSS 配置
│   └── .dockerignore
│
├── 📁 .github/                      # 🤖 GitHub 配置
│   ├── workflows/
│   │   ├── backend-ci.yml           # Go 后端 CI/CD
│   │   ├── frontend-ci.yml          # Next.js 前端 CI/CD
│   │   └── docker-build.yml         # Docker 镜像构建
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml           # Bug 报告模板
│   │   ├── feature_request.yml      # 功能请求模板
│   │   └── config.yml               # Issue 模板配置
│   └── PULL_REQUEST_TEMPLATE.md     # PR 模板
│
├── 🔧 配置文件
│   ├── .env.example                 # 环境变量示例
│   ├── .gitignore                   # Git 忽略规则
│   ├── .editorconfig                # 编辑器配置
│   ├── .copyright-header.go         # Go 版权头模板
│   ├── .copyright-header.js         # JS/TS 版权头模板
│   └── docker-compose.yml           # Docker Compose 编排
│
└── 📦 其他
    └── .idea/                       # JetBrains IDE 配置（不提交）
```

## 📂 目录说明

### 根目录文件

| 文件 | 说明 | 用途 |
|------|------|------|
| **README.md** | 项目主页 | 快速开始、特性介绍、安装指南 |
| **LICENSE** | Apache 2.0 | 开源许可证 |
| **NOTICE** | 版权声明 | Apache 2.0 要求的声明文件 |
| **Makefile** | 命令工具 | `make help` 查看所有命令 |
| **docker-compose.yml** | 容器编排 | 本地开发环境 |

### docs/ - 文档目录

所有设计文档、架构文档、开源准备文档的集中存放位置。

**为什么需要这个目录？**
- 📚 集中管理所有非代码文档
- 🔍 方便查找和维护
- 🎯 区分"用户文档"和"内部设计文档"

### backend/ - Go 后端

采用标准 Go 项目布局：
- `cmd/` - 可执行程序入口
- `internal/` - 私有应用代码（不可被外部导入）
- 领域驱动设计（DDD）架构

### frontend/ - Next.js 前端

Next.js 14 App Router 架构：
- `app/` - 路由和页面（新的 App Router）
- `components/` - 可复用的 React 组件
- `lib/` - 工具函数和 API 客户端

### .github/ - GitHub 配置

完整的 CI/CD 和社区配置：
- 自动化测试和构建
- Issue 和 PR 模板
- 容器镜像自动发布

## 🎯 文档归档原则

### 根目录保留（用户可见）
- ✅ README.md - 项目主页
- ✅ LICENSE, NOTICE - 法律文件
- ✅ CONTRIBUTING.md - 贡献指南
- ✅ CODE_OF_CONDUCT.md - 行为准则
- ✅ SECURITY.md - 安全策略
- ✅ CHANGELOG.md - 版本历史

### docs/ 目录存放（技术文档）
- ✅ 架构设计文档
- ✅ 开发者指南
- ✅ 设计决策记录
- ✅ Logo/品牌设计简报
- ✅ 开源准备文档

## 🚀 快速命令

```bash
# 查看所有可用命令
make help

# 启动开发环境
make run

# 运行测试
make test

# 构建所有组件
make build

# 清理构建文件
make clean

# 生成加密密钥
make gen-key
```

## 📖 相关文档

- [文档索引](./docs/README.md)
- [架构设计](./docs/ARCHITECTURE.md)
- [贡献指南](./CONTRIBUTING.md)
- [开源准备清单](./docs/OPENSOURCE_CHECKLIST.md)
