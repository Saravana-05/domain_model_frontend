import { useCallback, useEffect, useMemo, useState } from "react";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import TableChartOutlinedIcon   from "@mui/icons-material/TableChartOutlined";
import PeopleAltOutlinedIcon    from "@mui/icons-material/PeopleAltOutlined";
import CheckIcon                from "@mui/icons-material/Check";
import { useProjectStore } from "../core/store/projectStore";
import {
  apiListProjectUsers,
  apiAddProjectUser,
  apiSetProjectUserRoles,
  apiRemoveProjectUser,
  apiErrorMessage,
  type ProjectUser,
} from "../core/api/projectApi";
import { apiListRoles, apiListUsers } from "../core/api/rbacApi";

interface Role { id: string; name: string }
interface AnyUser { user_id: string; user_name: string; email: string }

/**
 * Users of ONE project (admin only).
 *
 * Shows the rows of that project's own user table (named after the project,
 * e.g. idam.testing_user). Adding a user here links them to RBAC: they become
 * a member of the project and get the chosen roles inside this project only.
 */
export function ProjectUsersScreen({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));

  const [users, setUsers]       = useState<ProjectUser[]>([]);
  const [table, setTable]       = useState<string | null>(null);
  const [roles, setRoles]       = useState<Role[]>([]);
  const [allUsers, setAllUsers] = useState<AnyUser[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // add form
  const [mode, setMode]         = useState<"existing" | "new">("existing");
  const [pickUser, setPickUser] = useState("");
  const [newName, setNewName]   = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass]   = useState("");
  const [addRoles, setAddRoles] = useState<Set<string>>(new Set());
  const [busy, setBusy]         = useState(false);
  // Fields start read-only and unlock on focus: stops the browser's saved-login
  // autofill from pre-filling the new user's name / email / password.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const noAutofill = (id: string) => ({
    name:         `new-project-user-${id}`,
    autoComplete: id === "pass" ? "new-password" : "off",
    readOnly:     !unlocked.has(id),
    onFocus:      () => setUnlocked((s) => (s.has(id) ? s : new Set(s).add(id))),
  });

  // inline role editing
  const [editing, setEditing]     = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pu, r, u] = await Promise.all([
        apiListProjectUsers(projectId),
        apiListRoles().catch(() => ({ data: [] })),
        apiListUsers().catch(() => ({ data: [] })),
      ]);
      setUsers(pu.data ?? []);
      setTable(pu.table ?? null);
      setRoles(r.data ?? []);
      setAllUsers(u.data ?? []);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't load project users"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setEditing(null);
    load();
  }, [load]);

  const available = useMemo(() => {
    const inProject = new Set(users.map((u) => u.user_id));
    return allUsers.filter((u) => !inProject.has(u.user_id));
  }, [allUsers, users]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  async function handleAdd() {
    setError(null);
    if (mode === "existing" && !pickUser) { setError("Pick a user to add."); return; }
    if (mode === "new" && (!newName.trim() || !newEmail.trim() || !newPass)) {
      setError("Name, email and password are required for a new user."); return;
    }
    setBusy(true);
    try {
      await apiAddProjectUser(projectId, {
        ...(mode === "existing"
          ? { user_id: pickUser }
          : { new_user: { user_name: newName.trim(), email: newEmail.trim(), password: newPass } }),
        role_ids: [...addRoles],
      });
      setPickUser(""); setNewName(""); setNewEmail(""); setNewPass(""); setAddRoles(new Set());
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't add the user"));
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles(userId: string) {
    setError(null);
    setBusy(true);
    try {
      await apiSetProjectUserRoles(projectId, userId, [...editRoles]);
      setEditing(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save the roles"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: ProjectUser) {
    if (!window.confirm(`Remove ${u.user_name} from ${project?.name ?? "this project"}? Their roles in this project are removed too.`)) return;
    setError(null);
    try {
      await apiRemoveProjectUser(projectId, u.user_id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't remove the user"));
    }
  }

  const roleChips = (selected: Set<string>, onToggle: (id: string) => void) => (
    <div style={styles.chips}>
      {roles.length === 0 && <span style={styles.muted}>No roles yet — create some under Access Control.</span>}
      {roles.map((r) => {
        const on = selected.has(r.id);
        return (
          <button
            key={r.id}
            type="button"
            style={{ ...styles.chip, ...(on ? styles.chipOn : {}) }}
            onClick={() => onToggle(r.id)}
          >
            {on && <CheckIcon sx={{ fontSize: 14 }} />}
            {r.name}
          </button>
        );
      })}
    </div>
  );

  const initial = (u: ProjectUser) => (u.user_name?.[0] ?? u.email?.[0] ?? "?").toUpperCase();

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.crumb}>{project?.name ?? "Project"}</div>
            <h1 style={styles.title}>Project users</h1>
            <p style={styles.subtitle}>
              Add people to this project and choose what they can do here. Roles apply only inside this project.
            </p>
          </div>
          {table && (
            <span style={styles.tableTag} title="The database table that holds this project's users">
              <TableChartOutlinedIcon sx={{ fontSize: 15 }} />
              {table}
            </span>
          )}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Add user */}
        <section style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.cardIcon}><PersonAddAltOutlinedIcon sx={{ fontSize: 19 }} /></span>
            <div>
              <div style={styles.cardTitle}>Add a user</div>
              <div style={styles.cardHint}>Pick someone who already has an account, or create a new one.</div>
            </div>
          </div>

          <div style={styles.segment}>
            <button type="button" style={{ ...styles.segBtn, ...(mode === "existing" ? styles.segOn : {}) }} onClick={() => setMode("existing")}>
              Existing user
            </button>
            <button type="button" style={{ ...styles.segBtn, ...(mode === "new" ? styles.segOn : {}) }} onClick={() => setMode("new")}>
              New user
            </button>
          </div>

          {mode === "existing" ? (
            <div style={styles.field}>
              <label style={styles.label}>User</label>
              <select style={styles.input} value={pickUser} onChange={(e) => setPickUser(e.target.value)}>
                <option value="">
                  {available.length === 0 ? "Everyone is already in this project" : "Select a user…"}
                </option>
                {available.map((u) => (
                  <option key={u.user_id} value={u.user_id}>{u.user_name} — {u.email}</option>
                ))}
              </select>
            </div>
          ) : (
            <div style={styles.newGrid}>
              <div style={styles.field}>
                <label style={styles.label}>Name</label>
                <input style={styles.input} {...noAutofill("name")} placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Email</label>
                <input style={styles.input} {...noAutofill("email")} placeholder="name@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Password</label>
                <input style={styles.input} {...noAutofill("pass")} placeholder="8+ chars, A-Z, 0-9, symbol" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
              </div>
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Roles in this project</label>
            {roleChips(addRoles, (id) => setAddRoles((s) => toggle(s, id)))}
          </div>

          <div style={styles.actions}>
            <button type="button" style={{ ...styles.primaryBtn, ...(busy ? styles.btnDisabled : {}) }} disabled={busy} onClick={handleAdd}>
              <PersonAddAltOutlinedIcon sx={{ fontSize: 17 }} />
              {busy ? "Adding…" : "Add to project"}
            </button>
          </div>
        </section>

        {/* Users */}
        <section style={styles.card}>
          <div style={styles.cardHead}>
            <span style={styles.cardIcon}><PeopleAltOutlinedIcon sx={{ fontSize: 19 }} /></span>
            <div style={{ flex: 1 }}>
              <div style={styles.cardTitle}>
                Users in this project <span style={styles.count}>{users.length}</span>
              </div>
            </div>
          </div>

          {loading && users.length === 0 && <div style={styles.muted}>Loading…</div>}

          {!loading && users.length === 0 && (
            <div style={styles.empty}>
              <PeopleAltOutlinedIcon sx={{ fontSize: 34, color: "#6f6786" }} />
              <div style={styles.emptyTitle}>No users yet</div>
              <div style={styles.emptyText}>Only admins can access this project until you add people above.</div>
            </div>
          )}

          <div style={styles.list}>
            {users.map((u) => (
              <div key={u.user_id} style={styles.userRow}>
                <div style={styles.avatar}>{initial(u)}</div>

                <div style={styles.userMain}>
                  <div style={styles.userName}>{u.user_name}</div>
                  <div style={styles.userEmail}>{u.email}</div>

                  <div style={{ marginTop: 10 }}>
                    {editing === u.user_id ? (
                      roleChips(editRoles, (id) => setEditRoles((s) => toggle(s, id)))
                    ) : u.roles.length > 0 ? (
                      <div style={styles.chips}>
                        {u.roles.map((r) => <span key={r.id} style={{ ...styles.chip, ...styles.chipOn, cursor: "default" }}>{r.name}</span>)}
                      </div>
                    ) : (
                      <span style={styles.noRole}>No role yet — can't do anything in this project</span>
                    )}
                  </div>
                </div>

                <div style={styles.rowActions}>
                  {editing === u.user_id ? (
                    <>
                      <button type="button" style={styles.smallPrimary} disabled={busy} onClick={() => saveRoles(u.user_id)}>Save</button>
                      <button type="button" style={styles.smallGhost} onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        style={styles.smallGhost}
                        onClick={() => { setEditing(u.user_id); setEditRoles(new Set(u.roles.map((r) => r.id))); }}
                      >
                        Edit roles
                      </button>
                      <button type="button" style={styles.smallDanger} onClick={() => remove(u)}>Remove</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page:      { padding: "28px clamp(16px, 3vw, 40px) 48px", color: "#f5f3fa" },
  inner:     { maxWidth: 920, margin: "0 auto" },

  header:    { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 24 },
  crumb:     { fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#a78bfa", marginBottom: 4 },
  title:     { fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.2 },
  subtitle:  { margin: "8px 0 0", color: "#b3abc7", fontSize: 14, lineHeight: 1.5, maxWidth: 520 },
  tableTag:  { display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 20, background: "#241f31", border: "1px solid rgba(125,211,252,0.25)", color: "#7dd3fc", fontSize: 13, fontWeight: 600, fontFamily: "ui-monospace, Menlo, Consolas, monospace" },
  error:     { background: "rgba(248,113,113,0.12)", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 10, padding: "11px 14px", fontSize: 14, marginBottom: 18 },

  card:      { background: "#332c42", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "22px 24px", marginBottom: 22 },
  cardHead:  { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 },
  cardIcon:  { width: 36, height: 36, borderRadius: 10, background: "rgba(167,139,250,0.16)", color: "#c4b5fd", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardTitle: { fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 },
  cardHint:  { fontSize: 13, color: "#b3abc7", marginTop: 2 },
  count:     { fontSize: 12, fontWeight: 700, color: "#c4b5fd", background: "rgba(167,139,250,0.16)", borderRadius: 20, padding: "2px 9px" },
  muted:     { color: "#8a8398", fontSize: 14 },

  segment:   { display: "inline-flex", padding: 3, gap: 2, borderRadius: 10, background: "#241f31", marginBottom: 18 },
  segBtn:    { padding: "7px 18px", borderRadius: 8, border: "none", background: "transparent", color: "#b3abc7", fontSize: 14, cursor: "pointer" },
  segOn:     { background: "#8b5cf6", color: "#fff", fontWeight: 600 },

  field:     { marginBottom: 18 },
  label:     { display: "block", fontSize: 13, color: "#d4cfe3", fontWeight: 600, marginBottom: 8 },
  input:     { width: "100%", boxSizing: "border-box", fontSize: 14, padding: "11px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.16)", background: "#241f31", color: "#f5f3fa", outline: "none" },
  newGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 14px" },

  chips:     { display: "flex", flexWrap: "wrap", gap: 8 },
  chip:      { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#cfc8e0", fontSize: 13, cursor: "pointer" },
  chipOn:    { background: "rgba(139,92,246,0.28)", borderColor: "#8b5cf6", color: "#efe7ff", fontWeight: 600 },

  actions:   { display: "flex", justifyContent: "flex-end", marginTop: 4 },
  primaryBtn:{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  btnDisabled:{ opacity: 0.6, cursor: "default" },

  empty:     { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "30px 0 14px", textAlign: "center" },
  emptyTitle:{ fontSize: 15, fontWeight: 600, color: "#d4cfe3" },
  emptyText: { fontSize: 13, color: "#8a8398", maxWidth: 360 },

  list:      { display: "flex", flexDirection: "column", gap: 12 },
  userRow:   { display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px", borderRadius: 12, background: "#2a2438", border: "1px solid rgba(255,255,255,0.06)" },
  avatar:    { width: 40, height: 40, borderRadius: "50%", background: "#8b5cf6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 },
  userMain:  { flex: 1, minWidth: 0 },
  userName:  { fontSize: 15, fontWeight: 700 },
  userEmail: { fontSize: 13, color: "#b3abc7", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" },
  noRole:    { fontSize: 13, color: "#fbbf24" },
  rowActions:{ display: "flex", gap: 8, flexShrink: 0 },

  smallPrimary: { padding: "7px 14px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  smallGhost:   { padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#d4cfe3", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  smallDanger:  { padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.4)", background: "transparent", color: "#f87171", fontSize: 13, fontWeight: 600, cursor: "pointer" },
};