# 大模型接口调用工具箱设计文档

- 文档状态：Draft
- 版本：v0.2
- 日期：2026-08-25
- 目标读者：产品、前后端、测试、部署与安全相关人员

## 1. 项目概述

### 1.1 产品定位

这是一个面向开发者和技术团队的网页版大模型接口调用工具箱，用于统一管理和测试 OpenAI、Anthropic 等模型服务接口，支持参数配置、单次调用、流式输出、请求调试、结果保存和调用记录查询。

产品不是新的聊天产品，而是一个可复现、可观察、可比较的 API 调试与实验工作台。

### 1.2 解决的问题

1. 不同供应商的认证方式、请求格式、消息格式和流式协议不一致。
2. 开发者需要反复修改脚本才能测试模型、参数和提示词。
3. API Key 不应暴露在浏览器、URL、日志或前端构建产物中。
4. 调用失败时缺少清晰的请求、响应、耗时和错误上下文。
5. 不同模型的结果、成本和延迟难以横向比较。

### 1.3 目标

- 在一个网页中配置并调用 OpenAI、Anthropic 模型。
- 支持非流式 JSON 响应和 SSE 流式响应。
- 统一消息输入和常用生成参数，同时允许供应商扩展字段。
- 安全保存、使用和撤销 API Key。
- 保存调用记录，支持查看请求摘要、响应、耗时和错误。
- 对供应商差异进行隔离，使后续接入其他供应商不影响核心业务。

### 1.4 非目标

第一版暂不承诺：

- 训练、微调或托管模型。
- 多人协作、组织权限和计费系统。
- 文件上传、图像生成、语音、视频和复杂 Agent 编排。
- 保证第三方模型服务本身的可用性。
- 在服务端永久保存完整提示词和响应（是否保存由隐私设置决定）。

### 1.5 首版实现约束

以下决策在首版中固定，不由实现者自行替换：

- 前端使用 React + TypeScript + Vite，样式使用 Tailwind CSS。
- 后端使用 Python + FastAPI，数据访问使用 SQLAlchemy。
- 本地开发使用 SQLite，生产使用 PostgreSQL。
- 测试使用 Pytest（后端）和 Playwright（端到端）。
- 首版实现账号/密码登录，使用服务端 HttpOnly Session Cookie；不使用 JWT 存储在浏览器中。
- 首版允许 API Key 加密持久化。使用 `APP_ENCRYPTION_KEY` 通过 AES-GCM 加密后写入数据库，禁止写入 localStorage。
- OpenAI 固定使用 Responses API（`POST /v1/responses`），不实现 Chat Completions。
- 首版只支持纯文本输入和输出，不实现图片、文件、工具调用、结构化输出、Web Search、Extended Thinking 和成本计算。
- 首版只支持单个部署实例；Redis 为可选项，不作为首版运行前提。
- 自定义 Base URL 默认关闭。若实现该字段，只允许管理员配置的 HTTPS allowlist 地址，不能接受任意用户输入地址。
- 首版默认保存调用元数据，不保存 prompt 和 output；用户勾选“保存内容”后才写入内容表，默认保留 30 天。

### 1.6 Definition of Done

每个首版功能只有在以下条件全部满足时才算完成：

- 有对应的单元测试或集成测试。
- 有成功、失败、加载和取消状态。
- 发生数据库结构变化时提供 Alembic migration。
- 更新 `.env.example`、README 和 API/OpenAPI 契约。
- 通过格式化、lint、类型检查和测试。
- 不泄露 API Key，不把敏感内容写入普通日志。
- 前端在桌面和移动视口下完成基本可用性检查。

## 2. 用户与核心场景

### 2.1 用户角色

| 角色 | 主要需求 |
| --- | --- |
| 个人开发者 | 快速验证模型和请求参数 |
| 后端开发者 | 检查供应商兼容性、错误和原始响应 |
| Prompt 工程师 | 比较提示词、模型和生成参数 |
| 测试人员 | 重放请求并验证结果 |

第一版实现账号/密码登录。默认不提供邮箱验证、密码找回、OAuth、组织和角色权限；每个账号只能访问自己的凭据、调用记录和设置。部署初始化时通过命令创建第一个管理员账号。

### 2.2 核心用户流程

