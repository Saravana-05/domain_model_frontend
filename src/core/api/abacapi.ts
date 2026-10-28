/**
 * Frontend client for the domain ABAC API (backend: app/routers/abac_routes.py)
 * and the role list (backend: GET /rbac/roles).
 *
 * Lives next to datastoreApi.ts (src/api/abacApi.ts).
 *
 * All requests go through the shared apiFetch() from datastoreApi.ts, so they
 * use the same base URL and the same auth token (useAuthStore → Bearer header),
 * and get the same 401 → logout / 403 → PermissionError handling.
 */
import { apiFetch } from "./datastoreApi";

/**
 * A rule as sent to / returned from the backend. Structurally the same as
 * DomainPermissionRule in DomainPermissionsPanel.tsx — kept as a loose type
 * here so this file needs no import path from the SchemaInspector folder.
 */
type DomainPermissionRule = any;

/**
 * apiFetch throws `Error("API <status>: <raw body>")` for non-403 failures.
 * Pull the backend's `detail` text out so the UI toast shows a clean
 * message instead of raw JSON. PermissionError (403) passes through as-is.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return (await apiFetch(path, init)) as T;
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const m = msg.match(/^API (\d+): (.*)$/s);
    if (m) {
      let detail = m[2];
      try {
        const parsed = JSON.parse(m[2]);
        if (typeof parsed?.detail === "string") detail = parsed.detail;
      } catch { /* body wasn't JSON — keep raw text */ }
      throw new Error(detail || `Request failed (${m[1]})`);
    }
    throw err;
  }
}

/** Rules of one domain model. */
export async function apiGetDomainAbac(domainName: string): Promise<DomainPermissionRule[]> {
  const res = await request<{ data: DomainPermissionRule[] }>(
    `/abac/domains/${encodeURIComponent(domainName)}`,
  );
  return res.data ?? [];
}

/** Replace the whole rule list of a domain model. Returns the saved rules (with server ids). */
export async function apiSaveDomainAbac(
  domainName: string,
  rules: DomainPermissionRule[],
  scope: { projectId?: string | null; moduleId?: string | null } = {},
): Promise<DomainPermissionRule[]> {
  const res = await request<{ data: DomainPermissionRule[] }>(
    `/abac/domains/${encodeURIComponent(domainName)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        rules,
        project_id: scope.projectId ?? null,
        module_id: scope.moduleId ?? null,
      }),
    },
  );
  return res.data ?? [];
}

/** Role names for the "Who can access (roles)" dropdown. */
export async function apiListRoleNames(): Promise<string[]> {
  const res = await request<{ data: { name: string }[] }>("/rbac/roles");
  return (res.data ?? []).map((r) => r.name);
}