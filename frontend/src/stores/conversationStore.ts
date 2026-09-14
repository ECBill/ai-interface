import { create } from "zustand";
import type {
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  GenerationParameters,
  StreamEvent,
} from "../types";
import {
  conversationApi,
  streamMessage,
  streamRegenerate,
  streamEditMessage,
} from "../api/client";
import { usePreferenceStore } from "./preferenceStore";

// ── Streaming state per conversation ──────────────────
interface StreamState {
  abortController: AbortController | null;
  activeMessageId: string | null;
  status: "idle" | "connecting" | "thinking" | "answering" | "done" | "error" | "cancelled";
  warnings: string[];
}

interface ConversationState {
  conversations: ConversationSummary[];
  activeConversation: ConversationDetail | null;
  messages: Record<string, ChatMessage[]>; // conversationId -> messages
  loadingConversations: boolean;
  loadingMessages: boolean;
  searchQuery: string;
  streams: Record<string, StreamState>; // conversationId -> stream state

  // Actions
  loadConversations: () => Promise<void>;
  createConversation: (data?: {
    providerId?: string;
    model?: string;
    system?: string;
  }) => Promise<ConversationDetail>;
  selectConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  patchConversation: (
    id: string,
    data: Partial<{
      title: string;
      providerId: string;
      model: string;
      system: string;
      parameters: GenerationParameters;
    }>,
  ) => Promise<void>;
  loadMessages: (id: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  sendMessage: (conversationId: string, content: string, options?: {
    providerId?: string;
    model?: string;
    system?: string;
    parameters?: GenerationParameters;
  }) => Promise<void>;
  regenerateMessage: (conversationId: string, messageId: string) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, content: string) => Promise<void>;
  stopStreaming: (conversationId: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  getStreamState: (conversationId: string) => StreamState;
  isStreaming: (conversationId: string) => boolean;
}

function defaultStreamState(): StreamState {
  return {
    abortController: null,
    activeMessageId: null,
    status: "idle",
    warnings: [],
  };
}

function updateMessageInState(
  state: Record<string, ChatMessage[]>,
  conversationId: string,
  messageId: string,
  updater: (msg: ChatMessage) => ChatMessage,
): Record<string, ChatMessage[]> {
  const msgs = state[conversationId];
  if (!msgs) return state;
  return {
    ...state,
    [conversationId]: msgs.map((m) => (m.id === messageId ? updater(m) : m)),
  };
}

function appendMessageToState(
  state: Record<string, ChatMessage[]>,
  conversationId: string,
  message: ChatMessage,
): Record<string, ChatMessage[]> {
  const msgs = state[conversationId] || [];
  return { ...state, [conversationId]: [...msgs, message] };
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messages: {},
  loadingConversations: false,
  loadingMessages: false,
  searchQuery: "",
  streams: {},

  loadConversations: async () => {
    set({ loadingConversations: true });
    try {
      const data = await conversationApi.list(50);
      set({ conversations: data.items, loadingConversations: false });
    } catch {
      set({ loadingConversations: false });
    }
  },

  createConversation: async (data) => {
    const conv = await conversationApi.create(data || {});
    set((state) => ({
      conversations: [
        {
          id: conv.id,
          title: conv.title,
          providerId: conv.providerId,
          model: conv.model,
          messageCount: conv.messageCount,
          lastMessagePreview: conv.lastMessagePreview,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          lastMessageAt: conv.lastMessageAt,
        },
        ...state.conversations,
      ],
      activeConversation: conv,
      messages: { ...state.messages, [conv.id]: [] },
    }));
    usePreferenceStore.getState().updateDebounced({ lastConversationId: conv.id });
    return conv;
  },

  selectConversation: async (id) => {
    // Don't stop existing streams — they continue in background
    try {
      const conv = await conversationApi.get(id);
      set({ activeConversation: conv });
      await get().loadMessages(id);
      usePreferenceStore.getState().updateDebounced({ lastConversationId: id });
    } catch {
      set({ activeConversation: null });
    }
  },

  renameConversation: async (id, title) => {
    const conv = await conversationApi.patch(id, { title });
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              title: conv.title,
              providerId: conv.providerId,
              model: conv.model,
              messageCount: conv.messageCount,
              lastMessagePreview: conv.lastMessagePreview,
              updatedAt: conv.updatedAt,
              lastMessageAt: conv.lastMessageAt,
            }
          : c,
      ),
      activeConversation: state.activeConversation?.id === id ? conv : state.activeConversation,
    }));
  },

  deleteConversation: async (id) => {
    await conversationApi.delete(id);
    set((state) => {
      const conversations = state.conversations.filter((c) => c.id !== id);
      const messages = { ...state.messages };
      delete messages[id];
      const streams = { ...state.streams };
      delete streams[id];
      const activeConversation =
        state.activeConversation?.id === id ? null : state.activeConversation;
      return { conversations, messages, streams, activeConversation };
    });
  },

  patchConversation: async (id, data) => {
    const conv = await conversationApi.patch(id, data);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              title: conv.title,
              providerId: conv.providerId,
              model: conv.model,
              messageCount: conv.messageCount,
              lastMessagePreview: conv.lastMessagePreview,
              updatedAt: conv.updatedAt,
              lastMessageAt: conv.lastMessageAt,
            }
          : c,
      ),
      activeConversation: state.activeConversation?.id === id ? conv : state.activeConversation,
    }));
  },

  loadMessages: async (id) => {
    set({ loadingMessages: true });
    try {
      const data = await conversationApi.messages(id, 50);
      set((state) => ({
        messages: { ...state.messages, [id]: data.items },
        loadingMessages: false,
      }));
    } catch {
      set({ loadingMessages: false });
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  sendMessage: async (conversationId, content, options) => {
    const abortController = new AbortController();
    set((state) => ({
      streams: {
        ...state.streams,
        [conversationId]: {
          abortController,
          activeMessageId: null,
          status: "connecting",
          warnings: [],
        },
      },
    }));

    let assistantId: string | null = null;
    let sendError: Error | null = null;

    await streamMessage(
      conversationId,
      content,
      options,
      {
        onEvent: (event: StreamEvent) => {
          handleStreamEvent(event, conversationId, set, get, (id) => {
            assistantId = id;
          });
        },
        onError: (error: Error) => {
          sendError = error;
          set((state) => ({
            streams: {
              ...state.streams,
              [conversationId]: {
                ...defaultStreamState(),
                status: "error",
              },
            },
          }));
          if (assistantId) {
            set((state) => ({
              messages: updateMessageInState(state.messages, conversationId, assistantId!, (m) => ({
                ...m,
                status: "failed",
                errorCode: error.message,
              })),
            }));
          }
        },
      },
      abortController.signal,
    );

    // Refresh conversation list to update previews/ordering
    get().loadConversations();

    if (sendError) throw sendError;
  },

  regenerateMessage: async (conversationId, messageId) => {
    const abortController = new AbortController();
    set((state) => ({
      streams: {
        ...state.streams,
        [conversationId]: {
          abortController,
          activeMessageId: null,
          status: "connecting",
          warnings: [],
        },
      },
    }));

    let assistantId: string | null = null;

    await streamRegenerate(
      conversationId,
      messageId,
      {
        onEvent: (event: StreamEvent) => {
          handleStreamEvent(event, conversationId, set, get, (id) => {
            assistantId = id;
          });
        },
        onError: (error: Error) => {
          set((state) => ({
            streams: {
              ...state.streams,
              [conversationId]: { ...defaultStreamState(), status: "error" },
            },
          }));
          if (assistantId) {
            set((state) => ({
              messages: updateMessageInState(state.messages, conversationId, assistantId!, (m) => ({
                ...m,
                status: "failed",
                errorCode: error.message,
              })),
            }));
          }
        },
      },
      abortController.signal,
    );

    get().loadConversations();
  },

  editMessage: async (conversationId, messageId, content) => {
    const abortController = new AbortController();
    set((state) => ({
      streams: {
        ...state.streams,
        [conversationId]: {
          abortController,
          activeMessageId: null,
          status: "connecting",
          warnings: [],
        },
      },
    }));

    let assistantId: string | null = null;

    await streamEditMessage(
      conversationId,
      messageId,
      content,
      {
        onEvent: (event: StreamEvent) => {
          handleStreamEvent(event, conversationId, set, get, (id) => {
            assistantId = id;
          });
        },
        onError: (error: Error) => {
          set((state) => ({
            streams: {
              ...state.streams,
              [conversationId]: { ...defaultStreamState(), status: "error" },
            },
          }));
          if (assistantId) {
            set((state) => ({
              messages: updateMessageInState(state.messages, conversationId, assistantId!, (m) => ({
                ...m,
                status: "failed",
                errorCode: error.message,
              })),
            }));
          }
        },
      },
      abortController.signal,
    );

    // Reload messages to reflect the edited user message and superseded state
    get().loadMessages(conversationId);
    get().loadConversations();
  },

  stopStreaming: (conversationId) => {
    const stream = get().streams[conversationId];
    if (stream?.abortController) {
      stream.abortController.abort();
    }
    set((state) => ({
      streams: {
        ...state.streams,
        [conversationId]: {
          ...defaultStreamState(),
          status: "cancelled",
        },
      },
    }));
    // Mark active assistant message as cancelled
    const msgs = get().messages[conversationId];
    if (msgs) {
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant" && m.status === "streaming");
      if (lastAssistant) {
        set((state) => ({
          messages: updateMessageInState(state.messages, conversationId, lastAssistant.id, (m) => ({
            ...m,
            status: "cancelled",
          })),
        }));
      }
    }
  },

  deleteMessage: async (conversationId, messageId) => {
    await conversationApi.deleteMessage(conversationId, messageId);
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).filter(
          (m) => m.id !== messageId,
        ),
      },
    }));
  },

  getStreamState: (conversationId) => {
    return get().streams[conversationId] || defaultStreamState();
  },

  isStreaming: (conversationId) => {
    const s = get().streams[conversationId];
    return s?.status === "connecting" || s?.status === "thinking" || s?.status === "answering";
  },
}));