1. 用户打开“供应商配置”页面。
2. 选择供应商，填写 API Key、Base URL（可选）和默认模型。
3. 点击“验证连接”，后端发起最小化验证请求并返回可读结果。
4. 进入“调用工作台”，选择供应商和模型，填写系统提示词及消息。
5. 选择是否流式输出，调整 temperature、max tokens、top_p 等参数。
6. 发送请求，实时查看响应、耗时、token 使用量和错误信息。
7. 用户可保存本次调用，稍后查看或重放。
8. 用户可以撤销或删除 API Key，并确认已不能继续调用。

## 3. 总体架构

### 3.1 架构原则

- 浏览器只调用本工具箱后端，不直接调用 OpenAI 或 Anthropic。
- 供应商差异集中在 Adapter 层，核心服务只处理统一领域模型。
- 流式链路端到端传递，避免后端等待完整响应后再返回。
- API Key 默认只存密文或加密密文，严禁明文日志。
- 请求和响应保存遵循最小化原则，并支持关闭内容持久化。
- 所有外部调用设置超时、取消、重试边界和大小限制。

### 3.2 推荐逻辑分层

```text
Browser SPA
  |
  | HTTPS / JSON / SSE
  v
API Gateway / Web Server
  |
  +-- Auth & Session
  +-- Request Validation
  +-- Provider Service
  |     +-- OpenAI Adapter
  |     +-- Anthropic Adapter
  |     +-- Future Adapters
  +-- Invocation Service
  +-- Secret Service
  +-- History Service
  +-- Observability
  |
  +-- Relational Database
  +-- Secret Store or Encrypted Database Field
  +-- Optional Redis (rate limit / cancellation / short-lived state)
  |
  +--> OpenAI API
  +--> Anthropic API
```

### 3.3 模块职责

| 模块 | 职责 |
| --- | --- |
| Web UI | 表单、参数编辑、SSE 展示、历史记录和错误呈现 |
| API 层 | 鉴权、输入校验、统一响应格式、请求限流 |
| Invocation Service | 编排一次调用的生命周期、计时、取消、记录和结果归档 |
| Provider Adapter | 将统一请求转换为供应商请求，并将响应转换为统一事件 |
| Secret Service | 加密、读取、验证、轮换和撤销密钥 |
| History Service | 保存、分页查询、查看和删除调用记录 |
| Database | 保存供应商配置、调用元数据和可选内容 |
| Observability | 结构化日志、指标、追踪和审计事件 |

### 3.4 关键数据流

#### 非流式调用

```text
UI -> POST /api/v1/invocations
   -> API 校验请求
   -> Invocation Service 读取已解密密钥
   -> Provider Adapter 转换请求
   -> Provider API 返回完整响应
   -> Adapter 统一响应
   -> 保存元数据/可选内容
   -> UI 收到 JSON
```

#### 流式调用

```text
UI -> POST /api/v1/invocations/stream
   -> API 校验请求
   -> Provider Adapter 建立供应商流
   -> 后端将统一事件转发为 SSE
   -> UI 增量渲染文本
   -> 收到 done 或 error
   -> 保存最终元数据/可选内容
```

客户端断开连接时，后端必须取消上游请求，避免继续消耗供应商额度。

## 4. 技术方案建议

首版技术栈固定如下：

- 前端：React + TypeScript + Vite + Tailwind CSS，使用 `fetch()`、`ReadableStream` 和 `AbortController`。
- 后端：Python + FastAPI，使用异步 HTTP 客户端、Pydantic、SQLAlchemy 和 Alembic。
- 数据库：本地 SQLite，生产 PostgreSQL。
- 测试：Pytest、HTTP mock server、Playwright。
- 外部 HTTP：优先使用 OpenAI 和 Anthropic 官方 Python SDK；需要控制流式取消时允许使用成熟异步 HTTP 客户端。
- 密钥保护：使用 `APP_ENCRYPTION_KEY` 派生 AES-GCM 加密密钥；生产环境可替换为 KMS/Secret Manager。
- 部署：Docker Compose，同域提供前后端，默认监听 `127.0.0.1:8000`。

初始实现采用单体服务加清晰模块边界，不拆分微服务。

## 5. 统一领域模型

