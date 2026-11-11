import { apiListProjects, apiCreateProject } from "../../api/projectApi";
import { apiListAllModules, apiCreateModule } from "../../api/moduleApi";
import { useProjectStore } from "../../store/projectStore";
import type { DomainModelImportResult } from "./domainImport";

export interface ResolvedImportScope {
  /** PascalCase domain name → the real project / module ids it should be filed under. */
  byDomain: Record<string, { projectId: string; moduleId: string | null }>;
  createdProjects: number;
  createdModules: number;
  warnings: string[];
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * Makes sure every project and module named in an imported
 * Project → Module → Domain model JSON exists on the backend — reusing one
 * with the same name (case-insensitive) when it does, creating it when it
 * doesn't — and returns the ids each imported domain model belongs under.
 *
 * Deliberately talks to the APIs directly instead of projectStore.createProject():
 * that action also switches the app's *current* project, which an import
 * shouldn't do as a side effect.
 */
export async function resolveImportScope(result: DomainModelImportResult): Promise<ResolvedImportScope> {
  const out: ResolvedImportScope = { byDomain: {}, createdProjects: 0, createdModules: 0, warnings: [] };
  if (result.projects.length === 0) return out;

  const [projRes, modRes] = await Promise.all([
    apiListProjects().catch(() => ({ data: [] as any[] })),
    apiListAllModules().catch(() => ({ data: [] as any[] })),
  ]);
  const existingProjects = [...(projRes.data ?? [])];
  const existingModules  = [...(modRes.data ?? [])];

  const projectId = new Map<string, string>();            // project name → id
  const moduleId  = new Map<string, string>();            // "project|module" → id

  for (const p of result.projects) {
    let found = existingProjects.find((x) => key(x.name) === key(p.name));
    if (!found) {
      try {
        const res = await apiCreateProject(p.name, p.description);
        if (res.status === "success" && res.data) { found = res.data; existingProjects.push(found); out.createdProjects++; }
        else out.warnings.push(`Couldn't create project "${p.name}": ${res.message ?? "unknown error"}`);
      } catch (err: any) {
        out.warnings.push(`Couldn't create project "${p.name}": ${err?.message ?? String(err)}`);
      }
    }
    if (!found) continue;
    projectId.set(p.name, found.id);

    for (const m of p.modules) {
      let mod = existingModules.find((x) => x.project_id === found!.id && key(x.name) === key(m.name));
      if (!mod) {
        try {
          const res = await apiCreateModule(found.id, m.name, m.description);
          if (res.status === "success" && res.data) { mod = res.data; existingModules.push(mod); out.createdModules++; }
          else out.warnings.push(`Couldn't create module "${m.name}" in "${p.name}": ${res.message ?? "unknown error"}`);
        } catch (err: any) {
          out.warnings.push(`Couldn't create module "${m.name}" in "${p.name}": ${err?.message ?? String(err)}`);
        }
      }
      if (mod) moduleId.set(`${p.name}|${m.name}`, mod.id);
    }
  }

  for (const [domain, scope] of Object.entries(result.domainScopes)) {
    if (!scope.project) continue;
    const pid = projectId.get(scope.project);
    if (!pid) { out.warnings.push(`"${domain}" left outside project "${scope.project}" (project unavailable).`); continue; }
    const mid = scope.module ? moduleId.get(`${scope.project}|${scope.module}`) ?? null : null;
    if (scope.module && !mid) out.warnings.push(`"${domain}" placed in project "${scope.project}" without module "${scope.module}" (module unavailable).`);
    out.byDomain[domain] = { projectId: pid, moduleId: mid };
  }

  if (out.createdProjects || out.createdModules) {
    await useProjectStore.getState().fetchProjects();
    useProjectStore.getState().bumpTree();
  }
  return out;
}