// ── Stream event handler ──────────────────────────────
function handleStreamEvent(
  event: StreamEvent,
  conversationId: string,
  set: (fn: (state: ConversationState) => Partial<ConversationState>) => void,
  _get: () => ConversationState,
  setAssistantId: (id: string) => void,
) {
  switch (event.type) {
    case "user_message": {
      set((state) => ({
        messages: appendMessageToState(state.messages, conversationId, event.message),
      }));
      break;
    }
    case "start": {
      setAssistantId(event.messageId);
      const placeholder: ChatMessage = {
        id: event.messageId,
        conversationId,
        seq: 0,
        role: "assistant",
        content: "",
        thinking: "",
        status: "streaming",
        providerId: event.providerId,
        model: event.model,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        messages: appendMessageToState(state.messages, conversationId, placeholder),
        streams: {
          ...state.streams,
          [conversationId]: {
            ...state.streams[conversationId],
            activeMessageId: event.messageId,
            status: "connecting",
          },
        },
      }));
      break;
    }
case "warning": {
       set((state) => {
         const s = state.streams[conversationId];
         if (!s) return { streams: { ...state.streams, [conversationId]: { abortController: null, activeMessageId: null, status: "idle", warnings: [event.message] } } };
         return {
           streams: {
             ...state.streams,
             [conversationId]: { ...s, warnings: [...s.warnings, event.message] },
           },
         };
       });
       break;
     }
