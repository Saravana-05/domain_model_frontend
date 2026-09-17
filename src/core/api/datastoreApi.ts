/**
 * Datastore API client — talks to the FastAPI /datastore endpoints.
 *
 * Backend: G:\skiode_lambda_backend\fastapi_service
 * Docs:    https://bzpfusv4ugqui3ysdnx2j53iyy0kefvt.lambda-url.ap-south-1.on.aws/docs
 */

import { useAuthStore } from "../../store/authStore";
import { useProjectStore } from "../store/projectStore";

const API_BASE = import.meta.env.VITE_API_URL || "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";

// Static token injected at build time (e.g. sky-view-builder sets VITE_API_TOKEN in its .env)
const STATIC_TOKEN: string = import.meta.env.VITE_API_TOKEN || "";

/** Resolve auth token: Zustand session first, then build-time env token. */
function resolveToken(): string | null {
  return useAuthStore.getState().token || STATIC_TOKEN || null;
}

// ════════════════════════════════════════════════════════════════════════════
// Backend wire types (match the FastAPI SchemaField Pydantic model)
// ════════════════════════════════════════════════════════════════════════════

export type BackendFieldType = "text" | "number" | "boolean" | "date" | "formattedText";

export interface BackendSchemaField {
  field_id:      string;
  type:          BackendFieldType;
  label:         string;
  value?:        any;              // default value
  cardinality?:  string;           // "list" = multi-value field
  relationKind?: string;           // "integral" | "association"
  relatedDomain?: string;          // the domain this field's relation points to
  validationRefs?: string[];       // attached named validation-rule tags
  // Extended metadata stored via model_config extra: allow
  component?:    string;
  placeholder?:  string;
  datasource?:   string;
  ui_config?:    Record<string, any>;
  rbac?:         Record<string, any>;
  abac?:         Record<string, any>;
  [key: string]: any;              // any extra fields
}

export interface BackendCreateRequest {
  table_name: string;
  schema:     BackendSchemaField[];
  db_backend?: "dynamodb" | "postgresql";
  versioned?: boolean;
  /** Optional — scopes this domain model to a project. If omitted,
   *  apiCreateDomain() below fills it in from the currently-selected
   *  project (see ProjectSelector.tsx / projectStore.ts). Pass an
   *  explicit `null` to force "no project" even if one is selected. */
  project_id?: string | number | null;
}

export interface BackendCreateResponse {
  status:        string;
  table_name:    string;
  table_created?: boolean;   // true = just created, false = already existed
  action?:       string;     // "created" | "already existed"
  db_backend?:   string;     // "dynamodb" | "postgresql"
  aws_region?:   string;     // DynamoDB: e.g. "ap-south-1"
  pg_host?:      string;     // PostgreSQL: host name
  pg_db?:        string;     // PostgreSQL: database name
  total_fields?: number;
  columns?:      { field_id: string; label: string; type: string }[];
  versioned?:    boolean;
  message?:      string;
}

export interface BackendSchemaEntry {
  table_name: string;
  schema:     BackendSchemaField[];
  db_backend?: "dynamodb" | "postgresql";
  versioned?: boolean;
  project_id?: string | null;
}

export interface BackendSchemasListResponse {
  status:  string;
  count:   number;
  schemas: BackendSchemaEntry[];
}

export interface BackendSchemaResponse {
  status:     string;
  table_name: string;
  schema:     BackendSchemaField[];
}

export interface BackendRowsResponse {
  status:     string;
  table_name: string;
  count:      number;
  data:       Record<string, any>[];
}

// ════════════════════════════════════════════════════════════════════════════
// Type converters — frontend ↔ backend
// ════════════════════════════════════════════════════════════════════════════

/** Map frontend FieldType → backend field type */
export function frontendTypeToBackend(type: string): BackendFieldType {
  switch (type) {
    case "string":  return "text";
    case "number":  return "number";
    case "boolean": return "boolean";
    case "date":    return "date";
    default:        return "text";
  }
}

/** Map backend field type → frontend FieldType */
export function backendTypeToFrontend(type: BackendFieldType): string {
  switch (type) {
    case "text":          return "string";
    case "formattedText": return "string";
    case "number":        return "number";
    case "boolean":       return "boolean";
    case "date":          return "date";
    default:              return "string";
  }
}

// ── Resolving named validation registry rules into flat, form-runnable ones ──
// Mirrors flattenNamedValidationRule in src/core/schema/domainBuilder.ts —
// duplicated here (not imported) to keep this API file self-contained. Kept
// in sync manually; if that function's behavior changes, this one should too.

interface FlatValidationRule {
  type: string;
  value?: any;
  message: string;
}