### 5.1 供应商

```ts
interface Provider {
  id: string;             // openai | anthropic
  name: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModel?: string;
}
```

### 5.2 调用请求

```ts
interface InvocationRequest {
  providerId: string;
  model: string;
  system?: string;
  messages: Message[];
  stream?: boolean;
  parameters?: GenerationParameters;
  metadata?: Record<string, string>;
  saveContent?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface GenerationParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  providerOptions?: Record<string, unknown>;
}
```

### 5.3 统一响应与事件

```ts
interface InvocationResponse {
  invocationId: string;
  providerId: string;
  model: string;
  outputText: string;
  usage?: Usage;
  finishReason?: string;
  latencyMs: number;
  warnings?: string[];
}

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

type StreamEvent =
  | { type: "start"; invocationId: string; model: string }
  | { type: "delta"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason?: string; latencyMs: number; warnings?: string[] }
  | { type: "error"; code: string; message: string };
```

### 5.3 首版字段约束

服务端使用 Pydantic 对所有请求执行校验，前端只做同等校验以改善交互体验。除特别说明外，字符串按 Unicode 字符数限制：

| 字段 | 约束 | 默认值 |
| --- | --- | --- |
| `providerId` | `openai` 或 `anthropic` | 无 |
| `model` | 必填，1-128 字符 | 无 |
| `system` | 可选，最多 20,000 字符 | 空 |
| `messages` | 必填，1-100 条；至少包含 1 条 `user` 消息 | 无 |
| `messages[].role` | 仅 `user` 或 `assistant` | 无 |
| `messages[].content` | 必填，1-100,000 字符 | 无 |
| `temperature` | `0-2`；发送 Anthropic 时限制为 `0-1` | 不发送 |
| `topP` | `0-1` | 不发送 |
| `maxTokens` | 整数 `1-32,768` | 1,024 |
| `stop` | 最多 4 项，每项 1-128 字符 | 不发送 |
| `providerOptions` | 首版必须为空对象或省略 | 空 |
| `metadata` | 最多 10 个键；键和值各最多 128 字符 | 空 |
| `saveContent` | 布尔值 | `false` |

整个 JSON 请求 body 不超过 1 MB。`email` 必须符合标准邮箱格式且最多 254 字符；`password` 长度为 12-128 字符，必须包含至少一个字母和一个数字。`limit` 范围为 1-100，默认 20；历史记录使用不透明 cursor 分页。

`system` 独立于 `messages`。OpenAI Adapter 将其映射为 Responses API 的 `instructions`；Anthropic Adapter 将其映射为 Messages API 的顶层 `system`。首版 `providerOptions` 只允许空对象，保留字段用于后续扩展；核心业务不依赖供应商原始字段。

### 5.4 首版供应商映射

依据供应商官方 API 文档，首版固定使用以下映射：

| 统一字段 | OpenAI Responses API | Anthropic Messages API |
| --- | --- | --- |
| Endpoint | `POST https://api.openai.com/v1/responses` | `POST https://api.anthropic.com/v1/messages` |
| 认证 | `Authorization: Bearer <key>` | `x-api-key: <key>` |
| 版本头 | 无 | `anthropic-version: 2023-06-01` |
| `system` | 顶层 `instructions` | 顶层 `system` |
| `messages` | `input`，元素为 `{role, content}` | `messages`，元素为 `{role, content}` |
| `maxTokens` | `max_output_tokens` | `max_tokens` |
| `temperature` | `temperature`，仅在模型支持时发送 | `temperature`，范围 `0-1`，仅在模型支持时发送 |
| `topP` | `top_p`，仅在模型支持时发送 | `top_p`，范围 `0-1`，仅在模型支持时发送 |
| `stop` | `stop` | `stop_sequences` |
| `stream` | `stream: true` | `stream: true` |
| 文本响应 | 从 `output` 中提取 text 或使用 SDK 的 output text helper | 从 `content` 中提取 `type: "text"` 的 block |

OpenAI Responses API 的 HTTP 流使用语义事件，首版至少处理 `response.created`、`response.output_text.delta`、`response.completed`、`response.failed` 和 `error`。Anthropic 流至少处理 `message_start`、`content_block_delta` 中的 `text_delta`、`message_delta`、`message_stop`、`ping` 和 `error`。未知事件必须忽略并记录事件类型，不得导致服务崩溃。

