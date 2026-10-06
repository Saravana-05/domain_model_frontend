import { useCallback, useEffect, useMemo, useState } from "react";
import ChevronRightIcon       from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon         from "@mui/icons-material/ExpandMore";
import FolderOutlinedIcon     from "@mui/icons-material/FolderOutlined";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import AddIcon                from "@mui/icons-material/Add";
import RefreshIcon            from "@mui/icons-material/Refresh";
import { useProjectStore } from "../../core/store/projectStore";
import { apiListAllModules, apiCreateModule, type BackendModule } from "../api/moduleApi";
import { apiListSchemas } from "../api/datastoreApi";
import { CreateEntityModal } from "./CreateEntityModal";

/** One domain model as the tree needs it. */
interface TreeDomain {
  name:      string;
  projectId: string | null;
  moduleId:  string | null;
}

interface SidebarTreeProps {
  /** Currently highlighted domain model (set when one is clicked here). */
  activeDomain: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectModule:  (moduleId: string, projectId: string) => void;
  onSelectDomain:  (domain: { name: string; projectId: string | null; moduleId: string | null }) => void;
  /** Click on the "Projects" header — the Projects overview page. */
  onOpenProjectsPage: () => void;
}

const EXPANDED_KEY = "sidebar-tree-expanded";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Sidebar explorer:  Project → Module → Domain model.
 *
 * Everything comes from the backend (projects from the store, modules and
 * domain models fetched here), so it reflects what's saved. It re-fetches
 * whenever projectStore.treeVersion is bumped — apiCreateDomain /
 * apiSubmitDraft / createModule all do that — or when ↻ is clicked.
 *
 * Row ids used for expand state: "p:<projectId>", "m:<moduleId>".
 */
