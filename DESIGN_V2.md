# AI Interface V2 设计文档

- 文档状态：Draft
- 版本：v2.0
- 日期：2026-08-27
- 目标读者：产品、前后端、测试、部署与安全相关人员
- 基线：V1 已支持账号会话、OpenAI/Anthropic 调用、自定义 OpenAI 兼容网关、流式思考与回答展示、基础供应商配置和调用记录

## 1. V2 定位

V2 将 AI Interface 从“单次调用工具”升级为“可复现、可比较、可诊断的模型实验工作台”。核心体验是：一次准备，多种模型并行调用；完整看到思考、回答、耗时、Token、错误和请求差异；任何一次实验都可以保存、重放和分享为可移植配置。

## 2. V2 目标与非目标

### 2.1 目标

1. 支持一次请求同时调用多个模型，并以并排或时间线方式比较结果。
2. 支持完整的流式事件：思考、回答、工具状态、usage、完成和错误。
3. 提供供应商连接验证、模型发现和模型能力信息。
4. 提供历史记录详情、重放、复制配置、导入导出和删除。
5. 让自定义 OpenAI 兼容网关成为正式的一等供应商类型，支持路径、请求格式、鉴权方式和模型别名配置。
6. 提供取消、超时、重试、限流和可观察性，避免无限等待。
7. 在不暴露 API Key 的前提下支持团队共享实验模板。

### 2.2 非目标

V2 暂不实现模型训练、微调、知识库、计费结算、多租户组织管理、完整 Agent 编排、文件持久化、图片/音视频理解和公网 SaaS 部署。

## 3. 核心用户场景

### 场景 A：模型对比
用户输入一套 system prompt 和消息，选择公司网关上的三个模型，一次发送并比较最终回答、思考耗时、首 token 延迟和 Token 使用量。

### 场景 B：网关兼容性诊断
用户输入 Base URL、路径、API Key 和模型名称，点击“验证连接”。系统分别检查网络、鉴权、模型、请求格式和流式能力，并返回可执行的错误建议。

### 场景 C：实验重放
用户从历史记录打开一次调用，查看完整参数和事件摘要，修改模型或温度后重新执行；新调用使用当前供应商凭据，不复制旧密钥。

### 场景 D：模板复用
用户将 prompt、模型选择和生成参数导出为不含密钥的 JSON 模板，导入后继续实验。

## 4. V2 功能范围

### 4.1 实验工作台

- 单模型和多模型两种运行模式。
- 模型选择支持搜索、收藏、最近使用和能力筛选。
- system prompt、消息列表、assistant 消息、参数面板和供应商扩展参数。
- 一键发送、停止、重试和复制请求配置。
- 每个模型独立显示状态：排队、连接中、思考中、生成中、成功、失败、取消。
- 响应区域分为思考、最终回答、原始事件摘要和错误详情。
- 支持展开/折叠思考过程；默认展示思考状态和正文，不把思考内容混入最终回答。
- 显示首 token 延迟、总耗时、输入/输出/总 Token 和 finish reason。

### 4.2 供应商与模型管理

- 内置 OpenAI Responses、Anthropic Messages。
- 自定义 OpenAI 兼容网关：Base URL、路径策略、模型列表、模型别名、鉴权头配置。
- 配置后端点验证：健康、鉴权、指定模型、非流式调用、流式调用。
- 手动模型注册和可选的 `/models` 自动发现。
- 模型能力字段：支持流式、思考、temperature、top_p、最大输出、上下文窗口。
- API Key 轮换、撤销、指纹显示和最近验证时间。
- 保存配置时自动 trim 密钥和 URL，禁止保存全空值。

### 4.3 历史与实验资产

- 历史记录按时间、模型、供应商、状态、标签和请求模式筛选。
- 详情页展示请求摘要、响应、思考、usage、耗时、错误、事件时间线。
- 重放、复制、删除、添加标签和备注。
- 导出不含密钥的实验 JSON；导入前执行版本和字段校验。
- 可选保存完整 prompt、thinking 和 output；默认只保存元数据。
- 内容保留策略可配置，默认 30 天。

