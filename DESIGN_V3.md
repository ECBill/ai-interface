# AI Interface V3 设计文档

- 文档状态：Draft
- 版本：v3.0
- 日期：2026-08-28
- 目标读者：产品、前后端、测试、部署与安全相关人员
- 基线：V1/V2 已实现账号会话、OpenAI/Anthropic 调用、流式思考与回答、多模型对比、供应商配置和调用记录

---

## 1. V3 定位与背景

### 1.1 产品定位

V3 将 AI Interface 从"单次调用调试台"重构为"以对话为核心的个人 AI 客户端"。

前两版在功能深度上持续叠加（多模型对比、网关兼容、验证诊断、模板导出），但最基础的用户体验没有过关。V3 的唯一主题是：**把用户每天接触的界面做成正常、完整、可信赖的聊天产品，然后再谈深度功能。**

一个正常的 LLM 对话产品的标准形态是：

1. 用户与助手的历史消息上下排列，形成消息流。
2. 新消息追加在消息流底部，不替换旧内容。
3. 助手回复以流式方式增量出现在自己的气泡内。
4. 历史会话保存并可在侧边栏切换。
5. 对话上下文自动携带，多轮对话不需要用户重复粘贴上文。

### 1.2 V1/V2 教训复盘（V3 直接动因）

以下四个问题在 V2 实现中被用户实际验证存在，V3 必须逐条解决：

| # | 问题 | 根因诊断 | V3 对策 |
| --- | --- | --- | --- |
| P1 | 服务器重启后是否仍保持登录 | 后端使用 HttpOnly Cookie + SQLite `SessionRecord` 表持久化会话，重启不失效。**实现正确，无需修复。** | 保留现有方案，增加滑动续期与"记住我"选项（§8） |
| P2 | 每次刷新网页都要重新输入供应商设置 | 前端 `provider`/`model` 等状态为硬编码 `useState` 默认值；`loadProviders()` 仅在打开设置弹窗时触发；启动时只调用 `/auth/me`，未拉取已保存配置。后端其实已持久化凭据，纯粹是前端状态恢复链断裂。 | 定义完整的应用启动加载链（§7）+ 服务端 `user_preferences` 表（§6.3） |
| P3 | 对话框不是对话，是"图灵测试式"的单次问答 | UI 为"请求面板 → 响应面板"左右分栏的调试台结构；每次请求只发送单条 `user` 消息，后端不携带历史上下文；新回复覆盖旧回复。 | 全新对话式架构：会话列表、消息流 UI、服务端上下文自动携带（§4、§5、§6） |
| P4 | 回复区域没有滚动条，内容增长无限拉长页面 | `.response-body` 无固定视口高度与 `overflow` 设置，内容撑开文档流。 | 消息流区固定视口高度、独立滚动、自动跟随底部策略（§4.4） |

### 1.3 目标

1. 提供标准的多轮对话体验：会话列表、消息流、流式回复、上下文自动携带。
2. 刷新页面后，登录态、供应商配置、模型选择、会话列表、UI 偏好**零丢失**恢复。
3. 消息流区域滚动行为符合主流聊天产品规范。
4. 会话与消息持久化到服务端数据库，跨设备语义一致（同账号）。
5. V2 已有的深度能力（思考流、多模型对比、连接验证）保留，但作为对话之上的增强，不干扰基础体验。

### 1.4 非目标

V3 暂不实现：

- 多用户协作、组织与共享。
- 文件/图片上传、语音、工具调用。
- 消息级分支树（branching）编辑，仅做线性的重新生成。
- 知识库、Agent 编排、成本结算。
- 移动端原生 App。

---

## 2. 核心原则：基础体验优先

V3 所有设计决策遵循以下优先级排序，冲突时序号小者优先：

1. **刷新零丢失**：任何用户已完成并被系统确认的操作（登录、保存配置、发送消息），在刷新或重启后必须完整恢复。前端禁止依赖"内存里的状态"承载持久语义。
2. **标准对话范式**：凡是主流聊天产品（ChatGPT、Claude、Gemini 等）已经形成共识的交互模式，V3 必须遵循，除非有明确且用户可感知的改进理由。
3. **布局稳定**：页面骨架（顶栏、侧栏、消息区、输入区）在任何内容量下保持固定；只有消息流内部滚动。禁止"页面被内容撑长"。
4. **状态可感知**：发送中、流式中、错误、已取消，四类状态必须有明确视觉区分，且不会无限停留在中间态。
5. **渐进增强**：深度功能（对比模式、思考流、模板）不得增加基础聊天路径的复杂度；默认路径是"打开即聊"。

