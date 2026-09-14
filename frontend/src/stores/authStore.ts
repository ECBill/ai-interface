import { create } from "zustand";
import type { User } from "../types";
import { authApi } from "../api/client";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  checkSession: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,
  initialized: false,

  checkSession: async () => {
    try {
      const user = await authApi.me();
      set({ user, initialized: true });
      return true;
    } catch {
      set({ user: null, initialized: true });
      return false;
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const user = await authApi.login(email, password);
      set({ user, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "登录失败",
      });
      throw err;
    }
  },

  register: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const user = await authApi.register(email, password);
      set({ user, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "注册失败",
      });
      throw err;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));