### 4.4 团队模板

- 模板只包含模型配置引用、prompt、参数和标签，不包含 API Key。
- V2 单实例下使用公开链接关闭，先实现本地导入导出。
- 后续团队权限以独立版本设计，不在 V2 中隐式引入。

## 5. 总体架构

```text
React SPA
  |
  | JSON / SSE
  v
FastAPI API
  +-- Auth & Session
  +-- Experiment Service
  +-- Invocation Orchestrator
  +-- Provider Registry
  |     +-- OpenAI Responses Adapter
  |     +-- Anthropic Messages Adapter
  |     +-- OpenAI-Compatible Gateway Adapter
  +-- Secret Service
  +-- History / Template Service
  +-- Validation / Rate Limit / Observability
  |
  +-- SQLite (development) / PostgreSQL (production)
  +-- Optional Redis for cancellation and rate limits
  |
  +--> Provider APIs and company gateways
```

### 5.1 关键原则

- 浏览器永远不直接访问模型供应商。
- Adapter 只负责协议映射和事件解析；编排器负责生命周期、并发、取消、记录和重试。
- 每个上游调用使用独立的 `AbortSignal`/取消句柄。
- 上游错误必须保留 HTTP 状态、供应商错误码和脱敏后的响应摘要。
- thinking 与 answer 是不同事件流，不能通过字符串拼接猜测边界。
- 多模型实验中的一个失败不能阻塞其他模型完成。

## 6. 统一领域模型

```ts
interface ProviderConfig {
  id: string;
  kind: "openai-responses" | "anthropic-messages" | "openai-compatible";
  name: string;
  baseUrl: string;
  endpointPath?: string;
  auth: { type: "bearer" | "x-api-key" | "custom-header"; headerName?: string };
  models: ModelInfo[];
}

interface ModelInfo {
  id: string;
  displayName?: string;
  alias?: string;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  supportsTemperature?: boolean;
  supportsTopP?: boolean;
  maxOutputTokens?: number;
  contextWindow?: number;
}

interface ExperimentRequest {
  targets: Array<{ providerId: string; model: string }>;
  system?: string;
  messages: Message[];
  stream: boolean;
  parameters: GenerationParameters;
  saveContent: boolean;
  tags?: string[];
}

type StreamEvent =
  | { type: "start"; invocationId: string; model: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: "status"; value: "connecting" | "thinking" | "answering" }
  | { type: "done"; finishReason?: string; latencyMs: number }
  | { type: "error"; code: string; message: string; retryable: boolean };
```

V2 要求自定义网关兼容以下常见返回形态：

- 非流式：`choices[0].message.content`。
- 思考正文：`choices[0].message.reasoning_content`。
- 流式思考：`choices[0].delta.reasoning_content`。
- 流式回答：`choices[0].delta.content`。
- 结束：`data: [DONE]`。

`content` 既可能是字符串，也可能是包含 `text` 字段的数组。未知字段必须忽略，未知事件记录类型后继续处理。

## 7. HTTP API

所有接口前缀为 `/api/v2`。除登录、注册外均要求 HttpOnly Session Cookie。

### 7.1 供应商

- `GET /providers`：返回当前用户供应商、模型、能力和配置状态，不返回密钥。
- `PUT /providers/{providerId}`：保存供应商元数据和模型列表。
- `PUT /providers/{providerId}/credentials`：保存或轮换密钥，响应返回指纹。
- `POST /providers/{providerId}/validate`：执行网络、鉴权、模型和流式验证，返回分步骤结果。
- `GET /providers/{providerId}/models`：读取缓存或请求上游模型列表。
- `DELETE /providers/{providerId}/credentials`：撤销密钥。

验证结果示例：

```json
{
  "providerId": "company-gateway",
  "valid": true,
  "checks": [
    {"name": "network", "status": "passed", "latencyMs": 42},
    {"name": "authentication", "status": "passed"},
    {"name": "model", "status": "passed", "model": "deepseek-v4-flash"},
    {"name": "streaming", "status": "passed"}
  ]
}
```

