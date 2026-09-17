import { useState, useRef, Fragment, useEffect } from "react";
import { SchemaInspector, type SchemaInspectorHandle, type MainTab } from "./core/renderer/SchemaInspector_shim";
import { allSchemas } from "./schemas";
import { LoginScreen } from "./screens/LoginScreen";
import { ResourcesScreen } from "./screens/rbac/ResourcesScreen";
import { RolesScreen } from "./screens/rbac/RolesScreen";
import { RolePermissionsScreen } from "./screens/rbac/RolePermissionsScreen";
import { UserRolesScreen } from "./screens/rbac/UserRolesScreen";
import { useAuthStore } from "./store/authStore";
import { useProjectStore } from "./core/store/projectStore";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import type { BackendProject } from "./core/api/projectApi";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CodeIcon                from "@mui/icons-material/Code";
import FolderOutlinedIcon      from "@mui/icons-material/FolderOutlined";
import FilterListIcon          from "@mui/icons-material/FilterList";
import "./App.css";

type Screen = "projects" | "inspector" | "rbac/resources" | "rbac/roles" | "rbac/permissions" | "rbac/users";

const NAV_ITEMS: { id: Screen; label: string; group?: string }[] = [
  { id: "rbac/roles",       label: "Roles",             group: "RBAC Admin" },
  { id: "rbac/resources",   label: "Resources",         group: "RBAC Admin" },
  { id: "rbac/permissions", label: "Role Permissions",  group: "RBAC Admin" },
  { id: "rbac/users",       label: "User Roles",        group: "RBAC Admin" },
];

/** Sidebar sub-items nested under the "Domain Model" group — each one is
 *  a tab inside SchemaInspector rather than a whole separate Screen, so
 *  clicking any of these keeps SchemaInspector mounted (no re-fetching
 *  from the backend, no losing in-progress edits) and just tells it which
 *  tab to show, the same way the header's "Export" button already does. */
