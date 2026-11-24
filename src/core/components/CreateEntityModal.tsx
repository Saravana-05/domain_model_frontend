import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface CreateEntityValues {
  name:        string;
  description: string;
  /** Only meaningful for kind="module": the project the module goes in. */
  projectId:   string;
}

interface CreateEntityModalProps {
  kind: "project" | "module";
  /** Projects to pick from (kind="module" only). */
  projects?: { id: string; name: string }[];
  /** Pre-selected project (kind="module"). */
  initialProjectId?: string | null;
  /** Show the project as a fixed label instead of a dropdown — used when
   *  the modal is opened from a specific project. */
  lockProject?: boolean;
  /** Does the actual create. Throw an Error (message is shown in the modal)
   *  to keep the modal open; resolve to close it. */
  onSubmit: (values: CreateEntityValues) => Promise<void>;
  onClose: () => void;
}

/**
 * Shared "Create project" / "Create module" dialog. Rendered through a
 * portal so it sits above the sidebar and pages regardless of where it was
 * opened from (sidebar tree, Projects page, Modules page).
 * Esc or a click on the backdrop closes it; Enter in a field submits.
 */
export function CreateEntityModal({
  kind, projects = [], initialProjectId = null, lockProject = false, onSubmit, onClose,
}: CreateEntityModalProps) {
  const isModule = kind === "module";
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId]     = useState<string>(initialProjectId ?? projects[0]?.id ?? "");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    const trimmed = name.trim();
    if (isModule && !projectId) { setError("Choose the project this module belongs to."); return; }
    if (!trimmed) { setError(`${isModule ? "Module" : "Project"} name is required.`); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, description: description.trim(), projectId });
      onClose();
    } catch (err: any) {
      // e.g. "Module 'HR' already exists in this project"
      setError(err?.message ?? "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const projectLabel = projects.find((p) => p.id === projectId)?.name ?? `Project ${projectId}`;

  return createPortal(
    <div style={styles.backdrop} onMouseDown={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isModule ? "Create module" : "Create project"}
        style={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 style={styles.title}>{isModule ? "Create Module" : "Create Project"}</h2>

        {isModule && (
          <div style={styles.field}>
            <label style={styles.label}>Project</label>
            {lockProject ? (
              <div style={styles.locked}>{projectLabel}</div>
            ) : (
              <select
                value={projectId}
                disabled={busy}
                onChange={(e) => setProjectId(e.target.value)}
                style={styles.input}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div style={styles.field}>
          <label style={styles.label}>{isModule ? "Module name" : "Project name"}</label>
          <input
            autoFocus
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={isModule ? "e.g. Billing" : "e.g. Clinic Management"}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Description (optional)</label>
          <input
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={isModule ? "What is this module for?" : "What is this project for?"}
            style={styles.input}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.actions}>
          <button
            type="button"
            className="page-header-btn page-header-btn--filter"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="page-header-btn page-header-btn--import"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,8,18,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog:   { width: "100%", maxWidth: 440, background: "#2f2840", color: "#f5f3fa", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" },
  title:    { margin: "0 0 18px", fontSize: 18, fontWeight: 700 },
  field:    { marginBottom: 14 },
  label:    { display: "block", fontSize: 12, fontWeight: 600, color: "#b3abc7", marginBottom: 6 },
  input:    { width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "#241f31", color: "#f5f3fa" },
  locked:   { padding: "10px 12px", borderRadius: 8, fontSize: 14, fontWeight: 600, background: "rgba(139,92,246,0.14)", border: "1px solid rgba(139,92,246,0.35)" },
  error:    { color: "#f87171", fontSize: 13, marginBottom: 12 },
  actions:  { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 },
};