两家供应商的模型能力并不完全一致。Adapter 在发送前根据已知能力决定是否省略不支持的参数；无法确认时宁可省略，并在统一响应中返回 `warnings`。首版不启用任何需要额外 beta header 的能力。

## 6. Provider Adapter 接口

```ts
interface ProviderAdapter {
  readonly providerId: string;

  listModels(config: ProviderConfig): Promise<ModelInfo[]>;
  validateConnection(config: ProviderConfig): Promise<ValidationResult>;
  invoke(
    request: InvocationRequest,
    config: ProviderConfig,
    signal: AbortSignal,
  ): Promise<InvocationResponse>;
  stream(
    request: InvocationRequest,
    config: ProviderConfig,
    signal: AbortSignal,
  ): AsyncIterable<StreamEvent>;
}
```

Adapter 必须负责：

- 供应商认证头和 Base URL。
- 请求字段映射和不支持参数的处理。
- 供应商错误到统一错误码的映射。
- 流式事件解析，包括文本增量、结束原因和 usage。
- 防止供应商原始响应中的密钥、请求头被透传到前端。

Adapter 不应负责用户鉴权、数据库写入、业务限流或 UI 格式化。

### 6.1 供应商配置类型

```ts
interface ProviderConfig {
  providerId: "openai" | "anthropic";
  apiKey: string;
  baseUrl: string;
  defaultModel?: string;
}

interface ModelInfo {
  id: string;
  displayName?: string;
  supportsStreaming: boolean;
  supportsTemperature?: boolean;
  supportsTopP?: boolean;
}

interface ValidationResult {
  valid: boolean;
  providerId: string;
  latencyMs: number;
  message: string;
}
```

## 7. HTTP API 设计

所有接口前缀为 `/api/v1`，JSON 接口使用 `Content-Type: application/json`。

除注册和登录接口外，所有接口必须携带有效的 HttpOnly Session Cookie。密码使用 Argon2id 哈希，服务端不保存明文密码。登录失败使用统一错误信息，避免暴露账号是否存在。

### 7.0 账号与会话

#### `POST /auth/register`

首版仅允许在尚无账号时创建第一个账号；之后返回 `REGISTRATION_CLOSED`。请求字段为 `email` 和 `password`。

#### `POST /auth/login`

校验账号密码并设置 HttpOnly、Secure（生产）、SameSite=Lax Cookie。响应只返回用户基本信息和过期时间。

#### `POST /auth/logout`

撤销当前会话并清除 Cookie。

#### `GET /auth/me`

返回当前登录用户的 `id`、`email` 和创建时间，不返回密码哈希或密钥信息。

### 7.1 供应商配置

#### `GET /providers`

返回已支持供应商及其能力，不返回任何 Key。

```json
{
  "items": [
    {
      "id": "openai",
      "name": "OpenAI",
      "configured": true,
      "defaultModel": "gpt-4.1-mini",
      "supportsStreaming": true
    }
  ]
}
```

#### `PUT /providers/{providerId}/credentials`

请求：

```json
{ "apiKey": "...", "baseUrl": "https://api.openai.com/v1" }
```

响应只返回配置状态和脱敏标识，例如 `sk-...abcd`，不得返回完整 Key。

#### `POST /providers/{providerId}/validate`

使用已保存凭据验证连接。返回供应商、模型（如可获取）、延迟和可读错误。

#### `DELETE /providers/{providerId}/credentials`

撤销本地保存的凭据。之后的新调用必须失败并返回 `PROVIDER_NOT_CONFIGURED`。

#### `GET /providers/{providerId}/models`

读取供应商模型列表。若供应商不支持或请求失败，应返回明确错误，并允许 UI 使用手动输入模型。

### 7.2 调用

#### `POST /invocations`

执行非流式调用，返回 `InvocationResponse`。

#### `POST /invocations/stream`

执行流式调用，响应类型为 `text/event-stream`。这是 POST 接口，前端必须使用 `fetch()` + `ReadableStream` 读取 SSE，不能使用原生 `EventSource`。每条 SSE 的 `data` 是 JSON 编码的 `StreamEvent`：

