import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import AddIcon from "@mui/icons-material/Add";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import {
  apiListRoles,
  apiCreateRole,
  apiDeleteRole,
  apiGetRole,
  apiSetRolePermissions,
  apiListResources,
  apiCreateResource,
  apiDeleteResource,
  apiCreatePermission,
  apiDeletePermission,
  apiListUsers,
  apiSetUserRoles,
  apiCreateUser,
} from "../../core/api/rbacApi";
import { apiListSchemas } from "../../core/api/datastoreApi";
import { apiGetDomainAbac, apiSaveDomainAbac } from "../../core/api/abacapi";
import { apiListProjects } from "../../core/api/projectApi";
import { apiListAllModules } from "../../core/api/moduleApi";
import { c, common, checkboxAccent } from "./rbacTheme";

/**
 * One RBAC admin screen (replaces Roles / Resources / Role Permissions / User Roles).
 *
 *   Header      title + [Assign Role] [Add Role]
 *   Tabs        Role Permissions · User Assignments · Roles · Resources
 *   Permissions matrix: resources (collapsible) × roles, one Save button
 */

// ── Types ──────────────────────────────────────────────────────────────────────
interface Permission { id: string; action: string }
interface Resource   { id: string; name: string; description?: string; permissions: Permission[] }
interface Role       { id: string; name: string; description?: string }
interface User       { user_id: string; user_name: string; email: string; roles: Role[] }
type Grants = Record<string, Set<string>>;
/** Where an RBAC resource comes from in the datastore */
interface SchemaSource { table: string; project?: string; module?: string; backend?: string; projectId?: string | null; moduleId?: string | null }
type Tab = "permissions" | "assignments" | "roles" | "resources";

const DEFAULT_ACTIONS = ["create", "view", "edit", "delete"];
const ACTION_ORDER = ["create", "view", "read", "edit", "update", "delete", "approve", "reject"];

// ── Helpers ────────────────────────────────────────────────────────────────────
const normalizeList = <T,>(val: any): T[] => {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
  return [];
};

const sortActions = (perms: Permission[]) =>
  [...perms].sort((a, b) => {
    const ai = ACTION_ORDER.indexOf(a.action), bi = ACTION_ORDER.indexOf(b.action);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const sameSet = (a?: Set<string>, b?: Set<string>) => {
  const x = a ?? new Set<string>(), y = b ?? new Set<string>();
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
};

const cloneGrants = (g: Grants): Grants => {
  const out: Grants = {};
  for (const [k, v] of Object.entries(g)) out[k] = new Set(v);
  return out;
};

function useIsNarrow(bp = 900) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < bp);
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < bp);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [bp]);
  return narrow;
}