function flattenRegistryRule(rule: any, tag: string): FlatValidationRule[] {
  // Legacy flat shape — already exactly a FlatValidationRule.
  if (rule.type) {
    return [{ type: rule.type, value: rule.value, message: rule.message ?? "" }];
  }

  const desc = rule.description ?? "";

  switch (rule.kind) {
    case "required":
      return [{ type: "required", message: desc || "This field is required" }];
    case "pattern":
      return rule.expression
        ? [{ type: "pattern", value: rule.expression, message: desc || "Invalid format" }]
        : [];
    case "custom":
      return rule.expression
        ? [{ type: "custom", value: rule.expression, message: desc || "Invalid value" }]
        : [];
    case "length": {
      const out: FlatValidationRule[] = [];
      if (rule.min !== undefined) out.push({ type: "minLength", value: rule.min, message: desc || `At least ${rule.min} characters` });
      if (rule.max !== undefined) out.push({ type: "maxLength", value: rule.max, message: desc || `At most ${rule.max} characters` });
      return out;
    }
    case "range": {
      const out: FlatValidationRule[] = [];
      if (rule.min !== undefined) out.push({ type: "min", value: rule.min, message: desc || `Minimum value is ${rule.min}` });
      if (rule.max !== undefined) out.push({ type: "max", value: rule.max, message: desc || `Maximum value is ${rule.max}` });
      return out;
    }
    case "cardinality":
      // Not a scalar-field check — nothing to send to the form runtime for
      // this one, same reasoning as buildSchemas()'s own handling of it.
      console.warn(`[domainToBackendRequest] Skipping "${tag}" (kind: cardinality) — not a field-level check, nothing to enforce client-side.`);
      return [];
    case "all":
      return (rule.validations ?? []).flatMap((sub: any) => flattenRegistryRule(sub, tag));
    default:
      return [];
  }
}

/**
 * Convert a frontend domain definition (all layers) into a backend CreateRequest.
 *
 * The backend's SchemaField uses `model_config = {"extra": "allow"}`, which means
 * we can embed complete ui_config, rbac, abac objects — the backend stores them
 * unchanged and returns them in GET /schemas responses.
 */
export function domainToBackendRequest(params: {
  domainName:  string;
  fields:      Record<string, {
    type:         string;
    default?:     any;
    datasource?:  string;
    validations?: Array<{ type: string; value?: any; message: string }>;
    validationRefs?: string[];
    [key: string]: any;            // allow DomainFieldCore to pass through untyped
  }>;
  uiHints?:    Record<string, Record<string, any>>;   // full-path keys
  rbacRules?:  Record<string, Record<string, any>>;   // full-path keys
  abacRules?:  Record<string, Record<string, any>>;   // full-path keys
  db_backend?: "dynamodb" | "postgresql";              // which DB to store data in
  versioned?:  boolean;                                 // enable version history for this domain
  /** Named validation registry, needed to resolve each field's
   *  validationRefs into real rules before sending — without this, a
   *  field that only has registry refs attached (no inline validations)
   *  would silently persist NO validations at all. */
  registry?: Record<string, any>;
}): BackendCreateRequest {
  const { domainName, fields, uiHints = {}, rbacRules = {}, abacRules = {}, db_backend, versioned, registry = {} } = params;

  const schema: BackendSchemaField[] = Object.entries(fields).map(([fieldName, fieldDef]) => {
    const path = `${domainName}.${fieldName}`;
    const ui   = uiHints[path];
    const rbac = rbacRules[path];
    const abac = abacRules[path];

    const field: BackendSchemaField = {
      field_id: fieldName,
      type:     frontendTypeToBackend(fieldDef.type),
      label:    ui?.label ?? fieldName,
      value:    fieldDef.default ?? null,
    };

    if (fieldDef.datasource)  field.datasource  = fieldDef.datasource;
    if (fieldDef.cardinality) field.cardinality = fieldDef.cardinality;
    if (ui?.component)        field.component   = ui.component;
    if (ui?.placeholder)      field.placeholder = ui.placeholder;

    // Persist the composition/reference distinction for FK columns so
    // consumers (e.g. the view-builder) can tell "part of" relations
    // (branch belongs to clinic — no link/unlink) apart from plain
    // reassignable references (doctor/patient belongs to branch).
    if (fieldDef.relationKind) field.relationKind = fieldDef.relationKind;

    // relatedDomain was missing from this same whitelist — relationKind
    // ("association"/"integral") was being saved, but the actual target
    // domain it points to was silently dropped on every save. That's why
    // a freshly-created or freshly-re-saved relation field could show
    // relationKind with an empty related_domain_model.linked_with on
    // export: the backend genuinely never received the value to store.
    // This is the save-side counterpart to the same gap already fixed in
    // backendSchemaToFrontend() (the load side).
    if (fieldDef.relatedDomain) field.relatedDomain = fieldDef.relatedDomain;

    // Resolve registry-attached rules (validationRefs) into real, flat
    // rules the Form plugin can run — this was the actual gap: only
    // fieldDef.validations (inline, one-off rules typed directly on the
    // field) ever made it into the payload before. Clicking a Registry
    // Rules chip attached a TAG to validationRefs, but that tag was never
    // looked up or resolved here, so it silently vanished on save.
    const refRules: FlatValidationRule[] = Array.isArray(fieldDef.validationRefs)
      ? fieldDef.validationRefs.flatMap((tag: string) => {
          const rule = registry[tag];
          if (!rule) {
            console.warn(`[domainToBackendRequest] Validation tag "${tag}" not found in registry (field: ${path})`);
            return [];
          }
          return flattenRegistryRule(rule, tag);
        })
      : [];
    const inlineRules: FlatValidationRule[] = Array.isArray(fieldDef.validations) ? fieldDef.validations : [];
    const allValidations = [...refRules, ...inlineRules];
    if (allValidations.length > 0) field.validations = allValidations;

    // Also persist the raw tag list itself (not just the rules resolved
    // from it above) — backendSchemaToFrontend() reads validationRefs
    // back on load to show the actual tag identity (e.g. "required-name")
    // in the Validation Refs column and the Export tab's JSON. Without
    // sending it here too, that identity is only ever present for fields
    // saved before this fix; any field saved through this function keeps
    // its enforced rules (field.validations still runs fine) but loses
    // which named tag it came from on the next reload.
    if (Array.isArray(fieldDef.validationRefs) && fieldDef.validationRefs.length > 0) {
      field.validationRefs = fieldDef.validationRefs;
    }

    // Store full ui_config blob so it round-trips correctly
    if (ui && Object.keys(ui).length > 0) field.ui_config = ui;
    if (rbac && Object.keys(rbac).length > 0) field.rbac = rbac;
    if (abac && Object.keys(abac).length > 0) field.abac = abac;

    return field;
  });

  const req: BackendCreateRequest = { table_name: domainName, schema };
  if (db_backend) req.db_backend = db_backend;
  if (versioned !== undefined) req.versioned = versioned;
  return req;
}

