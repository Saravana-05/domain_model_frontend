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

// ── Project users ─────────────────────────────────────────────────────────────
// Every project has its own user table (named after the project, e.g.
// idam.testing_user). Entering a user there links them to RBAC: project
// membership + roles that apply only inside that project. Admin-only.

export interface ProjectUserRole { id: string; name: string }

export interface ProjectUser {
  user_id:    string;
  user_name:  string;
  email:      string;
  is_active:  boolean;
  added_by?:  string | null;
  created_at?: string | null;
  roles:      ProjectUserRole[];
}

export interface ProjectUsersResult extends ApiResult<ProjectUser[]> {
  /** Name of the project's user table, e.g. "idam.testing_user" */
  table?: string | null;
}

/** GET /projects/{id}/users — rows of the project's user table */
export async function apiListProjectUsers(projectId: string): Promise<ProjectUsersResult> {
  return apiFetch(`/projects/${projectId}/users`);
}

/** POST /projects/{id}/users — add an existing user (user_id) or create one (new_user) */
export async function apiAddProjectUser(
  projectId: string,
  payload: {
    user_id?:  string;
    new_user?: { user_name: string; email: string; password: string };
    /** roles inside this project; omit to leave the user's roles unchanged */
    role_ids?: string[];
  },
): Promise<ApiResult<ProjectUser>> {
  return apiFetch(`/projects/${projectId}/users`, {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

/** PUT /projects/{id}/users/{userId}/roles — replace the user's roles in this project */
export async function apiSetProjectUserRoles(
  projectId: string,
  userId: string,
  roleIds: string[],
): Promise<ApiResult<ProjectUser>> {
  return apiFetch(`/projects/${projectId}/users/${userId}/roles`, {
    method: "PUT",
    body:   JSON.stringify({ role_ids: roleIds }),
  });
}

/** DELETE /projects/{id}/users/{userId} — remove the user from the project */
export async function apiRemoveProjectUser(projectId: string, userId: string): Promise<ApiResult<null>> {
  return apiFetch(`/projects/${projectId}/users/${userId}`, { method: "DELETE" });
}

/** Pull the readable message out of an "API 400: {"detail":"..."}" error. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.match(/\{.*\}/s);
  if (m) {
    try {
      const d = JSON.parse(m[0])?.detail;
      if (typeof d === "string") return d;
    } catch { /* fall through */ }
  }
  return msg || fallback;
}