---

## 3. 总体架构

```text
React SPA (三栏布局)
  |
  | JSON / SSE (HttpOnly Session Cookie)
  v
FastAPI API (/api/v3)
  +-- Auth & Session          # 沿用 V1/V2，增加滑动续期
  +-- Conversation Service    # V3 新增：会话与消息生命周期
  +-- Context Builder         # V3 新增：从消息历史构建上下文窗口
  +-- Invocation Orchestrator # 沿用：调用生命周期、计时、取消、记录
  +-- Provider Registry       # 沿用：OpenAI / Anthropic / 兼容网关
  +-- Secret Service          # 沿用：AES-GCM 加密凭据
  +-- Preference Service      # V3 新增：用户偏好读写
  +-- History Service         # 沿用：调用元数据记录
  |
  +-- SQLite (dev) / PostgreSQL (prod)
  |
  +--> Provider APIs and gateways
```

### 3.1 架构原则

- 浏览器只调用本工具箱后端，不直接调用模型供应商。
- 会话与消息是**服务端一等公民**，不是前端本地缓存；换浏览器登录同一账号能看到同样的会话。
- 上下文构建（Context Builder）在服务端完成：前端只发送"新消息 + 会话 ID"，不要求前端回传完整历史。这消除前端状态丢失导致的上下文断裂（直接解决 P2/P3 的耦合）。
- Adapter 层职责不变：协议映射与事件解析；编排器负责生命周期、取消与记录。
- thinking 与 answer 仍是独立事件通道（V2 原则保留）。

### 3.2 一次对话消息的数据流

```text
UI 输入框 -> POST /conversations/{id}/messages (仅新消息文本)
   -> API 校验 + 鉴权
   -> Conversation Service 落库 user 消息 (status=sending)
   -> Context Builder 读取会话历史 + 系统提示词 + 参数
   -> 截断策略（见 §5.3）构建最终 messages 数组
   -> Invocation Orchestrator -> Provider Adapter
   -> SSE: reasoning_delta / answer_delta / usage / done / error
   -> 每个阶段增量落库 assistant 消息状态与内容
   -> UI 消息流内流式渲染该 assistant 气泡
   -> done 后更新 usage、耗时、finish_reason
```

---

## 4. 前端界面设计

### 4.1 整体布局：三栏结构

```text
+--------------------------------------------------------------+
| 顶栏：品牌 · 当前会话标题 · 模型选择器 · 用户头像/菜单          |
+----------+-----------------------------------+---------------+
| 左栏      |  中栏：消息流（独立滚动）            |  右栏（可折叠） |
| 会话列表  |  ...历史消息...                     |  模型与参数    |
| + 新对话  |  [user 气泡]                       |  系统提示词    |
| 搜索框    |  [assistant 气泡 + thinking 折叠]   |  思考开关      |
| 按时间分组 |  [user 气泡]                       |  上下文摘要    |
|          |  [assistant 气泡 (流式中▌)]         |  本会话统计    |
|          |-----------------------------------|               |
|          |  输入区（固定底部，自适应高度）        |               |
+----------+-----------------------------------+---------------+
| 状态栏：连接状态 · 当前模型 · 供应商指纹 · 流式状态              |
+--------------------------------------------------------------+
```

- **左栏（会话列表）**：宽度约 260px，可折叠。顶部"新建对话"按钮 + 搜索框；列表按更新时间倒序，按"今天 / 昨天 / 近 7 天 / 更早"分组；每项显示标题（首条用户消息截断 40 字符）与最后活动时间；hover 显示重命名/删除。至少保留一个"新对话"虚拟项。
- **中栏（消息流 + 输入区）**：核心区域。消息流占据剩余全部高度，`overflow-y: auto`，独立滚动（详见 §4.4）。输入区固定在底部。
- **右栏（模型与参数）**：默认折叠为图标，点击展开，宽度约 300px。包含模型选择、系统提示词、生成参数（temperature/max tokens/top_p）、思考显示开关、本会话 token 统计。**多模型对比模式入口放在右栏**，不污染默认聊天路径。