### 7.2 实验与调用

- `POST /experiments`：创建单模型或多模型实验。
- `POST /experiments/{id}/stream`：以 SSE 返回多个 invocation 的事件，事件携带 `invocationId`。
- `POST /invocations`：执行单个非流式调用。
- `POST /invocations/{id}/cancel`：取消指定调用。
- `POST /invocations/{id}/retry`：仅对可重试错误重试。
- `GET /invocations`：cursor 分页查询摘要，支持 provider、model、status、tag、时间筛选。
- `GET /invocations/{id}`：查看详情和事件摘要。
- `DELETE /invocations/{id}`：删除调用及关联内容。

### 7.3 模板

- `POST /templates/import`：校验并导入不含密钥的模板。
- `GET /templates`：查询当前用户模板。
- `POST /templates/export`：导出模板 JSON。
- `DELETE /templates/{id}`：删除模板。

## 8. 数据模型变化

### provider_credentials

新增：`provider_kind`、`endpoint_path`、`auth_type`、`auth_header_name`、`last_validated_at`、`validation_status`。

### provider_models

新增表：`id`、`provider_credential_id`、`model_id`、`display_name`、`alias`、`capabilities_json`、`enabled`、`created_at`、`updated_at`。

### experiments

新增表：`id`、`owner_id`、`title`、`request_json`、`status`、`created_at`、`completed_at`。

### invocations

新增：`experiment_id`、`request_id`、`first_token_ms`、`input_tokens`、`output_tokens`、`total_tokens`、`finish_reason`、`thinking_text`、`warnings_json`。

### invocation_events

新增表：`id`、`invocation_id`、`sequence`、`event_type`、`text_delta`、`occurred_at`。默认只保存事件元数据，内容遵循 `saveContent` 和保留策略。

### templates

保存版本化、脱敏后的实验配置，不保存任何加密密钥或完整认证头。

所有结构变化必须通过 Alembic migration，不能依赖启动时自动改表。

## 9. 前端页面与交互

### 9.1 页面

1. 工作台：单模型/多模型切换、目标模型选择、参数、消息编辑器、并行响应。
2. 供应商：供应商类型、端点、认证、模型列表、能力和连接验证。
3. 历史：筛选、详情、时间线、重放、删除、导出。
4. 模板：导入、导出、标签和最近使用。
5. 设置：默认参数、内容保存、思考展示、超时和主题。

### 9.2 响应面板

每个模型独立拥有：

- 顶部状态和首 token 计时。
- 可折叠 THINKING 区，实时显示 `reasoning_delta`。
- ANSWER 区，实时显示 `answer_delta`。
- usage、finish reason、总耗时和错误详情。
- 停止按钮只停止对应调用，也支持停止整个实验。

### 9.3 加载与错误状态

- 连接中、思考中、回答中、完成、失败、取消必须有不同状态。
- 超过首字节超时时显示“上游未返回首个事件”，不显示模糊的“正在连接”。
- 多模型模式允许部分成功，失败卡片提供重试。
- 错误详情默认折叠，展示 HTTP 状态、供应商错误码和脱敏摘要。

## 10. 超时、并发与性能

- 连接超时默认 10 秒。
- 首事件超时默认 20 秒，可按供应商配置。
- 总调用超时默认 180 秒。
- 多模型实验默认最多并发 5 个目标。
- 浏览器断开后 2 秒内取消上游请求。
- 上游事件到浏览器的 P95 转发延迟小于 200 ms。
- 单次事件文本和完整响应均设置大小上限，防止内存无限增长。
- 只对连接错误和 5xx 做有限重试；不重试鉴权、参数、模型不存在和用户取消。

## 11. 安全与隐私

