import { useEffect, useState } from "react";
import {
  apiListResources,
  apiCreateResource,
  apiDeleteResource,
  apiCreatePermission,
  apiDeletePermission,
} from "../../core/api/rbacApi";
import { apiListSchemas } from "../../core/api/datastoreApi";
import { SetupGuide } from "./SetupGuide";

const DEFAULT_ACTIONS = ["create", "view", "edit", "delete"];

interface Permission { id: string; action: string }
interface Resource   { id: string; name: string; description?: string; permissions: Permission[] }

function normalizePerms(val: any): Permission[] {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

export function ResourcesScreen() {
  const [resources, setResources]           = useState<Resource[]>([]);
  const [allDomainNames, setAllDomainNames] = useState<string[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState("");
  const [syncing, setSyncing]               = useState<string | null>(null);
  const [expanded, setExpanded]             = useState<string | null>(null);
  const [toggling, setToggling]             = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      // Fetch RBAC resources + backend datastore schemas in parallel
      const [rbacRes, datastoreRes] = await Promise.all([
        apiListResources(),
        apiListSchemas().catch(() => ({ schemas: [] })), // graceful fallback
      ]);

      setResources(
        (rbacRes.data ?? []).map((r: any) => ({
          ...r,
          permissions: normalizePerms(r.permissions),
        }))
      );

      // Use only backend datastore schema names as the source of truth
      const datastoreNames: string[] = (datastoreRes.schemas ?? []).map(
        (s: any) => s.table_name as string
      );
      setAllDomainNames(datastoreNames);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Sync one domain model into RBAC ────────────────────────────────────────
  async function syncDomain(domainName: string) {
    setSyncing(domainName);
    setError("");
    try {
      const label = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      const existing = resources.find(
        (r) => r.name.toLowerCase() === domainName.toLowerCase()
      );

      let resourceId: string;
      if (existing) {
        resourceId = existing.id;
      } else {
        const res = await apiCreateResource(label, `Domain model: ${domainName}`);
        resourceId = res.data.id;
      }

      const currentPerms = existing?.permissions ?? [];
      for (const action of DEFAULT_ACTIONS) {
        if (!currentPerms.some((p) => p.action === action)) {
          await apiCreatePermission(resourceId, action);
        }
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(null);
    }
  }

  // ── Sync ALL domains at once ───────────────────────────────────────────────
  async function syncAll() {
    for (const name of allDomainNames) {
      const resource = resources.find(
        (r) => r.name.toLowerCase() === name.toLowerCase()
      );
      if (!resource) await syncDomain(name);
    }
  }

  // ── Toggle a single permission checkbox ───────────────────────────────────
  async function togglePermission(resource: Resource, action: string) {
    setToggling(true);
    try {
      const existing = resource.permissions.find((p) => p.action === action);
      if (existing) await apiDeletePermission(existing.id);
      else          await apiCreatePermission(resource.id, action);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setToggling(false);
    }
  }

  // ── Delete a resource ─────────────────────────────────────────────────────
  async function removeResource(id: string) {
    if (!confirm("Delete this resource and all its permissions?")) return;
    try { await apiDeleteResource(id); await load(); }
    catch (e: any) { setError(e.message); }
  }

  if (loading) return <div style={s.center}>Loading…</div>;

  // ── Build lookup: domain name → RBAC resource ──────────────────────────────
  const domainResourceMap = new Map<string, Resource>();
  for (const r of resources) {
    const matched = allDomainNames.find(
      (d) => d.toLowerCase() === r.name.toLowerCase()
    );
    if (matched) domainResourceMap.set(matched, r);
  }

  const orphanResources = resources.filter(
    (r) => !allDomainNames.some((d) => d.toLowerCase() === r.name.toLowerCase())
  );

  const allSynced =
    allDomainNames.length > 0 &&
    allDomainNames.every((d) => domainResourceMap.has(d));

  const unsyncedCount = allDomainNames.filter((d) => !domainResourceMap.has(d)).length;

  return (
    <div style={s.page}>
      <SetupGuide currentStep={2} />

      <div style={s.headerRow}>
        <div>
          <h2 style={s.heading}>Resources & Permissions</h2>
          <p style={s.sub}>
            Each <strong>schema</strong> becomes a protected resource. Tick which actions are
            allowed — these become assignable permissions for roles.
          </p>
        </div>
        {unsyncedCount > 0 && (
          <button style={s.syncAllBtn} onClick={syncAll} disabled={syncing !== null}>
            {syncing ? "Syncing…" : `⚡ Sync All (${unsyncedCount} pending)`}
          </button>
        )}
      </div>

      {error && <div style={s.error}>{error}</div>}

      {/* ── Schema cards (backend datastore + frontend domains, merged) ─────── */}
      <div style={s.sectionLabel}>
        Schemas ({allDomainNames.length})
        <span style={s.sectionHint}> — from datastore</span>
      </div>
      <div style={s.list}>
        {allDomainNames.length === 0 && (
          <div style={s.empty}>No schemas found in the datastore.</div>
        )}

        {allDomainNames.map((domainName) => {
          const resource  = domainResourceMap.get(domainName);
          const isSynced  = !!resource;
          const isSyncing = syncing === domainName;
          return (
            <div key={domainName} style={{ ...s.card, ...(isSynced ? {} : s.cardUnsynced) }}>
              <div style={s.cardHeader}>
                {/* Left: icon + name */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    ...s.icon,
                    background: isSynced ? "#ede9fe" : "#f3f4f6",
                    color: isSynced ? "#5b21b6" : "#9ca3af",
                  }}>
                    {domainName[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={s.resourceName}>
                      {domainName.charAt(0).toUpperCase() + domainName.slice(1)}
                      <span style={{ ...s.badge, ...(isSynced ? s.badgeSynced : s.badgeUnsynced) }}>
                        {isSynced ? "✓ Synced" : "Not synced"}
                      </span>
                    </div>
                    <div style={s.resourceDesc}>
                      {isSynced
                        ? `${resource!.permissions.length} permission${resource!.permissions.length !== 1 ? "s" : ""} defined`
                        : "Click Sync to create RBAC permissions for this schema"}
                    </div>
                  </div>
                </div>

                {/* Right: actions */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {!isSynced && (
                    <button
                      style={s.syncBtn}
                      onClick={() => syncDomain(domainName)}
                      disabled={isSyncing}
                    >
                      {isSyncing ? "Syncing…" : "Sync"}
                    </button>
                  )}
                  {isSynced && (
                    <>
                      <button
                        style={s.iconBtn}
                        onClick={() =>
                          setExpanded(expanded === resource!.id ? null : resource!.id)
                        }
                      >
                        {expanded === resource!.id ? "▲ Hide" : "▼ Edit Permissions"}
                      </button>
                      <button
                        style={s.deleteBtn}
                        onClick={() => removeResource(resource!.id)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Permission chips — visible when synced & not expanded */}
              {isSynced && expanded !== resource!.id && (
                <div style={s.permSummary}>
                  {DEFAULT_ACTIONS.map((action) => {
                    const has = resource!.permissions.some((p) => p.action === action);
                    return (
                      <span key={action} style={{ ...s.chip, ...(has ? s.chipOn : s.chipOff) }}>
                        {has ? "✓" : "✗"} {action}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Expanded permission editor */}
              {isSynced && expanded === resource!.id && (
                <div style={s.permEditor}>
                  <div style={s.permEditorLabel}>Toggle permissions:</div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {DEFAULT_ACTIONS.map((action) => {
                      const has = resource!.permissions.some((p) => p.action === action);
                      return (
                        <label key={action} style={s.checkLabel}>
                          <input
                            type="checkbox"
                            checked={has}
                            disabled={toggling}
                            onChange={() => togglePermission(resource!, action)}
                          />
                          <span style={{ ...s.permTag, ...(has ? s.permTagOn : s.permTagOff) }}>
                            {action}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Custom / orphan resources ──────────────────────────────────────── */}
      <AddCustomResource onAdded={load} />

      {orphanResources.length > 0 && (
        <>
          <div style={{ ...s.sectionLabel, marginTop: 28 }}>Custom Resources</div>
          <div style={s.list}>
            {orphanResources.map((r) => (
              <div key={r.id} style={s.card}>
                <div style={s.cardHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={s.icon}>{r.name[0].toUpperCase()}</div>
                    <div>
                      <div style={s.resourceName}>
                        {r.name}
                        <span style={{ ...s.badge, ...s.badgeSynced }}>Custom</span>
                      </div>
                      <div style={s.resourceDesc}>
                        {r.description ?? `${r.permissions.length} permissions`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={s.iconBtn}
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      {expanded === r.id ? "▲ Hide" : "▼ Edit Permissions"}
                    </button>
                    <button style={s.deleteBtn} onClick={() => removeResource(r.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                <div style={s.permSummary}>
                  {DEFAULT_ACTIONS.map((action) => {
                    const has = r.permissions.some((p) => p.action === action);
                    return (
                      <span key={action} style={{ ...s.chip, ...(has ? s.chipOn : s.chipOff) }}>
                        {has ? "✓" : "✗"} {action}
                      </span>
                    );
                  })}
                </div>
                {expanded === r.id && (
                  <div style={s.permEditor}>
                    <div style={s.permEditorLabel}>Toggle permissions:</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {DEFAULT_ACTIONS.map((action) => {
                        const has = r.permissions.some((p) => p.action === action);
                        return (
                          <label key={action} style={s.checkLabel}>
                            <input
                              type="checkbox"
                              checked={has}
                              disabled={toggling}
                              onChange={() => togglePermission(r, action)}
                            />
                            <span
                              style={{ ...s.permTag, ...(has ? s.permTagOn : s.permTagOff) }}
                            >
                              {action}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {allSynced && allDomainNames.length > 0 && (
        <div style={s.nextStep}>
          All schemas synced. <strong>Next → Step 3: Role Permissions</strong> — assign what each role can do.
        </div>
      )}
    </div>
  );
}

// ── Add custom resource sub-component ─────────────────────────────────────────
function AddCustomResource({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen]     = useState(false);
  const [name, setName]     = useState("");
  const [desc, setDesc]     = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  async function save() {
    if (!name.trim()) return;
    setSaving(true); setError("");
    try {
      const res = await apiCreateResource(name.trim(), desc.trim() || undefined);
      for (const action of DEFAULT_ACTIONS) {
        await apiCreatePermission(res.data.id, action);
      }
      setName(""); setDesc(""); setOpen(false);
      onAdded();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      {!open ? (
        <button style={s.addCustomBtn} onClick={() => setOpen(true)}>
          + Add custom resource
        </button>
      ) : (
        <div style={s.addBox}>
          {error && <div style={{ ...s.error, marginBottom: 8 }}>{error}</div>}
          <input
            style={s.input}
            placeholder="Resource name (e.g. Invoice)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            style={s.input}
            placeholder="Description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.btn} onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Add"}
            </button>
            <button
              style={s.cancelBtn}
              onClick={() => { setOpen(false); setName(""); setDesc(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page:           { padding: "24px 32px", maxWidth: 860, margin: "0 auto" },
  headerRow:      { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 },
  heading:        { fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#111" },
  sub:            { margin: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.5 },
  syncAllBtn:     { padding: "10px 18px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" },
  center:         { textAlign: "center", padding: 40, color: "#888" },
  error:          { background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "10px 14px", fontSize: 13 },
  sectionLabel:   { fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  sectionHint:    { fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 11 },
  list:           { display: "flex", flexDirection: "column", gap: 10 },
  empty:          { color: "#9ca3af", fontSize: 14, textAlign: "center", padding: 24 },
  card:           { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" },
  cardUnsynced:   { border: "1.5px dashed #d1d5db", background: "#fafafa" },
  cardHeader:     { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" },
  icon:           { width: 38, height: 38, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0, background: "#ede9fe", color: "#5b21b6" },
  resourceName:   { fontWeight: 600, fontSize: 15, color: "#111", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  resourceDesc:   { color: "#6b7280", fontSize: 13, marginTop: 3 },
  badge:          { fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20 },
  badgeSynced:    { background: "#dcfce7", color: "#166534" },
  badgeUnsynced:  { background: "#f3f4f6", color: "#9ca3af" },
  syncBtn:        { padding: "8px 16px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  iconBtn:        { padding: "6px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" },
  deleteBtn:      { padding: "6px 12px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", cursor: "pointer", fontSize: 13, color: "#dc2626" },
  permSummary:    { display: "flex", gap: 8, padding: "8px 18px 12px 18px", flexWrap: "wrap" },
  chip:           { padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500 },
  chipOn:         { background: "#dcfce7", color: "#166534" },
  chipOff:        { background: "#f3f4f6", color: "#9ca3af" },
  permEditor:     { padding: "12px 18px 16px", background: "#f9fafb", borderTop: "1px solid #e5e7eb" },
  permEditorLabel:{ fontSize: 12, color: "#9ca3af", marginBottom: 10 },
  checkLabel:     { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" },
  permTag:        { padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500 },
  permTagOn:      { background: "#dcfce7", color: "#166534" },
  permTagOff:     { background: "#f3f4f6", color: "#6b7280" },
  addCustomBtn:   { padding: "8px 16px", borderRadius: 8, border: "1.5px dashed #d1d5db", background: "#fff", color: "#6b7280", cursor: "pointer", fontSize: 13, fontWeight: 500 },
  addBox:         { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 },
  input:          { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 14, outline: "none" },
  btn:            { padding: "9px 20px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  cancelBtn:      { padding: "9px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 14 },
  nextStep:       { marginTop: 24, padding: "12px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14, color: "#166534" },
};