### 4.2 移动端降级（视口 < 768px）

- 三栏退化为单栏：默认显示中栏；左栏通过汉堡菜单以抽屉形式滑出；右栏通过顶栏齿轮图标以底部弹层或全屏页打开。
- 消息流与输入区仍占满视口高度，消息流独立滚动。
- 输入框至少支持：发送、停止、粘贴长文本；参数面板可后置到发送前的确认层。

### 4.3 聊天区详细规范（解决 P3）

#### 4.3.1 消息气泡

- **user 消息**：右对齐气泡，区分底色；支持多行文本；显示发送时间（hover 或小字）。
- **assistant 消息**：左对齐，带供应商/模型标识徽标（如 `openai · gpt-4.1-mini`）。
- 消息按时间顺序上下排列，**永不互相覆盖**（直接修复"输入一条、替换一条"的旧行为）。
- 空消息流显示欢迎态：简短引导文案 + 示例 prompt（可点击填入）。

#### 4.3.2 thinking 展示

- 收到 `reasoning_delta` 时，在对应 assistant 气泡内渲染**可折叠 THINKING 区块**，默认展开实时滚动，完成后自动折叠为"已思考 N 秒 · 点击展开"摘要行。
- thinking 内容与 answer 正文**视觉与数据双重分离**，不拼接。
- 用户可在右栏偏好中设置 thinking 默认展开/折叠。

#### 4.3.3 流式渲染

- `answer_delta` 增量追加到当前 assistant 气泡，末尾显示闪烁光标 `▌`。
- 流式期间消息流自动跟随（详见 §4.4）。
- `usage` / `done` 到达后：移除光标，气泡底部补充一行元数据（`首字 320ms · 总计 1.8s · 523 tokens · 自然结束`）。
- `error` 到达后：气泡变为错误态（红色边框 + 错误码与可读信息 + "重试"按钮），不中断消息流布局。

#### 4.3.4 消息操作

- 每条 assistant 消息 hover 显示操作条：**复制**（纯文本 answer）、**重新生成**（用同一段上下文重新请求，新回复追加为新气泡，旧回复保留并标记"已重新生成"）、**删除**（软删除，双向确认）。
- user 消息 hover 显示：**复制**、**编辑重发**（编辑后该消息之后的所有 assistant 回复标记为旧分支，新回复追加）。
- 流式进行中，输入区发送按钮变为**停止**按钮；点击后后端取消上游请求，气泡状态变为"已停止"，保留已生成部分。

#### 4.3.5 输入区

- 多行自适应高度 textarea，最小 1 行、最大约 8 行后内部滚动。
- **Enter 发送，Shift+Enter 换行**（与主流产品一致）。
- 输入区左侧显示当前模型徽标，点击可快速切换（等价于右栏模型选择）。
- 空内容时发送按钮禁用；请求进行中发送按钮变为停止。
- **点击发送立即清空输入框**（主流行为），消息以流式状态先渲染；若请求在建立前即失败（网络错误、未登录），把原文回填输入框避免丢失。

#### 4.3.6 会话切换与新建

- 新建对话：立即创建空会话（乐观 UI，服务端落库），标题在首条消息发送后自动生成（取首条 user 消息前 40 字符）。
- 切换会话：前端从服务端拉取该会话消息列表，渲染时短暂显示骨架屏；流式中的会话切换后再切回，能恢复显示已生成的部分（从服务端已落库内容 + 进行中的事件流重连或拉取最新状态）。
- 删除会话需二次确认；删除后自动选中相邻会话。

### 4.4 滚动策略（解决 P4）

消息流滚动是 V3 的硬性 UI 规范：

1. **视口固定**：消息流容器使用 `flex: 1; min-height: 0; overflow-y: auto;`，高度由布局撑满剩余空间，**永远不把页面撑长**。顶栏、输入区固定可见。
2. **自动跟随**：流式输出或新消息到达时，若用户当前滚动位置贴近底部（距底部 < 80px），自动平滑滚动跟随最新内容。
3. **解除跟随**：用户向上滚动超过阈值后，停止自动跟随，并在消息流底部悬浮显示 **"↓ 回到最新"** 按钮（带新消息计数角标）。
4. **手动回底**：点击该按钮，滚到底部并恢复跟随。
5. **长内容**：单条消息超长（如长代码块）正常撑开气泡，容器滚动；代码块内部使用横向滚动而非撑宽布局。
6. **历史加载**：会话消息默认加载最近 50 条；向上滚动到顶部时自动向上分页加载更早消息，并保持滚动锚点不跳动。
7. 左栏会话列表同样独立滚动，不撑长页面。

