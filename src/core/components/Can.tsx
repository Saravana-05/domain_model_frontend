import type { ReactNode } from "react";
import { useAuthStore } from "../../store/authStore";

/**
 * Set to false to let every signed-in user design projects / modules / domain
 * models (the old behaviour). When true, designing needs an admin role OR the
 * `edit` action on a resource named DESIGNER_RESOURCE (create that resource in
 * RBAC Admin → Resources, then grant it to a role).
 */
export const RESTRICT_DOMAIN_DESIGN = true;
export const DESIGNER_RESOURCE = "domain_model";

/**
 * Hook: does the signed-in user hold `action` on `resource`?
 *
 *   const canEdit = usePermission("Employee", "edit");
 *
 * Admins (PRODUCT_ADMIN / ORG_ADMIN) always pass. Resource names are matched
 * case-insensitively. The selector returns a boolean, so the component
 * re-renders exactly when the answer changes (e.g. after /auth/me refreshes
 * the permission list).
 *
 * This only controls what the UI shows — the backend re-checks every request.
 */
export function usePermission(resource: string, action: string): boolean {
  return useAuthStore((s) => s.hasPermission(resource, action));
}

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.isAdmin());
}

/** Can the user create/edit/delete projects, modules and domain models? */
export function useCanDesign(): boolean {
  return useAuthStore((s) => {
    if (!s.user) return false;
    if (!RESTRICT_DOMAIN_DESIGN) return true;
    return s.isAdmin() || s.hasPermission(DESIGNER_RESOURCE, "edit");
  });
}

/**
 * Render children only if the user may perform `action` on `resource`.
 *
 *   <Can resource="Employee" action="delete"><button>Delete</button></Can>
 *   <Can resource="Employee" action="edit" fallback={<span>Read only</span>}>…</Can>
 */
export function Can({
  resource,
  action,
  fallback = null,
  children,
}: {
  resource: string;
  action: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const allowed = usePermission(resource, action);
  return <>{allowed ? children : fallback}</>;
}

/** Render children only for admins. */
export function AdminOnly({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return <>{useIsAdmin() ? children : fallback}</>;
}

/** Render children only if the user may design projects / modules / domains. */
export function DesignerOnly({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return <>{useCanDesign() ? children : fallback}</>;
}