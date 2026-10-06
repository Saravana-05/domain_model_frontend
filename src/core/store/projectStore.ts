import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  apiListProjects,
  apiCreateProject,
  type BackendProject,
} from "../../core/api/projectApi";
import {
  apiListModules,
  apiListAllModules,
  apiCreateModule,
  type BackendModule,
} from "../../core/api/moduleApi";

interface ProjectState {
  projects:         BackendProject[];
  currentProjectId: string | null;
  loading:          boolean;

  /** Modules of the CURRENT project (Project → Module → Domain model);
   *  every module when no project is selected. */
  modules:          BackendModule[];
  currentModuleId:  string | null;
  modulesLoading:   boolean;

  /** Bumped whenever a project / module / domain model is created, so the
   *  sidebar tree (components/SidebarTree.tsx) knows to re-fetch. */
  treeVersion:      number;
  bumpTree:         () => void;

  setCurrentProjectId: (id: string | null) => void;
  fetchProjects:        () => Promise<void>;
  createProject:        (name: string, description?: string) => Promise<BackendProject | null>;

  setCurrentModuleId:  (id: string | null) => void;
  /** Loads the modules of `projectId` (defaults to the current project). */
  fetchModules:         (projectId?: string | null) => Promise<void>;
  createModule:         (name: string, description?: string) => Promise<BackendModule | null>;
}

/**
 * Tracks the currently-selected Project across the app. Domain-model
 * creation (see datastoreApi.ts's apiCreateDomain) and the domain list
 * (apiListSchemas) both read `currentProjectId` from here automatically,
 * so switching the project in one place (see ProjectSelector.tsx) scopes
 * every domain-model call without threading a prop through every screen.
 *
 * Modules work the same way one level down: `currentModuleId` (when set)
 * is added to every domain-model create / list / draft call, so the
 * Domain Model page only shows the selected module's domain models.
 * A module always belongs to the current project, so switching project
 * clears the module selection and the module list.
 *
 * Only `currentProjectId` / `currentModuleId` are persisted (like a "last
 * used" pointer) — the `projects` / `modules` lists themselves are always
 * re-fetched fresh from the backend, so they never go stale across sessions.
 */
export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects:         [],
      currentProjectId: null,
      loading:          false,
      modules:          [],
      currentModuleId:  null,
      modulesLoading:   false,
      treeVersion:      0,

      bumpTree: () => set((state) => ({ treeVersion: state.treeVersion + 1 })),

      setCurrentProjectId: (id) =>
        set((state) =>
          // Same project → leave the module alone. Different project →
          // the old module no longer applies, so drop it (and its list).
          id === state.currentProjectId
            ? {}
            : { currentProjectId: id, currentModuleId: null, modules: [] },
        ),

      setCurrentModuleId: (id) => set({ currentModuleId: id }),

      fetchModules: async (projectId) => {
        const pid = projectId === undefined ? get().currentProjectId : projectId;
        set({ modulesLoading: true });
        try {
          // No project selected ("All Projects") → load every module so the
          // Domain Model cards can still show their module's name.
          const res = pid ? await apiListModules(pid) : await apiListAllModules();
          // Ignore a stale response if the project changed while loading.
          if (get().currentProjectId !== pid) {
            set({ modulesLoading: false });
            return;
          }
          const list = res.data ?? [];
          set((state) => ({
            modules: list,
            modulesLoading: false,
            // Persisted module no longer exists (deleted elsewhere) → clear it.
            currentModuleId:
              state.currentModuleId && !list.some((m) => m.id === state.currentModuleId)
                ? null
                : state.currentModuleId,
          }));
        } catch (err) {
          console.error("[projectStore] fetchModules failed:", err);
          set({ modulesLoading: false });
        }
      },

      createModule: async (name, description) => {
        const pid = get().currentProjectId;
        if (!pid) return null;
        const res = await apiCreateModule(pid, name, description);
        if (res.status === "success" && res.data) {
          const created = res.data;
          set((state) => ({
            modules:         [created, ...state.modules],
            currentModuleId: created.id,
            treeVersion:     state.treeVersion + 1,
          }));
          return created;
        }
        return null;
      },

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
            // same rule as setCurrentProjectId: a new project has no module yet
            currentModuleId:  null,
            modules:          [],
            treeVersion:      state.treeVersion + 1,
          }));
          return created;
        }
        return null;
      },
    }),
    {
      name: "project-store",
      partialize: (state) => ({
        currentProjectId: state.currentProjectId,
        currentModuleId:  state.currentModuleId,
      }),
    },
  ),
);