### 4.5 状态与错误展示

| 状态 | 触发 | 展示 |
| --- | --- | --- |
| 等待首事件 | 已发送、未收到任何 delta | assistant 气泡显示三点跳动占位 + "正在连接" |
| 思考中 | 收到 reasoning_delta | THINKING 区块展开，光标闪烁 |
| 回答中 | 收到 answer_delta | 正文增量渲染，光标闪烁，状态栏 LIVE |
| 完成 | done | 元数据行（耗时/tokens/finish） |
| 失败 | error 事件或网络断开 | 气泡错误态 + 重试按钮，明确区分"网络断开/上游错误/已取消" |
| 已取消 | 用户点击停止 | "已停止 · 已生成 N 字" |

- 超过首事件超时（默认 20s）仍未收到任何事件，自动显示"上游未返回首事件"并可重试，不无限等待。

### 4.6 应用启动加载链（解决 P2 的前端侧）

应用挂载时按以下顺序执行，任一步失败进入对应兜底而非白屏：

```text
1. GET /auth/me
   ├─ 200 -> 继续步骤 2
   └─ 401 -> 显示登录页（无账号时显示首次注册），登录成功后回到步骤 2
2. 并行请求（Promise.all，加载页遮罩期间完成）：
   ├─ GET /providers            -> 恢复供应商列表与配置状态
   ├─ GET /preferences          -> 恢复最后使用的 providerId/model/参数/UI 偏好
   └─ GET /conversations?limit=50 -> 恢复会话列表
3. GET /preferences.lastConversationId 对应的 GET /conversations/{id}/messages
   ├─ 存在 -> 渲染该会话，滚动到底部
   └─ 不存在/已删除 -> 选中会话列表第一项或创建新对话
4. 全部完成 -> 移除加载遮罩，界面进入可用态
```

- **加载遮罩**必须显示进度（"恢复会话…"），总时长超过 5s 显示重试入口。
- 任何一步失败：给出具体错误提示与重试按钮；供应商接口失败不阻塞聊天界面渲染（仅提示"供应商配置读取失败"）。
- 硬性要求：刷新页面后，**登录态、供应商配置标记、最后使用的模型、最后的会话内容全部与刷新前一致**。这就是 P2 的验收口径。

### 4.7 前端状态管理约定

- 引入轻量状态管理（Context + reducer 或 Zustand），按域拆分 store：`authStore`、`providerStore`、`conversationStore`、`preferenceStore`、`streamStore`。
- **持久语义的数据只存服务端**；localStorage 仅允许缓存 UI 偏好（主题、右栏展开状态），且服务端 `preferences` 为准、localStorage 为离线回退。
- 每个会话的流式状态独立，切换会话不终止进行中的流（后台继续接收并落库）。

---

## 5. 对话域模型与上下文构建

### 5.1 会话与消息（统一领域模型）

```ts
interface Conversation {
  id: string;
  title: string;                 // 首条 user 消息截断，可手动改名
  providerId: string;            // 会话级当前供应商
  model: string;                 // 会话级当前模型
  createdAt: string;
  updatedAt: string;             // 最后一条消息时间，用于列表排序
  messageCount: number;
  lastMessagePreview?: string;   // 列表预览，60 字符
}

type MessageStatus = "sending" | "streaming" | "succeeded" | "failed" | "cancelled";

interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;               // 正文（answer）
  thinking?: string;              // 思考内容，仅 assistant
  status: MessageStatus;
  providerId?: string;           // 仅 assistant
  model?: string;                // 仅 assistant
  invocationId?: string;         // 关联调用记录，仅 assistant
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  firstTokenMs?: number;
  finishReason?: string;
  createdAt: string;
  editedAt?: string;
  supersededBy?: string;         // 重新生成/编辑重发后的新消息 id
}
```

### 5.2 发送消息请求

前端只发送增量，历史由服务端组装：