/**
 * Convert a backend schema response back to a frontend-friendly shape.
 */
export function backendSchemaToFrontend(entry: BackendSchemaEntry): {
  domainName: string;
  fields:     Record<string, {
    type: string; default?: any; datasource?: string;
    cardinality?: string; relationKind?: string;
    relatedDomain?: string; validationRefs?: string[];
  }>;
  uiHints:    Record<string, Record<string, any>>;
  rbacRules:  Record<string, Record<string, any>>;
  abacRules:  Record<string, Record<string, any>>;
  versioned:  boolean;
} {
  const { table_name, schema, versioned } = entry;
  const fields:    Record<string, any> = {};
  const uiHints:   Record<string, any> = {};
  const rbacRules: Record<string, any> = {};
  const abacRules: Record<string, any> = {};

  for (const field of schema) {
    const path = `${table_name}.${field.field_id}`;

    fields[field.field_id] = {
      type:           backendTypeToFrontend(field.type),
      default:        field.value ?? undefined,
      datasource:     field.datasource,
      cardinality:    field.cardinality ?? undefined,
      relationKind:   field.relationKind ?? undefined,
      // These two were missing entirely — the raw backend field object
      // already carries them (see the /datastore/schemas response: each
      // field has "relatedDomain": "contact" etc. right alongside
      // relationKind), but this function silently dropped them on the
      // way into the frontend's field shape. That's why every relation
      // came back empty on reload/import even though the backend had it
      // stored correctly all along — downstream code (handleLoadFromBackend
      // in SchemaInspector.tsx) reads relatedDomain/validationRefs off of
      // exactly this returned object, so if they're missing here, no
      // amount of "whitelisting" further downstream can recover them.
      relatedDomain:  field.relatedDomain ?? undefined,
      validationRefs: field.validationRefs ?? undefined,
    };

    const ui: Record<string, any> = {};
    if (field.component)   ui.component   = field.component;
    if (field.label)       ui.label       = field.label;
    if (field.placeholder) ui.placeholder = field.placeholder;
    if (field.ui_config)   Object.assign(ui, field.ui_config);
    if (Object.keys(ui).length > 0) uiHints[path] = ui;

    if (field.rbac && Object.keys(field.rbac).length > 0) rbacRules[path] = field.rbac;
    if (field.abac && Object.keys(field.abac).length > 0) abacRules[path] = field.abac;
  }

  return { domainName: table_name, fields, uiHints, rbacRules, abacRules, versioned: !!versioned };
}

