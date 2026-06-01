import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserPermission {
  resource: string;
  action: string;
}

export interface AuthUser {
  userId: string;
  userName: string;
  email: string;
  role: string;
  orgId: string | null;
  permissions: UserPermission[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  hasPermission: (resource: string, action: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,

      login: (token, user) => set({ token, user }),

      logout: () => set({ token: null, user: null }),

      hasPermission: (resource, action) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === "PRODUCT_ADMIN") return true;
        return user.permissions.some(
          (p) =>
            p.resource.toLowerCase() === resource.toLowerCase() &&
            p.action.toLowerCase() === action.toLowerCase()
        );
      },
    }),
    { name: "auth-store" }
  )
);