case "status": {
       set((state) => {
         const s = state.streams[conversationId];
         if (!s) return { streams: { ...state.streams, [conversationId]: { abortController: null, activeMessageId: null, status: event.value, warnings: [] } } };
         return {
           streams: {
             ...state.streams,
             [conversationId]: { ...s, status: event.value },
           },
         };
       });
       break;
     }
    case "reasoning_delta": {
      set((state) => ({
        messages: updateMessageInState(state.messages, conversationId, event.messageId, (m) => ({
          ...m,
          thinking: (m.thinking || "") + event.text,
          status: "streaming",
        })),
      }));
      break;
    }
    case "answer_delta": {
      set((state) => ({
        messages: updateMessageInState(state.messages, conversationId, event.messageId, (m) => ({
          ...m,
          content: m.content + event.text,
          status: "streaming",
        })),
      }));
      break;
    }
    case "usage": {
      set((state) => ({
        messages: updateMessageInState(state.messages, conversationId, event.messageId, (m) => ({
          ...m,
          inputTokens: event.inputTokens ?? m.inputTokens,
          outputTokens: event.outputTokens ?? m.outputTokens,
          totalTokens: event.totalTokens ?? m.totalTokens,
        })),
      }));
      break;
    }
    case "done": {
      set((state) => ({
        messages: updateMessageInState(state.messages, conversationId, event.messageId, (m) => ({
          ...m,
          status: "succeeded",
          latencyMs: event.latencyMs,
          firstTokenMs: event.firstTokenMs ?? m.firstTokenMs,
          finishReason: event.finishReason ?? m.finishReason,
        })),
      }));
      set((state) => {
        const s = state.streams[conversationId];
        if (!s) return {};
        return {
          streams: {
            ...state.streams,
            [conversationId]: { ...defaultStreamState(), status: "done" },
          },
        };
      });
      break;
    }
    case "error": {
      set((state) => ({
        messages: updateMessageInState(state.messages, conversationId, event.messageId, (m) => ({
          ...m,
          status: "failed",
          errorCode: event.code,
        })),
      }));
      set((state) => {
        const s = state.streams[conversationId];
        if (!s) return {};
        return {
          streams: {
            ...state.streams,
            [conversationId]: { ...defaultStreamState(), status: "error" },
          },
        };
      });
      break;
    }
  }
}