- API Key 只在后端解密，永不进入前端状态、localStorage、URL 或日志。
- 自定义 Base URL 执行 SSRF 防护：开发环境允许明确配置的内网网关，生产环境使用管理员 allowlist；拒绝回环、云元数据和未授权地址。
- 原始上游响应只保存脱敏摘要；thinking、prompt、answer 按用户选择和保留策略保存。
- 导入导出模板必须扫描 `apiKey`、`Authorization`、Cookie 等敏感字段并拒绝导入。
- 每个调用和供应商配置都校验 owner，不能依赖前端 ID。
- 供应商验证接口限流，日志记录 requestId、providerId、状态和耗时，不记录密钥。

## 12. 测试策略

### 单元测试

- 三种 Adapter 的请求映射和响应提取。
- reasoning/content 字符串、数组、空值和未知字段。
- SSE 事件顺序、事件分片、`[DONE]`、非法 JSON 和供应商错误。
- URL 拼接、鉴权头、API Key trim 和敏感字段脱敏。
- 多模型部分成功、取消、超时和重试策略。

### 集成测试

- 模拟 OpenAI 兼容网关返回非流式思考和正文。
- 模拟流式 `reasoning_content` 后接 `content`。
- 验证供应商连接检查每个步骤的结果。
- 验证客户端断开能取消上游。
- 验证不同用户无法互相读取凭据、实验和模板。
- 验证 Alembic migration 可在旧数据库上升级和回滚。

### 端到端测试

- 注册、配置公司网关、验证连接。
- 选择三个模型并行发送，分别看到思考和回答。
- 停止单个模型和停止整个实验。
- 查看历史详情、重放、导出并重新导入模板。
- 桌面和移动视图下无横向溢出、遮挡和无限加载。

## 13. V2 验收标准

### 功能

- [ ] 可配置并验证 OpenAI、Anthropic 和自定义 OpenAI 兼容网关。
- [ ] 自定义网关可配置路径、鉴权方式和至少三个模型。
- [ ] 单模型调用可实时显示思考和最终回答。
- [ ] 多模型调用可并行执行，单个失败不影响其他结果。
- [ ] 可停止、重试、查看详情、重放和删除调用。
- [ ] 可查看首 token、总耗时、usage 和 finish reason。
- [ ] 可导入导出不含密钥的实验模板。

### 兼容性

- [ ] 兼容 `reasoning_content` 和 `content` 的非流式响应。
- [ ] 兼容 `delta.reasoning_content` 和 `delta.content` 的流式响应。
- [ ] 兼容 content 字符串、数组、空值和未知事件。
- [ ] 网关返回 4xx、5xx、超时、断开时均显示准确错误。

### 安全

- [ ] 完整 API Key 不出现在浏览器、日志、URL、模板或错误响应中。
- [ ] 自定义地址通过 allowlist/SSRF 防护。
- [ ] 用户只能访问自己的凭据、实验、历史和模板。
- [ ] 内容保存和自动过期策略可验证。

### 性能

- [ ] 流式首事件到浏览器转发 P95 小于 200 ms。
- [ ] 多模型默认最多并发 5 个，超过限制时给出明确提示。
- [ ] 上游停止或浏览器断开后 2 秒内释放连接。
- [ ] 任一异常状态不会无限停留在“正在连接”。

## 14. 交付阶段

### Phase 1：协议与稳定性

- 抽象 Provider Registry 和 Adapter 接口。
- 完成 OpenAI 兼容网关正式配置模型。
- 完成 reasoning/content 双通道事件。
- 增加验证连接、首事件超时、错误映射和取消。

### Phase 2：实验对比

- 多模型选择和并行编排。
- 响应面板、usage、首 token 和时间线。
- 历史详情、重放和部分失败处理。

### Phase 3：模板与质量

- 导入导出模板。
- Alembic migration、完整集成测试和 Playwright 流程。
- 指标、限流、日志脱敏和移动端验收。

## 15. Definition of Done

每个 V2 功能必须同时具备：

1. 明确的 API 契约和错误码。
2. 成功、失败、超时、取消和加载状态。
3. 单元测试与必要的集成/端到端测试。
4. 数据库变更对应 Alembic migration。
5. 不泄露密钥的日志、响应和前端状态检查。
6. 桌面和移动视口基本可用性验证。
7. README、环境变量和运行命令同步更新。
