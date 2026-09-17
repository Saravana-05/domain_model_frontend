import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  apiListProjects,
  apiCreateProject,
  type BackendProject,
} from "../../core/api/projectApi";

interface ProjectState {
  projects:         BackendProject[];
  currentProjectId: string | null;
  loading:          boolean;

  setCurrentProjectId: (id: string | null) => void;
  fetchProjects:        () => Promise<void>;
  createProject:        (name: string, description?: string) => Promise<BackendProject | null>;
}

/**
 * Tracks the currently-selected Project across the app. Domain-model
 * creation (see datastoreApi.ts's apiCreateDomain) and the domain list
 * (apiListSchemas) both read `currentProjectId` from here automatically,
 * so switching the project in one place (see ProjectSelector.tsx) scopes
 * every domain-model call without threading a prop through every screen.
 *
 * Only `currentProjectId` is persisted (like a "last used" pointer) —
 * the `projects` list itself is always re-fetched fresh from the backend
 * on load, so it never goes stale across sessions.
 */
export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects:         [],
      currentProjectId: null,
      loading:          false,

      setCurrentProjectId: (id) => set({ currentProjectId: id }),

      fetchProjects: async () => {
        set({ loading: true });
        try {
          const res = await apiListProjects();
          set({ projects: res.data ?? [], loading: false });
        } catch (err) {
          console.error("[projectStore] fetchProjects failed:", err);
          set({ loading: false });
        }
      },

      createProject: async (name, description) => {
        const res = await apiCreateProject(name, description);
        if (res.status === "success" && res.data) {
          const created = res.data;
          set((state) => ({
            projects:         [created, ...state.projects],
            currentProjectId: created.id,
          }));
          return created;
        }
        return null;
      },
    }),
    {
      name: "project-store",
      partialize: (state) => ({ currentProjectId: state.currentProjectId }),
    },
  ),
);