export interface BackendValidationRule {
  tag:          string;
  version?:     string;
  description?: string;
  category?:    string;
  kind?:        string;
  type?:        string;
  value?:       any;
  message?:     string;
  expression?:  string;
  min?:         number;
  max?:         number;
  validations?: BackendValidationRule[];
}

export interface BackendValidationRulesListResponse {
  status: string;
  count:  number;
  rules:  BackendValidationRule[];
}

// ════════════════════════════════════════════════════════════════════════════
// API functions
// ════════════════════════════════════════════════════════════════════════════

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const token = resolveToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers, ...init });
  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout();
    }
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * POST /datastore/create — create a table from a schema.
 *
 * If `req.project_id` isn't explicitly set, this scopes the new domain
 * model to whichever project is currently selected (ProjectSelector.tsx)
 * — every one of SchemaInspector.tsx's ~10 create-domain call sites gets
 * project scoping "for free" this way, without each needing to be
 * touched individually. Pass `project_id: null` explicitly to force
 * "no project" regardless of what's currently selected.
 */
export async function apiCreateDomain(req: BackendCreateRequest): Promise<BackendCreateResponse> {
  const project_id = req.project_id !== undefined
    ? req.project_id
    : useProjectStore.getState().currentProjectId;

  return apiFetch("/datastore/create", {
    method: "POST",
    body:   JSON.stringify({ ...req, project_id: project_id ?? undefined }),
  });
}

/**
 * GET /datastore/schemas — list registered table schemas.
 * Defaults to the currently-selected project (pass `null` explicitly to
 * force the full unfiltered list regardless of what's selected).
 */
export async function apiListSchemas(
  projectId?: string | null,
): Promise<BackendSchemasListResponse> {
  const effectiveId = projectId !== undefined
    ? projectId
    : useProjectStore.getState().currentProjectId;

  const query = effectiveId ? `?project_id=${encodeURIComponent(effectiveId)}` : "";
  return apiFetch(`/datastore/schemas${query}`);
}

/** GET /datastore/schemas/{table_name} — get schema for one table */
export async function apiGetSchema(tableName: string): Promise<BackendSchemaResponse> {
  return apiFetch(`/datastore/schemas/${tableName}`);
}

/** POST /datastore/{table_name}/row — insert a data row */
export async function apiInsertRow(
  tableName: string,
  row: Record<string, any>,
): Promise<any> {
  return apiFetch(`/datastore/${tableName}/row`, {
    method: "POST",
    body:   JSON.stringify(row),
  });
}

/** GET /datastore/{table_name}/rows — list all rows */
export async function apiListRows(tableName: string): Promise<BackendRowsResponse> {
  return apiFetch(`/datastore/${tableName}/rows`);
}

/** GET /datastore/{table_name}/row/{id} — get one row by ID */
export async function apiGetRow(tableName: string, recordId: string): Promise<any> {
  return apiFetch(`/datastore/${tableName}/row/${recordId}`);
}

/** POST /datastore/domain-attributes — save a field/attribute for a domain */
export async function apiSaveAttribute(
  domainModelId: string,
  attributeName: string,
  label?: string,
  fieldType?: string,
): Promise<{ status: string; message?: string }> {
  return apiFetch("/datastore/domain-attributes", {
    method: "POST",
    body: JSON.stringify({
      domain_model_id: domainModelId,
      attribute_name:  attributeName,
      label:           label ?? null,
      field_type:      fieldType ?? null,
    }),
  });
}

/** POST /datastore/domain-attributes/{domain}/{attribute}/translation — save one language's label */
export async function apiSaveAttributeTranslation(
  domainModelId: string,
  attributeName: string,
  langCode: "en" | "ta" | "ar",
  label: string,
): Promise<{ status: string; message?: string; label?: string }> {
  return apiFetch(
    `/datastore/domain-attributes/${domainModelId}/${attributeName}/translation`,
    {
      method: "POST",
      body: JSON.stringify({ lang_code: langCode, label }),
    },
  );
}

/** GET /datastore/validation-rules — list every named validation rule stored in the DB */
export async function apiListValidationRules(): Promise<BackendValidationRulesListResponse> {
  return apiFetch("/datastore/validation-rules");
}

/** POST /datastore/validation-rules — create or update (upsert, keyed by tag) one named validation rule */
export async function apiSaveValidationRule(
  tag: string,
  rule: Omit<BackendValidationRule, "tag">,
): Promise<{ status: string; message?: string }> {
  return apiFetch("/datastore/validation-rules", {
    method: "POST",
    body: JSON.stringify({ tag, ...rule }),
  });
}

export async function apiDeleteValidationRule(tag: string): Promise<{ status: string; message?: string }> {
  const res = await fetch(`${API_BASE}/datastore/validation-rules/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
  return res.json();
}