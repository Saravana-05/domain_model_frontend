/**
 * Projects API client — talks to the FastAPI /projects endpoints.
 *
 * A project is a container that domain models (see datastoreApi.ts) can
 * optionally be created inside of. Kept as a self-contained file, same
 * reasoning as datastoreApi.ts's own duplication note: easy to read in
 * isolation, one clear place to change if the backend's shape changes.
 */

import { useAuthStore } from "../../store/authStore";

const API_BASE = import.meta.env.VITE_API_URL || "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";
const STATIC_TOKEN: string = import.meta.env.VITE_API_TOKEN || "";

function resolveToken(): string | null {
  return useAuthStore.getState().token || STATIC_TOKEN || null;
}

export interface BackendProject {
  id:          string;
  name:        string;
  description?: string | null;
  created_at?:  string | null;
  updated_at?:  string | null;
}

interface ApiResult<T> {
  status:  string;
  message?: string;
  data?:   T;
  count?:  number;
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
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/** POST /projects — create a project */
export async function apiCreateProject(name: string, description?: string): Promise<ApiResult<BackendProject>> {
  return apiFetch("/projects", {
    method: "POST",
    body:   JSON.stringify({ name, description: description ?? null }),
  });
}

/** GET /projects — list all projects */
export async function apiListProjects(): Promise<ApiResult<BackendProject[]>> {
  return apiFetch("/projects");
}

/** GET /projects/{id} — get one project */
export async function apiGetProject(projectId: string): Promise<ApiResult<BackendProject>> {
  return apiFetch(`/projects/${projectId}`);
}

/** PUT /projects/{id} — update a project */
export async function apiUpdateProject(
  projectId: string,
  payload: { name?: string; description?: string },
): Promise<ApiResult<BackendProject>> {
  return apiFetch(`/projects/${projectId}`, {
    method: "PUT",
    body:   JSON.stringify(payload),
  });
}

/** DELETE /projects/{id} — delete a project */
export async function apiDeleteProject(projectId: string): Promise<ApiResult<null>> {
  return apiFetch(`/projects/${projectId}`, { method: "DELETE" });
}