import { useState, Fragment, useEffect } from "react";
import { SchemaInspector } from "./core/renderer/SchemaInspector";
import { allSchemas } from "./schemas";
import { LoginScreen } from "./screens/LoginScreen";
import { ResourcesScreen } from "./screens/rbac/ResourcesScreen";
import { RolesScreen } from "./screens/rbac/RolesScreen";
import { RolePermissionsScreen } from "./screens/rbac/RolePermissionsScreen";
import { UserRolesScreen } from "./screens/rbac/UserRolesScreen";
import { useAuthStore } from "./store/authStore";
import "./App.css";

type Screen = "inspector" | "rbac/resources" | "rbac/roles" | "rbac/permissions" | "rbac/users";

const NAV_ITEMS: { id: Screen; label: string; group?: string }[] = [
  { id: "inspector",        label: "Schema Inspector" },
  { id: "rbac/roles",       label: "Roles",             group: "RBAC Admin" },
  { id: "rbac/resources",   label: "Resources",         group: "RBAC Admin" },
  { id: "rbac/permissions", label: "Role Permissions",  group: "RBAC Admin" },
  { id: "rbac/users",       label: "User Roles",        group: "RBAC Admin" },
];

/** Decode JWT exp — handles base64url encoding used by JWTs */
function isTokenExpired(token: string): boolean {
  try {
    // JWT uses base64url: replace - → +, _ → /, add padding
    const b64url = token.split(".")[1];
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return payload.exp * 1000 < Date.now();
  } catch {
    return false; // can't decode → don't assume expired
  }
}

export default function App() {
  const { user, token, logout } = useAuthStore();
  const [screen, setScreen] = useState<Screen>("inspector");

  const tokenExpired = !!token && isTokenExpired(token);

  // Clear stale token in an effect — never call setState during render
  useEffect(() => {
    if (tokenExpired) logout();
  }, [tokenExpired]);

  if (!token || !user || tokenExpired) {
    return <LoginScreen sessionExpired={tokenExpired} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <span style={styles.brandIcon}>⚙</span>
          <span style={styles.brandName}>Form Engine</span>
        </div>

        <nav style={styles.nav}>
          {NAV_ITEMS.map((item, i) => {
            const prevItem = NAV_ITEMS[i - 1];
            const showGroup = item.group && item.group !== prevItem?.group;
            return (
              <Fragment key={item.id}>
                {showGroup && <div style={styles.navGroup}>{item.group}</div>}
                <button
                  style={{ ...styles.navItem, ...(screen === item.id ? styles.navItemActive : {}) }}
                  onClick={() => setScreen(item.id)}
                >
                  {item.label}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div style={styles.userSection}>
          <div style={styles.userInfo}>
            <div style={styles.userAvatar}>{(user.userName?.[0] ?? "?").toUpperCase()}</div>
            <div>
              <div style={styles.userName}>{user.userName}</div>
              <div style={styles.userRole}>{user.role}</div>
            </div>
          </div>
          <button style={styles.logoutBtn} onClick={logout}>Sign out</button>
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        {screen === "inspector" && (
          <>
            <div style={styles.pageHeader}>
              <div>
                <h1 style={styles.pageTitle}>Schema Inspector</h1>
                <p style={styles.pageSub}>
                  Domain Model · UI Configuration · Access Control · Validation Registry
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={styles.badge}>{allSchemas.env?.version ?? "—"}</span>
                <span style={{ ...styles.badge, background: "#dcfce7", color: "#166534" }}>
                  {allSchemas.env?.mode ?? "—"}
                </span>
              </div>
            </div>
            <SchemaInspector schemas={allSchemas} />
          </>
        )}
        {screen === "rbac/resources"   && <ResourcesScreen />}
        {screen === "rbac/roles"       && <RolesScreen />}
        {screen === "rbac/permissions" && <RolePermissionsScreen />}
        {screen === "rbac/users"       && <UserRolesScreen />}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar:      { width: 220, background: "#1e1b4b", display: "flex", flexDirection: "column", flexShrink: 0 },
  brand:        { display: "flex", alignItems: "center", gap: 10, padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" },
  brandIcon:    { fontSize: 22 },
  brandName:    { color: "#e0e7ff", fontWeight: 700, fontSize: 16 },
  nav:          { flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" },
  navGroup:     { padding: "14px 8px 4px", fontSize: 11, fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: 1 },
  navItem:      { width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#c7d2fe", fontSize: 14, cursor: "pointer", transition: "background 0.15s" },
  navItemActive:{ background: "#4338ca", color: "#fff", fontWeight: 600 },
  userSection:  { padding: "16px", borderTop: "1px solid rgba(255,255,255,0.1)" },
  userInfo:     { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  userAvatar:   { width: 32, height: 32, borderRadius: "50%", background: "#4f46e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  userName:     { color: "#e0e7ff", fontSize: 13, fontWeight: 600 },
  userRole:     { color: "#818cf8", fontSize: 12 },
  logoutBtn:    { width: "100%", padding: "7px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#c7d2fe", fontSize: 13, cursor: "pointer" },
  main:         { flex: 1, overflowY: "auto", background: "#f8f9fc" },
  pageHeader:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 32px 0" },
  pageTitle:    { fontSize: 22, fontWeight: 700, margin: 0, color: "#111" },
  pageSub:      { margin: "4px 0 0", color: "#6b7280", fontSize: 14 },
  badge:        { padding: "4px 10px", borderRadius: 20, background: "#f3f4f6", color: "#374151", fontSize: 12, fontWeight: 600 },
};
