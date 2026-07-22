/**
 * Datastore API client — talks to the FastAPI /datastore endpoints.
 *
 * Backend: G:\skiode_lambda_backend\fastapi_service
 * Docs:    https://bzpfusv4ugqui3ysdnx2j53iyy0kefvt.lambda-url.ap-south-1.on.aws/docs
 */

import { useAuthStore } from "../../store/authStore";

// const API_BASE = import.meta.env.VITE_API_URL || "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
    [key: string]: any;            // allow DomainFieldCore to pass through untyped
  }>;
  uiHints?:    Record<string, Record<string, any>>;   // full-path keys
  rbacRules?:  Record<string, Record<string, any>>;   // full-path keys
  abacRules?:  Record<string, Record<string, any>>;   // full-path keys
  db_backend?: "dynamodb" | "postgresql";              // which DB to store data in
  versioned?:  boolean;                                 // enable version history for this domain
}): BackendCreateRequest {
  const { domainName, fields, uiHints = {}, rbacRules = {}, abacRules = {}, db_backend, versioned } = params;

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

    // Persist inline validation rules so the Form plugin can run them client-side
    if (Array.isArray(fieldDef.validations) && fieldDef.validations.length > 0) {
      field.validations = fieldDef.validations;
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
  fields:     Record<string, { type: string; default?: any; datasource?: string }>;
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
      type:        backendTypeToFrontend(field.type),
      default:     field.value ?? undefined,
      datasource:  field.datasource,
      cardinality: field.cardinality ?? undefined,
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

/** POST /datastore/create — create a DynamoDB table from a schema */
export async function apiCreateDomain(req: BackendCreateRequest): Promise<BackendCreateResponse> {
  return apiFetch("/datastore/create", {
    method: "POST",
    body:   JSON.stringify(req),
  });
}

/** GET /datastore/schemas — list all registered table schemas */
export async function apiListSchemas(): Promise<BackendSchemasListResponse> {
  return apiFetch("/datastore/schemas");
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