import React, { useEffect, useState } from "react";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import AddIcon             from "@mui/icons-material/Add";
import { useProjectStore } from "../../store/projectStore";

/**
 * Persistent project picker — sits above every tab in the Schema
 * Inspector. Whichever project is selected here becomes the scope for
 * every subsequent "Create Domain" call (see apiCreateDomain in
 * datastoreApi.ts, which reads useProjectStore.getState().currentProjectId)
 * and filters the domain list loaded from the backend.
 *
 * Selecting "— No project (global) —" behaves exactly like the app did
 * before Projects existed: domain models are created without a
 * project_id and the full unfiltered list is loaded.
 */
export function ProjectSelector() {
  const projects           = useProjectStore((s) => s.projects);
  const currentProjectId   = useProjectStore((s) => s.currentProjectId);
  const loading            = useProjectStore((s) => s.loading);
  const setCurrentProjectId = useProjectStore((s) => s.setCurrentProjectId);
  const fetchProjects       = useProjectStore((s) => s.fetchProjects);
  const createProject       = useProjectStore((s) => s.createProject);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createProject(name);
      setNewName("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="si-project-selector"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border-tertiary)",
        background: "var(--color-bg-secondary, #FAFAF8)",
      }}
    >
      <FolderOutlinedIcon sx={{ fontSize: 16, color: "#7e22ce" }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
        Project:
      </span>

      <select
        value={currentProjectId ?? ""}
        onChange={(e) => setCurrentProjectId(e.target.value || null)}
        style={{
          fontSize: 13,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--color-border-tertiary)",
          background: "#fff",
        }}
      >
        <option value="">— No project (global) —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {loading && (
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Loading…</span>
      )}

      {creating ? (
        <>
          <input
            autoFocus
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="New project name"
            style={{
              fontSize: 13,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--color-border-tertiary)",
            }}
          />
          <button type="button" className="si-icon-btn" disabled={busy} onClick={handleCreate}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="si-icon-btn" disabled={busy} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="si-icon-btn" onClick={() => setCreating(true)}>
          <AddIcon sx={{ fontSize: 14 }} /> New Project
        </button>
      )}

      {currentProjectId && (
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary)" }}>
          New domain models will be created inside this project.
        </span>
      )}
    </div>
  );
}