# CertFlow 前端重构设计

状态：实施中

## 实施进度

已完成：主题 Provider、全局 Toast 容器、统一 `ResourceModal`、基础资源的 URL 驱动新增/详情/编辑/删除、云凭证真实验证与启用/禁用、AK/SK 创建后不可修改、ACME 密钥轮换、DNS Zone 编辑，以及删除前的服务端引用保护；证书列表详情 Modal、三步证书创建 Workflow Modal、证书详情/编辑/删除 API、手动 TXT 验证 Modal 和旧 `/certificates/new`、旧手动验证地址兼容重定向。

进行中：自动化与 ALB 目标详情/编辑、完整中英文词条、TanStack Query 数据层和移动端资源卡片。

## 1. 定位与目标

CertFlow 是面向平台工程师和运维人员的证书生命周期控制台。界面应当安静、可扫描、可恢复，不采用营销页式的大标题、渐变和装饰性动效。

- 视觉语言：保留深绿色品牌色，以高对比中性色承载数据与表单。
- 信息密度：桌面偏高，移动端优先完成查询和关键操作。
- 动效：只呈现状态连续性，统一 160ms，不使用装饰性循环动画。
- 设计方差：3；动效强度：2；信息密度：6。

本轮重构目标：统一 CRUD 工作流、完成中英文与浅深色主题、建立可复用组件和数据访问边界，并补齐响应式和可访问性基线。

非目标：本轮不改变 Go 端签发、续期、部署的领域规则；前端只补充完成交互所必需的查询与修改 API。

## 2. 信息架构

```text
概览
基础资源
  云凭证
  ACME 账户
  DNS 账户
证书运维
  证书
  自动化
  执行记录
系统设置
```

桌面端保持 `Sidebar / Header / Main` 三段布局：侧栏展开宽度 244px、折叠宽度 80px，Header 高度 72px，内容最大宽度 1440px。移动端在 768px 以下改为顶部栏与抽屉导航，Header 仅保留页面名、语言、用户菜单和导航开关。

顶部第二行只显示当前页面的一句功能说明；不在 Header 堆叠指标、操作按钮或环境状态。

## 3. 统一资源工作流

### 3.1 列表

每个资源页面由下列区域构成：

1. 页面标题和唯一的主操作“新建”。
2. 可选的筛选、搜索和状态计数。
3. 桌面端数据表；移动端资源卡片。
4. 空、加载、错误和无权限状态。

行点击打开详情，不把行点击和文字链接混用。行末保留 `更多` 图标按钮，菜单按权限提供编辑、启停、立即执行和删除；图标按钮必须带 Tooltip 与无障碍名称。

### 3.2 Modal 规范

所有新增、编辑、详情使用 HeroUI `Modal`，统一由 `ResourceModal` 实现。Modal 是 URL 驱动状态，保证刷新、浏览器返回和分享链接可预测：

```text
/certificates?modal=create
/certificates?selected=<certificateId>&mode=view
/certificates?selected=<certificateId>&mode=edit
```

| 场景 | 尺寸 | 内容 | 关闭行为 |
| --- | --- | --- | --- |
| 资源详情 | 760px | 摘要、配置、关联资源、最近执行 | Esc、遮罩、关闭按钮 |
| 新增/编辑凭证、账户、目标 | 680px | 分组表单和固定底部操作栏 | 脏表单二次确认 |
| 新建/编辑证书 | 920px | 三步表单：身份、域名、验证与续期 | 脏表单二次确认 |
| 手动 DNS 验证 | 1080px，手机全屏 | TXT 记录、复制、继续验证、结果 | 任务未完成时提醒确认 |
| 删除、立即执行、重新签发 | 480px | 影响范围、目标名称、确认操作 | 明确取消与确认 |

详情默认只读，底部不直接堆积多个主要按钮。操作收纳进 `Dropdown`，其中“编辑”为首要操作；“删除”“立即执行”“重新签发”先进入 `ConfirmDialog`。对于“更新 ALB”这类外部副作用操作，确认框必须列出证书、上传凭证、部署目标与监听器。