```ts
// POST /api/v3/conversations/{conversationId}/messages
interface SendMessageRequest {
  content: string;               // 1-100,000 字符
  // 可选会话级覆盖；缺省使用会话当前设置或用户偏好
  providerId?: string;
  model?: string;
  system?: string;               // 覆盖系统提示词（同时写回会话设置）
  parameters?: GenerationParameters;
  stream?: boolean;              // 默认 true
}
```

响应为 SSE（`text/event-stream`），事件流沿用 V2 统一事件并扩展：

```ts
type StreamEvent =
  | { type: "start"; invocationId: string; messageId: string; model: string }
  | { type: "reasoning_delta"; messageId: string; text: string }
  | { type: "answer_delta"; messageId: string; text: string }
  | { type: "status"; messageId: string; value: "connecting" | "thinking" | "answering" }
  | { type: "usage"; messageId: string; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: "done"; messageId: string; finishReason?: string; latencyMs: number; firstTokenMs?: number }
  | { type: "error"; messageId: string; code: string; message: string; retryable: boolean }
```

所有事件携带 `messageId`，前端据此把事件路由到正确的气泡（多会话并行流式时必需）。

### 5.3 上下文构建与截断（Context Builder）

- 服务端从该会话按时间正序读取消息，构建 `messages` 数组：`user`/`assistant` 的 `content` 交替；`failed`/`cancelled` 的 assistant 消息**跳过**（不把失败内容发给模型）；被 `supersededBy` 标记的旧分支跳过，只走最新链。
- `system` 提示词优先级：请求覆盖 > 会话设置 > 用户偏好默认 > 无。
- **截断策略**（防止上下文无限增长）：
  - 按消息条数：默认携带最近 40 条有效消息（可配置 10-100）。
  - 按字符预算：所有消息字符总量上限默认 200,000 字符（约预留模型的 token 预算），超限时从最旧消息开始丢弃，但**必须保留首条 user 消息**（维持话题锚点）。
  - 截断发生时在响应 `warnings` 中提示"已截断早期 N 条消息"。
- 前端永远不回传历史数组；这保证刷新、多端、消息流状态损坏都不影响上下文正确性。

### 5.4 重新生成与编辑重发

- **重新生成**：`POST /conversations/{id}/messages/{messageId}/regenerate`。服务端找到该 assistant 消息，取其前驱上下文重新调用；旧消息标记 `supersededBy`，新消息追加落库。
- **编辑重发**：`PUT /conversations/{id}/messages/{messageId}` 修改 user 消息内容后，自动触发从该消息开始的新一轮生成；该消息之后的旧消息全部标记 superseded。

---

## 6. 数据模型变化

所有变更通过 Alembic migration 提供。

### 6.1 conversations（新增表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string PK | |
| `owner_id` | FK users | 所有权校验必需 |
| `title` | string(200) | 默认取首条消息 |
| `provider_id` | string | 会话当前供应商 |
| `model` | string(128) | 会话当前模型 |
| `system_prompt` | text nullable | 会话级系统提示词 |
| `parameters_json` | JSON | 会话级生成参数 |
| `last_message_at` | datetime | 列表排序键 |
| `created_at` / `updated_at` / `deleted_at` | datetime | 软删除 |

索引：`(owner_id, last_message_at DESC)`。

### 6.2 chat_messages（新增表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string PK | |
| `conversation_id` | FK conversations | |
| `role` | enum | user / assistant |
| `content` | text | 正文 |
| `thinking` | text nullable | 思考内容 |
| `status` | enum | sending/streaming/succeeded/failed/cancelled |
| `provider_id` / `model` | string nullable | 仅 assistant |
| `invocation_id` | FK invocations nullable | 关联调用元数据 |
| `error_code` | string nullable | |
| `input_tokens` / `output_tokens` / `total_tokens` | int nullable | |
| `latency_ms` / `first_token_ms` | int nullable | |
| `finish_reason` | string(64) nullable | |
| `superseded_by` | string nullable | 分支标记 |
| `created_at` / `edited_at` | datetime | |

索引：`(conversation_id, created_at)`。assistant 内容默认保存（对话产品的核心价值就是历史），thinking 保存与否遵循用户偏好（默认保存，保留策略同 V2）。