```text
event: delta
data: {"type":"delta","text":"你好"}

 event: done
data: {"type":"done","latencyMs":842}
```

服务端错误也必须尽量以 `error` 事件发送；若请求尚未建立流，则使用普通错误响应。

#### `POST /invocations/{invocationId}/cancel`

取消仍在进行的调用。取消应触发上游 AbortSignal，并记录 `CANCELLED` 状态。

### 7.3 历史记录

#### `GET /invocations?providerId=&status=&cursor=&limit=`

分页返回调用摘要，默认不返回完整 prompt 和 output。

#### `GET /invocations/{invocationId}`

返回调用详情，内容是否可见取决于保存策略和用户权限。

#### `POST /invocations/{invocationId}/replay`

使用原始参数创建一次新的调用。默认不复制旧的凭据，只引用当前供应商配置。

#### `DELETE /invocations/{invocationId}`

删除调用记录及其可选内容。

### 7.4 统一错误格式

```json
{
  "error": {
    "code": "PROVIDER_RATE_LIMITED",
    "message": "供应商请求频率受限，请稍后重试",
    "requestId": "req_01J...",
    "retryable": true,
    "details": {}
  }
}
```

建议错误码：

| 错误码 | HTTP | 说明 |
| --- | ---: | --- |
| `INVALID_REQUEST` | 400 | 参数格式或范围错误 |
| `UNAUTHENTICATED` | 401 | 未登录或会话失效 |
| `FORBIDDEN` | 403 | 无权访问资源 |
| `PROVIDER_NOT_CONFIGURED` | 409 | 未配置凭据 |
| `PROVIDER_AUTH_FAILED` | 502 | 供应商鉴权失败 |
| `PROVIDER_RATE_LIMITED` | 429 | 供应商限流 |
| `PROVIDER_TIMEOUT` | 504 | 上游超时 |
| `PROVIDER_UNAVAILABLE` | 502 | 上游不可用 |
| `INVOCATION_CANCELLED` | 499 | 调用被取消 |
| `INTERNAL_ERROR` | 500 | 未预期服务端错误 |

## 8. 数据模型

### 8.1 provider_credentials

- `id`
- `owner_id`
- `provider_id`
- `encrypted_api_key`
- `base_url`
- `key_fingerprint`
- `created_at`
- `updated_at`
- `revoked_at`

约束：`owner_id + provider_id` 唯一；查询接口永不返回 `encrypted_api_key`。开发和生产首版均使用 AES-GCM 加密，密钥由 `APP_ENCRYPTION_KEY` 注入；该环境变量缺失或格式错误时服务拒绝启动。解密只在后端调用期间存在于内存中。

### 8.4 users 和 sessions

`users` 保存 `id`、`email`、`password_hash`、`created_at`、`updated_at`；`sessions` 保存 `id`、`user_id`、`expires_at`、`created_at` 和 `revoked_at`。Session ID 使用密码学安全随机值，只存哈希后的 session token。

### 8.2 invocations

- `id`
- `owner_id`
- `provider_id`
- `model`
- `status`: `running | succeeded | failed | cancelled`
- `stream`
- `parameters_json`
- `input_tokens`
- `output_tokens`
- `total_tokens`
- `latency_ms`
- `finish_reason`
- `error_code`
- `request_id`
- `created_at`
- `completed_at`

### 8.3 invocation_contents

- `invocation_id`
- `system_prompt`
- `messages_json`
- `output_text`
- `retention_expires_at`

此表可按部署策略关闭、加密或设置自动过期。默认建议保存元数据，内容保存由用户显式选择。

## 9. 前端页面与交互

### 9.1 页面

1. **调用工作台**：供应商、模型、消息编辑器、参数面板、发送/停止、实时响应、调用摘要。
2. **供应商配置**：配置 Key、Base URL、默认模型、连接验证、撤销凭据。
3. **调用历史**：按供应商、模型、状态和时间筛选，查看详情、重放、删除。
4. **系统设置**：内容保存策略、默认流式模式、主题和本地偏好。
5. **外观设计**：在保证上述功能正常无误的基础上尽量美观好看。

### 9.2 交互要求