const INSPECTOR_TABS: { id: MainTab; label: string }[] = [
  { id: "domain",       label: "Domain Model" },
  // { id: "ui",           label: "UI Config" },
  { id: "validations",  label: "Validations" },
  { id: "access",       label: "Access Control" },
  // { id: "data",         label: "Data" },
  { id: "translations", label: "Translations" },
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

/**
 * Top-right filter on the Domain Model page. Selecting a project here just
 * writes to the same projectStore.currentProjectId that the Projects page
 * writes to when you open a project — SchemaInspector already reloads the
 * domain list from the backend whenever that value changes, so picking a
 * project here filters the results shown without any extra wiring.
 */
function ProjectFilter({
  projects,
  currentProjectId,
  onSelect,
}: {
  projects: BackendProject[];
  currentProjectId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const currentLabel = currentProjectId
    ? projects.find((p) => p.id === currentProjectId)?.name ?? "Project"
    : "All Projects";

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="page-header-btn page-header-btn--filter"
        onClick={() => setOpen((v) => !v)}
      >
        <FilterListIcon sx={{ fontSize: 17 }} />
        {currentLabel}
      </button>
      {open && (
        <div style={styles.filterDropdown}>
          <div
            style={{
              ...styles.filterOption,
              ...(currentProjectId === null ? styles.filterOptionActive : {}),
            }}
            onClick={() => { onSelect(null); setOpen(false); }}
          >
            All Projects
          </div>
          {projects.map((p) => (
            <div
              key={p.id}
              style={{
                ...styles.filterOption,
                ...(currentProjectId === p.id ? styles.filterOptionActive : {}),
              }}
              onClick={() => { onSelect(p.id); setOpen(false); }}
            >
              {p.name}
            </div>
          ))}
          {projects.length === 0 && (
            <div style={{ ...styles.filterOption, cursor: "default", color: "#8a8398" }}>
              No projects yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { user, token, logout } = useAuthStore();
  const [screen, setScreen] = useState<Screen>("projects");
  const [inspectorTab, setInspectorTab] = useState<MainTab>("domain");
  const schemaInspectorRef = useRef<SchemaInspectorHandle>(null);

  const projects            = useProjectStore((s) => s.projects);
  const currentProjectId    = useProjectStore((s) => s.currentProjectId);
  const setCurrentProjectId = useProjectStore((s) => s.setCurrentProjectId);
  const fetchProjects       = useProjectStore((s) => s.fetchProjects);

  const tokenExpired = !!token && isTokenExpired(token);

  // Clear stale token in an effect — never call setState during render
  useEffect(() => {
    if (tokenExpired) logout();
  }, [tokenExpired]);

  // Load the Projects list once on mount so it's ready for the sidebar's
  // active-project highlighting and the Domain Model page's filter.
  useEffect(() => {
    if (token && !tokenExpired) fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tokenExpired]);

  if (!token || !user || tokenExpired) {
    return <LoginScreen sessionExpired={tokenExpired} />;
  }

  /** Opening a project (from the Projects page) scopes every subsequent
   *  domain-model read/create to it (via projectStore.currentProjectId,
   *  read by datastoreApi.ts) and jumps straight to the Domain Model tab
   *  so the user can start creating domain models inside that project. */
  function openProject(id: string) {
    setCurrentProjectId(id);
    setScreen("inspector");
    setInspectorTab("domain");
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <span style={styles.brandIcon}>⚙</span>
          <span style={styles.brandName}>Skiode</span>
        </div>

        <nav style={styles.nav}>
          <div style={styles.navGroup}>Projects</div>
          <button
            type="button"
            style={{
              ...styles.navItem,
              ...styles.navItemWithIcon,
              ...(screen === "projects" ? styles.navItemActive : {}),
            }}
            onClick={() => setScreen("projects")}
          >
            <FolderOutlinedIcon sx={{ fontSize: 16 }} style={{ flexShrink: 0 }} />
            <span>Projects</span>
          </button>

          <div style={styles.navGroup}>Domain Model</div>
          {INSPECTOR_TABS.map((item) => (
            <button
              key={item.id}
              style={{
                ...styles.navItem,
                ...(screen === "inspector" && inspectorTab === item.id ? styles.navItemActive : {}),
              }}
              onClick={() => { setScreen("inspector"); setInspectorTab(item.id); }}
            >
              {item.label}
            </button>
          ))}

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
        {screen === "projects" && <ProjectsScreen onOpenProject={openProject} />}
        {screen === "inspector" && (
          <>
            <div style={styles.pageHeader}>
              <div>
                <h1 style={styles.pageTitle}>Domain Model Configurator</h1>
                
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {inspectorTab === "domain" && (
                  <ProjectFilter
                    projects={projects}
                    currentProjectId={currentProjectId}
                    onSelect={setCurrentProjectId}
                  />
                )}
                <button
                  className="page-header-btn page-header-btn--import"
                  type="button"
                  onClick={() => schemaInspectorRef.current?.openImportModal()}
                >
                  <CloudUploadOutlinedIcon sx={{ fontSize: 17 }} />
                  Import JSON
                </button>
                <button
                  className="page-header-btn page-header-btn--export"
                  type="button"
                  onClick={() => setInspectorTab("export")}
                >
                  <CodeIcon sx={{ fontSize: 16 }} />
                  Export
                </button>
                <span style={styles.badge}>{allSchemas.env?.version ?? "—"}</span>
                <span style={{ ...styles.badge, background: "#10301c", color: "#4ade80" }}>
                  {allSchemas.env?.mode ?? "—"}
                </span>
              </div>
            </div>
            <SchemaInspector
              ref={schemaInspectorRef}
              schemas={allSchemas}
              activeTab={inspectorTab}
              onTabChange={setInspectorTab}
            />
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
  sidebar:      { width: 220, background: "#2a2438", display: "flex", flexDirection: "column", flexShrink: 0 },
  brand:        { display: "flex", alignItems: "center", gap: 10, padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" },
  brandIcon:    { fontSize: 22 },
  brandName:    { color: "#f5f3fa", fontWeight: 700, fontSize: 16 },
  nav:          { flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" },
  navGroup:     { padding: "14px 8px 4px", fontSize: 11, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 1 },
  navItem:      { width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#b3abc7", fontSize: 14, cursor: "pointer", transition: "background 0.15s" },
  navItemWithIcon: { display: "flex", alignItems: "center", gap: 8 },
  navItemActive:{ background: "#8b5cf6", color: "#fff", fontWeight: 600 },
  userSection:  { padding: "16px", borderTop: "1px solid rgba(255,255,255,0.08)" },
  userInfo:     { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  userAvatar:   { width: 32, height: 32, borderRadius: "50%", background: "#8b5cf6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  userName:     { color: "#f5f3fa", fontSize: 13, fontWeight: 600 },
  userRole:     { color: "#a78bfa", fontSize: 12 },
  logoutBtn:    { width: "100%", padding: "7px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#b3abc7", fontSize: 13, cursor: "pointer" },
  main:         { flex: 1, overflowY: "auto", background: "#2a2438" },
  pageHeader:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 32px 0" },
  pageTitle:    { fontSize: 22, fontWeight: 700, margin: 0, color: "#f5f3fa" },
  pageSub:      { margin: "4px 0 0", color: "#b3abc7", fontSize: 14 },
  badge:        { padding: "4px 10px", borderRadius: 20, background: "#332c42", color: "#b3abc7", fontSize: 12, fontWeight: 600 },

  filterDropdown:      { position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 200, maxHeight: 260, overflowY: "auto", background: "#fff", border: "1px solid var(--color-border-tertiary, #e5e1f0)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 20, padding: 6 },
  filterOption:        { padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "#332c42", cursor: "pointer" },
  filterOptionActive:  { background: "#f3e8ff", color: "#7c3aed", fontWeight: 700 },
};