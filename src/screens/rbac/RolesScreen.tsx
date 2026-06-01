import { useEffect, useState } from "react";
import { apiListRoles, apiCreateRole, apiDeleteRole } from "../../core/api/rbacApi";
import { SetupGuide } from "./SetupGuide";

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

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <SetupGuide currentStep={1} />

      <h2 style={s.heading}>Roles</h2>
      <p style={s.sub}>
        A <strong>Role</strong> is a named group of permissions. Users are assigned roles, not
        individual permissions directly.
      </p>

      {error && <div style={s.error}>{error}</div>}

      {/* Preset role quick-add */}
      {PRESET_ROLES.some((p) => !existingNames.has(p.name.toLowerCase())) && (
        <div style={s.presetBox}>
          <div style={s.presetLabel}>Quick start — add common roles:</div>
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
          style={s.input}
          placeholder="Custom role name (e.g. Auditor)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addRole(newName, newDesc)}
        />
        <input
          style={s.input}
          placeholder="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button style={s.btn} onClick={() => addRole(newName, newDesc)} disabled={saving || !newName.trim()}>
          {saving ? "Adding…" : "+ Add Role"}
        </button>
      </div>

      {roles.length === 0 && (
        <div style={s.empty}>No roles yet — use the quick-start buttons above or create a custom one.</div>
      )}

      <div style={s.list}>
        {roles.map((r) => (
          <div key={r.id} style={s.card}>
            <div style={s.rolePill}>{r.name[0].toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={s.roleName}>{r.name}</div>
              <div style={s.roleDesc}>{r.description ?? "No description"}</div>
            </div>
            <button style={s.delBtn} onClick={() => removeRole(r.id)}>Delete</button>
          </div>
        ))}
      </div>

      {roles.length > 0 && (
        <div style={s.nextStep}>
          Roles ready. <strong>Next → Step 2: Resources</strong> — sync your domain models and define permissions.
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:       { padding: "24px 32px", maxWidth: 800, margin: "0 auto" },
  heading:    { fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#111" },
  sub:        { margin: "0 0 20px", color: "#6b7280", fontSize: 14, lineHeight: 1.5 },
  center:     { textAlign: "center", padding: 40, color: "#888" },
  error:      { background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13 },
  presetBox:  { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "14px 16px", marginBottom: 16 },
  presetLabel:{ fontSize: 13, color: "#1e40af", fontWeight: 600, marginBottom: 10 },
  presetBtn:  { padding: "8px 16px", borderRadius: 8, border: "1.5px solid #4f46e5", background: "#fff", color: "#4f46e5", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  addBox:     { display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" },
  input:      { flex: 1, minWidth: 160, padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 14, outline: "none" },
  btn:        { padding: "9px 18px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  empty:      { color: "#9ca3af", fontSize: 14, textAlign: "center", padding: 40, background: "#f9fafb", borderRadius: 10, border: "1px dashed #e5e7eb" },
  list:       { display: "flex", flexDirection: "column", gap: 8 },
  card:       { display: "flex", alignItems: "center", gap: 14, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 18px" },
  rolePill:   { width: 36, height: 36, borderRadius: 8, background: "#ede9fe", color: "#5b21b6", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 },
  roleName:   { fontWeight: 600, fontSize: 15, color: "#111" },
  roleDesc:   { fontSize: 13, color: "#6b7280", marginTop: 2 },
  delBtn:     { padding: "6px 14px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 13 },
  nextStep:   { marginTop: 20, padding: "12px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14, color: "#166534" },
};