// ════════════════════════════════════════════════════════════════════════════
// Main screen
// ════════════════════════════════════════════════════════════════════════════
export function RbacScreen() {
  const [roles, setRoles]         = useState<Role[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [users, setUsers]         = useState<User[]>([]);
  const [schemaNames, setSchemaNames] = useState<string[]>([]);
  const [sources, setSources]   = useState<Record<string, SchemaSource>>({});
  const [grants, setGrants]       = useState<Grants>({});
  const [saved, setSaved]         = useState<Grants>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [toast, setToast]     = useState("");
  const [tab, setTab]         = useState<Tab>("permissions");

  const [syncing, setSyncing] = useState<string | null>(null);
  const [showAddRole, setShowAddRole]     = useState(false);
  const [assignFor, setAssignFor]         = useState<{ open: boolean; userId?: string }>({ open: false });
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showImport, setShowImport]         = useState(false);
  const [exporting, setExporting]           = useState(false);
  const [exportText, setExportText]         = useState<string | null>(null);

  // Latest values for use inside async reloads (so unsaved edits survive a refresh)
  const grantsRef = useRef(grants); grantsRef.current = grants;
  const savedRef  = useRef(saved);  savedRef.current  = saved;
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  // ── Load everything ─────────────────────────────────────────────────────────
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError("");
    try {
      const [rolesRes, resRes, usersRes, schemaRes, projRes, modRes] = await Promise.all([
        apiListRoles(),
        apiListResources(),
        apiListUsers().catch(() => ({ data: [] })),
        apiListSchemas(null).catch(() => ({ schemas: [] })),   // null = every project, not just the selected one
        apiListProjects().catch(() => ({ data: [] })),
        apiListAllModules().catch(() => ({ data: [] })),
      ]);

      const roleList: Role[] = rolesRes.data ?? [];
      const resList: Resource[] = (resRes.data ?? []).map((r: any) => ({
        ...r, permissions: sortActions(normalizeList<Permission>(r.permissions)),
      }));
      const userList: User[] = (usersRes.data ?? []).map((u: any) => ({
        ...u, roles: normalizeList<Role>(u.roles),
      }));

      const roleGrants = await Promise.all(
        roleList.map((r) =>
          apiGetRole(r.id)
            .then((res) => ({ id: r.id, perms: (res.data?.permissions ?? []).map((p: any) => p.id) as string[] }))
            .catch(() => ({ id: r.id, perms: [] as string[] }))
        )
      );

      const fresh: Grants = {};
      for (const { id, perms } of roleGrants) fresh[id] = new Set(perms);

      // keep unsaved edits for roles the admin has already touched
      const nextGrants: Grants = {};
      for (const r of roleList) {
        const touched = r.id in grantsRef.current && !sameSet(grantsRef.current[r.id], savedRef.current[r.id]);
        nextGrants[r.id] = touched ? grantsRef.current[r.id] : new Set(fresh[r.id]);
      }

      setRoles(roleList);
      setResources(resList);
      setUsers(userList);
      const schemaList: any[] = (schemaRes as any).schemas ?? [];
      const projName = new Map<string, string>(((projRes as any).data ?? []).map((p: any) => [String(p.id), p.name]));
      const modName  = new Map<string, string>(((modRes as any).data ?? []).map((m: any) => [String(m.id), m.name]));
      const src: Record<string, SchemaSource> = {};
      for (const sc of schemaList) {
        src[String(sc.table_name).toLowerCase()] = {
          table:   sc.table_name,
          project: sc.project_id != null ? projName.get(String(sc.project_id)) ?? `Project ${sc.project_id}` : undefined,
          module:  sc.module_id  != null ? modName.get(String(sc.module_id))   ?? `Module ${sc.module_id}`   : undefined,
          backend: sc.db_backend,
          projectId: sc.project_id != null ? String(sc.project_id) : null,
          moduleId:  sc.module_id  != null ? String(sc.module_id)  : null,
        };
      }
      setSources(src);
      setSchemaNames(schemaList.map((s: any) => s.table_name as string));
      setSaved(fresh);
      setGrants(nextGrants);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-sync: any domain model without an RBAC resource gets one (create/view/edit/delete)
  // automatically. `tried` stops us retrying the same model forever if the backend rejects it.
  const tried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loading || syncing !== null) return;
    const have = new Set(resources.map((r) => r.name.toLowerCase()));
    const missing = schemaNames.filter((n) => !have.has(n.toLowerCase()) && !tried.current.has(n.toLowerCase()));
    if (!missing.length) return;
    missing.forEach((n) => tried.current.add(n.toLowerCase()));
    syncSchemas(missing, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, syncing, schemaNames, resources]);

  // ── Sync domain models (datastore schemas) into RBAC resources ─────────────
  async function syncSchemas(names: string[], auto = false) {
    if (!names.length) return;
    setSyncing(names.length === 1 ? names[0] : "__all__"); setError("");
    try {
      const byName = new Map(resources.map((r) => [r.name.toLowerCase(), r]));
      for (const n of names) {
        const existing = byName.get(n.toLowerCase());
        let id = existing?.id;
        if (!id) {
          const res = await apiCreateResource(cap(n), `Domain model: ${n}`);
          id = res.data.id as string;
        }
        for (const a of DEFAULT_ACTIONS) {
          if (!existing?.permissions.some((p) => p.action === a)) await apiCreatePermission(id!, a);
        }
      }
      if (!auto) flash(names.length === 1 ? `${cap(names[0])} synced` : `${names.length} domain models synced`);
    } catch (e: any) { setError(e.message); }
    finally { await load({ silent: true }); setSyncing(null); }
  }

  // ── Permission editing ──────────────────────────────────────────────────────
  const toggle = useCallback((roleId: string, permId: string) => {
    setGrants((prev) => {
      const next = cloneGrants(prev);
      const s = next[roleId] ?? (next[roleId] = new Set());
      s.has(permId) ? s.delete(permId) : s.add(permId);
      return next;
    });
  }, []);

  const toggleMany = useCallback((roleId: string, permIds: string[], on: boolean) => {
    setGrants((prev) => {
      const next = cloneGrants(prev);
      const s = next[roleId] ?? (next[roleId] = new Set());
      permIds.forEach((id) => (on ? s.add(id) : s.delete(id)));
      return next;
    });
  }, []);

  const allPermIds = useMemo(() => resources.flatMap((r) => r.permissions.map((p) => p.id)), [resources]);
  const dirtyRoles = useMemo(
    () => roles.filter((r) => !sameSet(grants[r.id], saved[r.id])),
    [roles, grants, saved]
  );

  async function saveAll() {
    if (!dirtyRoles.length) { flash("No changes to save."); return; }
    setSaving(true); setError("");
    try {
      const valid = new Set(allPermIds);
      await Promise.all(
        dirtyRoles.map((r) =>
          apiSetRolePermissions(r.id, [...(grants[r.id] ?? [])].filter((id) => valid.has(id)))
        )
      );
      setSaved((prev) => {
        const next = cloneGrants(prev);
        dirtyRoles.forEach((r) => { next[r.id] = new Set(grants[r.id]); });
        return next;
      });
      flash(`✅ Saved ${dirtyRoles.length} role${dirtyRoles.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Export access control as JSON (roles, resources, grants, assignments, ABAC) ──
  async function exportJson() {
    setExporting(true); setError("");
    try {
      const entries = await Promise.all(
        schemaNames.map(async (n) => [n, await apiGetDomainAbac(n).catch(() => [] as any[])] as const)
      );
      const abacDomains: Record<string, any[]> = {};
      for (const [n, rules] of entries) if (rules.length) abacDomains[n] = rules.map(stripRuleIds);

      const data = buildExport(roles, resources, saved, users, abacDomains);
      setExportText(JSON.stringify(data, null, 2));
      if (dirtyRoles.length) flash("Showing saved permissions (unsaved edits not included)");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  function discardChanges() {
    setGrants(cloneGrants(saved));
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <div style={common.center}>Loading roles, resources &amp; permissions…</div>;

  return (
    <div style={common.page}>
      {/* Header */}
      <div style={common.header}>
        <div>
          <h1 style={common.title}>Access Control</h1>
          <p style={common.subtitle}>
            Manage what each role can do on every domain model, and which users hold which roles.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={{ ...s.headerBtn, opacity: exporting ? 0.6 : 1 }} onClick={exportJson} disabled={exporting}>
            <FileDownloadOutlinedIcon sx={{ fontSize: 17 }} /> {exporting ? "Loading…" : "Export"}
          </button>
          <button style={s.headerBtn} onClick={() => setShowImport(true)}>
            <FileUploadOutlinedIcon sx={{ fontSize: 17 }} /> Import
          </button>
          <button style={s.headerBtn} onClick={() => setAssignFor({ open: true })}>
            <PersonAddAltIcon sx={{ fontSize: 17 }} /> Assign Role
          </button>
          <button className="page-header-btn page-header-btn--import" onClick={() => setShowAddRole(true)}>
            <AddIcon sx={{ fontSize: 17 }} /> Add Role
          </button>
        </div>
      </div>

      {error && <div style={common.error}>{error}</div>}
      {toast && <div style={common.success}>{toast}</div>}

      {/* Tabs */}
      <div style={s.tabBar}>
        {([
          ["permissions", "Role Permissions", dirtyRoles.length ? `${dirtyRoles.length} unsaved` : ""],
          ["assignments", "User Assignments", String(users.length)],
          ["roles",       "Roles",            String(roles.length)],
          ["resources",   "Resources",        String(resources.length)],
        ] as [Tab, string, string][]).map(([key, label, count]) => (
          <button key={key} style={{ ...s.tab, ...(tab === key ? s.tabActive : {}) }} onClick={() => setTab(key)}>
            {label}
            {count && (
              <span style={{ ...s.tabCount, ...(key === "permissions" ? s.tabCountWarn : {}) }}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "permissions" && (
        <PermissionsTab
          roles={roles}
          resources={resources}
          grants={grants}
          allPermIds={allPermIds}
          sources={sources}
          schemaNames={schemaNames}
          syncing={syncing}
          dirtyCount={dirtyRoles.length}
          saving={saving}
          onToggle={toggle}
          onToggleMany={toggleMany}
          onSave={saveAll}
          onDiscard={discardChanges}
          goTo={setTab}
        />
      )}

      {tab === "assignments" && (
        <AssignmentsTab
          users={users}
          roles={roles}
          onEdit={(userId) => setAssignFor({ open: true, userId })}
          onCreateUser={() => setShowCreateUser(true)}
        />
      )}

      {tab === "roles" && (
        <RolesTab
          roles={roles}
          onAdd={() => setShowAddRole(true)}
          onChanged={() => load({ silent: true })}
          onError={setError}
          onFlash={flash}
        />
      )}

      {tab === "resources" && (
        <ResourcesTab
          resources={resources}
          schemaNames={schemaNames}
          sources={sources}
          syncing={syncing}
          onSync={syncSchemas}
          onChanged={() => load({ silent: true })}
          onError={setError}
          onFlash={flash}
        />
      )}

      {/* Modals */}
      {showAddRole && (
        <AddRoleModal
          existing={roles.map((r) => r.name.toLowerCase())}
          onClose={() => setShowAddRole(false)}
          onCreated={async () => { setShowAddRole(false); flash("Role created"); await load({ silent: true }); }}
        />
      )}
      {assignFor.open && (
        <AssignRoleModal
          users={users}
          roles={roles}
          initialUserId={assignFor.userId}
          onClose={() => setAssignFor({ open: false })}
          onSaved={async () => { setAssignFor({ open: false }); flash("Roles assigned"); await load({ silent: true }); }}
        />
      )}
      {exportText !== null && (
        <ExportModal text={exportText} onClose={() => setExportText(null)} />
      )}
      {showImport && (
        <ImportModal
          blocked={dirtyRoles.length > 0}
          schemaNames={schemaNames}
          sources={sources}
          onClose={() => setShowImport(false)}
          onApplied={() => load({ silent: true })}
        />
      )}
      {showCreateUser && (
        <CreateUserModal
          onClose={() => setShowCreateUser(false)}
          onCreated={async () => { setShowCreateUser(false); flash("User created"); await load({ silent: true }); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 1 — Role permissions matrix (desktop) / role cards (narrow)
// ════════════════════════════════════════════════════════════════════════════
function PermissionsTab({
  roles, resources, grants, allPermIds, sources, schemaNames, syncing, dirtyCount, saving,
  onToggle, onToggleMany, onSave, onDiscard, goTo,
}: {
  roles: Role[]; resources: Resource[]; grants: Grants; allPermIds: string[];
  sources: Record<string, SchemaSource>; schemaNames: string[];
  syncing: string | null;
  dirtyCount: number; saving: boolean;
  onToggle: (roleId: string, permId: string) => void;
  onToggleMany: (roleId: string, permIds: string[], on: boolean) => void;
  onSave: () => void; onDiscard: () => void; goTo: (t: Tab) => void;
}) {
  const narrow = useIsNarrow();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeRoleId, setActiveRoleId] = useState<string>(roles[0]?.id ?? "");

  useEffect(() => {
    if (!roles.find((r) => r.id === activeRoleId)) setActiveRoleId(roles[0]?.id ?? "");
  }, [roles, activeRoleId]);

  // Rows = every domain model (synced or not, grouped by project › module) + resources with no domain model
  const resByName = new Map(resources.map((r) => [r.name.toLowerCase(), r]));
  const schemaRows = [...schemaNames]
    .sort((a, b) => {
      const sa = sources[a.toLowerCase()], sb = sources[b.toLowerCase()];
      return `${sa?.project ?? "~"}|${sa?.module ?? "~"}|${a}`.localeCompare(`${sb?.project ?? "~"}|${sb?.module ?? "~"}|${b}`);
    })
    .map((n) => ({ key: `s:${n}`, name: n, res: resByName.get(n.toLowerCase()) }));
  const orphanRows = resources
    .filter((r) => !schemaNames.some((n) => n.toLowerCase() === r.name.toLowerCase()))
    .map((r) => ({ key: `o:${r.id}`, name: r.name, res: r as Resource | undefined, orphan: true }));
  const rows: { key: string; name: string; res?: Resource; orphan?: boolean }[] = [...schemaRows, ...orphanRows];

  if (roles.length === 0)
    return (
      <div style={common.empty}>
        No roles yet. Use <strong style={{ color: c.text }}>Add Role</strong> above to create one.
      </div>
    );
  if (rows.length === 0)
    return (
      <div style={common.empty}>
        No domain models or resources yet. Create domain models first, then sync them in the{" "}
        <button style={s.linkBtn} onClick={() => goTo("resources")}>Resources tab</button>.
      </div>
    );

  const toggleCollapse = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));
  const countEnabled = (roleId: string) => allPermIds.filter((id) => grants[roleId]?.has(id)).length;

  const colTemplate = `300px repeat(${roles.length}, minmax(110px, 1fr))`;
  const activeRole = roles.find((r) => r.id === activeRoleId);

  return (
    <>
      {!narrow ? (
        <div style={s.matrixWrap}>
          {/* sticky header */}
          <div style={{ ...s.matrixHead, gridTemplateColumns: colTemplate }}>
            <div style={s.colLabel}>Resource / Action</div>
            {roles.map((r) => (
              <div key={r.id} style={{ textAlign: "center", padding: "0 4px" }}>
                <div style={s.roleHead} title={r.description}>{r.name}</div>
                <div style={s.roleCount}>{countEnabled(r.id)}/{allPermIds.length}</div>
              </div>
            ))}
          </div>

          {rows.map((row) => {
            if (!row.res) {
              // domain model that has no RBAC resource yet
              return (
                <div key={row.key} style={{ ...s.resRow, gridTemplateColumns: colTemplate, cursor: "default", opacity: 0.85 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={s.caret} />
                    <div style={{ minWidth: 0 }}>
                      <span style={s.resName}>{row.name}</span>
                      <SourceTag src={sources[row.name.toLowerCase()]} />
                    </div>
                  </div>
                  <div style={{ gridColumn: "2 / -1", fontSize: 12, color: c.textMuted }}>
                    {syncing !== null ? "Setting up permissions…" : "Couldn't set up permissions for this domain model — reload to retry."}
                  </div>
                </div>
              );
            }
            const res = row.res;
            const ids = res.permissions.map((p) => p.id);
            const open = !collapsed[res.id];
            return (
              <div key={res.id}>
                {/* resource row */}
                <div
                  style={{ ...s.resRow, gridTemplateColumns: colTemplate }}
                  onClick={() => toggleCollapse(res.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={s.caret}>{open ? "▼" : "▶"}</span>
                    <div style={{ minWidth: 0 }}>
                      <span style={s.resName}>{res.name}</span>
                      <SourceTag src={row.orphan ? undefined : sources[res.name.toLowerCase()]} />
                    </div>
                  </div>
                  {roles.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                      <AllPill ids={ids} granted={grants[r.id]} onToggle={(on) => onToggleMany(r.id, ids, on)} />
                    </div>
                  ))}
                </div>

                {/* action rows */}
                {open && res.permissions.length === 0 && (
                  <div style={{ ...s.actionRow, gridTemplateColumns: "1fr", color: c.textMuted, fontSize: 12, paddingLeft: 44 }}>
                    No actions defined — add some in the Resources tab.
                  </div>
                )}
                {open && res.permissions.map((p) => (
                  <div key={p.id} style={{ ...s.actionRow, gridTemplateColumns: colTemplate }}>
                    <div style={{ paddingLeft: 36 }}>
                      <span style={s.actionName}>{p.action}</span>
                    </div>
                    {roles.map((r) => (
                      <div key={r.id} style={{ display: "flex", justifyContent: "center" }}>
                        <Box checked={!!grants[r.id]?.has(p.id)} onClick={() => onToggle(r.id, p.id)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {/* role pills */}
          <div style={s.pillRow}>
            {roles.map((r) => {
              const active = r.id === activeRoleId;
              return (
                <button key={r.id} onClick={() => setActiveRoleId(r.id)} style={{ ...s.pill, ...(active ? s.pillActive : {}) }}>
                  {r.name} <span style={{ opacity: 0.7, marginLeft: 4 }}>({countEnabled(r.id)}/{allPermIds.length})</span>
                </button>
              );
            })}
          </div>

          {activeRole && (
            <div style={common.card}>
              <div style={s.cardTop}>
                <span style={{ ...s.roleHead, fontSize: 15 }}>{activeRole.name}</span>
                <button
                  style={common.btnGhost}
                  onClick={() => onToggleMany(activeRole.id, allPermIds, countEnabled(activeRole.id) !== allPermIds.length)}
                >
                  {countEnabled(activeRole.id) === allPermIds.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              {resources.map((res) => {
                const ids = res.permissions.map((p) => p.id);
                const open = !collapsed[res.id];
                return (
                  <div key={res.id}>
                    <div style={{ ...s.resRow, display: "flex", justifyContent: "space-between" }} onClick={() => toggleCollapse(res.id)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={s.caret}>{open ? "▼" : "▶"}</span>
                        <div style={{ minWidth: 0 }}>
                          <span style={s.resName}>{res.name}</span>
                          <SourceTag src={sources[res.name.toLowerCase()]} />
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <AllPill ids={ids} granted={grants[activeRole.id]} onToggle={(on) => onToggleMany(activeRole.id, ids, on)} />
                      </div>
                    </div>
                    {open && res.permissions.map((p) => (
                      <div key={p.id} style={{ ...s.actionRow, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ ...s.actionName, paddingLeft: 24 }}>{p.action}</span>
                        <Box size={24} checked={!!grants[activeRole.id]?.has(p.id)} onClick={() => onToggle(activeRole.id, p.id)} />
                      </div>
                    ))}
                  </div>
                );
              })}
              <div style={s.progressWrap}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: c.textSub }}>Permissions enabled</span>
                  <strong>{countEnabled(activeRole.id)}/{allPermIds.length}</strong>
                </div>
                <div style={s.progressTrack}>
                  <div style={{ ...s.progressBar, width: `${allPermIds.length ? (countEnabled(activeRole.id) / allPermIds.length) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save bar */}
      <div style={s.saveBar}>
        {dirtyCount > 0 && <span style={s.dirtyBadge}>{dirtyCount} role{dirtyCount > 1 ? "s" : ""} with unsaved changes</span>}
        {dirtyCount > 0 && <button style={common.btnGhost} onClick={onDiscard} disabled={saving}>Discard</button>}
        <button
          className="page-header-btn page-header-btn--import"
          style={{ opacity: saving || dirtyCount === 0 ? 0.5 : 1 }}
          onClick={onSave}
          disabled={saving || dirtyCount === 0}
        >
          {saving ? "Saving…" : "✓ Save Role Permissions"}
        </button>
      </div>
    </>
  );
}

/** "Project › Module · table · backend" line under a resource name */
function SourceTag({ src }: { src?: SchemaSource }) {
  if (!src)
    return <div style={s.sourceLine}><span style={s.sourceCustom}>No matching domain model (custom or leftover)</span></div>;
  const path = [src.project, src.module].filter(Boolean).join(" › ");
  return (
    <div style={s.sourceLine} title={`Datastore table: ${src.table}`}>
      {path && <span>{path}</span>}
      {path && <span style={{ opacity: 0.5 }}> · </span>}
      <span>table <code style={s.sourceCode}>{src.table}</code></span>
      {src.backend && <span style={s.sourceBackend}>{src.backend}</span>}
    </div>
  );
}

/** "✓ all / — all / ◐ some" pill for a resource row */
function AllPill({ ids, granted, onToggle }: { ids: string[]; granted?: Set<string>; onToggle: (on: boolean) => void }) {
  if (ids.length === 0) return <span style={{ color: c.textMuted }}>—</span>;
  const n = ids.filter((id) => granted?.has(id)).length;
  const all = n === ids.length;
  const some = n > 0 && !all;
  return (
    <button
      onClick={() => onToggle(!all)}
      style={{
        ...s.allPill,
        ...(all ? { color: c.accentText, background: c.accentSoft, borderColor: c.accentBorder }
          : some ? { color: c.amber.text, background: c.amber.bg, borderColor: c.amber.border }
          : {}),
      }}
    >
      {all ? "✓ all" : some ? `◐ ${n}/${ids.length}` : "— all"}
    </button>
  );
}

/** The square check button used in the matrix */
function Box({ checked, onClick, size = 20 }: { checked: boolean; onClick: () => void; size?: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={checked}
      style={{
        width: size, height: size, borderRadius: 5, cursor: "pointer", padding: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: checked ? c.accent : "rgba(255,255,255,0.06)",
        border: `2px solid ${checked ? c.accent : "rgba(255,255,255,0.18)"}`,
        boxShadow: checked ? "0 0 8px rgba(139,92,246,0.55)" : "none",
        transition: "all 0.12s",
      }}
    >
      {checked && (
        <svg width={size - 8} height={size - 8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 2 — User assignments
// ════════════════════════════════════════════════════════════════════════════
function AssignmentsTab({
  users, roles, onEdit, onCreateUser,
}: { users: User[]; roles: Role[]; onEdit: (userId: string) => void; onCreateUser: () => void }) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const filtered = users.filter((u) => {
    const text = `${u.user_name ?? ""} ${u.email ?? ""}`.toLowerCase();
    return text.includes(q.toLowerCase()) && (roleFilter === "all" || u.roles.some((r) => r.id === roleFilter));
  });

  return (
    <>
      <div style={s.toolbar}>
        <input style={{ ...common.input, flex: 1, minWidth: 200, width: "auto" }} placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...common.input, width: "auto", minWidth: 160 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button style={s.headerBtn} onClick={onCreateUser}>
          <AddIcon sx={{ fontSize: 17 }} /> Create User
        </button>
      </div>

      {users.length === 0 ? (
        <div style={common.empty}>No users yet. Click <strong style={{ color: c.text }}>Create User</strong> to add the first one.</div>
      ) : (
        <div style={common.card}>
          <div style={{ ...s.tHead, gridTemplateColumns: "2fr 3fr 90px" }}>
            <div>User</div><div>Roles</div><div style={{ textAlign: "right" }}>Action</div>
          </div>
          {filtered.length === 0 && <div style={{ ...common.center, padding: 24 }}>No users match your filter.</div>}
          {filtered.map((u) => (
            <div key={u.user_id} style={{ ...s.tRow, gridTemplateColumns: "2fr 3fr 90px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div style={s.avatar}>{(u.user_name || u.email || "?")[0].toUpperCase()}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={s.userName}>{u.user_name || "—"}</div>
                  <div style={s.userEmail}>{u.email}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {u.roles.length === 0
                  ? <span style={{ color: c.textMuted, fontSize: 12, fontStyle: "italic" }}>No roles</span>
                  : u.roles.map((r) => <span key={r.id} style={s.rolePill}>{r.name}</span>)}
              </div>
              <div style={{ textAlign: "right" }}>
                <button style={common.btnGhost} onClick={() => onEdit(u.user_id)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 3 — Roles (list + delete)
// ════════════════════════════════════════════════════════════════════════════
function RolesTab({
  roles, onAdd, onChanged, onError, onFlash,
}: { roles: Role[]; onAdd: () => void; onChanged: () => void; onError: (m: string) => void; onFlash: (m: string) => void }) {
  const [confirm, setConfirm] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (!confirm) return;
    setBusy(true);
    try {
      await apiDeleteRole(confirm.id);
      onFlash(`Role "${confirm.name}" deleted`);
      setConfirm(null);
      onChanged();
    } catch (e: any) { onError(e.message); setConfirm(null); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button style={s.headerBtn} onClick={onAdd}><AddIcon sx={{ fontSize: 17 }} /> Add Role</button>
      </div>

      {roles.length === 0 ? (
        <div style={common.empty}>No roles created yet.</div>
      ) : (
        <div style={common.card}>
          <div style={{ ...s.tHead, gridTemplateColumns: "40px 2fr 4fr 90px" }}>
            <div>#</div><div>Role</div><div>Description</div><div style={{ textAlign: "right" }}>Action</div>
          </div>
          {roles.map((r, i) => (
            <div key={r.id} style={{ ...s.tRow, gridTemplateColumns: "40px 2fr 4fr 90px" }}>
              <div style={{ color: c.textMuted, fontSize: 12 }}>{i + 1}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={common.icon}>{r.name[0].toUpperCase()}</div>
                <span style={s.userName}>{r.name}</span>
              </div>
              <div style={{ color: c.textSub, fontSize: 13 }}>{r.description || <em style={{ color: c.textMuted }}>No description</em>}</div>
              <div style={{ textAlign: "right" }}>
                <button style={common.btnDanger} onClick={() => setConfirm(r)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <Modal title="Delete role?" onClose={() => !busy && setConfirm(null)} width={400}>
          <p style={{ color: c.textSub, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            Delete <strong style={{ color: c.text }}>"{confirm.name}"</strong>? Users holding this role will lose its permissions. This cannot be undone.
          </p>
          <div style={s.modalActions}>
            <button style={common.btnGhost} onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button style={{ ...common.btnPrimary, background: "linear-gradient(135deg,#dc2626,#b91c1c)", opacity: busy ? 0.6 : 1 }} onClick={doDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 4 — Resources & actions
// ════════════════════════════════════════════════════════════════════════════
function ResourcesTab({
  resources, schemaNames, sources, syncing, onSync, onChanged, onError, onFlash,
}: {
  resources: Resource[]; schemaNames: string[]; sources: Record<string, SchemaSource>;
  syncing: string | null; onSync: (names: string[]) => void;
  onChanged: () => void; onError: (m: string) => void; onFlash: (m: string) => void;
}) {
  const [customBusy, setCustomBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [confirm, setConfirm] = useState<Resource | null>(null);

  const byName = new Map(resources.map((r) => [r.name.toLowerCase(), r]));
  const unsynced = schemaNames.filter((n) => !byName.has(n.toLowerCase()));
  const orphans = resources.filter((r) => !schemaNames.some((n) => n.toLowerCase() === r.name.toLowerCase()));

  const sync = onSync;

  async function togglePerm(res: Resource, action: string) {
    setToggling(true);
    try {
      const existing = res.permissions.find((p) => p.action === action);
      if (existing) await apiDeletePermission(existing.id);
      else await apiCreatePermission(res.id, action);
      onChanged();
    } catch (e: any) { onError(e.message); }
    finally { setToggling(false); }
  }

  async function addCustom() {
    if (!form.name.trim()) return;
    setCustomBusy(true);
    try {
      const res = await apiCreateResource(form.name.trim(), form.description.trim() || undefined);
      for (const a of DEFAULT_ACTIONS) await apiCreatePermission(res.data.id, a);
      setForm({ name: "", description: "" }); setAdding(false);
      onFlash("Resource created");
      onChanged();
    } catch (e: any) { onError(e.message); }
    finally { setCustomBusy(false); }
  }

  async function doDelete() {
    if (!confirm) return;
    try {
      await apiDeleteResource(confirm.id);
      onFlash(`Resource "${confirm.name}" removed`);
      onChanged();
    } catch (e: any) { onError(e.message); }
    finally { setConfirm(null); }
  }

  const renderCard = (name: string, res?: Resource, custom = false) => {
    const synced = !!res;
    const isOpen = !!res && expanded === res.id;
    return (
      <div key={res?.id ?? name} style={{ ...common.card, ...(synced ? {} : s.cardUnsynced) }}>
        <div style={s.resHead}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{ ...common.icon, ...(synced ? {} : { background: c.neutral.bg, color: c.textMuted }) }}>{name[0].toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...common.cardTitle, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {cap(name)}
                <span style={{ ...s.badge, ...(synced ? s.badgeOn : s.badgeOff) }}>{custom ? "Custom" : synced ? "✓ Synced" : "Not synced"}</span>
              </div>
              <div style={common.cardDesc}>
                {synced ? `${res!.permissions.length} action${res!.permissions.length !== 1 ? "s" : ""} defined` : "Sync to create permissions for this schema"}
              </div>
              <SourceTag src={custom ? undefined : sources[name.toLowerCase()]} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!synced && (
              <button className="page-header-btn page-header-btn--import" style={{ padding: "7px 16px" }} onClick={() => sync([name])} disabled={syncing !== null}>
                {syncing === name ? "Syncing…" : "Sync"}
              </button>
            )}
            {synced && (
              <>
                <button style={common.btnGhost} onClick={() => setExpanded(isOpen ? null : res!.id)}>{isOpen ? "▲ Hide" : "▼ Edit actions"}</button>
                <button style={common.btnDanger} onClick={() => setConfirm(res!)}>{custom ? "Delete" : "Remove"}</button>
              </>
            )}
          </div>
        </div>

        {synced && !isOpen && (
          <div style={s.chips}>
            {DEFAULT_ACTIONS.map((a) => {
              const has = res!.permissions.some((p) => p.action === a);
              return <span key={a} style={{ ...s.chip, ...(has ? s.chipOn : s.chipOff) }}>{has ? "✓" : "✗"} {a}</span>;
            })}
          </div>
        )}

        {isOpen && (
          <div style={s.editor}>
            <div style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>Toggle which actions exist for this resource:</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {DEFAULT_ACTIONS.map((a) => {
                const has = res!.permissions.some((p) => p.action === a);
                return (
                  <label key={a} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" style={checkboxAccent} checked={has} disabled={toggling} onChange={() => togglePerm(res!, a)} />
                    <span style={{ ...s.chip, fontSize: 13, padding: "5px 14px", ...(has ? s.chipOn : s.chipOff) }}>{a}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ ...common.sectionLabel, marginBottom: 0 }}>
          Schemas ({schemaNames.length}) <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: c.textMuted }}>— from datastore</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {unsynced.length > 0 && (
            <button className="page-header-btn page-header-btn--import" onClick={() => sync(unsynced)} disabled={syncing !== null} style={{ opacity: syncing ? 0.6 : 1 }}>
              {syncing === "__all__" ? "Syncing…" : `⚡ Sync all (${unsynced.length} pending)`}
            </button>
          )}
          <button style={s.headerBtn} onClick={() => setAdding((v) => !v)}><AddIcon sx={{ fontSize: 17 }} /> Custom resource</button>
        </div>
      </div>

      {adding && (
        <div style={{ ...common.card, padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          <input style={common.input} placeholder="Resource name (e.g. Invoice)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input style={common.input} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="page-header-btn page-header-btn--import" onClick={addCustom} disabled={!form.name.trim() || customBusy} style={{ opacity: !form.name.trim() ? 0.5 : 1 }}>
              {customBusy ? "Adding…" : "Add"}
            </button>
            <button style={common.btnGhost} onClick={() => { setAdding(false); setForm({ name: "", description: "" }); }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {schemaNames.length === 0 && <div style={common.empty}>No schemas found in the datastore.</div>}
        {schemaNames.map((n) => renderCard(n, byName.get(n.toLowerCase())))}
      </div>

      {orphans.length > 0 && (
        <>
          <div style={{ ...common.sectionLabel, marginTop: 26 }}>Custom resources</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {orphans.map((r) => renderCard(r.name, r, true))}
          </div>
        </>
      )}

      {confirm && (
        <Modal title="Remove resource?" onClose={() => setConfirm(null)} width={400}>
          <p style={{ color: c.textSub, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            Remove <strong style={{ color: c.text }}>"{confirm.name}"</strong> and all its permissions? Roles will lose any access granted on it.
          </p>
          <div style={s.modalActions}>
            <button style={common.btnGhost} onClick={() => setConfirm(null)}>Cancel</button>
            <button style={{ ...common.btnPrimary, background: "linear-gradient(135deg,#dc2626,#b91c1c)" }} onClick={doDelete}>Remove</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Modals
// ════════════════════════════════════════════════════════════════════════════
function Modal({ title, subtitle, onClose, children, width = 460 }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: number;
}) {
  return (
    <div style={common.backdrop} onMouseDown={onClose}>
      <div style={{ ...common.dialog, maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: c.text, margin: 0 }}>{title}</h3>
            {subtitle && <div style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={s.closeX}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const PRESET_ROLES = [
  { name: "Admin",   description: "Full access to everything" },
  { name: "Manager", description: "Can view and edit, but not delete" },
  { name: "Viewer",  description: "Read-only access" },
];

function AddRoleModal({ existing, onClose, onCreated }: { existing: string[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(n = name, d = desc) {
    const v = n.trim();
    if (v.length < 3) return setErr("Role name must be at least 3 characters");
    if (v.length > 50) return setErr("Role name must be under 50 characters");
    if (d.length > 200) return setErr("Description must be under 200 characters");
    if (existing.includes(v.toLowerCase())) return setErr("A role with this name already exists");
    setBusy(true); setErr("");
    try { await apiCreateRole(v, d.trim() || undefined); onCreated(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }

  const presets = PRESET_ROLES.filter((p) => !existing.includes(p.name.toLowerCase()));

  return (
    <Modal title="Add New Role" subtitle="Fill in the details below" onClose={() => !busy && onClose()}>
      {err && <div style={common.error}>{err}</div>}
      {presets.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ ...common.sectionLabel, marginBottom: 6 }}>Quick start</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button key={p.name} style={s.presetBtn} onClick={() => { setName(p.name); setDesc(p.description); setErr(""); }}>+ {p.name}</button>
            ))}
          </div>
        </div>
      )}
      <label style={common.label}>Role name <span style={{ color: c.red.text }}>*</span></label>
      <input style={common.input} autoFocus placeholder="e.g. Auditor" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <label style={common.label}>Description</label>
      <textarea style={{ ...common.input, resize: "none" }} rows={3} placeholder="Describe the role's purpose" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div style={s.modalActions}>
        <button style={common.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="page-header-btn page-header-btn--import" style={{ opacity: busy ? 0.6 : 1 }} onClick={() => submit()} disabled={busy}>
          {busy ? "Creating…" : "Create Role"}
        </button>
      </div>
    </Modal>
  );
}

function AssignRoleModal({ users, roles, initialUserId, onClose, onSaved }: {
  users: User[]; roles: Role[]; initialUserId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [userId, setUserId] = useState(initialUserId ?? "");
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(users.find((u) => u.user_id === initialUserId)?.roles.map((r) => r.id) ?? [])
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function pickUser(id: string) {
    setUserId(id);
    setPicked(new Set(users.find((u) => u.user_id === id)?.roles.map((r) => r.id) ?? []));
  }
  function flip(id: string) {
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function save() {
    if (!userId) return setErr("Please select a user");
    setBusy(true); setErr("");
    try { await apiSetUserRoles(userId, [...picked]); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Assign Roles" subtitle="Choose a user and tick the roles they should hold" onClose={() => !busy && onClose()}>
      {err && <div style={common.error}>{err}</div>}
      <label style={common.label}>User</label>
      <select style={common.input} value={userId} onChange={(e) => pickUser(e.target.value)}>
        <option value="">Select a user…</option>
        {users.map((u) => <option key={u.user_id} value={u.user_id}>{u.user_name || u.email} — {u.email}</option>)}
      </select>
      <label style={{ ...common.label, marginTop: 6 }}>Roles</label>
      {roles.length === 0 ? (
        <span style={{ color: c.textMuted, fontSize: 13 }}>No roles defined yet.</span>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {roles.map((r) => {
            const on = picked.has(r.id);
            return (
              <label key={r.id} style={{ ...s.roleChoice, ...(on ? s.roleChoiceOn : {}), opacity: userId ? 1 : 0.5 }}>
                <input type="checkbox" style={checkboxAccent} checked={on} disabled={!userId} onChange={() => flip(r.id)} />
                <span style={{ fontSize: 13, fontWeight: 600, color: on ? "#c4b0fa" : c.textSub }}>{r.name}</span>
              </label>
            );
          })}
        </div>
      )}
      <div style={s.modalActions}>
        <button style={common.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="page-header-btn page-header-btn--import" style={{ opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save Roles"}
        </button>
      </div>
    </Modal>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ user_name: "", email: "", password: "", is_superuser: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!form.user_name || !form.email || !form.password) return setErr("All fields are required");
    setBusy(true); setErr("");
    try { await apiCreateUser(form); onCreated(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Create New User" onClose={() => !busy && onClose()}>
      {err && <div style={common.error}>{err}</div>}
      <label style={common.label}>Full name</label>
      <input style={common.input} placeholder="e.g. John Doe" value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} />
      <label style={common.label}>Email (used to log in)</label>
      <input style={common.input} type="email" placeholder="john@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <label style={common.label}>Password</label>
      <input style={common.input} type="password" placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: c.textSub, marginTop: 4 }}>
        <input type="checkbox" style={checkboxAccent} checked={form.is_superuser} onChange={(e) => setForm({ ...form, is_superuser: e.target.checked })} />
        <span>Make this user a <strong style={{ color: c.text }}>Product Admin</strong> (bypasses all permission checks)</span>
      </label>
      <div style={s.modalActions}>
        <button style={common.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="page-header-btn page-header-btn--import" style={{ opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create User"}
        </button>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export / Import (JSON)
// ════════════════════════════════════════════════════════════════════════════
const EXPORT_VERSION = "1.0";
const uid = () => Math.random().toString(36).slice(2, 9);
const lc = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * File format. Everything is keyed by NAME (role name, resource name, action,
 * user email) instead of database ids, so a file exported from one environment
 * can be imported into another.
 */
interface AccessExport {
  version: string;
  exportedAt?: string;
  rbac: {
    roles:       { name: string; description?: string }[];
    resources:   { name: string; description?: string; actions: string[] }[];
    /** role name → resource name → allowed actions */
    grants:      Record<string, Record<string, string[]>>;
    assignments: { email: string; roles: string[] }[];
  };
  abac: {
    /** domain model name → rules (same shape as the Permissions panel) */
    domains: Record<string, any[]>;
  };
}

/** ABAC rules are exported without ids and without conditions. */
function stripRuleIds(rule: any) {
  const { id: _id, conditions: _conditions, ...rest } = rule ?? {};
  return rest;
}

function buildExport(
  roles: Role[], resources: Resource[], saved: Grants, users: User[], abacDomains: Record<string, any[]>,
): AccessExport {
  const permInfo = new Map<string, { resource: string; action: string }>();
  for (const r of resources) for (const p of r.permissions) permInfo.set(p.id, { resource: r.name, action: p.action });

  const grants: AccessExport["rbac"]["grants"] = {};
  for (const role of roles) {
    const byRes: Record<string, string[]> = {};
    for (const id of saved[role.id] ?? []) {
      const info = permInfo.get(id);
      if (info) (byRes[info.resource] ??= []).push(info.action);
    }
    grants[role.name] = byRes;
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    rbac: {
      roles: roles.map((r) => ({ name: r.name, ...(r.description ? { description: r.description } : {}) })),
      resources: resources.map((r) => ({
        name: r.name,
        ...(r.description ? { description: r.description } : {}),
        actions: r.permissions.map((p) => p.action),
      })),
      grants,
      assignments: users
        .filter((u) => u.email && u.roles.length)
        .map((u) => ({ email: u.email, roles: u.roles.map((r) => r.name) })),
    },
    abac: { domains: abacDomains },
  };
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Validate + normalise an uploaded file. Missing sections become empty. */
function parseImport(text: string): { data?: AccessExport; error?: string } {
  let raw: any;
  try { raw = JSON.parse(text); } catch { return { error: "This file is not valid JSON." }; }
  if (!isObj(raw)) return { error: "Expected a JSON object at the top level." };
  if (typeof raw.version !== "string") return { error: 'Missing "version" — this does not look like an access-control export.' };
  if (raw.version.split(".")[0] !== EXPORT_VERSION.split(".")[0])
    return { error: `Unsupported version "${raw.version}" (this screen reads ${EXPORT_VERSION}).` };

  const rbac = raw.rbac ?? {};
  const abac = raw.abac ?? {};
  if (!isObj(rbac) || !isObj(abac)) return { error: '"rbac" and "abac" must be objects.' };

  const roles = rbac.roles ?? [], resources = rbac.resources ?? [], assignments = rbac.assignments ?? [];
  const grants = rbac.grants ?? {}, domains = abac.domains ?? {};
  if (!Array.isArray(roles) || !Array.isArray(resources) || !Array.isArray(assignments))
    return { error: '"rbac.roles", "rbac.resources" and "rbac.assignments" must be arrays.' };
  if (!isObj(grants) || !isObj(domains)) return { error: '"rbac.grants" and "abac.domains" must be objects.' };

  for (const r of roles)
    if (!isObj(r) || typeof r.name !== "string" || !r.name.trim()) return { error: "Every role needs a non-empty name." };
  for (const r of resources)
    if (!isObj(r) || typeof r.name !== "string" || !r.name.trim() || !Array.isArray(r.actions) || r.actions.some((a: any) => typeof a !== "string"))
      return { error: "Every resource needs a name and an actions array of strings." };
  for (const [role, byRes] of Object.entries(grants)) {
    if (!isObj(byRes)) return { error: `Grants for role "${role}" must be an object of resource → actions.` };
    for (const [res, acts] of Object.entries(byRes))
      if (!Array.isArray(acts) || acts.some((a) => typeof a !== "string"))
        return { error: `Grants for "${role}" › "${res}" must be an array of action names.` };
  }
  for (const a of assignments)
    if (!isObj(a) || typeof a.email !== "string" || !Array.isArray(a.roles))
      return { error: "Every assignment needs an email and a roles array." };
  for (const [d, rules] of Object.entries(domains))
    if (!Array.isArray(rules)) return { error: `ABAC rules for "${d}" must be an array.` };

  return { data: { version: raw.version, exportedAt: raw.exportedAt, rbac: { roles, resources, grants, assignments }, abac: { domains } } };
}

/**
 * Merge a file into the backend.
 *  - Roles / resources / actions that don't exist yet are created; existing ones are kept.
 *  - A role listed under `grants` gets exactly the permissions in the file (roles not listed are untouched).
 *  - A user listed under `assignments` gets exactly the roles in the file (matched by email; users are never created).
 *  - A domain listed under `abac.domains` has its rules replaced (domain models must already exist).
 */
async function applyImport(
  data: AccessExport, schemaNames: string[], sources: Record<string, SchemaSource>,
): Promise<{ summary: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const n = { roles: 0, resources: 0, actions: 0, grantRoles: 0, users: 0, domains: 0 };
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { warnings.push(`${label}: ${e?.message ?? e}`); }
  };
  const listRoles = async (): Promise<Role[]> => (await apiListRoles()).data ?? [];
  const listResources = async (): Promise<Resource[]> =>
    ((await apiListResources()).data ?? []).map((r: any) => ({ ...r, permissions: normalizeList<Permission>(r.permissions) }));

  // 1. roles
  let roleList = await listRoles();
  const haveRole = new Set(roleList.map((r) => lc(r.name)));
  for (const r of data.rbac.roles) {
    if (haveRole.has(lc(r.name))) continue;
    await attempt(`Role "${r.name}"`, async () => { await apiCreateRole(r.name.trim(), r.description?.trim() || undefined); n.roles++; });
  }
  roleList = await listRoles();

  // 2. resources + actions
  let resList = await listResources();
  for (const r of data.rbac.resources) {
    const existing = resList.find((x) => lc(x.name) === lc(r.name));
    await attempt(`Resource "${r.name}"`, async () => {
      let id = existing?.id;
      if (!id) { id = (await apiCreateResource(r.name.trim(), r.description?.trim() || undefined)).data.id as string; n.resources++; }
      for (const a of r.actions) {
        if (existing?.permissions.some((p) => lc(p.action) === lc(a))) continue;
        await apiCreatePermission(id!, a.trim()); n.actions++;
      }
    });
  }
  resList = await listResources();

  // 3. role → permission grants
  const permId = new Map<string, string>();
  for (const r of resList) for (const p of r.permissions) permId.set(`${lc(r.name)}|${lc(p.action)}`, p.id);
  const roleByName = new Map(roleList.map((r) => [lc(r.name), r]));
  for (const [roleName, byRes] of Object.entries(data.rbac.grants)) {
    const role = roleByName.get(lc(roleName));
    if (!role) { warnings.push(`Grants skipped: role "${roleName}" does not exist.`); continue; }
    const ids: string[] = [];
    for (const [resName, actions] of Object.entries(byRes))
      for (const a of actions) {
        const id = permId.get(`${lc(resName)}|${lc(a)}`);
        if (id) ids.push(id); else warnings.push(`Grant skipped: ${roleName} › ${resName} › ${a} does not exist.`);
      }
    await attempt(`Grants for "${roleName}"`, async () => { await apiSetRolePermissions(role.id, ids); n.grantRoles++; });
  }

  // 4. user → role assignments
  if (data.rbac.assignments.length) {
    const userList: User[] = (await apiListUsers().catch(() => ({ data: [] }))).data ?? [];
    for (const a of data.rbac.assignments) {
      const user = userList.find((u) => lc(u.email) === lc(a.email));
      if (!user) { warnings.push(`Assignment skipped: no user with email "${a.email}".`); continue; }
      const ids: string[] = [];
      for (const rn of a.roles) {
        const role = roleByName.get(lc(rn));
        if (role) ids.push(role.id); else warnings.push(`${a.email}: role "${rn}" does not exist.`);
      }
      await attempt(`Roles for ${a.email}`, async () => { await apiSetUserRoles(user.user_id, ids); n.users++; });
    }
  }

  // 5. ABAC rules per domain model
  for (const [domain, rules] of Object.entries(data.abac.domains)) {
    const real = schemaNames.find((s) => lc(s) === lc(domain));
    if (!real) { warnings.push(`ABAC skipped: domain model "${domain}" does not exist.`); continue; }
    const src = sources[lc(real)];
    const fresh = rules.map((r: any) => ({ ...r, id: uid(), conditions: [] }));
    await attempt(`ABAC rules for "${real}"`, async () => {
      await apiSaveDomainAbac(real, fresh, { projectId: src?.projectId ?? null, moduleId: src?.moduleId ?? null }); n.domains++;
    });
  }

  const summary = [
    `${n.roles} role${n.roles === 1 ? "" : "s"} created`,
    `${n.resources} resource${n.resources === 1 ? "" : "s"} and ${n.actions} action${n.actions === 1 ? "" : "s"} created`,
    `permissions set for ${n.grantRoles} role${n.grantRoles === 1 ? "" : "s"}`,
    `roles set for ${n.users} user${n.users === 1 ? "" : "s"}`,
    `ABAC rules replaced on ${n.domains} domain model${n.domains === 1 ? "" : "s"}`,
  ];
  return { summary, warnings };
}

const SAMPLE_EXPORT: AccessExport = {
  version: EXPORT_VERSION,
  rbac: {
    roles: [{ name: "Manager", description: "Can view and edit, but not delete" }],
    resources: [{ name: "Test", description: "Domain model: Test", actions: ["create", "view", "edit", "delete"] }],
    grants: { Manager: { Test: ["create", "view", "edit"] } },
    assignments: [{ email: "user@example.com", roles: ["Manager"] }],
  },
  abac: {
    domains: {
      Test: [{
        name: "Managers can read and update", effect: "allow", roles: ["Manager"], actions: ["read", "update"], fields: [],
      }],
    },
  },
};

/** Read-only JSON box with Copy and Download buttons */
function JsonViewer({ text, filename, label }: { text: string; filename: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 6px", gap: 8, flexWrap: "wrap" }}>
        <span style={{ ...common.sectionLabel, marginBottom: 0 }}>{label ?? "JSON"}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={common.btnGhost} onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
          <button style={common.btnGhost} onClick={() => downloadText(filename, text)}>Download</button>
        </div>
      </div>
      <pre style={s.jsonBox}>{text}</pre>
    </div>
  );
}

function ExportModal({ text, onClose }: { text: string; onClose: () => void }) {
  const filename = `access-control-${new Date().toISOString().slice(0, 10)}.json`;
  return (
    <Modal title="Export Access Control" subtitle="Copy this JSON or download it as a file" onClose={onClose} width={720}>
      <JsonViewer text={text} filename={filename} label={filename} />
      <div style={s.modalActions}>
        <button className="page-header-btn page-header-btn--import" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function ImportModal({ blocked, schemaNames, sources, onClose, onApplied }: {
  blocked: boolean; schemaNames: string[]; sources: Record<string, SchemaSource>;
  onClose: () => void; onApplied: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState("");
  const [result, setResult] = useState<{ summary: string[]; warnings: string[] } | null>(null);

  const { parsed, parseErr } = useMemo(() => {
    if (!text.trim()) return { parsed: null as AccessExport | null, parseErr: "" };
    const { data, error } = parseImport(text);
    return { parsed: data ?? null, parseErr: error ?? "" };
  }, [text]);

  async function pickFile(file?: File) {
    if (file) { setText(await file.text()); setRunErr(""); }
  }

  async function run() {
    if (!parsed) return;
    setBusy(true); setRunErr("");
    try { setResult(await applyImport(parsed, schemaNames, sources)); onApplied(); }
    catch (e: any) { setRunErr(e.message); }
    finally { setBusy(false); }
  }

  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const sampleText = useMemo(() => JSON.stringify(SAMPLE_EXPORT, null, 2), []);

  return (
    <Modal title="Import Access Control" subtitle="Paste JSON or choose a file exported from this screen" onClose={() => !busy && onClose()} width={720}>
      {blocked && <div style={common.warn}>You have unsaved permission changes. Save or discard them before importing.</div>}
      {(parseErr || runErr) && <div style={common.error}>{parseErr || runErr}</div>}

      {!result && (
        <>
          <JsonViewer text={sampleText} filename="access-control-template.json" label="Expected structure" />

          <label style={{ ...common.label, marginTop: 14 }}>Your JSON</label>
          <input
            type="file" accept="application/json,.json" style={common.input} disabled={busy || blocked}
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }}
          />
          <textarea
            style={{ ...common.input, ...s.jsonInput }}
            placeholder="…or paste JSON here"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy || blocked}
            spellCheck={false}
          />

          {parsed && (
            <div style={{ fontSize: 13, color: c.textSub, lineHeight: 1.7, marginTop: 8 }}>
              <div>
                {count(parsed.rbac.roles.length, "role")} · {count(parsed.rbac.resources.length, "resource")} ·
                {" "}{count(Object.keys(parsed.rbac.grants).length, "role grant set")} ·
                {" "}{count(parsed.rbac.assignments.length, "user assignment")} ·
                {" "}{count(Object.keys(parsed.abac.domains).length, "domain ABAC set")}
              </div>
              <div style={{ fontSize: 12, color: c.textMuted }}>
                Missing roles and resources are created. Roles, users and domains listed in the file have their
                permissions, roles or ABAC rules replaced with the file's. Anything not listed is left alone.
              </div>
            </div>
          )}
          <div style={s.modalActions}>
            <button style={common.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
            <button className="page-header-btn page-header-btn--import" style={{ opacity: busy || !parsed || blocked ? 0.5 : 1 }} onClick={run} disabled={busy || !parsed || blocked}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </>
      )}

      {result && (
        <>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: c.textSub, lineHeight: 1.7 }}>
            {result.summary.map((l) => <li key={l}>{l}</li>)}
          </ul>
          {result.warnings.length > 0 && (
            <div style={{ ...common.warn, marginTop: 12, maxHeight: 180, overflowY: "auto" }}>
              <strong>{count(result.warnings.length, "issue")}:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div style={s.modalActions}>
            <button className="page-header-btn page-header-btn--import" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const rowLine = "1px solid rgba(255,255,255,0.06)";
const s: Record<string, CSSProperties> = {
  headerBtn:   { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, border: `1px solid ${c.borderInput}`, background: "rgba(255,255,255,0.06)", color: c.text, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  linkBtn:     { background: "none", border: "none", color: c.accentText, cursor: "pointer", fontWeight: 700, fontSize: "inherit", padding: 0, fontFamily: "inherit", textDecoration: "underline" },

  // tabs
  tabBar:      { display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${c.border}`, overflowX: "hidden" },
  tab:         { padding: "10px 18px", border: "none", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600, color: c.textSub, borderBottom: "2px solid transparent", marginBottom: -1, borderRadius: "8px 8px 0 0", fontFamily: "inherit", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 8 },
  tabActive:   { color: "#fff", borderBottom: `2px solid ${c.accent}`, background: c.accentSoft },
  tabCount:    { fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 20, background: "rgba(255,255,255,0.08)", color: c.textSub },
  tabCountWarn:{ background: c.amber.bg, color: c.amber.text },

  // matrix
  matrixWrap:  { ...common.card, overflow: "visible", minHeight: 240 },
  matrixHead:  { display: "grid", alignItems: "center", padding: "12px 16px", position: "sticky", top: 0, zIndex: 5, background: c.cardRaised, borderBottom: `1px solid ${c.border}`, borderRadius: "12px 12px 0 0" },
  colLabel:    { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: c.textMuted },
  roleHead:    { fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: c.accentText, letterSpacing: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  roleCount:   { fontSize: 10, color: c.textMuted, marginTop: 2 },
  resRow:      { display: "grid", alignItems: "center", padding: "10px 16px", background: "rgba(255,255,255,0.04)", borderTop: rowLine, borderBottom: rowLine, cursor: "pointer" },
  caret:       { fontSize: 10, color: c.textMuted, width: 14, flexShrink: 0 },
  resName:     { fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: c.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actionRow:   { display: "grid", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  actionName:  { fontSize: 13, fontWeight: 500, textTransform: "uppercase", color: c.textSub },
  allPill:     { fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid transparent", background: "rgba(255,255,255,0.05)", color: c.textMuted, cursor: "pointer", fontFamily: "inherit" },

  // datastore source line
  sourceLine:  { fontSize: 11, color: c.textMuted, marginTop: 3, fontWeight: 400, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" },
  sourceCode:  { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: c.textSub, background: "rgba(255,255,255,0.06)", padding: "0 5px", borderRadius: 4 },
  sourceBackend:{ marginLeft: 6, padding: "0 7px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: c.blue.bg, color: c.blue.text, border: `1px solid ${c.blue.border}` },
  sourceCustom:{ fontStyle: "italic" },

  // narrow / mobile
  pillRow:     { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 14 },
  pill:        { flexShrink: 0, padding: "8px 14px", borderRadius: 12, fontSize: 12, fontWeight: 700, border: `1px solid ${c.borderInput}`, background: "rgba(255,255,255,0.05)", color: c.textSub, cursor: "pointer", fontFamily: "inherit" },
  pillActive:  { background: c.accent, color: "#fff", borderColor: c.accent },
  cardTop:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.05)", borderBottom: `1px solid ${c.border}` },
  progressWrap:{ padding: 16, background: "rgba(255,255,255,0.05)", borderTop: `1px solid ${c.border}` },
  progressTrack:{ height: 6, borderRadius: 6, background: "rgba(255,255,255,0.1)" },
  progressBar: { height: 6, borderRadius: 6, background: c.accent, transition: "width 0.3s" },

  // save bar
  saveBar:     { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" },
  dirtyBadge:  { padding: "4px 12px", borderRadius: 20, background: c.amber.bg, color: c.amber.text, border: `1px solid ${c.amber.border}`, fontSize: 12, fontWeight: 700 },

  // tables (assignments / roles)
  toolbar:     { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" },
  tHead:       { display: "grid", gap: 12, padding: "10px 18px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: c.textMuted, background: "rgba(255,255,255,0.04)", borderBottom: `1px solid ${c.border}` },
  tRow:        { display: "grid", gap: 12, padding: "12px 18px", alignItems: "center", borderBottom: rowLine },
  avatar:      { width: 36, height: 36, borderRadius: "50%", background: c.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, flexShrink: 0 },
  userName:    { fontWeight: 700, fontSize: 14, color: c.text },
  userEmail:   { fontSize: 12, color: c.textSub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" },
  rolePill:    { padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: c.accentSoft, color: "#c4b0fa", border: `1px solid ${c.accentBorder}` },

  // resources
  cardUnsynced:{ border: "1.5px dashed rgba(255,255,255,0.18)", background: "rgba(51,44,66,0.55)" },
  resHead:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", gap: 12, flexWrap: "wrap" },
  badge:       { fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20, border: "1px solid transparent" },
  badgeOn:     { background: c.green.bg, color: c.green.text, borderColor: c.green.border },
  badgeOff:    { background: c.neutral.bg, color: c.neutral.text, borderColor: c.neutral.border },
  chips:       { display: "flex", gap: 8, padding: "0 18px 14px", flexWrap: "wrap" },
  chip:        { padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1px solid transparent" },
  chipOn:      { background: c.green.bg, color: c.green.text, borderColor: c.green.border },
  chipOff:     { background: c.neutral.bg, color: c.neutral.text, borderColor: c.neutral.border },
  editor:      { padding: "12px 18px 16px", background: "rgba(0,0,0,0.18)", borderTop: `1px solid ${c.border}` },

  // json viewer
  jsonBox:     { margin: 0, padding: 12, maxHeight: 280, overflow: "auto", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: `1px solid ${c.border}`, color: c.textSub, fontSize: 12, lineHeight: 1.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre" },
  jsonInput:   { minHeight: 110, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 },

  // modals
  modalActions:{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  closeX:      { background: "transparent", border: "none", color: c.textMuted, cursor: "pointer", fontSize: 16, padding: 4, lineHeight: 1 },
  presetBtn:   { padding: "6px 12px", borderRadius: 8, border: `1px solid ${c.accentBorder}`, background: "rgba(139,92,246,0.14)", color: "#c4b0fa", fontWeight: 600, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  roleChoice:  { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "5px 10px", borderRadius: 8, border: `1px solid ${c.borderInput}`, background: c.inputBg },
  roleChoiceOn:{ border: `1px solid ${c.accentBorder}`, background: c.accentSoft },
};