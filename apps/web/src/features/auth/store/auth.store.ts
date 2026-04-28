import { create } from "zustand";

type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

type AuthState = {
  status: AuthStatus;
  userEmail: string | null;
  markAuthenticated: (email?: string | null) => void;
  markUnauthenticated: () => void;
  resetAuth: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  userEmail: null,

  markAuthenticated: (email) =>
    set({
      status: "authenticated",
      userEmail: email ?? null,
    }),

  markUnauthenticated: () =>
    set({
      status: "unauthenticated",
      userEmail: null,
    }),

  resetAuth: () =>
    set({
      status: "unknown",
      userEmail: null,
    }),
}));
