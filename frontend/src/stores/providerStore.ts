import { create } from "zustand";
import type { ProviderStatus } from "../types";
import { providerApi } from "../api/client";

interface ProviderState {
  providers: ProviderStatus[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  saveCredentials: (
    providerId: string,
    apiKey: string,
    baseUrl?: string | null,
    models?: string[],
  ) => Promise<void>;
  validate: (providerId: string, model?: string) => Promise<string>;
  revoke: (providerId: string) => Promise<void>;
  getConfiguredModels: () => { providerId: string; model: string }[];
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await providerApi.list();
      set({ providers: data.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "供应商加载失败",
      });
    }
  },

  saveCredentials: async (providerId, apiKey, baseUrl, models) => {
    const updated = await providerApi.saveCredentials(providerId, apiKey, baseUrl, models);
    set((state) => ({
      providers: state.providers.map((p) => (p.id === providerId ? updated : p)),
    }));
  },

  validate: async (providerId, model) => {
    const result = await providerApi.validate(providerId, model);
    return `${result.message} · ${result.model} · ${result.latencyMs}ms`;
  },

  revoke: async (providerId) => {
    await providerApi.revoke(providerId);
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId
          ? { ...p, configured: false, keyFingerprint: null, models: [] }
          : p,
      ),
    }));
  },

  getConfiguredModels: () => {
    return get()
      .providers.filter((p) => p.configured && p.models.length > 0)
      .flatMap((p) => p.models.map((m) => ({ providerId: p.id, model: m })));
  },
}));