### 6.3 user_preferences（新增表，解决 P2 的服务端侧）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | FK users PK | 一人一行 |
| `last_provider_id` | string nullable | 刷新恢复 |
| `last_model` | string(128) nullable | 刷新恢复 |
| `last_conversation_id` | string nullable | 刷新后直接回到该会话 |
| `default_system_prompt` | text nullable | |
| `default_parameters_json` | JSON | |
| `stream_by_default` | boolean | 默认 true |
| `show_thinking` | enum | expanded / collapsed / hidden |
| `ui_prefs_json` | JSON | 主题、右栏状态等 |

用户每次切换模型、切换会话、修改默认参数时，前端**防抖写回**（如 800ms）`PUT /preferences`；刷新时从这里恢复。这是"供应商设置不再要求重输"的机制保证。

### 6.4 invocations（沿用）

V2 的调用元数据表保留，assistant 消息通过 `invocation_id` 关联，历史/调试视图继续可用。对话消息与调用记录是两个视角：消息面向聊天，invocation 面向调试元数据。

---

## 7. HTTP API 设计（/api/v3）

除登录、注册外均要求 HttpOnly Session Cookie。错误格式沿用 V2 统一错误体。

### 7.1 会话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/conversations?limit=&cursor=` | 分页返回会话列表（摘要） |
| `POST` | `/conversations` | 创建空会话，可携带初始 providerId/model |
| `GET` | `/conversations/{id}` | 会话详情（含设置） |
| `PATCH` | `/conversations/{id}` | 改名、更新模型/参数/系统提示词 |
| `DELETE` | `/conversations/{id}` | 软删除会话及消息 |
| `GET` | `/conversations/{id}/messages?before=&limit=50` | 按时间正序返回消息；`before` 游标向上分页 |
| `POST` | `/conversations/{id}/messages` | 发送消息（§5.2），默认 SSE 响应；`stream:false` 时返回 JSON |
| `POST` | `/conversations/{id}/messages/{mid}/regenerate` | 重新生成 |
| `PUT` | `/conversations/{id}/messages/{mid}` | 编辑 user 消息并触发重发 |
| `DELETE` | `/conversations/{id}/messages/{mid}` | 删除单条消息 |

