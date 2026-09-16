import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authAPI } from './services/api';
import { queryClient } from './lib/queryClient';

// Shared devices (lab PCs) log a new student in on the same tab without a
// full page reload. Neither React Query's in-memory cache nor per-test
// draft answers are scoped by user id, so without an explicit wipe here
// the next person to log in can briefly see the previous student's
// "already submitted" status, submissions, or in-progress answers.
function clearPerUserClientState() {
  queryClient.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ct:draft:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* localStorage unavailable (private mode, etc.) */ }
}

export const useStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      // False until the initial refreshUser() (below) has resolved. `user`
      // is no longer persisted/hydrated synchronously (see the storage note
      // on the persist config), so on first mount it's briefly null even
      // for a tab that's genuinely still logged in — routes must wait for
      // this instead of treating that null as "logged out" and bouncing to
      // /login (see App.jsx).
      authReady: false,

      setUser: (user) => set({ user }),

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const { token, user } = await authAPI.login({ email, password });
          clearPerUserClientState();
          sessionStorage.setItem('pp_token', token);
          set({ user, token, isLoading: false });
          return { user };
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      register: async (name, email, password, department, extra = {}) => {
        set({ isLoading: true });
        try {
          const { token, user } = await authAPI.register({ name, email, password, department, ...extra });
          clearPerUserClientState();
          sessionStorage.setItem('pp_token', token);
          set({ user, token, isLoading: false });
          return { user };
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      googleLogin: async (credential) => {
        set({ isLoading: true });
        try {
          const { token, user, needsProfileCompletion } = await authAPI.googleLogin(credential);
          clearPerUserClientState();
          sessionStorage.setItem('pp_token', token);
          set({ user, token, isLoading: false });
          return { user, needsProfileCompletion: needsProfileCompletion ?? !user.profileComplete };
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      completeProfile: async (data) => {
        set({ isLoading: true });
        try {
          const { user } = await authAPI.completeProfile(data);
          set({ user, isLoading: false });
          return { user };
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        try { await authAPI.logout(); } catch {}
        sessionStorage.removeItem('pp_token');
        clearPerUserClientState();
        set({ user: null, token: null });
      },

      // Permanently deletes the signed-in student's account server-side,
      // then logs the (now nonexistent) session out client-side the same
      // way `logout()` does.
      deleteAccount: async (data) => {
        const res = await authAPI.deleteAccount(data);
        sessionStorage.removeItem('pp_token');
        clearPerUserClientState();
        set({ user: null, token: null });
        return res;
      },

      // Re-derives `user` from the token on every fresh mount instead of
      // trusting a persisted `user` object — see the storage note below on
      // why the session token itself isn't persisted across tabs either.
      // Always resolves `authReady: true`, whether or not a token existed,
      // so App.jsx knows when it's safe to decide "logged out" vs. "still
      // checking".
      refreshUser: async () => {
        const token = sessionStorage.getItem('pp_token');
        if (!token) { set({ authReady: true }); return; }
        try {
          const { user } = await authAPI.getMe();
          set({ user, token, authReady: true });
        } catch {
          sessionStorage.removeItem('pp_token');
          set({ user: null, token: null, authReady: true });
        }
      },

      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      // Accessibility & preferences
      preferences: {
        onboardingCompleted: false,
      },
      updatePreference: (key, value) => set((s) => ({
        preferences: { ...s.preferences, [key]: value },
      })),
      completeOnboarding: () => set((s) => ({
        preferences: { ...s.preferences, onboardingCompleted: true },
      })),
    }),
    {
      name: 'pp-store',
      // `user`/`token` are deliberately NOT persisted here. This app runs on
      // shared lab PCs during proctored tests — if a logged-in identity
      // survived in localStorage, the next student to open the browser
      // (without ever hitting the login form, since a truthy `user` skips
      // straight past it) would silently continue as the previous student:
      // "already submitted" for a test they never took, and any test they
      // DO attempt gets recorded under the wrong account. Instead, only the
      // JWT lives in sessionStorage (tab-scoped, gone when the tab closes)
      // and `refreshUser()` re-derives `user` from it on every fresh mount —
      // see store.js's App.jsx caller and services/api.js's interceptor.
      partialize: (s) => ({
        preferences: s.preferences,
      }),
    }
  )
);