export function SidebarTree({
  activeDomain, onSelectProject, onSelectModule, onSelectDomain, onOpenProjectsPage,
}: SidebarTreeProps) {
  const projects         = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentModuleId  = useProjectStore((s) => s.currentModuleId);
  const treeVersion      = useProjectStore((s) => s.treeVersion);
  const bumpTree         = useProjectStore((s) => s.bumpTree);
  const createProject    = useProjectStore((s) => s.createProject);

  const [modules, setModules]   = useState<BackendModule[]>([]);
  const [domains, setDomains]   = useState<TreeDomain[]>([]);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [hovered, setHovered]   = useState<string | null>(null);

  // Which "create" dialog is open: a new project, or a new module in a given project.
  const [modal, setModal] = useState<null | { kind: "project" } | { kind: "module"; projectId: string }>(null);

  const persist = (next: Set<string>) => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const setOpen = useCallback((id: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id); else next.delete(id);
      persist(next);
      return next;
    });
  }, []);
  const toggle = (id: string) => setOpen(id, !expanded.has(id));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mods, schemas] = await Promise.all([
        apiListAllModules().catch(() => ({ data: [] as BackendModule[] })),
        // explicit nulls = no project / module filter → everything
        apiListSchemas(null, null).catch(() => ({ schemas: [] as any[] })),
      ]);
      setModules(mods.data ?? []);
      setDomains(
        ((schemas as any).schemas ?? []).map((s: any) => ({
          name:      s.table_name,
          projectId: s.project_id ?? null,
          moduleId:  s.module_id ?? null,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, treeVersion]);

  // Keep the active project / module open so the selection is always visible.
  useEffect(() => {
    if (currentProjectId) setOpen(`p:${currentProjectId}`, true);
    if (currentModuleId)  setOpen(`m:${currentModuleId}`, true);
  }, [currentProjectId, currentModuleId, setOpen]);

  const tree = useMemo(() => {
    const modulesOf = (pid: string) => modules.filter((m) => m.project_id === pid);
    const domainsOfModule  = (mid: string) => domains.filter((d) => d.moduleId === mid);
    const looseDomainsOf   = (pid: string) => domains.filter((d) => d.projectId === pid && !d.moduleId);
    const knownProjectIds  = new Set(projects.map((p) => p.id));
    const orphanDomains    = domains.filter((d) => !d.projectId || !knownProjectIds.has(d.projectId));
    return { modulesOf, domainsOfModule, looseDomainsOf, orphanDomains };
  }, [projects, modules, domains]);

  async function createProjectFromModal(v: { name: string; description: string }) {
    const created = await createProject(v.name, v.description || undefined);
    if (!created) throw new Error("Couldn't create the project.");
    setOpen(`p:${created.id}`, true);
    bumpTree();
  }

  async function createModuleFromModal(v: { name: string; description: string; projectId: string }) {
    const res = await apiCreateModule(v.projectId, v.name, v.description || undefined);
    if (res.status !== "success" || !res.data) throw new Error(res.message ?? "Couldn't create the module.");
    setOpen(`p:${v.projectId}`, true);
    bumpTree();
    onSelectModule(res.data.id, v.projectId);
  }

  const domainRow = (d: TreeDomain, indent: number) => (
    <div
      key={`d:${d.name}`}
      title={d.name}
      style={{ ...styles.row, paddingLeft: indent, ...(activeDomain === d.name ? styles.rowActive : {}) }}
      onClick={() => onSelectDomain(d)}
    >
      <span style={styles.chevronSpacer} />
      <TableChartOutlinedIcon sx={{ fontSize: 14 }} style={{ flexShrink: 0, color: "#7dd3fc" }} />
      <span style={styles.label}>{d.name}</span>
    </div>
  );

  return (
    <div>
      {/* Header: "Projects" + add + refresh */}
      <div style={styles.headerRow}>
        <button type="button" style={styles.headerLabel} onClick={onOpenProjectsPage}>
          Projects
        </button>
        <button type="button" style={styles.iconBtn} title="Refresh" onClick={() => load()}>
          <RefreshIcon sx={{ fontSize: 14 }} style={loading ? { opacity: 0.4 } : undefined} />
        </button>
        <button type="button" style={styles.iconBtn} title="New project" onClick={() => setModal({ kind: "project" })}>
          <AddIcon sx={{ fontSize: 15 }} />
        </button>
      </div>

      {projects.length === 0 && (
        <div style={styles.empty}>No projects yet. Click + to create one.</div>
      )}

      {projects.map((p) => {
        const pid = `p:${p.id}`;
        const open = expanded.has(pid);
        const pModules = tree.modulesOf(p.id);
        const loose = tree.looseDomainsOf(p.id);
        const projectActive = currentProjectId === p.id && !currentModuleId && !activeDomain;

        return (
          <div key={pid}>
            <div
              style={{ ...styles.row, paddingLeft: 6, ...(projectActive ? styles.rowActive : {}) }}
              onMouseEnter={() => setHovered(pid)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { setOpen(pid, true); onSelectProject(p.id); }}
            >
              <span
                style={styles.chevron}
                onClick={(e) => { e.stopPropagation(); toggle(pid); }}
              >
                {open ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
              </span>
              <FolderOutlinedIcon sx={{ fontSize: 15 }} style={{ flexShrink: 0, color: "#a78bfa" }} />
              <span style={{ ...styles.label, fontWeight: 600 }}>{p.name}</span>
              <button
                type="button"
                title="New module"
                style={{ ...styles.iconBtn, opacity: hovered === pid || projectActive ? 1 : 0.55 }}
                onClick={(e) => { e.stopPropagation(); setModal({ kind: "module", projectId: p.id }); }}
              >
                <AddIcon sx={{ fontSize: 14 }} />
              </button>
            </div>

            {open && (
              <>
                {pModules.map((m) => {
                  const mid = `m:${m.id}`;
                  const mOpen = expanded.has(mid);
                  const mDomains = tree.domainsOfModule(m.id);
                  const moduleActive = currentModuleId === m.id && !activeDomain;
                  return (
                    <div key={mid}>
                      <div
                        style={{ ...styles.row, paddingLeft: 22, ...(moduleActive ? styles.rowActive : {}) }}
                        onClick={() => { setOpen(mid, true); onSelectModule(m.id, p.id); }}
                      >
                        <span
                          style={styles.chevron}
                          onClick={(e) => { e.stopPropagation(); toggle(mid); }}
                        >
                          {mOpen ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
                        </span>
                        <ViewModuleOutlinedIcon sx={{ fontSize: 15 }} style={{ flexShrink: 0, color: "#c4b5fd" }} />
                        <span style={styles.label}>{m.name}</span>
                        <span style={styles.count}>{mDomains.length}</span>
                      </div>
                      {mOpen && mDomains.map((d) => domainRow(d, 54))}
                      {mOpen && mDomains.length === 0 && (
                        <div style={{ ...styles.empty, paddingLeft: 54 }}>No domain models</div>
                      )}
                    </div>
                  );
                })}

                {/* Domain models in the project that aren't in any module yet */}
                {loose.length > 0 && (
                  <>
                    {pModules.length > 0 && <div style={{ ...styles.subLabel, paddingLeft: 30 }}>No module</div>}
                    {loose.map((d) => domainRow(d, pModules.length > 0 ? 38 : 30))}
                  </>
                )}

                {pModules.length === 0 && loose.length === 0 && (
                  <div style={{ ...styles.empty, paddingLeft: 30 }}>
                    No modules yet ·{" "}
                    <button type="button" style={styles.linkBtn} onClick={() => setModal({ kind: "module", projectId: p.id })}>
                      + Add module
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Global / unassigned domain models (no project at all) */}
      {tree.orphanDomains.length > 0 && (
        <div>
          <div style={{ ...styles.row, paddingLeft: 6 }} onClick={() => toggle("p:none")}>
            <span style={styles.chevron}>
              {expanded.has("p:none") ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
            </span>
            <FolderOutlinedIcon sx={{ fontSize: 15 }} style={{ flexShrink: 0, color: "#8a8398" }} />
            <span style={{ ...styles.label, color: "#8a8398" }}>No project</span>
            <span style={styles.count}>{tree.orphanDomains.length}</span>
          </div>
          {expanded.has("p:none") && tree.orphanDomains.map((d) => domainRow(d, 30))}
        </div>
      )}

      {modal?.kind === "project" && (
        <CreateEntityModal
          kind="project"
          onSubmit={createProjectFromModal}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "module" && (
        <CreateEntityModal
          kind="module"
          projects={projects}
          initialProjectId={modal.projectId}
          lockProject
          onSubmit={createModuleFromModal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  headerRow:    { display: "flex", alignItems: "center", gap: 2, padding: "14px 8px 4px" },
  headerLabel:  { flex: 1, textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 1 },
  iconBtn:      { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, borderRadius: 5, border: "none", background: "transparent", color: "#b3abc7", cursor: "pointer", flexShrink: 0 },

  row:          { display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: 6, cursor: "pointer", color: "#b3abc7", fontSize: 13, minHeight: 26 },
  rowActive:    { background: "#8b5cf6", color: "#fff" },
  chevron:      { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, flexShrink: 0, color: "inherit" },
  chevronSpacer:{ display: "inline-block", width: 16, flexShrink: 0 },
  label:        { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count:        { fontSize: 11, color: "#8a8398", flexShrink: 0 },
  subLabel:     { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#6f6786", padding: "6px 6px 2px" },
  linkBtn:      { background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "#a78bfa", fontSize: 12, fontWeight: 600 },
  empty:        { fontSize: 12, color: "#6f6786", padding: "4px 10px" },

};