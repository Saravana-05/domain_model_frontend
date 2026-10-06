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
import { SidebarTree } from "../src/core/components/SidebarTree";
import { ModulesScreen } from "./screens/ModulesScreen";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CodeIcon                from "@mui/icons-material/Code";
import FilterListIcon          from "@mui/icons-material/FilterList";
import "./App.css";

type Screen = "projects" | "modules" | "inspector" | "rbac/resources" | "rbac/roles" | "rbac/permissions" | "rbac/users";

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
 * Top-right scope filters on the Domain Model page (Project, then Module).
 * Selecting an item just writes to the same projectStore the Projects /
 * Modules pages write to when you open one — SchemaInspector already
 * reloads the domain list from the backend whenever currentProjectId or
 * currentModuleId changes, so picking one here filters the results shown
 * without any extra wiring.
 */
function ScopeFilter({
  items,
  currentId,
  onSelect,
  allLabel,
  fallbackLabel,
  emptyLabel,
}: {
  items: { id: string; name: string }[];
  currentId: string | null;
  onSelect: (id: string | null) => void;
  allLabel: string;
  fallbackLabel: string;
  emptyLabel: string;
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

  const currentLabel = currentId
    ? items.find((i) => i.id === currentId)?.name ?? fallbackLabel
    : allLabel;

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
              ...(currentId === null ? styles.filterOptionActive : {}),
            }}
            onClick={() => { onSelect(null); setOpen(false); }}
          >
            {allLabel}
          </div>
          {items.map((i) => (
            <div
              key={i.id}
              style={{
                ...styles.filterOption,
                ...(currentId === i.id ? styles.filterOptionActive : {}),
              }}
              onClick={() => { onSelect(i.id); setOpen(false); }}
            >
              {i.name}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ ...styles.filterOption, cursor: "default", color: "#8a8398" }}>
              {emptyLabel}
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
  // Domain model clicked in the sidebar tree — the Domain Model tab scrolls
  // to / highlights its card. Cleared whenever the scope is changed some
  // other way (project / module click, filters).
  const [focusDomain, setFocusDomain] = useState<string | null>(null);
  // Modules page: which project it starts filtered to.
  const [modulesProjectFilter, setModulesProjectFilter] = useState<string | null>(null);
  const schemaInspectorRef = useRef<SchemaInspectorHandle>(null);

  const projects            = useProjectStore((s) => s.projects);
  const currentProjectId    = useProjectStore((s) => s.currentProjectId);
  const setCurrentProjectId = useProjectStore((s) => s.setCurrentProjectId);
  const fetchProjects       = useProjectStore((s) => s.fetchProjects);
  const modules             = useProjectStore((s) => s.modules);
  const currentModuleId     = useProjectStore((s) => s.currentModuleId);
  const setCurrentModuleId  = useProjectStore((s) => s.setCurrentModuleId);
  const fetchModules        = useProjectStore((s) => s.fetchModules);

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

  // Keep the module list in step with the selected project (all modules
  // when "All Projects" is selected, so cards can still show module names).
  useEffect(() => {
    if (token && !tokenExpired) fetchModules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tokenExpired, currentProjectId]);

  if (!token || !user || tokenExpired) {
    return <LoginScreen sessionExpired={tokenExpired} />;
  }

  /** Project selected (sidebar tree or Projects page): make it the active
   *  project with no module filter and show its Modules page, where the
   *  user can open a module or create a new one. */
  function openProject(id: string) {
    setFocusDomain(null);
    setCurrentProjectId(id);
    setCurrentModuleId(null);
    fetchModules(id);
    setModulesProjectFilter(id);
    setScreen("modules");
  }

  /** Module selected: scopes every subsequent domain-model read/create to
   *  it (via projectStore.currentModuleId, read by datastoreApi.ts) and
   *  jumps to the Domain Model tab. */
  function openModule(moduleId: string, projectId: string) {
    setFocusDomain(null);
    // Order matters: changing project clears the module, so set project first.
    setCurrentProjectId(projectId);
    setCurrentModuleId(moduleId);
    // The module list for the filters is per-project — refresh it for the
    // project we just entered (also picks up a module created a moment ago).
    fetchModules(projectId);
    setScreen("inspector");
    setInspectorTab("domain");
  }

  /** Domain model selected in the tree: scope to the module it lives in
   *  (or its project / nothing), open the Domain Model tab and highlight
   *  its card. */
  function openDomain(d: { name: string; projectId: string | null; moduleId: string | null }) {
    if (d.projectId && d.moduleId) {
      setCurrentProjectId(d.projectId);
      setCurrentModuleId(d.moduleId);
      fetchModules(d.projectId);
    } else if (d.projectId) {
      setCurrentProjectId(d.projectId);
      setCurrentModuleId(null);
      fetchModules(d.projectId);
    } else {
      setCurrentProjectId(null);
      setCurrentModuleId(null);
      fetchModules(null);
    }
    setFocusDomain(d.name);
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
          <SidebarTree
            activeDomain={screen === "inspector" ? focusDomain : null}
            onSelectProject={openProject}
            onSelectModule={openModule}
            onSelectDomain={openDomain}
            onOpenProjectsPage={() => setScreen("projects")}
          />

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
        {screen === "modules" && (
          <ModulesScreen
            onOpenModule={openModule}
            initialProjectId={modulesProjectFilter}
          />
        )}
        {screen === "inspector" && (
          <>
            <div style={styles.pageHeader}>
              <div>
                <h1 style={styles.pageTitle}>Domain Model Configurator</h1>
                <p style={styles.pageSub}>
                  {[
                    currentProjectId ? (projects.find((p) => p.id === currentProjectId)?.name ?? "Project") : "All projects",
                    currentModuleId  ? (modules.find((m) => m.id === currentModuleId)?.name ?? "Module") : null,
                  ].filter(Boolean).join("  ›  ")}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {inspectorTab === "domain" && (
                  <>
                    <ScopeFilter
                      items={projects}
                      currentId={currentProjectId}
                      onSelect={(id) => { setFocusDomain(null); setCurrentProjectId(id); }}
                      allLabel="All Projects"
                      fallbackLabel="Project"
                      emptyLabel="No projects yet"
                    />
                    {currentProjectId && (
                      <ScopeFilter
                        items={modules}
                        currentId={currentModuleId}
                        onSelect={(id) => { setFocusDomain(null); setCurrentModuleId(id); }}
                        allLabel="All Modules"
                        fallbackLabel="Module"
                        emptyLabel="No modules in this project"
                      />
                    )}
                  </>
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
              focusDomain={focusDomain}
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
  sidebar:      { width: 260, background: "#2a2438", display: "flex", flexDirection: "column", flexShrink: 0 },
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