- 发送期间发送按钮变为停止操作，不能重复提交。
- 流式输出区域应增量显示，结束后补充 usage、耗时和结束原因。
- 网络断开、上游报错、用户取消三种状态必须视觉上区分。
- 表单校验在提交前完成，服务端仍必须重复校验。
- API Key 输入框默认隐藏，复制和显示操作应有明确反馈。
- 刷新页面不会丢失已保存配置，但不应把 Key 放入 localStorage。
- 移动端至少支持配置、发送和查看响应；复杂历史筛选可降级。

### 9.3 视觉设计方向

界面应是面向开发者的工作台，而不是营销落地页：采用高对比度的暖白、墨黑和青绿色强调色，使用有辨识度的等宽字体展示模型参数和响应，主工作区突出“请求编辑器 -> 响应观察 -> 调用元数据”的连续关系。桌面端采用左右分栏，移动端改为上下堆叠；避免堆叠卡片、紫色渐变、超大标题和无功能装饰。

## 10. 安全与隐私

1. 生产环境强制 HTTPS，Cookie 使用 `HttpOnly`、`Secure`、合适的 `SameSite`。
2. API Key 不进入 URL、前端日志、普通业务日志、异常堆栈、埋点和客户端存储。
3. 日志中的请求头、Authorization、完整 prompt 和 output 默认脱敏或不记录。
4. 使用 KMS/Secret Manager 或应用级 AEAD 加密保护静态密钥。
5. 对请求体大小、消息数量、单条消息长度和输出长度设置上限。
6. 对用户、IP、供应商分别设置限流，连接验证接口也必须限流。
7. 防止 SSRF：Base URL 只允许明确配置的供应商地址或经过管理员允许的地址；阻止访问本机、内网和云元数据地址。
8. 对 Markdown/HTML 输出进行安全渲染，禁止未经清理的脚本执行。
9. 历史记录和凭据所有权必须在服务端校验，不能只依赖前端传入的 owner ID。
10. 提供删除凭据和历史记录的能力，并记录必要的审计事件。

## 11. 可靠性与可观测性

- 默认连接超时、首字节超时和总调用超时均可配置。
- 默认连接超时 10 秒，首字节超时 15 秒，总调用超时 120 秒；SSE 心跳间隔不超过 15 秒。
- 本地 API 参数校验 P95 小于 500 ms；收到上游首 token 后 200 ms 内转发给前端。
- 单次请求最大 body 为 1 MB；单次响应最大缓存文本为 2 MB。
- 仅对明确可重试的网络错误和 5xx 错误重试；不自动重试鉴权错误、参数错误或用户取消。
- 每次调用生成 `requestId` 和 `invocationId`，贯穿日志、响应和历史记录。
- 指标至少包含调用成功率、错误码分布、P50/P95 延迟、首 token 延迟、流式中断率和 token 使用量。
- 健康检查不得调用真实模型接口；供应商验证为单独接口。
- 上游响应过大、流事件异常或 JSON 解析失败时，要终止连接并记录原因。

## 12. 测试策略

### 12.1 单元测试

- 每个 Adapter 的请求字段映射。
- OpenAI/Anthropic 流式事件解析。
- 统一错误码映射。
- 参数范围和消息格式校验。
- 密钥脱敏、加密和撤销逻辑。

### 12.2 集成测试

使用 mock HTTP server 验证：

- 非流式成功调用。
- 流式 delta、usage、done 顺序。
- 供应商鉴权失败、限流、超时和 5xx。
- 客户端断开后上游请求被取消。
- 调用失败时不保存错误凭据。
- 不同用户不能读取彼此的配置和历史。

### 12.3 端到端测试

- 配置凭据并验证连接。
- 发送 OpenAI 非流式请求并查看结果。
- 发送 Anthropic 流式请求并点击停止。
- 查看、重放和删除调用记录。
- 移动端主要流程无横向溢出或控件遮挡。

## 13. 验收标准

### 13.1 功能验收

