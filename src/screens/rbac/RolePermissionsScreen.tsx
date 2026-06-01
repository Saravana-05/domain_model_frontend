import { useEffect, useState, useCallback } from "react";
import {
  apiListRoles,
  apiListResources,
  apiGetRole,
  apiSetRolePermissions,
} from "../../core/api/rbacApi";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Permission { id: string; action: string }
interface Resource   { id: string; name: string; permissions: Permission[] }
interface Role       { id: string; name: string }

/** roleId → Set of granted permissionIds (local, editable) */
type Grants = Record<string, Set<string>>;

type ViewMode = "table" | "resource" | "role";

// ── Action colour palette ──────────────────────────────────────────────────────
const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  create: { bg: "#dbeafe", text: "#1e40af", border: "#bfdbfe" },
  view:   { bg: "#dcfce7", text: "#166534", border: "#bbf7d0" },
  edit:   { bg: "#fef9c3", text: "#854d0e", border: "#fde68a" },
  delete: { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" },
};
function actionColor(action: string) {
  return ACTION_COLORS[action] ?? { bg: "#f3f4f6", text: "#374151", border: "#e5e7eb" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePerms(val: any): Permission[] {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

function cloneGrants(g: Grants): Grants {
  const out: Grants = {};
  for (const [k, v] of Object.entries(g)) out[k] = new Set(v);
  return out;
}

// ── Main component ────────────────────────────────────────────────────────────
export function RolePermissionsScreen() {
  const [roles,     setRoles]     = useState<Role[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [grants,    setGrants]    = useState<Grants>({});
  const [dirty,     setDirty]     = useState<Set<string>>(new Set()); // roleIds with unsaved edits
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [toast,     setToast]     = useState("");
  const [view,      setView]      = useState<ViewMode>("table");

  // ── Load all data on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        const [rolesRes, resRes] = await Promise.all([apiListRoles(), apiListResources()]);
        const roleList: Role[]     = rolesRes.data ?? [];
        const resList: Resource[]  = (resRes.data ?? []).map((r: any) => ({
          ...r, permissions: normalizePerms(r.permissions),
        }));
        if (cancelled) return;
        setRoles(roleList);
        setResources(resList);

        // Fetch granted permissions for every role in parallel
        const grantResults = await Promise.all(
          roleList.map(r =>
            apiGetRole(r.id)
              .then(res => ({ id: r.id, perms: (res.data?.permissions ?? []).map((p: any) => p.id) as string[] }))
              .catch(() => ({ id: r.id, perms: [] }))
          )
        );
        if (cancelled) return;
        const g: Grants = {};
        for (const { id, perms } of grantResults) g[id] = new Set(perms);
        setGrants(g);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Toggle a single permission for a role ──────────────────────────────────
  const toggle = useCallback((roleId: string, permId: string) => {
    setGrants(prev => {
      const next = cloneGrants(prev);
      if (!next[roleId]) next[roleId] = new Set();
      next[roleId].has(permId) ? next[roleId].delete(permId) : next[roleId].add(permId);
      return next;
    });
    setDirty(d => { const n = new Set(d); n.add(roleId); return n; });
    setToast("");
  }, []);

  // ── Toggle all permissions for a role on one resource ─────────────────────
  const toggleResource = useCallback((roleId: string, resource: Resource, on: boolean) => {
    setGrants(prev => {
      const next = cloneGrants(prev);
      if (!next[roleId]) next[roleId] = new Set();
      resource.permissions.forEach(p => on ? next[roleId].add(p.id) : next[roleId].delete(p.id));
      return next;
    });
    setDirty(d => { const n = new Set(d); n.add(roleId); return n; });
    setToast("");
  }, []);

  // ── Save all dirty roles ───────────────────────────────────────────────────
  async function saveAll() {
    if (!dirty.size) return;
    setSaving(true); setError("");
    try {
      await Promise.all([...dirty].map(roleId =>
        apiSetRolePermissions(roleId, [...(grants[roleId] ?? [])])
      ));
      setDirty(new Set());
      showToast(`✅ Saved ${dirty.size} role${dirty.size > 1 ? "s" : ""}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  // ── Derived helpers ────────────────────────────────────────────────────────
  const totalPerms  = resources.reduce((n, r) => n + r.permissions.length, 0);

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>

      {/* ── Page header ── */}
      <div style={s.pageHeader}>
        <div>
          <h2 style={s.heading}>Roles &amp; Permissions</h2>
          <p style={s.sub}>
            {roles.length} role{roles.length !== 1 ? "s" : ""} · {resources.length} resource{resources.length !== 1 ? "s" : ""} · {totalPerms} permissions
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {dirty.size > 0 && (
            <span style={s.dirtyBadge}>{dirty.size} unsaved</span>
          )}
          <button
            style={{ ...s.saveBtn, opacity: dirty.size === 0 ? 0.45 : 1 }}
            onClick={saveAll}
            disabled={saving || dirty.size === 0}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {error  && <div style={s.error}>{error}</div>}
      {toast  && <div style={s.successBanner}>{toast}</div>}
      {roles.length === 0     && <div style={s.warn}>No roles yet — create roles first.</div>}
      {resources.length === 0 && <div style={s.warn}>No resources yet — sync domain models first.</div>}

      {roles.length > 0 && resources.length > 0 && (
        <>
          {/* ── View tabs ── */}
          <div style={s.tabBar}>
            {(["table", "resource", "role"] as ViewMode[]).map(v => (
              <button
                key={v}
                style={{ ...s.tab, ...(view === v ? s.tabActive : {}) }}
                onClick={() => setView(v)}
              >
                {v === "table"    && "⊞ Table View"}
                {v === "resource" && "📦 Resource View"}
                {v === "role"     && "👤 Role View"}
              </button>
            ))}
          </div>

          {/* ── TABLE VIEW ─────────────────────────────────────────────────── */}
          {view === "table" && (
            <TableView
              roles={roles}
              resources={resources}
              grants={grants}
              onToggle={toggle}
              onToggleResource={toggleResource}
            />
          )}

          {/* ── RESOURCE VIEW ──────────────────────────────────────────────── */}
          {view === "resource" && (
            <ResourceView
              roles={roles}
              resources={resources}
              grants={grants}
              onToggle={toggle}
              onToggleResource={toggleResource}
            />
          )}

          {/* ── ROLE VIEW ──────────────────────────────────────────────────── */}
          {view === "role" && (
            <RoleView
              roles={roles}
              resources={resources}
              grants={grants}
              onToggle={toggle}
              onToggleResource={toggleResource}
            />
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TABLE VIEW — matrix: roles × (resource → actions)
// ════════════════════════════════════════════════════════════════════════════

function TableView({
  roles, resources, grants, onToggle, onToggleResource: _onToggleResource,
}: {
  roles: Role[]; resources: Resource[]; grants: Grants;
  onToggle: (roleId: string, permId: string) => void;
  onToggleResource: (roleId: string, res: Resource, on: boolean) => void;
}) {
  return (
    <div style={s.tableWrap}>
      <table style={s.matrix}>
        <thead>
          {/* Resource name row */}
          <tr>
            <th style={{ ...s.th, ...s.thRole, background: "#f8f9fc" }}></th>
            {resources.map(res => (
              <th
                key={res.id}
                colSpan={res.permissions.length || 1}
                style={{ ...s.th, ...s.thResource }}
              >
                <span style={s.resNameBadge}>{res.name}</span>
              </th>
            ))}
          </tr>
          {/* Action name row */}
          <tr>
            <th style={{ ...s.th, ...s.thRole }}>Role</th>
            {resources.map(res =>
              res.permissions.length === 0 ? (
                <th key={res.id} style={{ ...s.th, ...s.thAction }}>—</th>
              ) : (
                res.permissions.map(p => {
                  const c = actionColor(p.action);
                  return (
                    <th key={p.id} style={{ ...s.th, ...s.thAction }}>
                      <span style={{ ...s.actionChip, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                        {p.action}
                      </span>
                    </th>
                  );
                })
              )
            )}
          </tr>
        </thead>
        <tbody>
          {roles.map((role, ri) => {
            const g = grants[role.id] ?? new Set();
            return (
              <tr key={role.id} style={{ background: ri % 2 === 0 ? "#fff" : "#f9fafb" }}>
                {/* Role name cell */}
                <td style={s.tdRole}>
                  <div style={s.roleNameCell}>
                    <div style={s.roleAvatar}>{role.name[0].toUpperCase()}</div>
                    <span style={s.roleName}>{role.name}</span>
                  </div>
                </td>
                {/* Permission checkboxes */}
                {resources.map(res =>
                  res.permissions.length === 0 ? (
                    <td key={res.id} style={s.td}><span style={{ color: "#d1d5db" }}>—</span></td>
                  ) : (
                    res.permissions.map(p => {
                      const checked = g.has(p.id);
                      const c = actionColor(p.action);
                      return (
                        <td key={p.id} style={s.td}>
                          <label style={s.checkCell}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggle(role.id, p.id)}
                              style={{ display: "none" }}
                            />
                            <span style={{
                              ...s.matrixCheck,
                              background: checked ? c.bg : "#f3f4f6",
                              border: `1.5px solid ${checked ? c.border : "#e5e7eb"}`,
                              color: checked ? c.text : "#d1d5db",
                            }}>
                              {checked ? "✓" : "—"}
                            </span>
                          </label>
                        </td>
                      );
                    })
                  )
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RESOURCE VIEW — grouped by resource, roles as rows
// ════════════════════════════════════════════════════════════════════════════

function ResourceView({
  roles, resources, grants, onToggle, onToggleResource,
}: {
  roles: Role[]; resources: Resource[]; grants: Grants;
  onToggle: (roleId: string, permId: string) => void;
  onToggleResource: (roleId: string, res: Resource, on: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {resources.map(res => (
        <div key={res.id} style={s.card}>
          {/* Resource header */}
          <div style={s.cardHead}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={s.resIcon}>{res.name[0].toUpperCase()}</div>
              <div>
                <div style={s.resHeading}>{res.name}</div>
                <div style={s.resHint}>{res.permissions.length} permission{res.permissions.length !== 1 ? "s" : ""}</div>
              </div>
            </div>
            {/* Action headers */}
            <div style={{ display: "flex", gap: 8 }}>
              {res.permissions.map(p => {
                const c = actionColor(p.action);
                return (
                  <span key={p.id} style={{ ...s.actionChip, background: c.bg, color: c.text, border: `1px solid ${c.border}`, minWidth: 56, textAlign: "center" }}>
                    {p.action}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Role rows */}
          <div style={s.roleRows}>
            {roles.map((role, ri) => {
              const g = grants[role.id] ?? new Set();
              const allOn = res.permissions.length > 0 && res.permissions.every(p => g.has(p.id));
              const anyOn = res.permissions.some(p => g.has(p.id));
              return (
                <div key={role.id} style={{ ...s.roleRow, background: ri % 2 === 0 ? "#fff" : "#f9fafb" }}>
                  {/* Role name + "all" toggle */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                    <div style={{ ...s.roleAvatar, width: 28, height: 28, fontSize: 12 }}>
                      {role.name[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>{role.name}</span>
                    <label style={s.allToggle}>
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={el => { if (el) el.indeterminate = anyOn && !allOn; }}
                        onChange={e => onToggleResource(role.id, res, e.target.checked)}
                      />
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>All</span>
                    </label>
                  </div>
                  {/* Per-action checkboxes */}
                  <div style={{ display: "flex", gap: 8 }}>
                    {res.permissions.map(p => {
                      const checked = g.has(p.id);
                      const c = actionColor(p.action);
                      return (
                        <label key={p.id} style={{ ...s.checkCell, minWidth: 56, justifyContent: "center" }}>
                          <input type="checkbox" checked={checked} onChange={() => onToggle(role.id, p.id)} style={{ display: "none" }} />
                          <span style={{
                            ...s.matrixCheck,
                            background: checked ? c.bg : "#f3f4f6",
                            border: `1.5px solid ${checked ? c.border : "#e5e7eb"}`,
                            color: checked ? c.text : "#d1d5db",
                          }}>
                            {checked ? "✓" : "—"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ROLE VIEW — grouped by role, resources as rows
// ════════════════════════════════════════════════════════════════════════════

function RoleView({
  roles, resources, grants, onToggle, onToggleResource,
}: {
  roles: Role[]; resources: Resource[]; grants: Grants;
  onToggle: (roleId: string, permId: string) => void;
  onToggleResource: (roleId: string, res: Resource, on: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(roles[0]?.id ?? null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {roles.map(role => {
        const g        = grants[role.id] ?? new Set();
        const isOpen   = expanded === role.id;
        const total    = resources.reduce((n, r) => n + r.permissions.length, 0);
        const granted  = resources.reduce((n, r) => n + r.permissions.filter(p => g.has(p.id)).length, 0);

        return (
          <div key={role.id} style={s.card}>
            {/* Role header — click to expand */}
            <div
              style={{ ...s.cardHead, cursor: "pointer" }}
              onClick={() => setExpanded(isOpen ? null : role.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={s.roleAvatar}>{role.name[0].toUpperCase()}</div>
                <div>
                  <div style={s.resHeading}>{role.name}</div>
                  <div style={s.resHint}>
                    {granted} / {total} permissions granted
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Quick summary chips */}
                {resources.map(res => {
                  const count = res.permissions.filter(p => g.has(p.id)).length;
                  if (count === 0) return null;
                  return (
                    <span key={res.id} style={s.summaryChip}>
                      {res.name} · {count}
                    </span>
                  );
                })}
                <span style={{ color: "#9ca3af", fontSize: 18 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Resource rows */}
            {isOpen && (
              <div style={s.roleRows}>
                {resources.map((res, ri) => {
                  const allOn = res.permissions.length > 0 && res.permissions.every(p => g.has(p.id));
                  const anyOn = res.permissions.some(p => g.has(p.id));
                  return (
                    <div key={res.id} style={{ ...s.roleRow, background: ri % 2 === 0 ? "#fff" : "#f9fafb" }}>
                      {/* Resource name + "all" toggle */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                        <div style={{ ...s.resIcon, width: 28, height: 28, fontSize: 12 }}>
                          {res.name[0].toUpperCase()}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>{res.name}</span>
                        <label style={s.allToggle}>
                          <input
                            type="checkbox"
                            checked={allOn}
                            ref={el => { if (el) el.indeterminate = anyOn && !allOn; }}
                            onChange={e => onToggleResource(role.id, res, e.target.checked)}
                          />
                          <span style={{ fontSize: 12, color: "#9ca3af" }}>All</span>
                        </label>
                      </div>
                      {/* Per-action permission chips */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {res.permissions.length === 0 ? (
                          <span style={{ fontSize: 12, color: "#d1d5db" }}>No permissions defined</span>
                        ) : (
                          res.permissions.map(p => {
                            const checked = g.has(p.id);
                            const c = actionColor(p.action);
                            return (
                              <label key={p.id} style={s.permLabel}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => onToggle(role.id, p.id)}
                                  style={{ display: "none" }}
                                />
                                <span style={{
                                  ...s.permChip,
                                  background: checked ? c.bg : "#f3f4f6",
                                  color: checked ? c.text : "#9ca3af",
                                  border: `1.5px solid ${checked ? c.border : "#e5e7eb"}`,
                                }}>
                                  {checked ? "✓" : "○"} {p.action}
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page:         { padding: "24px 32px", maxWidth: 1100, margin: "0 auto" },
  pageHeader:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 },
  heading:      { fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#111" },
  sub:          { margin: 0, color: "#6b7280", fontSize: 13 },
  center:       { textAlign: "center", padding: 40, color: "#888" },
  error:        { background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "10px 16px", marginBottom: 14, fontSize: 13 },
  warn:         { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 16px", marginBottom: 12, fontSize: 13 },
  successBanner:{ background: "#dcfce7", color: "#166534", borderRadius: 8, padding: "10px 16px", marginBottom: 14, fontSize: 13, fontWeight: 500 },
  saveBtn:      { padding: "10px 24px", borderRadius: 8, border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14, transition: "opacity 0.15s" },
  dirtyBadge:   { padding: "4px 12px", borderRadius: 20, background: "#fef3c7", color: "#92400e", fontSize: 12, fontWeight: 600 },

  // Tabs
  tabBar:       { display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e5e7eb", paddingBottom: 0 },
  tab:          { padding: "10px 20px", border: "none", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#6b7280", borderBottom: "2px solid transparent", marginBottom: -2, borderRadius: "6px 6px 0 0", transition: "all 0.15s" },
  tabActive:    { color: "#4f46e5", borderBottom: "2px solid #4f46e5", fontWeight: 700, background: "#f5f3ff" },

  // Table view
  tableWrap:    { overflowX: "auto", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff" },
  matrix:       { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  th:           { padding: "10px 12px", textAlign: "center", fontWeight: 600, borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" },
  thRole:       { textAlign: "left", background: "#f8f9fc", minWidth: 160, position: "sticky", left: 0, zIndex: 1, borderRight: "1px solid #e5e7eb" },
  thResource:   { background: "#f0f0ff", borderLeft: "2px solid #e5e7eb", color: "#4f46e5" },
  thAction:     { background: "#fafafa", color: "#6b7280", borderLeft: "1px solid #f3f4f6" },
  td:           { padding: "8px 10px", textAlign: "center", borderBottom: "1px solid #f3f4f6", borderLeft: "1px solid #f3f4f6" },
  tdRole:       { padding: "10px 14px", borderBottom: "1px solid #f3f4f6", borderRight: "1px solid #e5e7eb", background: "#fff", position: "sticky", left: 0, zIndex: 1 },

  // Shared card
  card:         { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" },
  cardHead:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #f3f4f6", gap: 12 },

  // Resource
  resIcon:      { width: 36, height: 36, borderRadius: 8, background: "#ede9fe", color: "#5b21b6", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, flexShrink: 0 },
  resHeading:   { fontWeight: 700, fontSize: 15, color: "#111" },
  resHint:      { fontSize: 12, color: "#9ca3af", marginTop: 2 },

  // Role
  roleAvatar:   { width: 34, height: 34, borderRadius: "50%", background: "#e0e7ff", color: "#3730a3", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  roleName:     { fontSize: 14, fontWeight: 600, color: "#111" },
  roleNameCell: { display: "flex", alignItems: "center", gap: 10 },
  roleRows:     { display: "flex", flexDirection: "column" },
  roleRow:      { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", gap: 16, borderBottom: "1px solid #f3f4f6" },
  allToggle:    { display: "flex", alignItems: "center", gap: 4, cursor: "pointer", marginLeft: 8 },
  summaryChip:  { padding: "2px 10px", borderRadius: 20, background: "#e0e7ff", color: "#3730a3", fontSize: 11, fontWeight: 600 },

  // Permission chips
  actionChip:   { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 },
  checkCell:    { display: "flex", alignItems: "center", cursor: "pointer" },
  matrixCheck:  { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 28, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.12s", userSelect: "none" },
  permLabel:    { cursor: "pointer" },
  resNameBadge: { display: "inline-block", padding: "2px 10px", borderRadius: 20, background: "#e0e7ff", color: "#3730a3", fontSize: 11, fontWeight: 700 },
  permChip:     { display: "inline-block", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.12s", userSelect: "none" },
};
