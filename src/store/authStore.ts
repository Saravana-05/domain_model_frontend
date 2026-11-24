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
  /** System role from the JWT: PRODUCT_ADMIN | ORG_ADMIN | USER */
  role: string;
  orgId: string | null;
  /** Names of the RBAC roles assigned to this user (e.g. ["Manager"]) */
  roles?: string[];
  /** Effective permissions = union of the permissions of all assigned roles */
  permissions: UserPermission[];
}

/** System roles that bypass every permission check — must match ADMIN_ROLES
 *  in the backend (app/services/rbac_service.py). */
export const ADMIN_ROLES = ["PRODUCT_ADMIN", "ORG_ADMIN"];
export const isAdminRole = (role?: string | null) => !!role && ADMIN_ROLES.includes(role);

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  /** Replace roles/permissions after a server refresh (called from App.tsx after /auth/me) */
  setAuthContext: (ctx: { roles?: string[]; permissions?: UserPermission[] }) => void;
  isAdmin: () => boolean;
  hasPermission: (resource: string, action: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,

      login: (token, user) => set({ token, user }),

      logout: () => set({ token: null, user: null }),

      setAuthContext: (ctx) =>
        set((s) =>
          s.user
            ? {
                user: {
                  ...s.user,
                  roles: ctx.roles ?? s.user.roles,
                  permissions: ctx.permissions ?? s.user.permissions,
                },
              }
            : s
        ),

      isAdmin: () => isAdminRole(get().user?.role),

      hasPermission: (resource, action) => {
        const { user } = get();
        if (!user) return false;
        if (isAdminRole(user.role)) return true;
        return (user.permissions ?? []).some(
          (p) =>
            p.resource.toLowerCase() === resource.toLowerCase() &&
            p.action.toLowerCase() === action.toLowerCase()
        );
      },
    }),
    { name: "auth-store" }
  )
);