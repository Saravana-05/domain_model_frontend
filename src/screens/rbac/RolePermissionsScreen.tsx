import { useEffect, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { c, common, checkboxAccent } from "./rbacTheme";
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
  create: c.blue,
  view:   c.green,
  edit:   c.amber,
  delete: c.red,
};
const OFF = { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.10)", text: "#6b6480" };

function actionColor(action: string) {
  return ACTION_COLORS[action] ?? { bg: "rgba(167,139,250,0.12)", text: "#c4b0fa", border: "rgba(139,92,246,0.35)" };
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

  if (loading) return <div style={common.center}>Loading…</div>;

  return (
    <div style={common.page}>

      {/* ── Page header ── */}
      <div style={common.header}>
        <div>
          <h1 style={common.title}>Roles &amp; Permissions</h1>
          <p style={common.subtitle}>
            {roles.length} role{roles.length !== 1 ? "s" : ""} · {resources.length} resource{resources.length !== 1 ? "s" : ""} · {totalPerms} permissions
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {dirty.size > 0 && (
            <span style={s.dirtyBadge}>{dirty.size} unsaved</span>
          )}
          <button
            className="page-header-btn page-header-btn--import"
            style={{ opacity: dirty.size === 0 ? 0.45 : 1 }}
            onClick={saveAll}
            disabled={saving || dirty.size === 0}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {error  && <div style={common.error}>{error}</div>}
      {toast  && <div style={common.success}>{toast}</div>}
      {roles.length === 0     && <div style={common.warn}>No roles yet — create roles first.</div>}
      {resources.length === 0 && <div style={common.warn}>No resources yet — sync domain models first.</div>}

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
  roles, resources, grants, onToggle, onToggleResource,
}: {
  roles: Role[]; resources: Resource[]; grants: Grants;
  onToggle: (roleId: string, permId: string) => void;
  onToggleResource: (roleId: string, res: Resource, on: boolean) => void;
}) {
  // Rows = resources (domain models), columns = roles. Each cell holds that
  // role's action toggles for the resource, so the table grows downward
  // (vertical scroll) instead of sideways.
  return (
    <div style={s.tableWrap}>
      <table style={s.matrix}>
        <thead>
          <tr>
            <th style={{ ...s.th, ...s.thRole, zIndex: 3 }}>Resource</th>
            {roles.map(role => (
              <th key={role.id} style={{ ...s.th, ...s.thSticky }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <div style={{ ...s.roleAvatar, width: 26, height: 26, fontSize: 12 }}>{role.name[0].toUpperCase()}</div>
                  <span style={s.roleName}>{role.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((res, ri) => (
            <tr key={res.id} style={{ background: ri % 2 === 0 ? c.card : "#2f2840" }}>
              <td style={s.tdRole}>
                <div style={s.roleNameCell}>
                  <div style={{ ...s.resIcon, width: 30, height: 30, fontSize: 13 }}>{res.name[0].toUpperCase()}</div>
                  <span style={s.roleName}>{res.name}</span>
                </div>
              </td>
              {roles.map(role => {
                const g = grants[role.id] ?? new Set<string>();
                const allOn = res.permissions.length > 0 && res.permissions.every(p => g.has(p.id));
                const anyOn = res.permissions.some(p => g.has(p.id));
                return (
                  <td key={role.id} style={s.td}>
                    {res.permissions.length === 0 ? (
                      <span style={{ color: OFF.text }}>—</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                        <label style={{ ...s.allToggle, marginLeft: 0 }} title="Toggle all">
                          <input
                            type="checkbox"
                            style={checkboxAccent}
                            checked={allOn}
                            ref={el => { if (el) el.indeterminate = anyOn && !allOn; }}
                            onChange={e => onToggleResource(role.id, res, e.target.checked)}
                          />
                        </label>
                        {res.permissions.map(p => {
                          const checked = g.has(p.id);
                          const ac = actionColor(p.action);
                          return (
                            <label key={p.id} style={s.permLabel}>
                              <input type="checkbox" checked={checked} onChange={() => onToggle(role.id, p.id)} style={{ display: "none" }} />
                              <span style={{
                                ...s.permChip,
                                padding: "3px 9px",
                                fontSize: 11,
                                background: checked ? ac.bg : OFF.bg,
                                color: checked ? ac.text : OFF.text,
                                border: `1.5px solid ${checked ? ac.border : OFF.border}`,
                              }}>
                                {p.action}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
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
                const ac = actionColor(p.action);
                return (
                  <span key={p.id} style={{ ...s.actionChip, background: ac.bg, color: ac.text, border: `1px solid ${ac.border}`, minWidth: 56, textAlign: "center" }}>
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
                <div key={role.id} style={{ ...s.roleRow, background: ri % 2 === 0 ? c.card : "#2f2840" }}>
                  {/* Role name + "all" toggle */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                    <div style={{ ...s.roleAvatar, width: 28, height: 28, fontSize: 12 }}>
                      {role.name[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: c.text }}>{role.name}</span>
                    <label style={s.allToggle}>
                      <input
                        type="checkbox"
                        style={checkboxAccent}
                        checked={allOn}
                        ref={el => { if (el) el.indeterminate = anyOn && !allOn; }}
                        onChange={e => onToggleResource(role.id, res, e.target.checked)}
                      />
                      <span style={{ fontSize: 12, color: c.textSub }}>All</span>
                    </label>
                  </div>
                  {/* Per-action checkboxes */}
                  <div style={{ display: "flex", gap: 8 }}>
                    {res.permissions.map(p => {
                      const checked = g.has(p.id);
                      const ac = actionColor(p.action);
                      return (
                        <label key={p.id} style={{ ...s.checkCell, minWidth: 56, justifyContent: "center" }}>
                          <input type="checkbox" checked={checked} onChange={() => onToggle(role.id, p.id)} style={{ display: "none" }} />
                          <span style={{
                            ...s.matrixCheck,
                            background: checked ? ac.bg : OFF.bg,
                            border: `1.5px solid ${checked ? ac.border : OFF.border}`,
                            color: checked ? ac.text : OFF.text,
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
                <span style={{ color: c.textMuted, fontSize: 18 }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Resource rows */}
            {isOpen && (
              <div style={s.roleRows}>
                {resources.map((res, ri) => {
                  const allOn = res.permissions.length > 0 && res.permissions.every(p => g.has(p.id));
                  const anyOn = res.permissions.some(p => g.has(p.id));
                  return (
                    <div key={res.id} style={{ ...s.roleRow, background: ri % 2 === 0 ? c.card : "#2f2840" }}>
                      {/* Resource name + "all" toggle */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                        <div style={{ ...s.resIcon, width: 28, height: 28, fontSize: 12 }}>
                          {res.name[0].toUpperCase()}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 600, color: c.text }}>{res.name}</span>
                        <label style={s.allToggle}>
                          <input
                            type="checkbox"
                            style={checkboxAccent}
                            checked={allOn}
                            ref={el => { if (el) el.indeterminate = anyOn && !allOn; }}
                            onChange={e => onToggleResource(role.id, res, e.target.checked)}
                          />
                          <span style={{ fontSize: 12, color: c.textSub }}>All</span>
                        </label>
                      </div>
                      {/* Per-action permission chips */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {res.permissions.length === 0 ? (
                          <span style={{ fontSize: 12, color: c.textMuted }}>No permissions defined</span>
                        ) : (
                          res.permissions.map(p => {
                            const checked = g.has(p.id);
                            const ac = actionColor(p.action);
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
                                  background: checked ? ac.bg : OFF.bg,
                                  color: checked ? ac.text : OFF.text,
                                  border: `1.5px solid ${checked ? ac.border : OFF.border}`,
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
const rowBorder = "1px solid rgba(255,255,255,0.06)";
const s: Record<string, CSSProperties> = {
  dirtyBadge:   { padding: "4px 12px", borderRadius: 20, background: c.amber.bg, color: c.amber.text, border: `1px solid ${c.amber.border}`, fontSize: 12, fontWeight: 700 },

  // Tabs
  tabBar:       { display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${c.border}` },
  tab:          { padding: "10px 18px", border: "none", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600, color: c.textSub, borderBottom: "2px solid transparent", marginBottom: -1, borderRadius: "8px 8px 0 0", transition: "all 0.15s", fontFamily: "inherit" },
  tabActive:    { color: "#fff", borderBottom: `2px solid ${c.accent}`, background: c.accentSoft },

  // Table view
  tableWrap:    { overflow: "auto", maxHeight: "calc(100vh - 300px)", minHeight: 240, borderRadius: 12, border: `1px solid ${c.border}`, background: c.card },
  matrix:       { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  th:           { padding: "10px 12px", textAlign: "center", fontWeight: 600, borderBottom: `1px solid ${c.border}`, whiteSpace: "nowrap", color: c.textSub },
  thSticky:     { position: "sticky", top: 0, zIndex: 2, background: c.cardRaised, minWidth: 200 },
  thRole:       { textAlign: "left", background: c.cardRaised, minWidth: 200, position: "sticky", top: 0, left: 0, zIndex: 1, borderRight: `1px solid ${c.border}` },
  thResource:   { background: "rgba(139,92,246,0.14)", borderLeft: `2px solid ${c.border}`, color: c.accentText },
  thAction:     { background: "rgba(0,0,0,0.15)", color: c.textSub, borderLeft: rowBorder },
  td:           { padding: "8px 10px", textAlign: "center", borderBottom: rowBorder, borderLeft: rowBorder },
  tdRole:       { padding: "10px 14px", borderBottom: rowBorder, borderRight: `1px solid ${c.border}`, background: "#2f2840", position: "sticky", left: 0, zIndex: 1 },

  // Shared card
  card:         common.card,
  cardHead:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: rowBorder, gap: 12, flexWrap: "wrap" },

  // Resource
  resIcon:      { ...common.icon, width: 36, height: 36, fontSize: 15 },
  resHeading:   { fontWeight: 700, fontSize: 15, color: c.text },
  resHint:      { fontSize: 12, color: c.textSub, marginTop: 2 },

  // Role
  roleAvatar:   { width: 34, height: 34, borderRadius: "50%", background: c.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  roleName:     { fontSize: 14, fontWeight: 600, color: c.text },
  roleNameCell: { display: "flex", alignItems: "center", gap: 10 },
  roleRows:     { display: "flex", flexDirection: "column" },
  roleRow:      { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", gap: 16, borderBottom: rowBorder, flexWrap: "wrap" },
  allToggle:    { display: "flex", alignItems: "center", gap: 4, cursor: "pointer", marginLeft: 8 },
  summaryChip:  { padding: "2px 10px", borderRadius: 20, background: c.accentSoft, color: "#c4b0fa", border: `1px solid ${c.accentBorder}`, fontSize: 11, fontWeight: 700 },

  // Permission chips
  actionChip:   { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 },
  checkCell:    { display: "flex", alignItems: "center", cursor: "pointer" },
  matrixCheck:  { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 28, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.12s", userSelect: "none" },
  permLabel:    { cursor: "pointer" },
  resNameBadge: { display: "inline-block", padding: "2px 10px", borderRadius: 20, background: c.accentSoft, color: "#c4b0fa", border: `1px solid ${c.accentBorder}`, fontSize: 11, fontWeight: 700 },
  permChip:     { display: "inline-block", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.12s", userSelect: "none" },
};