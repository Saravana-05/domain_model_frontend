import { useEffect, useState } from "react";
import { apiListUsers, apiListRoles, apiSetUserRoles } from "../../core/api/rbacApi";
import { useAuthStore } from "../../store/authStore";
import { SetupGuide } from "./SetupGuide";

const API_BASE = import.meta.env.VITE_API_URL ?? "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";

interface Role { id: string; name: string }
interface User { user_id: string; user_name: string; email: string; roles: Role[] }

async function apiCreateUser(data: { user_name: string; email: string; password: string; is_superuser: boolean }) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_BASE}/rbac/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail ?? "Failed to create user");
  return json;
}

export function UserRolesScreen() {
  const [users, setUsers]       = useState<User[]>([]);
  const [roles, setRoles]       = useState<Role[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [saving, setSaving]     = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});

  // Create user form state
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ user_name: "", email: "", password: "", is_superuser: false });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  function normalizeRoles(val: any): Role[] {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") return JSON.parse(val);
    return [];
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rolesRes] = await Promise.all([apiListUsers(), apiListRoles()]);
      const usersData: User[] = (usersRes.data ?? []).map((u: any) => ({
        ...u,
        roles: normalizeRoles(u.roles),
      }));
      setUsers(usersData);
      setRoles(rolesRes.data ?? []);
      const init: Record<string, Set<string>> = {};
      for (const u of usersData) {
        init[u.user_id] = new Set(u.roles.map((r: Role) => r.id));
      }
      setAssignments(init);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function toggle(userId: string, roleId: string) {
    setAssignments((prev) => {
      const set = new Set(prev[userId] ?? []);
      set.has(roleId) ? set.delete(roleId) : set.add(roleId);
      return { ...prev, [userId]: set };
    });
    setSavedUser(null);
  }

  async function saveUser(userId: string) {
    setSaving(userId); setError("");
    try {
      await apiSetUserRoles(userId, [...(assignments[userId] ?? [])]);
      setSavedUser(userId);
      setTimeout(() => setSavedUser(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  }

  async function createUser() {
    if (!form.email || !form.password || !form.user_name) {
      setCreateError("All fields are required"); return;
    }
    setCreating(true); setCreateError("");
    try {
      await apiCreateUser(form);
      setForm({ user_name: "", email: "", password: "", is_superuser: false });
      setShowCreate(false);
      await load();
    } catch (e: any) { setCreateError(e.message); }
    finally { setCreating(false); }
  }

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <SetupGuide currentStep={4} />

      <div style={s.headerRow}>
        <div>
          <h2 style={s.heading}>Users & Role Assignments</h2>
          <p style={s.sub}>
            Create users, then assign them roles. Each role carries its own set of permissions.
          </p>
        </div>
        <button style={s.createBtn} onClick={() => { setShowCreate(true); setCreateError(""); }}>
          + Create User
        </button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {/* Create User Modal */}
      {showCreate && (
        <div style={s.modalOverlay} onClick={() => setShowCreate(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalTitle}>Create New User</h3>

            {createError && <div style={s.error}>{createError}</div>}

            <label style={s.label}>Full Name</label>
            <input
              style={s.input}
              placeholder="e.g. John Doe"
              value={form.user_name}
              onChange={(e) => setForm({ ...form, user_name: e.target.value })}
            />

            <label style={s.label}>Email (used to login)</label>
            <input
              style={s.input}
              type="email"
              placeholder="john@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />

            <label style={s.label}>Password</label>
            <input
              style={s.input}
              type="password"
              placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />

            <div style={s.hint}>Password requirements: 8+ chars, one uppercase letter, one number, one special character (!@#$%…)</div>

            <label style={s.checkRow}>
              <input
                type="checkbox"
                checked={form.is_superuser}
                onChange={(e) => setForm({ ...form, is_superuser: e.target.checked })}
              />
              <span>Make this user a <strong>Product Admin</strong> (bypasses all permission checks)</span>
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={s.btn} onClick={createUser} disabled={creating}>
                {creating ? "Creating…" : "Create User"}
              </button>
              <button style={s.cancelBtn} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {roles.length === 0 && (
        <div style={s.warn}>No roles defined yet — go to Step 2 to create roles first.</div>
      )}

      {users.length === 0 && (
        <div style={s.empty}>
          No users yet. Click <strong>"+ Create User"</strong> above to add the first user.
        </div>
      )}

      <div style={s.list}>
        {users.map((u) => {
          const userRoles = assignments[u.user_id] ?? new Set();
          const isSaving  = saving === u.user_id;
          const isSaved   = savedUser === u.user_id;

          return (
            <div key={u.user_id} style={s.card}>
              <div style={s.userHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={s.avatar}>{(u.user_name || u.email)[0].toUpperCase()}</div>
                  <div>
                    <div style={s.userName}>{u.user_name || "—"}</div>
                    <div style={s.userEmail}>{u.email}</div>
                  </div>
                </div>
                <button
                  style={{ ...s.saveBtn, ...(isSaved ? s.saveBtnDone : {}) }}
                  onClick={() => saveUser(u.user_id)}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving…" : isSaved ? "✓ Saved" : "Save Roles"}
                </button>
              </div>

              <div style={s.rolesSection}>
                <div style={s.rolesLabel}>Assign roles:</div>
                {roles.length === 0 ? (
                  <span style={{ color: "#9ca3af", fontSize: 13 }}>No roles defined yet.</span>
                ) : (
                  <div style={s.rolesRow}>
                    {roles.map((r) => {
                      const checked = userRoles.has(r.id);
                      return (
                        <label key={r.id} style={{ ...s.roleLabel, ...(checked ? s.roleLabelOn : {}) }}>
                          <input type="checkbox" checked={checked} onChange={() => toggle(u.user_id, r.id)} />
                          <span style={{ ...s.rolePill, ...(checked ? s.rolePillOn : s.rolePillOff) }}>
                            {r.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:        { padding: "24px 32px", maxWidth: 860, margin: "0 auto" },
  headerRow:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 16 },
  heading:     { fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#111" },
  sub:         { margin: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.5 },
  createBtn:   { padding: "10px 18px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" },
  center:      { textAlign: "center", padding: 40, color: "#888" },
  error:       { background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "10px 14px", marginBottom: 12, fontSize: 13 },
  warn:        { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 16px", marginBottom: 12, fontSize: 14 },
  empty:       { color: "#9ca3af", fontSize: 14, textAlign: "center", padding: 48, background: "#f9fafb", borderRadius: 10, border: "1px dashed #e5e7eb" },
  list:        { display: "flex", flexDirection: "column", gap: 10, marginTop: 16 },
  card:        { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" },
  userHeader:  { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #f3f4f6" },
  avatar:      { width: 38, height: 38, borderRadius: "50%", background: "#4f46e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 },
  userName:    { fontWeight: 600, fontSize: 15, color: "#111" },
  userEmail:   { fontSize: 13, color: "#6b7280", marginTop: 2 },
  saveBtn:     { padding: "8px 18px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  saveBtnDone: { background: "#059669" },
  rolesSection:{ padding: "12px 18px 14px" },
  rolesLabel:  { fontSize: 12, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" as const, marginBottom: 10 },
  rolesRow:    { display: "flex", gap: 8, flexWrap: "wrap" },
  roleLabel:   { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "4px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff" },
  roleLabelOn: { border: "1.5px solid #a78bfa", background: "#f5f3ff" },
  rolePill:    { padding: "4px 10px", borderRadius: 20, fontSize: 13, fontWeight: 500 },
  rolePillOn:  { background: "#ede9fe", color: "#5b21b6" },
  rolePillOff: { background: "#f3f4f6", color: "#6b7280" },
  // Modal
  modalOverlay:{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal:       { background: "#fff", borderRadius: 14, padding: "28px 32px", width: 460, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 10 },
  modalTitle:  { fontSize: 18, fontWeight: 700, color: "#111", margin: "0 0 8px" },
  label:       { fontSize: 13, fontWeight: 600, color: "#374151" },
  input:       { padding: "10px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 14, outline: "none" },
  hint:        { fontSize: 12, color: "#9ca3af", marginTop: -4 },
  checkRow:    { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "#374151" },
  btn:         { flex: 1, padding: "11px", borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  cancelBtn:   { padding: "11px 20px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 14 },
};
