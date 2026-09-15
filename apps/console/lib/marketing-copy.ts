import type { Locale } from "@/components/providers/locale-provider";

export const repositoryUrl = "https://github.com/jaysonwu524/certflow";
export const quickStartUrl = "https://github.com/jaysonwu524/certflow#readme";
export const documentationUrl = "https://github.com/jaysonwu524/certflow/tree/main/docs";
export const licenseUrl = "https://github.com/jaysonwu524/certflow/blob/main/LICENSE";

export const marketingCopy = {
  "zh-CN": {
    nav: {
      capabilities: "产品能力",
      workflow: "工作流",
      deployment: "部署",
      login: "登录",
      console: "进入控制台",
    },
    mobileMenu: "打开官网导航",
    hero: {
      eyebrow: "CERTIFICATE OPERATIONS",
      title: "从签发到部署，<br />证书全程可控",
      description: "统一管理 ACME、DNS 与云凭证，自动签发、续期并更新阿里云 SSL 和 ALB。",
      workflow: "查看工作流",
    },
    preview: {
      area: "证书运维",
      title: "证书",
      create: "新建证书",
      overview: "概览",
      automation: "自动化",
      certificates: "证书运维",
      metrics: [
        ["有效证书", "当前可用版本"],
        ["30 天内到期", "需要关注"],
        ["执行中的任务", "签发与部署"],
      ],
      headers: ["证书", "状态", "有效期"],
      statuses: ["有效", "签发中"],
      expiry: ["2027年 01月 18日", "DNS 验证中"],
    },
    coverage: {
      label: "覆盖证书交付的关键链路",
      items: ["ACME 签发", "DNS-01 验证", "阿里云 SSL", "ALB 更新"],
    },
    capabilities: {
      eyebrow: "一套清晰的控制面",
      title: "减少证书链路中的人工断点",
      description: "将凭证、签发、验证和云上部署收拢到同一处，团队不再依赖临时脚本和人工交接。",
      items: [
        {
          title: "凭证不再散落",
          description: "集中维护 ACME、DNS 与云平台凭证，明确权限边界并持续验证可用性。",
        },
        {
          title: "到期前主动完成续期",
          description: "支持多域名和通配符证书。每次签发、验证与续期都保留可追溯记录。",
        },
        {
          title: "新版本自动交付至入口",
          description: "证书版本可上传阿里云 SSL 证书管理，并更新关联 ALB 的监听器。",
        },
      ],
    },
    workflow: {
      eyebrow: "可运行的工作流",
      title: "配置一次，后续每次变更都有记录",
      description: "续期、云证书上传和 ALB 更新可以独立启用，也可以按顺序组合为一条交付链路。",
      deployment: "了解部署方式",
      items: [
        { title: "接入账户", detail: "录入 ACME、DNS 与云平台凭证，并完成可用性验证。" },
        { title: "定义证书", detail: "选择域名、算法与验证方式，统一管理证书版本。" },
        { title: "编排自动化", detail: "按需续期、上传云证书平台或更新 ALB 配置。" },
        { title: "持续可追溯", detail: "执行结果实时回传，失败可通过站内信、邮件或 Webhook 通知。" },
      ],
    },
    operations: {
      title: "把异常留在告警里，而不是留到生产事故",
      description: "证书状态、到期窗口、自动化健康度和失败详情集中展示，团队可以在影响业务前处理问题。",
      items: [
        "手动验证模式，支持人工接管 DNS Challenge",
        "证书版本留存，避免重复创建云端资源",
        "站内信、Webhook 与邮件统一分发执行结果",
      ],
    },
    openSource: {
      eyebrow: "开源部署",
      title: "用 Docker 在自己的环境部署",
      description: "CertFlow 基于 Go、PostgreSQL 与 Next.js 构建。数据、凭证和执行记录始终由你的团队掌控。",
      github: "查看 GitHub",
      quickStart: "Docker 快速开始",
    },
    footer: { description: "证书生命周期运营平台", docs: "文档", license: "许可证" },
  },
  en: {
    nav: {
      capabilities: "Capabilities",
      workflow: "Workflow",
      deployment: "Deploy",
      login: "Sign in",
      console: "Open console",
    },
    mobileMenu: "Open site navigation",
    hero: {
      eyebrow: "CERTIFICATE OPERATIONS",
      title: "Certificates from<br />issuance to ALB",
      description: "Manage ACME, DNS, and cloud credentials. Automate issuance, renewal, Aliyun SSL uploads, and ALB updates.",
      workflow: "View workflow",
    },
    preview: {
      area: "Certificate operations",
      title: "Certificates",
      create: "New certificate",
      overview: "Overview",
      automation: "Automation",
      certificates: "Certificates",
      metrics: [
        ["Active", "Current version"],
        ["Expires in 30 days", "Needs attention"],
        ["Running", "Issuance and delivery"],
      ],
      headers: ["Certificate", "Status", "Expiry"],
      statuses: ["Active", "Issuing"],
      expiry: ["Jan 18, 2027", "DNS validation"],
    },
    coverage: {
      label: "The critical path for certificate delivery",
      items: ["ACME issuance", "DNS-01 validation", "Aliyun SSL", "ALB updates"],
    },
    capabilities: {
      eyebrow: "One clear control plane",
      title: "Remove manual breaks from certificate delivery",
      description:
        "Keep credentials, issuance, validation, and cloud deployment together instead of relying on short-lived scripts and handoffs.",
      items: [
        {
          title: "Credentials stay governed",
          description:
            "Maintain ACME, DNS, and cloud credentials in one place with clear access boundaries and live verification.",
        },
        {
          title: "Renew before expiry becomes a task",
          description:
            "Manage multi-domain and wildcard certificates with a traceable record for every issuance, validation, and renewal.",
        },
        {
          title: "New versions reach the edge",
          description:
            "Upload certificate versions to Aliyun SSL Certificate Management and update linked ALB listeners.",
        },
      ],
    },
    workflow: {
      eyebrow: "A workflow that runs",
      title: "Configure once. Keep every change traceable.",
      description:
        "Renewal, cloud certificate upload, and ALB updates can run alone or become a connected delivery chain.",
      deployment: "Explore deployment",
      items: [
        {
          title: "Connect accounts",
          detail: "Add ACME, DNS, and cloud credentials, then verify that each one is usable.",
        },
        {
          title: "Define certificates",
          detail: "Choose domains, algorithms, and validation methods while retaining certificate versions.",
        },
        {
          title: "Compose automation",
          detail:
            "Renew certificates, upload them to cloud certificate platforms, or update ALB configuration.",
        },
        {
          title: "Keep an audit trail",
          detail: "Execution outcomes are reported in real time through in-app messages, email, or webhooks.",
        },
      ],
    },
    operations: {
      title: "Keep exceptions in alerts, not production incidents",
      description:
        "Certificate status, expiry windows, automation health, and failure details stay visible before they affect the business.",
      items: [
        "Manual validation lets operators take over a DNS Challenge",
        "Certificate versions prevent duplicate cloud resources",
        "In-app, webhook, and email notifications share one execution result",
      ],
    },
    openSource: {
      eyebrow: "Open source deployment",
      title: "Deploy with Docker in your own environment",
      description:
        "CertFlow is built with Go, PostgreSQL, and Next.js. Your data, credentials, and execution history stay under your team's control.",
      github: "View GitHub",
      quickStart: "Docker quick start",
    },
    footer: { description: "Certificate lifecycle operations", docs: "Documentation", license: "License" },
  },
} as const;

export type MarketingCopy = (typeof marketingCopy)[Locale];
