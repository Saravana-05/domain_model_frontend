import { useEffect, useMemo, useState } from "react";
import AddIcon                from "@mui/icons-material/Add";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import ArrowForwardIcon       from "@mui/icons-material/ArrowForward";
import FolderOutlinedIcon     from "@mui/icons-material/FolderOutlined";
import { useProjectStore } from "../core/store/projectStore";
import {
  apiListAllModules,
  apiCreateModule,
  type BackendModule,
} from "../core/api/moduleApi";
import { CreateEntityModal } from "../core/components/CreateEntityModal";

interface ModulesScreenProps {
  /** Fires when the user clicks a module card (or just finished creating
   *  one). Modules belong to a project, so the project id comes with it.
   *  The parent (App.tsx) makes that project / module the active scope
   *  and navigates to the Domain Model tab. */
  onOpenModule: (moduleId: string, projectId: string) => void;
  /** Project to pre-select in the filter (e.g. the one just opened from
   *  the Projects page). null → show every project's modules. */
  initialProjectId?: string | null;
  /** Increment to open the "Create Module" form as soon as the page shows
   *  (used by the Domain Model page's "Add Module" button). */
  openCreateSignal?: number;
}

/**
 * "Modules" page — the middle level of Project → Module → Domain model.
 * Lists the modules of ALL projects, grouped by project, with a filter to
 * narrow to one project. Opening a module hands off to the Domain Model
 * page, scoped to that module (and its project).
 */
export function ModulesScreen({ onOpenModule, initialProjectId = null, openCreateSignal = 0 }: ModulesScreenProps) {
  const projects      = useProjectStore((s) => s.projects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  const [allModules, setAllModules] = useState<BackendModule[]>([]);
  const [loading, setLoading]       = useState(false);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(initialProjectId);

  const [showCreate, setShowCreate]   = useState(false);

  async function loadModules() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiListAllModules();
      setAllModules(res.data ?? []);
    } catch (err: any) {
      setLoadError(err?.message ?? "Couldn't load modules.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (projects.length === 0) fetchProjects();
    loadModules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the parent when it re-opens this page for a specific project.
  useEffect(() => {
    setFilterProjectId(initialProjectId);
  }, [initialProjectId]);

  useEffect(() => {
    if (openCreateSignal > 0) startCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateSignal]);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? `Project ${id}`;

  // Group by project, in the Projects page's order. A project with no
  // modules gets no group header — the empty-state message covers it.
  const groups = useMemo(() => {
    const shownProjects = filterProjectId
      ? projects.filter((p) => p.id === filterProjectId)
      : projects;
    return shownProjects
      .map((p) => ({ project: p, modules: allModules.filter((m) => m.project_id === p.id) }))
      .filter((g) => g.modules.length > 0);
  }, [projects, allModules, filterProjectId]);

  const totalShown = groups.reduce((n, g) => n + g.modules.length, 0);

  function startCreate() {
    setShowCreate(true);
  }

  async function handleCreate(v: { name: string; description: string; projectId: string }) {
    const res = await apiCreateModule(v.projectId, v.name, v.description || undefined);
    if (res.status !== "success" || !res.data) {
      throw new Error(res.message ?? "Couldn't create the module. Please try again.");
    }
    const created = res.data;
    setAllModules((prev) => [created, ...prev]);
    onOpenModule(created.id, created.project_id);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Modules</h1>
          <p style={styles.subtitle}>
            Every module, grouped by project. Open a module to build domain models inside it.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={filterProjectId ?? ""}
            onChange={(e) => setFilterProjectId(e.target.value || null)}
            style={styles.select}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="page-header-btn page-header-btn--import"
            disabled={projects.length === 0}
            title={projects.length === 0 ? "Create a project first" : undefined}
            onClick={startCreate}
          >
            <AddIcon sx={{ fontSize: 17 }} />
            Create Module
          </button>
        </div>
      </div>

      {showCreate && (
        <CreateEntityModal
          kind="module"
          projects={projects}
          initialProjectId={filterProjectId ?? projects[0]?.id ?? null}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {loadError && <div style={styles.error}>{loadError}</div>}
      {loading && allModules.length === 0 && <div style={styles.hint}>Loading modules…</div>}

      {!loading && !loadError && totalShown === 0 && !showCreate && (
        <div style={styles.emptyState}>
          <ViewModuleOutlinedIcon sx={{ fontSize: 40, color: "#a78bfa" }} />
          <p style={styles.emptyText}>
            {filterProjectId
              ? "No modules in this project yet. Create one to start building domain models inside it."
              : "No modules yet. Create one to start building domain models inside it."}
          </p>
        </div>
      )}

      {groups.map(({ project, modules }) => (
        <section key={project.id} style={styles.group}>
          <div style={styles.groupHeader}>
            <FolderOutlinedIcon sx={{ fontSize: 16, color: "#a78bfa" }} />
            <span style={styles.groupTitle}>{project.name}</span>
            <span style={styles.groupCount}>{modules.length} module{modules.length === 1 ? "" : "s"}</span>
          </div>

          <div style={styles.grid}>
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                style={styles.card}
                onClick={() => onOpenModule(m.id, m.project_id)}
              >
                <div style={styles.cardIcon}>
                  <ViewModuleOutlinedIcon sx={{ fontSize: 22, color: "#a78bfa" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.cardTitle}>{m.name}</div>
                  <div style={styles.cardDesc}>{m.description || projectName(m.project_id)}</div>
                </div>
                <ArrowForwardIcon sx={{ fontSize: 18, color: "#8a8398" }} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page:          { padding: "24px 32px 40px", color: "#f5f3fa" },
  header:        { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 },
  title:         { fontSize: 22, fontWeight: 700, margin: 0 },
  subtitle:      { margin: "6px 0 0", color: "#b3abc7", fontSize: 14, maxWidth: 560 },
  select:        { fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "#332c42", color: "#f5f3fa" },

  createCard:    { background: "#332c42", borderRadius: 12, padding: 18, marginBottom: 24 },
  createRow:     { display: "flex", gap: 16, marginBottom: 12 },
  label:         { display: "block", fontSize: 12, color: "#b3abc7", marginBottom: 6, fontWeight: 600 },
  input:         { width: "100%", boxSizing: "border-box", fontSize: 14, padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "#241f31", color: "#f5f3fa" },
  error:         { color: "#f87171", fontSize: 13, marginBottom: 10 },
  createActions: { display: "flex", gap: 10 },

  hint:          { color: "#b3abc7", fontSize: 14 },
  emptyState:    { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 0", color: "#b3abc7" },
  emptyText:     { fontSize: 14, maxWidth: 380, textAlign: "center", margin: 0 },

  group:         { marginBottom: 28 },
  groupHeader:   { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  groupTitle:    { fontSize: 14, fontWeight: 700, color: "#f5f3fa" },
  groupCount:    { fontSize: 12, color: "#8a8398" },

  grid:          { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 260px))", gap: 14 },
  card:          { display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "#332c42", cursor: "pointer", transition: "transform 0.12s ease, border-color 0.12s ease" },
  cardIcon:      { width: 40, height: 40, borderRadius: 10, background: "rgba(167,139,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardTitle:     { fontSize: 15, fontWeight: 700, color: "#f5f3fa", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardDesc:      { fontSize: 12, color: "#b3abc7", marginTop: 2, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};