### 3.3 各资源详情

| 资源 | 详情必须展示 | 编辑能力 |
| --- | --- | --- |
| 云凭证 | 提供商、AccessKey ID、凭证摘要、最后验证、被引用数 | 名称、描述、验证、启用/禁用；AK/SK 不可修改 |
| ACME 账户 | Directory、邮箱、算法、状态、证书引用 | 名称、联系邮箱、密钥导入/轮换 |
| DNS 账户 | 云凭证、已授权 Zone、最近验证 | 名称、Zone 多选、重新验证 |
| 证书 | SAN、算法、ACME/DNS、到期、指纹、自动化、最近执行 | 名称、域名、验证账户、续期窗口 |
| 自动化 | 动作、触发策略、证书、目标、下次运行、最近错误 | 动作配置、启停、关联目标 |
| ALB 目标 | 阿里云凭证、地域、ALB、监听器、当前证书 | 名称、监听器、启停 |

## 4. 页面与任务体验

### 4.1 证书

新建证书采用三步 Modal：

1. **证书身份**：名称、算法、域名与 SAN；域名输入即时标准化、去重并提示通配符覆盖范围。
2. **签发验证**：ACME 账户、自动 DNS 或手动 TXT；自动 DNS 模式要求 DNS 账户。
3. **续期策略**：提前续期天数，并提示自动化任务在另一步配置。

提交后显示“已创建，签发已排队”的 Toast，并在详情 Modal 自动打开以展示进度。手动 TXT 不跳转到孤立页面，而是在可直链的验证 Modal 中展示复制状态和继续验证结果。

### 4.2 自动化与 ALB

自动化创建必须先选择任务类型，再展示相关字段，避免用户在无关字段间切换。

- 定期续期：证书、频率、启停状态。
- 上传 SSL：证书、阿里云凭证、触发条件。
- 更新 ALB：证书、一个或多个部署目标；详情中显示是否会先上传 SSL 证书。

ALB 目标使用受控的级联选择：凭证 -> 地域 -> ALB -> HTTPS/QUIC 监听器。每一级都有 Skeleton、空状态、错误重试和 `AbortController`，切换上级值时立即清空下级值并取消旧请求。

### 4.3 执行记录

执行记录的行详情应显示时间线：排队、运行、成功/失败，以及结构化错误摘要。长日志按需加载并可复制；失败记录提供“重新执行”入口，但不自动重试外部云操作。

## 5. 视觉令牌与主题

所有颜色、阴影、尺寸和动效必须通过语义变量使用，页面禁止新增裸色值。

```css
:root {
  --color-canvas: #f6f7f5;
  --color-surface: #ffffff;
  --color-surface-subtle: #f0f2ef;
  --color-text: #17231d;
  --color-text-muted: #65716a;
  --color-border: #dce2dc;
  --color-accent: #0f766e;
  --color-danger: #b42318;
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --radius-control: 6px; --radius-surface: 8px;
  --motion-fast: 160ms; --motion-ease: ease-out;
}
```

以 `next-themes` 提供“跟随系统、浅色、深色”选项。深色模式通过 `[data-theme="dark"]` 覆盖同一批语义变量；状态色也必须有深色背景与文本对应值，不能仅反转页面背景。

状态、成功、警告和错误不能只依赖颜色，必须同时有文字与图标。正文和帮助文字满足 WCAG AA 对比度。

## 6. 国际化

使用 `next-intl` 管理中英文文案，保留 Cookie 中的语言偏好，不需要改变控制台路由。按领域拆分词条：

```text
messages/
  zh-CN/common.json       en/common.json
  zh-CN/certificates.json en/certificates.json
  zh-CN/automations.json  en/automations.json
  zh-CN/auth.json         en/auth.json
```

服务器组件与客户端组件都使用同一套键值和 ICU 参数；日期、时间、计数、时区均通过 locale formatter 生成。禁止组件内硬编码用户可见中文或英文。状态码由 `StatusTag` 统一翻译，不允许页面自行转换。

