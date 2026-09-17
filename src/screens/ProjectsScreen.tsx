import { useEffect, useState } from "react";
import AddIcon             from "@mui/icons-material/Add";
import FolderOutlinedIcon  from "@mui/icons-material/FolderOutlined";
import ArrowForwardIcon    from "@mui/icons-material/ArrowForward";
import { useProjectStore } from "../core/store/projectStore";

interface ProjectsScreenProps {
  /** Fires when the user clicks a project card (or just finished creating
   *  one) — the parent (App.tsx) sets it as the active project and
   *  navigates to the Domain Model tab, where "Create Domain" will be
   *  scoped to it automatically via projectStore.currentProjectId. */
  onOpenProject: (id: string) => void;
}

/**
 * Standalone "Projects" page, reached from its own sidebar item. Lists
 * every project as a clickable card and lets the user create a new one.
 * Domain-model creation itself doesn't happen here — clicking a project
 * (or finishing "Create") hands off to the Domain Model page for that.
 */
export function ProjectsScreen({ onOpenProject }: ProjectsScreenProps) {
  const projects       = useProjectStore((s) => s.projects);
  const loading        = useProjectStore((s) => s.loading);
  const fetchProjects  = useProjectStore((s) => s.fetchProjects);
  const createProject  = useProjectStore((s) => s.createProject);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName]             = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Project name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createProject(trimmed, description.trim() || undefined);
      if (created) {
        setName("");
        setDescription("");
        setShowCreate(false);
        onOpenProject(created.id);
      } else {
        setError("Couldn't create the project. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Projects</h1>
          <p style={styles.subtitle}>
            Group your domain models by project. Open a project to build domain models inside it.
          </p>
        </div>
        <button
          type="button"
          className="page-header-btn page-header-btn--import"
          onClick={() => { setShowCreate(true); setError(null); }}
        >
          <AddIcon sx={{ fontSize: 17 }} />
          Create Project
        </button>
      </div>

      {showCreate && (
        <div style={styles.createCard}>
          <div style={styles.createRow}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Project name</label>
              <input
                autoFocus
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. Clinic Management"
                style={styles.input}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Description (optional)</label>
              <input
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="What is this project for?"
                style={styles.input}
              />
            </div>
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.createActions}>
            <button
              type="button"
              className="page-header-btn page-header-btn--export"
              disabled={busy}
              onClick={handleCreate}
            >
              {busy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              className="page-header-btn page-header-btn--filter"
              disabled={busy}
              onClick={() => { setShowCreate(false); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && projects.length === 0 && <div style={styles.hint}>Loading projects…</div>}

      {!loading && projects.length === 0 && !showCreate && (
        <div style={styles.emptyState}>
          <FolderOutlinedIcon sx={{ fontSize: 40, color: "#a78bfa" }} />
          <p style={styles.emptyText}>No projects yet. Create one to start building domain models inside it.</p>
        </div>
      )}

      <div style={styles.grid}>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            style={styles.card}
            onClick={() => onOpenProject(p.id)}
          >
            <div style={styles.cardIcon}>
              <FolderOutlinedIcon sx={{ fontSize: 22, color: "#a78bfa" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.cardTitle}>{p.name}</div>
              {p.description && <div style={styles.cardDesc}>{p.description}</div>}
            </div>
            <ArrowForwardIcon sx={{ fontSize: 18, color: "#8a8398" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page:          { padding: "24px 32px 40px", color: "#f5f3fa" },
  header:        { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 },
  title:         { fontSize: 22, fontWeight: 700, margin: 0 },
  subtitle:      { margin: "6px 0 0", color: "#b3abc7", fontSize: 14, maxWidth: 520 },

  createCard:    { background: "#332c42", borderRadius: 12, padding: 18, marginBottom: 24 },
  createRow:     { display: "flex", gap: 16, marginBottom: 12 },
  label:         { display: "block", fontSize: 12, color: "#b3abc7", marginBottom: 6, fontWeight: 600 },
  input:         { width: "100%", boxSizing: "border-box", fontSize: 14, padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "#241f31", color: "#f5f3fa" },
  error:         { color: "#f87171", fontSize: 13, marginBottom: 10 },
  createActions: { display: "flex", gap: 10 },

  hint:          { color: "#b3abc7", fontSize: 14 },
  emptyState:    { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 0", color: "#b3abc7" },
  emptyText:     { fontSize: 14, maxWidth: 360, textAlign: "center", margin: 0 },

  grid:          { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 260px))", gap: 14 },
  card:          { display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "#332c42", cursor: "pointer", transition: "transform 0.12s ease, border-color 0.12s ease" },
  cardIcon:      { width: 40, height: 40, borderRadius: 10, background: "rgba(167,139,250,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardTitle:     { fontSize: 15, fontWeight: 700, color: "#f5f3fa", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardDesc:      { fontSize: 12, color: "#b3abc7", marginTop: 2, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};