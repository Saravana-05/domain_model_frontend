import type { AllSchemas, DependencyGraph, ResolvedScreen, ActionDef } from "./core/schema/types";
import { resolveScreen }              from "./core/schema/schemaResolver";
import { useFormStore }               from "./core/store/formStore";
import { buildDependencyGraph, getAffectedNodes } from "./core/engines/dependencyEngine";
import { applyAccessRules }           from "./core/engines/accessEngine";
import { applyComputedFields }        from "./core/engines/computedEngine";
import { applyValidation }            from "./core/engines/validationEngine";
import { loadDatasource, loadAllStaticDatasources } from "./core/engines/datasourceEngine";
import { executeAction, type ActionResult } from "./core/engines/actionsEngine";
import type { ExpressionContext }     from "./core/engines/expressionEngine";

export interface FormEngineOptions {
  auth?: Record<string, any>; // injected into every expression context
}

export class FormEngine {
  private schemas: AllSchemas;
  private screen:  ResolvedScreen;
  private graph:   DependencyGraph;
  private ctx:     ExpressionContext;

  constructor(schemas: AllSchemas, screenId: string, options: FormEngineOptions = {}) {
    this.schemas = schemas;

    const screen = resolveScreen(screenId, schemas);
    if (!screen) throw new Error(`Screen "${screenId}" not found`);
    this.screen = screen;

    this.graph = buildDependencyGraph(screen.fields, schemas.datasources);

    // Expression context — env from schemas, auth from runtime options
    this.ctx = {
      env:  schemas.env  ?? {},
      auth: options.auth ?? {},
    };
  }

  async init(): Promise<void> {
    useFormStore.getState().initStore(this.screen.fields);
    await loadAllStaticDatasources(this.schemas);

    const data = useFormStore.getState().data;
    applyAccessRules(this.screen.fields, data, this.ctx);
    applyComputedFields(this.screen.fields, data, this.ctx);
  }

  getScreen():  ResolvedScreen  { return this.screen; }
  getGraph():   DependencyGraph  { return this.graph;  }
  getContext(): ExpressionContext { return this.ctx;   }

  async onFieldChange(path: string, value: any): Promise<void> {
    const store = useFormStore.getState();
    store.setFieldValue(path, value);
    store.setTouched(path);

    const data    = useFormStore.getState().data;
    const affected = getAffectedNodes(this.graph, path);

    const computedPaths:    string[] = [];
    const visibilityPaths:  string[] = [];
    const disabledPaths:    string[] = [];
    const validationPaths:  string[] = [path];
    const datasourcesToLoad: string[] = [];

    for (const node of affected) {
      if      (node.startsWith("computed:"))    computedPaths.push(node.slice(9));
      else if (node.startsWith("visibility:"))  visibilityPaths.push(node.slice(11));
      else if (node.startsWith("disabled:"))    disabledPaths.push(node.slice(9));
      else if (node.startsWith("validation:")) {
        const p = node.slice(11);
        if (!validationPaths.includes(p)) validationPaths.push(p);
      }
      else if (node.startsWith("datasource:")) datasourcesToLoad.push(node.slice(11));
    }

    // Computed first — result may affect access / validation
    applyComputedFields(this.screen.fields, data, this.ctx, computedPaths);

    const updated = useFormStore.getState().data;

    const accessPaths = [...new Set([...visibilityPaths, ...disabledPaths])];
    if (accessPaths.length) applyAccessRules(this.screen.fields, updated, this.ctx, accessPaths);

    const { touched } = useFormStore.getState().meta;
    for (const p of validationPaths) {
      const field = this.screen.fields[p];
      if (field && touched[p]) applyValidation(field, updated, this.ctx);
    }

    for (const ds of datasourcesToLoad) {
      await loadDatasource(ds, this.schemas, updated);
    }
  }

  async onFieldBlur(path: string): Promise<void> {
    const store = useFormStore.getState();
    store.setTouched(path);
    const field = this.screen.fields[path];
    if (field) applyValidation(field, store.data, this.ctx);
  }

  validateAll(): boolean {
    const store = useFormStore.getState();
    for (const field of Object.values(this.screen.fields)) {
      store.setTouched(field.path);
      applyValidation(field, store.data, this.ctx);
    }
    return Object.values(useFormStore.getState().ui.errors).every((e) => !e);
  }

  getData(): Record<string, any> {
    return useFormStore.getState().data;
  }

  /** Execute a named action defined in schemas.actions. */
  async runAction(actionName: string): Promise<ActionResult> {
    const action = this.schemas.actions?.[actionName] as ActionDef | undefined;
    if (!action) return { success: false, error: `Action "${actionName}" not found` };
    return executeAction(action, this.getData());
  }
}