## 7. 状态、反馈与可访问性

全局 `FeedbackProvider` 负责 Toast，表单错误留在字段下方而不是只显示 Toast。

| 状态 | 呈现 |
| --- | --- |
| 首次加载 | 与最终布局一致的 Skeleton |
| 提交中 | 按钮禁用、保留按钮宽度、显示 Spinner |
| 成功 | Toast，必要时更新列表与详情数据 |
| 可恢复错误 | 上下文 Alert，显示原因与重试按钮 |
| 空数据 | 解释当前为空的原因与唯一的下一步操作 |
| 危险操作 | ConfirmDialog，明确影响范围 |

HeroUI Modal、Dropdown、Tabs 和 Tooltip 作为无障碍基础；补充以下要求：错误信息用 `aria-describedby` 关联字段，提交状态使用 `aria-live="polite"`，关闭 Modal 后焦点返回触发元素，键盘可完成行操作与菜单操作，所有图标按钮都有 `aria-label`。

## 8. 前端代码架构

React 层不使用 class。采用类型、纯函数、Feature Hook 与展示组件组合，避免将网络、状态和大段 JSX 堆进一个组件。

```text
frontend/
  components/ui/
    resource-modal.tsx confirm-dialog.tsx feedback-provider.tsx
    async-button.tsx data-table.tsx resource-card.tsx
  features/
    certificates/ certificate-modal.tsx certificate-table.tsx use-certificate-form.ts
    automations/ automation-modal.tsx deployment-target-modal.tsx use-alb-cascade.ts
    resources/ credential-modal.tsx acme-account-modal.tsx dns-account-modal.tsx
  lib/
    api-client.ts api-error.ts formatters.ts query-keys.ts
  messages/
```

命名规则：事件使用 `handle*`，异步动作使用动词，例如 `createAutomation`、`updateCertificate`、`loadListeners`；ID 统一为 `Id`，不混用 `ID`。复杂逻辑只保留必要的中文注释，例如说明级联请求取消、密钥不回显或 URL 状态恢复的原因；不对普通 JSX 和赋值写注释。

数据访问采用 TanStack Query：Query Key 统一定义，Mutation 成功后精确失效相关资源，失败映射成稳定的 `ApiError`。后端应维护 OpenAPI 描述并生成 TypeScript Client，避免当前页面重复定义 API 类型。

## 9. API 契约补充

为支撑详情与编辑，需要为资源提供统一契约：

```text
GET    /api/v1/{resource}
GET    /api/v1/{resource}/{id}
POST   /api/v1/{resource}
PATCH  /api/v1/{resource}/{id}
DELETE /api/v1/{resource}/{id}
POST   /api/v1/{resource}/{id}/verify | /run | /enable | /disable
```

删除 API 必须返回引用冲突的结构化原因；不能删除时，前端在 ConfirmDialog 中展示引用资源。所有 API 错误统一返回 `code`、`message`、`fieldErrors`、`requestId`，前端按错误类型区分认证、校验、冲突和网络故障。

## 10. 交付顺序与验收

1. 建立 ESLint、Prettier、主题令牌、`next-intl`、反馈系统和 API Client。
2. 实现 `ResourceModal`、`ConfirmDialog`、`DataTable` 与 URL Modal 状态。
3. 迁移云凭证、ACME、DNS、证书；补齐详情与编辑 API。
4. 迁移自动化、ALB 目标、执行记录，并实现请求取消和影响范围确认。
5. 完成暗色模式、移动资源卡片、键盘与焦点检查。
6. 用 Vitest 覆盖格式化、请求错误和表单校验；用 Playwright 覆盖登录、资源 CRUD、证书签发、手动 TXT、自动化和角色隔离。

验收标准：任意资源均可从列表进入详情、新增、编辑和删除流程；中英文页面无混合文案；浅深色模式可读；375px、768px、1280px 页面无横向溢出；外部副作用操作有确认和明确反馈；`lint`、类型检查、单元测试、端到端测试均可在 CI 运行。
