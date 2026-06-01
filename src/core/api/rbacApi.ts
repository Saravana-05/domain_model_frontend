import { useAuthStore } from "../../store/authStore";

const API_BASE = import.meta.env.VITE_API_URL || "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";
const STATIC_TOKEN: string = import.meta.env.VITE_API_TOKEN || "";

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token || STATIC_TOKEN || "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401) {
      // Token expired — clear auth state so the login screen re-appears
      useAuthStore.getState().logout();
    }
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Resources ─────────────────────────────────────────────────────────────────

export async function apiListResources() {
  return apiFetch("/rbac/resources");
}

export async function apiCreateResource(name: string, description?: string) {
  return apiFetch("/rbac/resources", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export async function apiDeleteResource(id: string) {
  return apiFetch(`/rbac/resources/${id}`, { method: "DELETE" });
}

// ── Permissions ───────────────────────────────────────────────────────────────

export async function apiListPermissions(resourceId?: string) {
  const qs = resourceId ? `?resource_id=${resourceId}` : "";
  return apiFetch(`/rbac/permissions${qs}`);
}

export async function apiCreatePermission(resourceId: string, action: string, description?: string) {
  return apiFetch("/rbac/permissions", {
    method: "POST",
    body: JSON.stringify({ resource_id: resourceId, action, description }),
  });
}

export async function apiDeletePermission(id: string) {
  return apiFetch(`/rbac/permissions/${id}`, { method: "DELETE" });
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export async function apiListRoles() {
  return apiFetch("/rbac/roles");
}

export async function apiCreateRole(name: string, description?: string) {
  return apiFetch("/rbac/roles", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export async function apiDeleteRole(id: string) {
  return apiFetch(`/rbac/roles/${id}`, { method: "DELETE" });
}

export async function apiGetRole(id: string) {
  return apiFetch(`/rbac/roles/${id}`);
}

export async function apiSetRolePermissions(roleId: string, permissionIds: string[]) {
  return apiFetch(`/rbac/roles/${roleId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permission_ids: permissionIds }),
  });
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function apiListUsers() {
  return apiFetch("/rbac/users");
}

export async function apiGetUserRoles(userId: string) {
  return apiFetch(`/rbac/users/${userId}/roles`);
}

export async function apiSetUserRoles(userId: string, roleIds: string[]) {
  return apiFetch(`/rbac/users/${userId}/roles`, {
    method: "PUT",
    body: JSON.stringify({ role_ids: roleIds }),
  });
}

export async function apiGetUserPermissions(userId: string) {
  return apiFetch(`/rbac/users/${userId}/permissions`);
}