- [ ] 可以配置 OpenAI API Key，并且页面、网络响应和日志中均不会显示完整 Key。
- [ ] 可以配置 Anthropic API Key，并完成连接验证。
- [ ] OpenAI 和 Anthropic 均可完成至少一种非流式文本调用。
- [ ] OpenAI 和 Anthropic 均可完成流式文本调用，文本增量实时显示。
- [ ] 可设置 system prompt、user/assistant 消息、model、temperature、max tokens。
- [ ] 提交非法参数时，前端和后端都返回可理解的校验错误。
- [ ] 调用中可以停止，停止后上游请求被取消且历史状态为 cancelled。
- [ ] 调用完成后可看到模型、状态、耗时、结束原因和 token usage（供应商提供时）。
- [ ] 可以保存、查询、查看、重放和删除调用记录。
- [ ] 删除凭据后，新的调用会被阻止；重新配置后可恢复调用。

### 13.2 安全验收

- [ ] 浏览器开发者工具中不存在供应商 API Key。
- [ ] localStorage、URL、错误信息和结构化日志中不存在完整 API Key。
- [ ] 未授权用户无法访问其他用户的凭据、调用详情和历史记录。
- [ ] Base URL 校验不会允许访问本机、内网或云元数据地址。
- [ ] Prompt 和 output 保存策略可关闭，关闭后数据库不保存完整内容。

### 13.3 性能与可用性验收

- [ ] 本地 API 参数校验 P95 小于 500 ms。
- [ ] 非流式请求在上游返回后 500 ms 内返回统一 JSON。
- [ ] 流式请求收到上游增量后能持续向浏览器转发，不等待完整响应。
- [ ] 上游首 token 到前端转发延迟不超过 200 ms，SSE 心跳间隔不超过 15 秒。
- [ ] 首 token 延迟和总耗时可被记录。
- [ ] 页面在桌面和移动视口下主要操作可用，无内容重叠和横向滚动。
- [ ] 上游超时、限流、断网和返回非法事件时，页面显示明确状态且不会无限加载。

### 13.4 质量门槛

- [ ] 单元测试、集成测试和关键端到端测试通过。
- [ ] 关键 API 有 OpenAPI 文档或等价的请求/响应契约。
- [ ] CI 至少执行格式化检查、类型检查、单元测试和安全扫描。
- [ ] 生产配置中的加密主密钥、数据库连接和供应商 Key 均通过环境变量或 Secret Manager 注入。

### 13.5 首版明确不验收

- 不验收图片、文件、工具调用、结构化输出、Web Search、Extended Thinking 和成本统计。
- 不验收 OAuth、密码找回、邮箱验证、组织权限和多实例部署。

## 14. 项目结构与开发命令

```text
frontend/
  src/
    components/
    pages/
    services/
    types/
backend/
  app/
    api/
    providers/
    services/
    models/
    schemas/
    core/
  migrations/
tests/
  unit/
  integration/
  e2e/
docker-compose.yml
.env.example
README.md
DESIGN.md
```

约定开发命令：

```bash
make dev
make test
make lint
make typecheck
make format
```

后端必须提供 `/healthz`，该接口不调用供应商；前端和后端默认通过同一开发代理或同域 Docker 服务访问。

## 15. 交付拆分

### Phase 1：最小可用版本

  - 账号/密码会话。
- OpenAI、Anthropic 凭据配置。
- 统一调用工作台。
- 非流式和 SSE 流式调用。
- 基础错误处理、日志和调用元数据。

### Phase 2：调试与历史

- 调用详情和历史列表。
- 重放、删除和内容保存策略。
- 模型列表读取。
- 请求/响应导出。
- 更完整的 usage、成本估算和筛选。

### Phase 3：团队与扩展

- 多用户、组织和权限。
- 更多供应商 Adapter。
- Prompt 模板和版本管理。
- 多模型并行比较。
- 审计日志、配额和团队级限流。

## 16. 待确认决策

1. 第二版是否开放自定义 Base URL？允许列表由管理员配置。
2. 第二版是否需要计算 token 成本？若需要，价格表由配置文件维护。
3. 第二版是否需要导入/导出 JSON 请求，以便与现有脚本互操作？

## 17. 设计结论

第一版以“安全的统一调用代理 + 可复现的调试工作台”为核心。OpenAI 和 Anthropic 通过独立 Adapter 接入，前端只依赖统一请求与事件协议；调用记录优先保存可观测元数据，完整内容采用显式选择和可过期策略。该结构能够在保持实现规模可控的同时，为更多供应商、团队权限和模型对比留下扩展空间。
