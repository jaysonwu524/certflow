# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of CertFlow
- ACME protocol support for certificate issuance (Let's Encrypt)
- DNS-01 challenge validation via Alibaba Cloud DNS
- Support for single domain, multi-SAN, and wildcard certificates
- Automatic certificate renewal scheduler
- PostgreSQL-based persistent job queue with retry logic
- Certificate deployment to Alibaba Cloud ALB/SLB
- AES-256-GCM encryption for all sensitive data
- Next.js + React + HeroUI 3.0 management interface
- Comprehensive execution tracking and audit logs
- Manual and automatic DNS validation modes
- Cloud credential versioning and rotation support
- Docker Compose for local development

### Security
- All private keys and credentials encrypted at rest
- Envelope encryption support for production deployments
- Minimum permission validation for cloud credentials
- Audit logging for all sensitive operations

### Documentation
- Comprehensive DESIGN.md architecture documentation
- Apache License 2.0
- Contributing guidelines
- Code of conduct
- Security policy

## Release Notes

### Version Numbering

CertFlow follows [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for backward-compatible functionality additions
- **PATCH** version for backward-compatible bug fixes

### Support Policy

- Latest release receives active support and security updates
- Previous minor version receives security updates for 6 months
- Older versions are not supported

---

[Unreleased]: https://github.com/yourusername/certflow/compare/v0.1.0...HEAD
