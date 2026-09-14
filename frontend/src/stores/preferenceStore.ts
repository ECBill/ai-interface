import { create } from "zustand";
import type { UserPreferences } from "../types";
import { preferenceApi } from "../api/client";

interface PreferenceState {
  prefs: UserPreferences | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<UserPreferences>;
  update: (data: Partial<UserPreferences>) => Promise<void>;
  updateDebounced: (data: Partial<UserPreferences>) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUpdate: Partial<UserPreferences> = {};

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
  prefs: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const prefs = await preferenceApi.get();
      set({ prefs, loading: false });
      return prefs;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "偏好加载失败",
      });
      throw err;
    }
  },

  update: async (data) => {
    try {
      const updated = await preferenceApi.update(data);
      set({ prefs: updated });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "偏好更新失败",
      });
    }
  },

  updateDebounced: (data) => {
    pendingUpdate = { ...pendingUpdate, ...data };
    // Apply locally immediately
    if (get().prefs) {
      set({ prefs: { ...get().prefs!, ...data } });
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const toSend = { ...pendingUpdate };
      pendingUpdate = {};
      get().update(toSend);
    }, 800);
  },
}));
