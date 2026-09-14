// ── Auth ──────────────────────────────────────────────
export interface User {
  id: number;
  email: string;
  createdAt: string;
  expiresAt?: string | null;
}

// ── Provider ──────────────────────────────────────────
export interface ProviderStatus {
  id: string;
  configured: boolean;
  keyFingerprint?: string | null;
  baseUrl?: string | null;
  models: string[];
}

export interface ValidationResult {
  providerId: string;
  valid: boolean;
  latencyMs: number;
  message: string;
  model?: string | null;
}

// ── Conversation ──────────────────────────────────────
export interface ConversationSummary {
  id: string;
  title: string;
  providerId: string;
  model: string;
  messageCount: number;
  lastMessagePreview?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  systemPrompt?: string | null;
  parameters: Record<string, unknown>;
}

// ── Message ───────────────────────────────────────────
export type MessageStatus =
  | "sending"
  | "streaming"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ChatMessage {
  id: string;
  conversationId: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  status: MessageStatus;
  providerId?: string | null;
  model?: string | null;
  invocationId?: number | null;
  errorCode?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  firstTokenMs?: number | null;
  finishReason?: string | null;
  supersededBy?: string | null;
  createdAt: string;
  editedAt?: string | null;
}

// ── Preferences ───────────────────────────────────────
export interface UserPreferences {
  lastProviderId?: string | null;
  lastModel?: string | null;
  lastConversationId?: string | null;
  defaultSystemPrompt?: string | null;
  defaultParameters: Record<string, unknown>;
  streamByDefault: boolean;
  showThinking: "expanded" | "collapsed" | "hidden";
  uiPrefs: Record<string, unknown>;
}

// ── Generation Parameters ─────────────────────────────
export interface GenerationParameters {
  temperature?: number | null;
  topP?: number | null;
  maxTokens: number;
  stop?: string[] | null;
  providerOptions?: Record<string, unknown>;
}

// ── SSE Stream Events ─────────────────────────────────
export type StreamEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "start"; invocationId: string; messageId: string; model: string; providerId: string }
  | { type: "warning"; message: string }
  | { type: "status"; messageId: string; value: "connecting" | "thinking" | "answering" }
  | { type: "reasoning_delta"; messageId: string; text: string }
  | { type: "answer_delta"; messageId: string; text: string }
  | {
      type: "usage";
      messageId: string;
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
    }
  | {
      type: "done";
      messageId: string;
      finishReason?: string | null;
      latencyMs: number;
      firstTokenMs?: number | null;
    }
  | { type: "error"; messageId: string; code: string; message: string; retryable: boolean };

// ── API Response Wrappers ─────────────────────────────
export interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export interface MessageListResponse {
  items: ChatMessage[];
  hasMore: boolean;
}
