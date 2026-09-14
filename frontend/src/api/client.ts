import type {
  ConversationDetail,
  ConversationListResponse,
  ConversationSummary,
  GenerationParameters,
  MessageListResponse,
  ProviderStatus,
  StreamEvent,
  User,
  UserPreferences,
  ValidationResult,
} from "../types";

const BASE = "/api/v3";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────
export const authApi = {
  me: () => request<User>("/auth/me"),
  login: (email: string, password: string, rememberMe = true) =>
    request<User>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe }),
    }),
  register: (email: string, password: string, rememberMe = true) =>
    request<User>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
};

// ── Providers ─────────────────────────────────────────
export const providerApi = {
  list: () => request<{ items: ProviderStatus[] }>("/providers"),
  saveCredentials: (
    providerId: string,
    apiKey: string,
    baseUrl?: string | null,
    models?: string[],
  ) =>
    request<ProviderStatus>(`/providers/${providerId}/credentials`, {
      method: "PUT",
      body: JSON.stringify({ apiKey, baseUrl: baseUrl || null, models: models || [] }),
    }),
  validate: (providerId: string, model?: string) =>
    request<ValidationResult>(`/providers/${providerId}/validate`, {
      method: "POST",
      body: JSON.stringify({ model }),
    }),
  revoke: (providerId: string) =>
    request<void>(`/providers/${providerId}/credentials`, { method: "DELETE" }),
};

// ── Conversations ─────────────────────────────────────
export const conversationApi = {
  list: (limit = 50) =>
    request<ConversationListResponse>(`/conversations?limit=${limit}`),
  create: (data: {
    title?: string;
    providerId?: string;
    model?: string;
    system?: string;
    parameters?: GenerationParameters;
  }) =>
    request<ConversationDetail>("/conversations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  get: (id: string) => request<ConversationDetail>(`/conversations/${id}`),
  patch: (id: string, data: Partial<{
    title: string;
    providerId: string;
    model: string;
    system: string;
    parameters: GenerationParameters;
  }>) =>
    request<ConversationDetail>(`/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
  messages: (id: string, limit = 50) =>
    request<MessageListResponse>(`/conversations/${id}/messages?limit=${limit}`),
  deleteMessage: (conversationId: string, messageId: string) =>
    request<void>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: "DELETE",
    }),
};

// ── Preferences ───────────────────────────────────────
export const preferenceApi = {
  get: () => request<UserPreferences>("/preferences"),
  update: (data: Partial<UserPreferences>) =>
    request<UserPreferences>("/preferences", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ── SSE Stream ────────────────────────────────────────
export interface StreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: Error) => void;
}

export async function streamMessage(
  conversationId: string,
  content: string,
  options?: {
    providerId?: string;
    model?: string;
    system?: string;
    parameters?: GenerationParameters;
    stream?: boolean;
  },
  callbacks?: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      providerId: options?.providerId,
      model: options?.model,
      system: options?.system,
      parameters: options?.parameters,
      stream: options?.stream ?? true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // not JSON
    }
    callbacks?.onError(new ApiError(res.status, detail));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) {
        const parsed = parseSSE(raw);
        if (parsed) callbacks?.onEvent(parsed);
      }
    }
    // flush remaining
    if (buffer.trim()) {
      const parsed = parseSSE(buffer);
      if (parsed) callbacks?.onEvent(parsed);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // User cancelled — not an error
      return;
    }
    callbacks?.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function streamRegenerate(
  conversationId: string,
  messageId: string,
  callbacks?: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${BASE}/conversations/${conversationId}/messages/${messageId}/regenerate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal,
    },
  );

  if (!res.ok || !res.body) {
    let detail = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // not JSON
    }
    callbacks?.onError(new ApiError(res.status, detail));
    return;
  }

  await readSSEStream(res, callbacks);
}

export async function streamEditMessage(
  conversationId: string,
  messageId: string,
  content: string,
  callbacks?: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${BASE}/conversations/${conversationId}/messages/${messageId}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal,
    },
  );

  if (!res.ok || !res.body) {
    let detail = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // not JSON
    }
    callbacks?.onError(new ApiError(res.status, detail));
    return;
  }

  await readSSEStream(res, callbacks);
}

async function readSSEStream(
  res: Response,
  callbacks?: StreamCallbacks,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) {
        const parsed = parseSSE(raw);
        if (parsed) callbacks?.onEvent(parsed);
      }
    }
    if (buffer.trim()) {
      const parsed = parseSSE(buffer);
      if (parsed) callbacks?.onEvent(parsed);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    callbacks?.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function parseSSE(raw: string): StreamEvent | null {
  const lines = raw.split("\n");
  let eventType = "";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) eventType = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!eventType || !data) return null;
  try {
    return JSON.parse(data.trim()) as StreamEvent;
  } catch {
    return null;
  }
}

export { ApiError };
export type { ConversationSummary };
