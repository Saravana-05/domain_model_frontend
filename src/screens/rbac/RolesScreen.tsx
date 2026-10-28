import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import AddIcon from "@mui/icons-material/Add";
import { apiListRoles, apiCreateRole, apiDeleteRole } from "../../core/api/rbacApi";
import { c, common } from "./rbacTheme";

interface Role { id: string; name: string; description?: string }

const PRESET_ROLES = [
  { name: "Admin",   description: "Full access to everything" },
  { name: "Manager", description: "Can view and edit, but not delete" },
  { name: "Viewer",  description: "Read-only access" },
];

export function RolesScreen() {
  const [roles, setRoles]     = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiListRoles();
      setRoles(res.data ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function addRole(name: string, desc?: string) {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiCreateRole(name.trim(), desc?.trim() || undefined);
      setNewName(""); setNewDesc("");
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function removeRole(id: string) {
    if (!confirm("Delete this role? Users with this role will lose its permissions.")) return;
    try { await apiDeleteRole(id); await load(); }
    catch (e: any) { setError(e.message); }
  }

  const existingNames = new Set(roles.map((r) => r.name.toLowerCase()));

  if (loading) return <div style={common.center}>Loading…</div>;

  return (
    <div style={common.page}>

      <div style={common.header}>
        <div>
          <h1 style={common.title}>Roles</h1>
          <p style={common.subtitle}>
            A <strong style={{ color: c.text }}>Role</strong> is a named group of permissions. Users are
            assigned roles, not individual permissions directly.
          </p>
        </div>
      </div>

      {error && <div style={common.error}>{error}</div>}

      {/* Preset role quick-add */}
      {PRESET_ROLES.some((p) => !existingNames.has(p.name.toLowerCase())) && (
        <div style={s.presetBox}>
          <div style={s.presetLabel}>Quick start — add common roles</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESET_ROLES.filter((p) => !existingNames.has(p.name.toLowerCase())).map((p) => (
              <button key={p.name} style={s.presetBtn} onClick={() => addRole(p.name, p.description)}>
                + {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom role form */}
      <div style={s.addBox}>
        <input
          style={{ ...common.input, flex: 1, minWidth: 180, width: "auto" }}
          placeholder="Custom role name (e.g. Auditor)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addRole(newName, newDesc)}
        />
        <input
          style={{ ...common.input, flex: 1, minWidth: 180, width: "auto" }}
          placeholder="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button
          className="page-header-btn page-header-btn--import"
          style={{ opacity: saving || !newName.trim() ? 0.5 : 1 }}
          onClick={() => addRole(newName, newDesc)}
          disabled={saving || !newName.trim()}
        >
          <AddIcon sx={{ fontSize: 17 }} />
          {saving ? "Adding…" : "Add Role"}
        </button>
      </div>

      {roles.length === 0 && (
        <div style={common.empty}>No roles yet — use the quick-start buttons above or create a custom one.</div>
      )}

      <div style={s.list}>
        {roles.map((r) => (
          <div key={r.id} style={s.card}>
            <div style={common.icon}>{r.name[0].toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={common.cardTitle}>{r.name}</div>
              <div style={common.cardDesc}>{r.description ?? "No description"}</div>
            </div>
            <button style={common.btnDanger} onClick={() => removeRole(r.id)}>Delete</button>
          </div>
        ))}
      </div>

      {/* {roles.length > 0 && (
        <div style={common.nextStep}>
          Roles ready. <strong>Next → Step 2: Resources</strong> — sync your domain models and define permissions.
        </div>
      )} */}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  presetBox:   { background: c.accentSoft, border: `1px solid ${c.accentBorder}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 },
  presetLabel: { fontSize: 12, color: c.accentText, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 },
  presetBtn:   { padding: "7px 14px", borderRadius: 8, border: `1px solid ${c.accentBorder}`, background: "rgba(139,92,246,0.14)", color: "#c4b0fa", fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  addBox:      { display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" },
  list:        { display: "flex", flexDirection: "column", gap: 10 },
  card:        { ...common.card, display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" },
};