### 7.2 偏好

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/preferences` | 返回用户偏好 |
| `PUT` | `/preferences` | 合并更新（部分字段） |

### 7.3 启动聚合接口（可选优化）

`GET /bootstrap`：单次返回 `user + providers + preferences + conversations(首页)`，减少启动往返。首版可不实现，前端按 §4.6 并行请求即可；但**验收以并行请求版为准**，聚合接口仅作性能优化。

### 7.4 供应商与调用（沿用 V2 契约）

`/providers`、`/providers/{id}/credentials`、`/providers/{id}/validate`、`/invocations` 系列、`/invocations/{id}/cancel` 原样保留在 `/api/v3` 命名空间下。对话发送产生的事件流中，取消沿用 AbortController 断开 SSE 即触发上游取消的语义（浏览器断开 → 2s 内取消上游）。

### 7.5 新增错误码

| 错误码 | HTTP | 说明 |
| --- | ---: | --- |
| `CONVERSATION_NOT_FOUND` | 404 | 会话不存在或不属于当前用户 |
| `MESSAGE_NOT_FOUND` | 404 | 消息不存在 |
| `MESSAGE_NOT_EDITABLE` | 409 | 仅 user 消息可编辑重发 |
| `CONTENT_EMPTY` | 400 | 消息内容为空 |
| `CONTEXT_OVERFLOW` | 413 | 截断后仍超出预算（防御性） |

---

## 8. 会话与认证增强（解决 P1 的"顺手加固"）

V1/V2 的 HttpOnly Cookie + 服务端 SessionRecord 方案**保留不动**（已验证重启持久）。V3 增强：

1. **滑动续期**：每次请求命中有效会话且剩余有效期低于 TTL 的一半时，自动延长 `expires_at` 并刷新 Cookie `max_age`。活跃用户不再每 24h 被强制登出一次。
2. **记住我**：登录接口接受 `rememberMe`；勾选时会话 TTL 30 天，未勾选 24h。默认勾选（个人工具场景）。
3. **会话清理**：后台任务定期删除已过期/已撤销超过 30 天的 SessionRecord 行。
4. `/auth/me` 响应增加 `expiresAt`，前端在即将过期且无活动时静默刷新。
5. 明确约束不变：token 只存哈希；Cookie `HttpOnly; SameSite=Lax; Secure(生产)`；不使用 JWT 存浏览器。

---

## 9. V2 能力在 V3 中的落位

深度功能保留但重新归位，均以"不打扰默认聊天路径"为前提：

| V2 能力 | V3 落位 |
| --- | --- |
| 思考流（reasoning/answer 双通道） | 内化为 assistant 气泡内的 THINKING 折叠块（§4.3.2），所有供应商统一行为 |
| 多模型对比 | 右栏"对比模式"开关。开启后发送一次、右侧并排多栏流式结果；**对比结果是独立的一次性实验视图**，不写入当前会话消息流（写入 invocations 历史可回看） |
| 连接验证/网关诊断 | 保留在"供应商设置"页（V3 中从弹窗升级为独立页面/全屏分区），分步验证结果不变 |
| 自定义 OpenAI 兼容网关 | 供应商设置页内完整保留（kind、路径、鉴权、模型别名） |
| 模型能力字段 | 右栏模型选择器展示徽标（支持思考/流式等） |
| 调用历史/重放/删除 | 独立"调用记录"页保留；每条 assistant 消息通过 invocation 链接可跳转调试详情 |
| 模板导入导出 | 降级到 Phase 3，不阻塞基础体验 |

---

## 10. 安全与隐私（继承并补充）

V1/V2 全部安全要求继续有效，V3 补充：

1. 会话与消息的**所有权校验必须在服务端**：所有 `/conversations/*` 接口校验 `owner_id`；不信任前端传入的任何归属字段。
2. 消息内容（含 thinking）默认保存于数据库，属于用户私有数据；删除会话为软删除，后台任务 7 天后物理清除；导出功能（Phase 3）必须先扫描敏感字段。
3. Context Builder 截断后的完整请求体仍受 1MB 上限约束。
4. SSE 事件中永不包含 API Key、完整认证头；错误信息延续脱敏摘要策略。
5. 供应商 Base URL 的 SSRF allowlist 策略沿用 V2。
6. 限流：消息发送接口按用户限流（默认 30 次/分钟），防止意外刷库。

---

## 11. 可靠性与性能

- 连接超时 10s、首事件超时 20s、总调用超时 180s（沿用 V2，右栏可按供应商覆盖）。
- 消息落库策略：user 消息发送前先落库（防丢）；assistant 消息流式期间**节流落库**（每 1s 或每 2KB 增量持久化一次），done 时写入最终内容与统计。服务重启最多丢失最后 1s 的增量，且消息状态可被启动清理任务标记为 failed。
- 消息列表接口 P95 < 300ms（50 条，含分页）。
- 流式转发延迟 P95 < 200ms（沿用）。
- 启动加载链（§4.6）在本地环境总耗时目标 < 1.5s。
- 会话列表虚拟滚动（>100 会话时），消息流超长会话依赖向上分页，不一次性渲染全部。

---

## 12. 测试策略

### 12.1 单元测试

- Context Builder：交替消息构建、失败消息跳过、superseded 分支跳过、条数截断、字符预算截断、保留首条消息。
- 消息状态机：sending → streaming → succeeded/failed/cancelled 的合法迁移。
- 滑动续期与 rememberMe TTL 计算。
- 会话标题自动生成与改名。
- 偏好合并更新（PUT 部分字段不覆盖其他字段）。

### 12.2 集成测试

- 发送消息：落库 user → SSE 事件序列 → assistant 落库 → 统计字段完整。
- 上下文携带：第二轮请求的实际出站 payload 包含第一轮问答。
- 刷新恢复：登录 → 配置供应商 → 发送消息 → 重新初始化（模拟刷新）→ bootstrap 链路恢复全部状态。
- 重新生成/编辑重发后，后续调用的上下文走新分支。
- 浏览器断开 SSE → 上游被取消 → 消息状态 cancelled。
- 越权访问他人会话/消息返回 404。
- 服务重启后（测试中重启 app）会话数据与会话 cookie 仍有效。

### 12.3 端到端测试（Playwright）

1. 注册/登录 → 配置供应商 → 发送消息 → 流式看到回复。
2. 刷新页面：仍登录、模型选择不变、会话列表与消息完整恢复、消息流定位到底部。
3. 多轮对话：第二轮回答体现第一轮上下文。
4. 长回复（>2000 字）期间：消息区滚动而不是页面变长；向上滚动停止跟随并出现"回到最新"按钮。
5. 停止生成、重新生成、编辑重发、删除会话。
6. 新建/切换会话，进行中流式不互相干扰。
7. 移动端视口：抽屉会话列表、输入可用、无横向溢出。

---

## 13. V3 验收标准

### 13.1 基础体验（最高优先级，逐条对应 P1-P4）

- [ ] **P1**：重启后端服务后浏览器无需重新登录（Cookie + 服务端会话持久）。
- [ ] **P1**：活跃使用期间不被中途登出（滑动续期生效）。
- [ ] **P2**：配置供应商并刷新页面后，模型选择器、默认模型、系统提示词、参数全部自动恢复，无需任何重输。
- [ ] **P2**：发送消息后刷新，回到同一会话且消息完整。
- [ ] **P3**：连续发送多条消息，历史消息全部保留在消息流中上下排列，新回复追加而非替换。
- [ ] **P3**：多轮对话中模型能正确引用前文（上下文服务端携带）。
- [ ] **P4**：超长回复期间页面总高度不变，仅消息流内部滚动；自动跟随与"回到最新"按钮行为正确。
- [ ] Enter 发送、Shift+Enter 换行、发送即清空、失败回填。

### 13.2 对话功能

- [ ] 会话列表按时间分组排序、搜索、重命名、删除。
- [ ] thinking 折叠块实时显示并可展开回看，与正文分离。
- [ ] 消息操作：复制、重新生成（保留旧回复标记）、编辑重发、删除。
- [ ] 停止生成后已输出内容保留，状态为"已停止"。
- [ ] usage/耗时/首字延迟在完成后展示于消息元数据行。
- [ ] 上下文截断时界面有提示。

### 13.3 继承能力

- [ ] V2 供应商配置、验证、网关兼容、调用历史功能在 V3 中可用。
- [ ] 对比模式可从右栏开启，多模型并排流式，不写入会话消息流。
- [ ] assistant 消息可跳转关联的 invocation 调试详情。

### 13.4 安全与质量

- [ ] 越权访问他人会话被拒绝。
- [ ] API Key 依然不出现在浏览器、日志、URL。
- [ ] Alembic migration 覆盖全部新表，旧库可平滑升级。
- [ ] 单元/集成/E2E 全部通过；移动端视口基本可用。

---

## 14. 交付阶段

### Phase 1：基础对话体验（最高优先，先做）

- 对话域模型与 migration（conversations、chat_messages、user_preferences）。
- 会话 CRUD、消息发送（SSE）、服务端上下文构建与截断。
- 三栏布局、消息流、滚动策略、输入区交互。
- 启动加载链与偏好持久化（**P2 修复**）。
- 滑动续期与 rememberMe（**P1 加固**）。
- 基础错误与取消。

### Phase 2：会话管理完善

- 消息操作全集：复制、重新生成、编辑重发、删除。
- 会话搜索、重命名、删除、时间分组列表。
- thinking 折叠交互完善、偏好项接入。
- 流式中切换会话与后台接收。
- 集成/E2E 测试补全（刷新恢复、滚动、多轮上下文）。

### Phase 3：深度功能回归

- 对比模式（多模型并排）在右栏重新接入。
- 供应商设置页升级（从弹窗到独立页，验证分步结果）。
- invocation 调试视图与消息关联跳转。
- 模板导入导出、虚拟滚动等性能项。

---

## 15. 待确认决策

1. 对比模式的结果是否需要"转存为会话"（把某次对比中最优回复导入当前对话）？
2. 消息内容是否需要按会话设置独立加密（当前与其他数据同库同策略）？
3. Phase 3 是否引入会话置顶/归档？

---

## 16. 设计结论

V3 的判断是：**一个连"刷新不丢状态、对话有历史、回复区有滚动条"都没做到的产品，叠加再多实验功能也没有意义。** 因此 V3 以四个已验证的体验缺陷为直接动因，把产品重心从"实验工作台"重构为"标准对话客户端"：会话与消息成为服务端一等公民，上下文由服务端组装，前端通过确定的启动加载链恢复全部状态，滚动与布局规范被写成硬性约束。V2 的深度能力全部保留，但被重新安置在不打扰基础聊天路径的位置。先让用户"打开即聊、刷新如初"，再谈对比、调试与模板。
