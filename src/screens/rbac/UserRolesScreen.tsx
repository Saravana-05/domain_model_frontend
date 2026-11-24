import { useEffect, useState } from "react";
import { apiListUsers, apiListRoles, apiSetUserRoles } from "../../core/api/rbacApi";
import { useAuthStore } from "../../store/authStore";
import type { CSSProperties } from "react";
import AddIcon from "@mui/icons-material/Add";
import { c, common, checkboxAccent } from "./rbacTheme";

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

  if (loading) return <div style={common.center}>Loading…</div>;

  return (
    <div style={common.page}>

      <div style={common.header}>
        <div>
          <h1 style={common.title}>Users & Role Assignments</h1>
          <p style={common.subtitle}>
            Create users, then assign them roles. Each role carries its own set of permissions.
          </p>
        </div>
        <button
          className="page-header-btn page-header-btn--import"
          onClick={() => { setShowCreate(true); setCreateError(""); }}
        >
          <AddIcon sx={{ fontSize: 17 }} />
          Create User
        </button>
      </div>

      {error && <div style={common.error}>{error}</div>}

      {/* Create User Modal */}
      {showCreate && (
        <div style={common.backdrop} onMouseDown={() => { if (!creating) setShowCreate(false); }}>
          <div style={common.dialog} onMouseDown={(e) => e.stopPropagation()}>
            <h3 style={s.modalTitle}>Create New User</h3>

            {createError && <div style={common.error}>{createError}</div>}

            <label style={common.label}>Full Name</label>
            <input
              style={common.input}
              placeholder="e.g. John Doe"
              value={form.user_name}
              onChange={(e) => setForm({ ...form, user_name: e.target.value })}
            />

            <label style={common.label}>Email (used to login)</label>
            <input
              style={common.input}
              type="email"
              placeholder="john@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />

            <label style={common.label}>Password</label>
            <input
              style={common.input}
              type="password"
              placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />

            <div style={s.hint}>Password requirements: 8+ chars, one uppercase letter, one number, one special character (!@#$%…)</div>

            <label style={s.checkRow}>
              <input
                type="checkbox"
                style={checkboxAccent}
                checked={form.is_superuser}
                onChange={(e) => setForm({ ...form, is_superuser: e.target.checked })}
              />
              <span>Make this user a <strong style={{ color: c.text }}>Product Admin</strong> (bypasses all permission checks)</span>
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                className="page-header-btn page-header-btn--import"
                style={{ flex: 1, justifyContent: "center", opacity: creating ? 0.6 : 1 }}
                onClick={createUser}
                disabled={creating}
              >
                {creating ? "Creating…" : "Create User"}
              </button>
              <button style={common.btnGhost} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {roles.length === 0 && (
        <div style={common.warn}>No roles defined yet — go to Step 2 to create roles first.</div>
      )}

      {users.length === 0 && (
        <div style={common.empty}>
          No users yet. Click <strong style={{ color: c.text }}>"+ Create User"</strong> above to add the first user.
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
                  className="page-header-btn page-header-btn--import"
                  style={{ padding: "8px 18px", opacity: isSaving ? 0.6 : 1, ...(isSaved ? s.saveBtnDone : {}) }}
                  onClick={() => saveUser(u.user_id)}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving…" : isSaved ? "✓ Saved" : "Save Roles"}
                </button>
              </div>

              <div style={s.rolesSection}>
                <div style={s.rolesLabel}>Assign roles:</div>
                {roles.length === 0 ? (
                  <span style={{ color: c.textMuted, fontSize: 13 }}>No roles defined yet.</span>
                ) : (
                  <div style={s.rolesRow}>
                    {roles.map((r) => {
                      const checked = userRoles.has(r.id);
                      return (
                        <label key={r.id} style={{ ...s.roleLabel, ...(checked ? s.roleLabelOn : {}) }}>
                          <input type="checkbox" style={checkboxAccent} checked={checked} onChange={() => toggle(u.user_id, r.id)} />
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

const s: Record<string, CSSProperties> = {
  list:        { display: "flex", flexDirection: "column", gap: 10, marginTop: 16 },
  card:        common.card,
  userHeader:  { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${c.border}`, gap: 12 },
  avatar:      { width: 38, height: 38, borderRadius: "50%", background: c.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 },
  userName:    { fontWeight: 700, fontSize: 15, color: c.text },
  userEmail:   { fontSize: 12, color: c.textSub, marginTop: 2 },
  saveBtnDone: { background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)", boxShadow: "0 2px 8px rgba(22,163,74,0.35)" },
  rolesSection:{ padding: "12px 18px 16px" },
  rolesLabel:  { fontSize: 11, color: c.accentText, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  rolesRow:    { display: "flex", gap: 8, flexWrap: "wrap" },
  roleLabel:   { display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "4px 8px", borderRadius: 8, border: `1px solid ${c.borderInput}`, background: c.inputBg },
  roleLabelOn: { border: `1px solid ${c.accentBorder}`, background: c.accentSoft },
  rolePill:    { padding: "3px 8px", borderRadius: 20, fontSize: 13, fontWeight: 600 },
  rolePillOn:  { color: "#c4b0fa" },
  rolePillOff: { color: c.textSub },
  modalTitle:  { fontSize: 18, fontWeight: 700, color: c.text, margin: "0 0 8px" },
  hint:        { fontSize: 12, color: c.textMuted, marginTop: -4 },
  checkRow:    { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: c.textSub },
};