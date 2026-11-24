/**
 * Modules API client — talks to the FastAPI /projects/{id}/modules and
 * /modules endpoints.
 *
 * Hierarchy:  Project → Module → Domain model
 * A module always lives inside exactly one project and groups that
 * project's domain models (see datastoreApi.ts — `module_id`).
 */

import { useAuthStore } from "../../store/authStore";

const API_BASE = import.meta.env.VITE_API_URL || "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";
const STATIC_TOKEN: string = import.meta.env.VITE_API_TOKEN || "";

function resolveToken(): string | null {
  return useAuthStore.getState().token || STATIC_TOKEN || null;
}

export interface BackendModule {
  id:           string;
  project_id:   string;
  name:         string;
  description?: string | null;
  created_at?:  string | null;
  updated_at?:  string | null;
}

interface ApiResult<T> {
  status:   string;
  message?: string;
  data?:    T;
  count?:   number;
}

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const token = resolveToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers, ...init });
  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout();
    }
    // FastAPI errors look like {"detail": "..."} — surface just the message.
    const text = await res.text().catch(() => res.statusText);
    let detail = text;
    try { detail = JSON.parse(text)?.detail ?? text; } catch { /* not JSON */ }
    throw new Error(typeof detail === "string" ? detail : `API ${res.status}: ${text}`);
  }
  return res.json();
}

/** POST /projects/{projectId}/modules — create a module inside a project */
export async function apiCreateModule(
  projectId: string, name: string, description?: string,
): Promise<ApiResult<BackendModule>> {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}/modules`, {
    method: "POST",
    body:   JSON.stringify({ name, description: description ?? null }),
  });
}

/** GET /projects/{projectId}/modules — list a project's modules */
export async function apiListModules(projectId: string): Promise<ApiResult<BackendModule[]>> {
  return apiFetch(`/projects/${encodeURIComponent(projectId)}/modules`);
}

/** GET /modules — list every module across all projects (used for name lookups when no project is selected) */
export async function apiListAllModules(): Promise<ApiResult<BackendModule[]>> {
  return apiFetch("/modules");
}

/** GET /modules/{id} — get one module */
export async function apiGetModule(moduleId: string): Promise<ApiResult<BackendModule>> {
  return apiFetch(`/modules/${encodeURIComponent(moduleId)}`);
}

/** PUT /modules/{id} — update a module */
export async function apiUpdateModule(
  moduleId: string,
  payload: { name?: string; description?: string },
): Promise<ApiResult<BackendModule>> {
  return apiFetch(`/modules/${encodeURIComponent(moduleId)}`, {
    method: "PUT",
    body:   JSON.stringify(payload),
  });
}

/** DELETE /modules/{id} — delete a module (backend refuses while it still has domain models) */
export async function apiDeleteModule(moduleId: string): Promise<ApiResult<null>> {
  return apiFetch(`/modules/${encodeURIComponent(moduleId)}`, { method: "DELETE" });
}