import React, { useState, useMemo, useEffect, useRef } from "react";
import StorageIcon              from "@mui/icons-material/Storage";
import PaletteOutlinedIcon      from "@mui/icons-material/PaletteOutlined";
import CheckCircleOutlinedIcon  from "@mui/icons-material/CheckCircleOutlined";
import LockOutlinedIcon         from "@mui/icons-material/LockOutlined";
import AddCircleOutlinedIcon    from "@mui/icons-material/AddCircleOutlined";
import ContentCopyIcon          from "@mui/icons-material/ContentCopy";
import CheckIcon                from "@mui/icons-material/Check";
import DeleteOutlinedIcon       from "@mui/icons-material/DeleteOutlined";
import AddIcon                  from "@mui/icons-material/Add";
import CodeIcon                 from "@mui/icons-material/Code";
import LabelIcon                from "@mui/icons-material/Label";
import ExpandMoreIcon           from "@mui/icons-material/ExpandMore";
import ExpandLessIcon           from "@mui/icons-material/ExpandLess";
import SaveOutlinedIcon         from "@mui/icons-material/SaveOutlined";
import EditOutlinedIcon         from "@mui/icons-material/EditOutlined";
import TableChartOutlinedIcon   from "@mui/icons-material/TableChartOutlined";
import CloudUploadOutlinedIcon  from "@mui/icons-material/CloudUploadOutlined";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import FormatPaintOutlinedIcon  from "@mui/icons-material/FormatPaintOutlined";
import type {
  AllSchemas,
  ComponentType,
  FieldType,
  FontSize,
  FontWeight,
  TextAlign,
  FieldWidth,
  DomainDefinition,
  DomainFieldCore,
  DomainViewConfig,
  FieldUIConfig,
  ValidationRule,
  ABACFieldRule,
  RBACFieldRule,
} from "../schema/types";
import { buildSchemas } from "../schema/domainBuilder";
import {
  domainToBackendRequest,
  backendSchemaToFrontend,
  apiCreateDomain,
  apiListSchemas,
  apiInsertRow,
  apiListRows,
  type BackendSchemaEntry,
  type BackendCreateResponse,
} from "../api/datastoreApi";

// ── Helper: build a human-readable DB location string from a create response ─
function dbLocation(res: BackendCreateResponse): string {
  if (res.db_backend === "postgresql" || res.pg_host) {
    const host = res.pg_host ?? "localhost";
    const db   = res.pg_db   ?? "";
    return `PostgreSQL (${host}${db ? `/${db}` : ""})`;
  }
  if (res.aws_region) return `DynamoDB (${res.aws_region})`;
  return "database";
}

// ════════════════════════════════════════════════════════════════════════════
// Unified extra-schema state (all live additions across all 3 layers)
// ════════════════════════════════════════════════════════════════════════════

interface ExtraSchemaState {
  /** Entirely new domains created via "Create Domain" tab */
  newDomains: DomainDefinition[];
  /** Extra fields added to EXISTING domains — domain name → field name → core */
  extraFields: Record<string, Record<string, DomainFieldCore>>;
  /** Extra UI hints — "domain.field" → FieldUIConfig */
  uiHints: Record<string, FieldUIConfig>;
  /** Extra RBAC rules — "domain.field" → RBACFieldRule */
  rbacRules: Record<string, RBACFieldRule>;
  /** Extra ABAC rules — "domain.field" → ABACFieldRule */
  abacRules: Record<string, ABACFieldRule>;
  /** Domain-level view configuration — domain name → DomainViewConfig */
  viewConfigs: Record<string, DomainViewConfig>;
}

const EMPTY_EXTRA: ExtraSchemaState = {
  newDomains: [], extraFields: {}, uiHints: {}, rbacRules: {}, abacRules: {}, viewConfigs: {},
};

// ════════════════════════════════════════════════════════════════════════════
// Merge helper — combines base AllSchemas + ExtraSchemaState → live AllSchemas
// ════════════════════════════════════════════════════════════════════════════

function mergeAll(base: AllSchemas, extra: ExtraSchemaState): AllSchemas {
  const isEmpty =
    extra.newDomains.length === 0 &&
    Object.keys(extra.extraFields).length === 0 &&
    Object.keys(extra.uiHints).length === 0 &&
    Object.keys(extra.rbacRules).length === 0 &&
    Object.keys(extra.abacRules).length === 0;
  if (isEmpty) return base;

  // Merge extraFields INTO newDomains so a domain never appears twice.
  // If the domain was created in-session (newDomains) AND had fields added
  // later (extraFields), we combine all fields into one entry.
  const newDomainNames = new Set(extra.newDomains.map((d) => d.name));
  const mergedNewDomains: DomainDefinition[] = extra.newDomains.map((dom) => ({
    ...dom,
    fields: { ...dom.fields, ...(extra.extraFields[dom.name] ?? {}) },
  }));
  // Domains that only have extra fields (added to a domain loaded from the
  // base schema, not created this session)
  const onlyExtraFieldDomains: DomainDefinition[] = Object.entries(extra.extraFields)
    .filter(([name]) => !newDomainNames.has(name))
    .map(([name, fields]) => ({ name, fields }));

  const allExtraDomains = [...mergedNewDomains, ...onlyExtraFieldDomains];

  const extraBuilt = buildSchemas({
    domains: allExtraDomains,
    ui: { fields: extra.uiHints, screens: {} },
    access: {
      rbac: Object.keys(extra.rbacRules).length ? { fields: extra.rbacRules } : undefined,
      abac: Object.keys(extra.abacRules).length ? { rules: extra.abacRules } : undefined,
    },
  });

  const mergedDomains = { ...base.domains };
  for (const [name, domDef] of Object.entries(extraBuilt.domains)) {
    if (mergedDomains[name]) {
      mergedDomains[name] = { fields: { ...mergedDomains[name].fields, ...domDef.fields } };
    } else {
      mergedDomains[name] = domDef;
    }
  }

  const mergedRBACFields: Record<string, RBACFieldRule> = {
    ...(base._layers?.rbac?.fields ?? {}),
    ...extra.rbacRules,
  };
  const mergedABACRules: Record<string, ABACFieldRule> = {
    ...(base._layers?.abac?.rules ?? {}),
    ...extra.abacRules,
  };

  return {
    domains:      mergedDomains,
    validations:  { ...base.validations,  ...extraBuilt.validations  },
    access:       { ...base.access,       ...extraBuilt.access       },
    uiExtensions: { ...base.uiExtensions, ...extraBuilt.uiExtensions },
    datasources:  base.datasources,
    ui:           base.ui,
    computed:     { ...base.computed,     ...extraBuilt.computed     },
    actions:      base.actions,
    env:          base.env,
    uiHints:      { ...(base.uiHints ?? {}), ...(extraBuilt.uiHints ?? {}) },
    _layers: {
      rbac: Object.keys(mergedRBACFields).length ? { fields: mergedRBACFields } : base._layers?.rbac,
      abac: Object.keys(mergedABACRules).length  ? { rules: mergedABACRules }  : base._layers?.abac,
      ui:   { ...(base._layers?.ui ?? {}), ...extra.uiHints },
      validationRegistry: base._layers?.validationRegistry,
      validationRefs: { ...(base._layers?.validationRefs ?? {}), ...(extraBuilt._layers?.validationRefs ?? {}) },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════════════════════════════

const FIELD_TYPES: FieldType[]     = ["string", "number", "boolean", "date"];
const COMPONENTS:  ComponentType[] = ["text", "number", "select", "checkbox", "textarea", "date"];
const FONT_SIZES:  FontSize[]      = ["xs", "sm", "base", "lg", "xl", "2xl"];
const FONT_WEIGHTS: FontWeight[]   = ["light", "normal", "medium", "semibold", "bold"];
const TEXT_ALIGNS: TextAlign[]     = ["left", "center", "right"];
const FIELD_WIDTHS: FieldWidth[]   = ["auto", "quarter", "third", "half", "full"];
const VAL_TYPES = ["required", "minLength", "maxLength", "min", "max", "pattern", "custom"] as const;

interface DraftValidation { type: string; value: string; message: string }

function getAllFieldPaths(schemas: AllSchemas): string[] {
  return Object.entries(schemas.domains).flatMap(([domain, def]) =>
    Object.keys(def.fields).map((field) => `${domain}.${field}`)
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`si-badge si-badge--${color}`}>{label}</span>;
}

function CopyBlock({ title, code }: { title: React.ReactNode; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="si-output">
      <div className="si-output-header">
        <span>{title}</span>
        <button
          className={`si-copy-btn ${copied ? "si-copy-btn--copied" : ""}`}
          type="button"
          onClick={() => navigator.clipboard.writeText(code).then(() => {
            setCopied(true); setTimeout(() => setCopied(false), 2000);
          })}
        >
          {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="si-code">{code}</pre>
    </div>
  );
}

function AddSection({
  label, icon, children,
}: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="si-add-section">
      <button className="si-add-toggle" type="button" onClick={() => setOpen((o) => !o)}>
        {icon ?? <AddCircleOutlinedIcon sx={{ fontSize: 16 }} />}
        <span>{label}</span>
        {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </button>
      {open && <div className="si-add-body">{children}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Code generators
// ════════════════════════════════════════════════════════════════════════════

function genDomainFieldCode(name: string, def: DomainFieldCore): string {
  const i = "    ";
  const lines = [`${i}${name}: {`];
  lines.push(`${i}  type: "${def.type}",`);
  if (def.default !== undefined && def.default !== "")
    lines.push(`${i}  default: ${def.type === "number" ? Number(def.default) : def.type === "boolean" ? def.default : `"${def.default}"`},`);
  if (def.format)     lines.push(`${i}  format: "${def.format}",`);
  if (def.computed)   lines.push(`${i}  computed: true,`);
  if (def.datasource) lines.push(`${i}  datasource: "${def.datasource}",`);
  if (def.validationRefs?.length)
    lines.push(`${i}  validationRefs: [${def.validationRefs.map((r) => `"${r}"`).join(", ")}],`);
  if (def.validations?.length) {
    lines.push(`${i}  validations: [`);
    for (const v of def.validations) {
      const val = v.value !== undefined ? `, value: ${isNaN(Number(v.value)) ? `"${v.value}"` : v.value}` : "";
      lines.push(`${i}    { type: "${v.type}"${val}, message: "${v.message}" },`);
    }
    lines.push(`${i}  ],`);
  }
  if (def.computedExpr) {
    const deps = def.computedExpr.dependsOn.map((d) => `"${d}"`).join(", ");
    lines.push(`${i}  computedExpr: { expression: "${def.computedExpr.expression}", dependsOn: [${deps}] },`);
  }
  lines.push(`${i}},`);
  return lines.join("\n");
}

function genDomainFile(domainName: string, fields: Record<string, DomainFieldCore>): string {
  const varName = `${domainName}Domain`;
  return [
    `import type { DomainDefinition } from "../core/schema/types";`,
    ``,
    `// No UI, no access — see src/ui-config/ and src/access-config/`,
    `export const ${varName}: DomainDefinition = {`,
    `  name: "${domainName}",`,
    `  fields: {`,
    Object.entries(fields).map(([n, d]) => genDomainFieldCode(n, d)).join("\n\n"),
    `  },`,
    `};`,
  ].join("\n");
}


function genRBACSnippet(rules: Record<string, RBACFieldRule>): string {
  const lines = Object.entries(rules).map(([path, rule]) => {
    const parts: string[] = [];
    if (rule.visible  !== undefined) parts.push(`visible: [${rule.visible.map((r) => `"${r}"`).join(", ")}]`);
    if (rule.read     !== undefined) parts.push(`read: [${rule.read.map((r) => `"${r}"`).join(", ")}]`);
    if (rule.write    !== undefined) parts.push(`write: [${rule.write.map((r) => `"${r}"`).join(", ")}]`);
    if (rule.disabled !== undefined) parts.push(`disabled: [${rule.disabled.map((r) => `"${r}"`).join(", ")}]`);
    return parts.length ? `  "${path}": { ${parts.join(", ")} },` : null;
  }).filter(Boolean);
  return lines.length ? `// Add inside fields in src/access-config/rbac.ts\n${lines.join("\n")}` : "";
}

function genABACSnippet(rules: Record<string, ABACFieldRule>): string {
  const lines = Object.entries(rules).map(([path, rule]) => {
    const parts: string[] = [];
    if (rule.visible  !== undefined) parts.push(`visible: ${typeof rule.visible === "string" ? `"${rule.visible}"` : rule.visible}`);
    if (rule.write    !== undefined) parts.push(`write: ${rule.write}`);
    if (rule.disabled !== undefined) parts.push(`disabled: ${rule.disabled}`);
    return parts.length ? `  "${path}": { ${parts.join(", ")} },` : null;
  }).filter(Boolean);
  return lines.length ? `// Add inside rules in src/access-config/abac.ts\n${lines.join("\n")}` : "";
}

// ════════════════════════════════════════════════════════════════════════════
// Domain View Config form component
// ════════════════════════════════════════════════════════════════════════════

interface ViewConfigFormProps {
  domainName:  string;
  current:     DomainViewConfig;
  fieldNames:  string[];
  onChange:    (cfg: DomainViewConfig) => void;
}

function ViewConfigForm({ domainName, current, fieldNames, onChange }: ViewConfigFormProps) {
  const tv = current.tableView ?? { enabled: false };
  const fv = current.formView  ?? { enabled: false };
  const cv = current.cardView  ?? { enabled: false };

  function setTable(patch: Partial<typeof tv>) {
    onChange({ ...current, tableView: { ...tv, ...patch } });
  }
  function setForm(patch: Partial<typeof fv>) {
    onChange({ ...current, formView: { ...fv, ...patch } });
  }
  function setCard(patch: Partial<typeof cv>) {
    onChange({ ...current, cardView: { ...cv, ...patch } });
  }

  return (
    <div className="si-view-config">
      {/* Table View */}
      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!tv.enabled}
            onChange={(e) => setTable({ enabled: e.target.checked })} />
          <TableChartOutlinedIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Table View</span>
          <span className="si-hint">Show {domainName} rows in a data grid</span>
        </label>
        {tv.enabled && (
          <div className="si-view-body">
            <div className="si-form-row">
              <label className="si-form-label">
                Page size
                <input className="si-form-input" type="number" min={5} max={200} step={5}
                  value={tv.pageSize ?? 25}
                  onChange={(e) => setTable({ pageSize: Number(e.target.value) })} />
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.sortable}
                  onChange={(e) => setTable({ sortable: e.target.checked })} />
                Sortable columns
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.filterable}
                  onChange={(e) => setTable({ filterable: e.target.checked })} />
                Column filters
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.searchable}
                  onChange={(e) => setTable({ searchable: e.target.checked })} />
                Global search
              </label>
            </div>
            <label className="si-form-label si-form-label--full">
              Visible fields <span className="si-hint">comma-separated field names; leave blank = all</span>
              <input className="si-form-input"
                value={(tv.visibleFields ?? []).join(", ")}
                onChange={(e) => setTable({
                  visibleFields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })}
                placeholder={fieldNames.slice(0, 3).join(", ")} />
            </label>
          </div>
        )}
      </div>

      {/* Form View */}
      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!fv.enabled}
            onChange={(e) => setForm({ enabled: e.target.checked })} />
          <CodeIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Form View</span>
          <span className="si-hint">Create / edit instances in a form</span>
        </label>
        {fv.enabled && (
          <div className="si-view-body">
            <label className="si-form-label">
              Layout
              <select className="si-form-select" value={fv.layout ?? "single"}
                onChange={(e) => setForm({ layout: e.target.value as any })}>
                <option value="single">Single column</option>
                <option value="two-column">Two columns</option>
                <option value="multi-column">Multi-column</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Card View */}
      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!cv.enabled}
            onChange={(e) => setCard({ enabled: e.target.checked })} />
          <PaletteOutlinedIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Card / Gallery View</span>
          <span className="si-hint">Show instances as visual cards</span>
        </label>
        {cv.enabled && (
          <div className="si-view-body">
            <div className="si-form-row">
              <label className="si-form-label">
                Title field
                <select className="si-form-select" value={cv.titleField ?? ""}
                  onChange={(e) => setCard({ titleField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="si-form-label">
                Subtitle field
                <select className="si-form-select" value={cv.subtitleField ?? ""}
                  onChange={(e) => setCard({ subtitleField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="si-form-label">
                Image field
                <select className="si-form-select" value={cv.imageField ?? ""}
                  onChange={(e) => setCard({ imageField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Layer 1 — Domain Model
// ════════════════════════════════════════════════════════════════════════════

interface DomainModelTabProps {
  schemas:       AllSchemas;
  viewConfigs:   Record<string, DomainViewConfig>;
  onAddField:    (domainName: string, fieldName: string, draft: FieldDraft) => void;
  onEditField:   (domainName: string, oldName: string, newName: string, draft: FieldDraft) => void;
  onViewConfig:  (domainName: string, cfg: DomainViewConfig) => void;
  onSaveBackend: (domainName: string) => void;
}

function DomainModelTab({
  schemas, viewConfigs,
  onAddField, onEditField, onViewConfig, onSaveBackend,
}: DomainModelTabProps) {
  const registry = schemas._layers?.validationRegistry ?? {};
  const [editing, setEditing] = useState<{ domain: string; field: string } | null>(null);

  return (
    <div className="si-domains">
      {Object.keys(schemas.domains).map((domainName) => {
        const fields     = schemas.domains[domainName].fields;
        const fieldNames = Object.keys(fields);
        const viewCfg    = viewConfigs[domainName] ?? {};

        return (
          <div className="si-card" key={domainName}>
            <div className="si-card-header">
              <StorageIcon sx={{ fontSize: 16, color: "#7e22ce" }} />
              <span className="si-domain-name">{domainName}</span>
              <span className="si-field-count">{fieldNames.length} fields</span>
              <span className="si-layer-tag si-layer-tag--domain">Domain Model</span>
              <button
                className="si-icon-btn si-icon-btn--cloud"
                type="button"
                title="Save to backend"
                onClick={() => onSaveBackend(domainName)}
              >
                <CloudUploadOutlinedIcon sx={{ fontSize: 15 }} />
                <span>Save to Backend</span>
              </button>
            </div>

            <table className="si-table">
              <thead>
                <tr>
                  <th>Field</th><th>Type</th><th>Format</th><th>Default</th><th>Datasource</th>
                  <th>Computed</th><th>Validation Refs</th><th>Inline Rules</th><th>Computed Expr</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fields).map(([fieldName, fieldDef]) => {
                  const fp          = `${domainName}.${fieldName}`;
                  const refs        = schemas._layers?.validationRefs?.[fp] ?? [];
                  const rules       = schemas.validations[fp] ?? [];
                  const comp        = schemas.computed[fp];
                  const refMsgs     = new Set(refs.map((t) => schemas._layers?.validationRegistry?.[t]?.message));
                  const inlineRules = rules.filter((r) => !refMsgs.has(r.message));
                  const isEditing   = editing?.domain === domainName && editing?.field === fieldName;

                  return (
                    <React.Fragment key={fieldName}>
                      <tr>
                        <td className="si-field-name">{fieldName}</td>
                        <td><Badge label={fieldDef.type} color="purple" /></td>
                        <td>{fieldDef.format ? <Badge label={fieldDef.format} color="blue" /> : <span className="si-muted">—</span>}</td>
                        <td className="si-mono">{JSON.stringify(fieldDef.default)}</td>
                        <td>{(fieldDef as any).datasource ? <Badge label={(fieldDef as any).datasource} color="blue" /> : <span className="si-muted">—</span>}</td>
                        <td>{fieldDef.computed ? <Badge label="computed" color="orange" /> : <span className="si-muted">—</span>}</td>
                        <td>
                          {refs.length === 0 ? <span className="si-muted">—</span> : (
                            <span className="si-val-list">
                              {refs.map((tag) => (
                                <span key={tag} className="si-val-ref" title={schemas._layers?.validationRegistry?.[tag]?.message}>
                                  <LabelIcon sx={{ fontSize: 11 }} />{tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td>
                          {inlineRules.length === 0 ? <span className="si-muted">—</span> : (
                            <span className="si-val-list">
                              {inlineRules.map((r, i) => (
                                <span key={i} className="si-val-item" title={r.message}>
                                  {r.type}{r.value !== undefined ? `(${r.value})` : ""}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td>
                          {comp
                            ? <code className="si-expr"><CodeIcon sx={{ fontSize: 11, verticalAlign: "middle" }} /> {comp.expression}</code>
                            : <span className="si-muted">—</span>}
                        </td>
                        <td>
                          <button
                            className={`si-edit-btn ${isEditing ? "si-edit-btn--active" : ""}`}
                            type="button"
                            onClick={() => setEditing(isEditing ? null : { domain: domainName, field: fieldName })}
                            title="Edit field"
                          >
                            <EditOutlinedIcon sx={{ fontSize: 13 }} />
                            {isEditing ? "Close" : "Edit"}
                          </button>
                        </td>
                      </tr>
                      {/* ── Inline edit row ── */}
                      {isEditing && (
                        <tr>
                          <td colSpan={10} className="si-edit-row">
                            <div className="si-edit-inline">
                              <div className="si-edit-inline-title">
                                <EditOutlinedIcon sx={{ fontSize: 14 }} />
                                Editing field <strong>{fieldName}</strong> in domain <strong>{domainName}</strong>
                              </div>
                              <FieldBuilder
                                key={`${domainName}.${fieldName}`}
                                submitLabel="Save changes"
                                initialName={fieldName}
                                initialDraft={fieldDefToDraft(fieldDef, schemas, fp)}
                                registry={registry}
                                onSubmit={(newName, draft) => {
                                  onEditField(domainName, fieldName, newName, draft);
                                  setEditing(null);
                                }}
                                onCancel={() => setEditing(null)}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* ── View Config section ── */}
            <div className="si-card-footer">
              <AddSection
                label="Domain View Configuration"
                icon={<TableChartOutlinedIcon sx={{ fontSize: 16 }} />}
              >
                <ViewConfigForm
                  domainName={domainName}
                  current={viewCfg}
                  fieldNames={fieldNames}
                  onChange={(cfg) => onViewConfig(domainName, cfg)}
                />
                {/* Preview badges */}
                <div className="si-view-badges">
                  {viewCfg.tableView?.enabled && <Badge label="Table View ON" color="purple" />}
                  {viewCfg.formView?.enabled  && <Badge label="Form View ON" color="teal" />}
                  {viewCfg.cardView?.enabled  && <Badge label="Card View ON" color="blue" />}
                </div>
              </AddSection>
            </div>

            {/* ── Add Field section ── */}
            <div className="si-card-footer">
              <AddSection label={`Add field to "${domainName}"`}>
                <FieldBuilder
                  submitLabel={`Add to ${domainName}`}
                  registry={registry}
                  onSubmit={(fieldName, draft) => onAddField(domainName, fieldName, draft)}
                />
              </AddSection>
            </div>
          </div>
        );
      })}

      <div className="si-tip">
        <span>💡 Use the <strong>Create Domain</strong> tab to add a brand-new domain with all 3 layers at once.</span>
      </div>
    </div>
  );
}

/** Reconstruct a FieldDraft from a built DomainFieldDef + live schema data (for Edit flow) */
function fieldDefToDraft(
  fieldDef: any,
  schemas:  AllSchemas,
  fullPath: string,
): FieldDraft {
  const uiHint  = schemas.uiHints?.[fullPath] ?? {};
  const rbac    = schemas._layers?.rbac?.fields?.[fullPath];
  const abac    = schemas._layers?.abac?.rules?.[fullPath];
  const comp    = schemas.computed[fullPath];
  const valRefs = schemas._layers?.validationRefs?.[fullPath] ?? [];

  return {
    // Layer 1
    type:           fieldDef.type ?? "string",
    default:        fieldDef.default !== undefined ? String(fieldDef.default) : "",
    computed:       !!fieldDef.computed,
    datasource:     (fieldDef as any).datasource ?? "",
    validationRefs: valRefs,
    validations:    [],
    exprStr:        comp?.expression ?? "",
    depsStr:        comp?.dependsOn?.join(", ") ?? "",
    // Layer 2
    component:       (uiHint.component ?? "text") as ComponentType,
    label:           uiHint.label       ?? "",
    placeholder:     uiHint.placeholder ?? "",
    color:           uiHint.color           ?? "",
    backgroundColor: uiHint.backgroundColor ?? "",
    borderColor:     uiHint.borderColor     ?? "",
    fontSize:        uiHint.fontSize        ?? "",
    fontWeight:      uiHint.fontWeight      ?? "",
    textAlign:       uiHint.textAlign       ?? "",
    width:           uiHint.width           ?? "",
    icon:            uiHint.icon            ?? "",
    tooltip:         uiHint.tooltip         ?? "",
    hidden:          uiHint.hidden          ?? false,
    readOnly:        uiHint.readOnly        ?? false,
    // Layer 3a ABAC
    abacVisible:  typeof abac?.visible  === "string" ? abac.visible  : "",
    abacWrite:    abac?.write    !== undefined ? (abac.write    as boolean | null) : null,
    abacDisabled: abac?.disabled !== undefined ? (abac.disabled as boolean | null) : null,
    // Layer 3b RBAC
    rbacVisible:  rbac?.visible?.join(", ")  ?? "",
    rbacRead:     rbac?.read?.join(", ")     ?? "",
    rbacWrite:    rbac?.write?.join(", ")    ?? "",
    rbacDisabled: rbac?.disabled?.join(", ") ?? "",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Layer 2 — UI Configuration
// ════════════════════════════════════════════════════════════════════════════

interface UIConfigTabProps {
  schemas:    AllSchemas;
  onAdd:      (path: string, hint: FieldUIConfig) => void;
  onRemove:   (path: string) => void;
  extraHints: Record<string, FieldUIConfig>;
}

function UIConfigTab({ schemas, onAdd, onRemove, extraHints }: UIConfigTabProps) {
  const hints      = schemas.uiHints ?? {};
  const allPaths   = Object.keys(hints);
  const fieldPaths = getAllFieldPaths(schemas);

  const byDomain: Record<string, string[]> = {};
  for (const path of allPaths) {
    const domain = path.split(".")[0];
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(path);
  }

  return (
    <div className="si-domains">
      <div className="si-card">
        <AddSection
          label="Add UI Configuration for a field"
          icon={<PaletteOutlinedIcon sx={{ fontSize: 16 }} />}
        >
          <AddUIConfigForm fieldPaths={fieldPaths} onAdd={onAdd} />
        </AddSection>
      </div>

      {Object.keys(byDomain).length === 0 ? (
        <div className="si-card">
          <div className="si-empty">No UI configuration found — add one above or edit <code>src/ui-config/index.ts</code></div>
        </div>
      ) : (
        Object.entries(byDomain).map(([domain, paths]) => (
          <div className="si-card" key={domain}>
            <div className="si-card-header">
              <PaletteOutlinedIcon sx={{ fontSize: 16, color: "#0f766e" }} />
              <span className="si-domain-name">{domain}</span>
              <span className="si-field-count">{paths.length} fields configured</span>
              <span className="si-layer-tag si-layer-tag--ui">UI Config</span>
            </div>
            <table className="si-table">
              <thead>
                <tr>
                  <th>Field</th><th>Component</th><th>Label</th><th>Placeholder</th>
                  <th>Color</th><th>Bg Color</th><th>Font Size</th><th>Font Weight</th>
                  <th>Align</th><th>Width</th><th>Tooltip</th><th>Flags</th><th>Source</th>
                </tr>
              </thead>
              <tbody>
                {paths.map((fp) => {
                  const hint      = hints[fp];
                  const fieldName = fp.split(".").slice(1).join(".");
                  const isExtra   = fp in extraHints;
                  return (
                    <tr key={fp}>
                      <td className="si-field-name">{fieldName}</td>
                      <td>{hint.component ? <Badge label={hint.component} color="teal" /> : <span className="si-muted">—</span>}</td>
                      <td className="si-label-cell">{hint.label ?? <span className="si-muted">—</span>}</td>
                      <td className="si-mono si-muted-empty">{hint.placeholder ?? <span className="si-muted">—</span>}</td>
                      <td>
                        {hint.color
                          ? <span className="si-color-swatch" style={{ background: hint.color }} title={hint.color}>{hint.color}</span>
                          : <span className="si-muted">—</span>}
                      </td>
                      <td>
                        {hint.backgroundColor
                          ? <span className="si-color-swatch" style={{ background: hint.backgroundColor }} title={hint.backgroundColor}>{hint.backgroundColor}</span>
                          : <span className="si-muted">—</span>}
                      </td>
                      <td>{hint.fontSize  ? <Badge label={hint.fontSize}  color="blue"   /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.fontWeight ? <Badge label={hint.fontWeight} color="purple" /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.textAlign ? <Badge label={hint.textAlign} color="gray"   /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.width     ? <Badge label={hint.width}     color="teal"   /> : <span className="si-muted">—</span>}</td>
                      <td className="si-label-cell">{hint.tooltip ?? <span className="si-muted">—</span>}</td>
                      <td>
                        <span className="si-val-list">
                          {hint.hidden   && <Badge label="hidden"   color="gray" />}
                          {hint.readOnly && <Badge label="readOnly" color="orange" />}
                        </span>
                      </td>
                      <td>
                        {isExtra
                          ? (
                            <span className="si-source-live">
                              <span>live</span>
                              <button className="si-remove-btn" type="button" onClick={() => onRemove(fp)}>
                                <DeleteOutlinedIcon sx={{ fontSize: 13 }} />
                              </button>
                            </span>
                          )
                          : <span className="si-muted">static</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function AddUIConfigForm({
  fieldPaths, onAdd,
}: { fieldPaths: string[]; onAdd: (path: string, hint: FieldUIConfig) => void }) {
  const [path,        setPath]        = useState("");
  const [component,   setComponent]   = useState<ComponentType>("text");
  const [label,       setLabel]       = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [color,       setColor]       = useState("");
  const [bgColor,     setBgColor]     = useState("");
  const [borderColor, setBorderColor] = useState("");
  const [fontSize,    setFontSize]    = useState<FontSize | "">("");
  const [fontWeight,  setFontWeight]  = useState<FontWeight | "">("");
  const [textAlign,   setTextAlign]   = useState<TextAlign | "">("");
  const [width,       setWidth]       = useState<FieldWidth | "">("");
  const [tooltip,     setTooltip]     = useState("");
  const [hidden,      setHidden]      = useState(false);
  const [readOnly,    setReadOnly]    = useState(false);
  const [saved,       setSaved]       = useState(false);

  function submit() {
    if (!path.trim()) return;
    const hint: FieldUIConfig = {};
    if (component)   hint.component       = component;
    if (label)       hint.label           = label;
    if (placeholder) hint.placeholder     = placeholder;
    if (color)       hint.color           = color;
    if (bgColor)     hint.backgroundColor = bgColor;
    if (borderColor) hint.borderColor     = borderColor;
    if (fontSize)    hint.fontSize        = fontSize as FontSize;
    if (fontWeight)  hint.fontWeight      = fontWeight as FontWeight;
    if (textAlign)   hint.textAlign       = textAlign as TextAlign;
    if (width)       hint.width           = width as FieldWidth;
    if (tooltip)     hint.tooltip         = tooltip;
    if (hidden)      hint.hidden          = true;
    if (readOnly)    hint.readOnly        = true;
    onAdd(path.trim(), hint);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setPath(""); setLabel(""); setPlaceholder(""); setColor(""); setBgColor("");
    setBorderColor(""); setFontSize(""); setFontWeight(""); setTextAlign(""); setWidth("");
    setTooltip(""); setHidden(false); setReadOnly(false);
  }

  return (
    <div className="si-layer-section si-layer-section--ui">
      <div className="si-form-row">
        <label className="si-form-label" style={{ flex: 2 }}>
          Field path <span className="si-hint">select existing or type new</span>
          <input className="si-form-input" list="ui-field-paths" value={path}
            onChange={(e) => setPath(e.target.value)} placeholder="user.email" />
          <datalist id="ui-field-paths">
            {fieldPaths.map((p) => <option key={p} value={p} />)}
          </datalist>
        </label>
        <label className="si-form-label">
          Component
          <select className="si-form-select" value={component} onChange={(e) => setComponent(e.target.value as ComponentType)}>
            {COMPONENTS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Label
          <input className="si-form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Email Address" />
        </label>
        <label className="si-form-label">
          Placeholder
          <input className="si-form-input" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} placeholder="john@example.com" />
        </label>
      </div>

      {/* Visual styling row */}
      <div className="si-style-section-label">
        <FormatPaintOutlinedIcon sx={{ fontSize: 13 }} />
        Visual Styling
      </div>
      <div className="si-form-row">
        <label className="si-form-label">
          Text color
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={color || "#000000"}
              onChange={(e) => setColor(e.target.value)} />
            <input className="si-form-input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#374151" />
            {color && <button className="si-clear-btn" type="button" onClick={() => setColor("")}>×</button>}
          </div>
        </label>
        <label className="si-form-label">
          Background
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={bgColor || "#ffffff"}
              onChange={(e) => setBgColor(e.target.value)} />
            <input className="si-form-input" value={bgColor} onChange={(e) => setBgColor(e.target.value)} placeholder="#f8fafc" />
            {bgColor && <button className="si-clear-btn" type="button" onClick={() => setBgColor("")}>×</button>}
          </div>
        </label>
        <label className="si-form-label">
          Border color
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={borderColor || "#e2e8f0"}
              onChange={(e) => setBorderColor(e.target.value)} />
            <input className="si-form-input" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} placeholder="#e2e8f0" />
            {borderColor && <button className="si-clear-btn" type="button" onClick={() => setBorderColor("")}>×</button>}
          </div>
        </label>
      </div>
      <div className="si-form-row">
        <label className="si-form-label">
          Font size
          <select className="si-form-select" value={fontSize} onChange={(e) => setFontSize(e.target.value as any)}>
            <option value="">— default —</option>
            {FONT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Font weight
          <select className="si-form-select" value={fontWeight} onChange={(e) => setFontWeight(e.target.value as any)}>
            <option value="">— default —</option>
            {FONT_WEIGHTS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Text align
          <select className="si-form-select" value={textAlign} onChange={(e) => setTextAlign(e.target.value as any)}>
            <option value="">— default —</option>
            {TEXT_ALIGNS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Width
          <select className="si-form-select" value={width} onChange={(e) => setWidth(e.target.value as any)}>
            <option value="">— default —</option>
            {FIELD_WIDTHS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Tooltip
          <input className="si-form-input" value={tooltip} onChange={(e) => setTooltip(e.target.value)} placeholder="Help text shown on hover" />
        </label>
      </div>
      <div className="si-form-row">
        <label className="si-checkbox-label">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hidden (not rendered)
        </label>
        <label className="si-checkbox-label">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          Read-only (display only)
        </label>
      </div>

      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved
            ? <><CheckIcon sx={{ fontSize: 15 }} /> Saved</>
            : <><SaveOutlinedIcon sx={{ fontSize: 15 }} /> Save UI Config</>}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Validation Registry
// ════════════════════════════════════════════════════════════════════════════

function ValidationsTab({ schemas }: { schemas: AllSchemas }) {
  const registry = schemas._layers?.validationRegistry ?? {};
  const refs     = schemas._layers?.validationRefs     ?? {};

  const usedBy: Record<string, string[]> = {};
  for (const [path, tags] of Object.entries(refs)) {
    for (const tag of tags) {
      if (!usedBy[tag]) usedBy[tag] = [];
      usedBy[tag].push(path);
    }
  }

  const typeColor: Record<string, string> = {
    required: "red", minLength: "blue", maxLength: "blue",
    min: "blue", max: "blue", pattern: "purple", custom: "orange",
  };

  return (
    <div className="si-card">
      <div className="si-card-header">
        <CheckCircleOutlinedIcon sx={{ fontSize: 16, color: "#92400e" }} />
        <span className="si-domain-name">Validation Registry</span>
        <span className="si-field-count">{Object.keys(registry).length} named rules</span>
        <span className="si-layer-tag si-layer-tag--val">Validations</span>
      </div>
      {Object.keys(registry).length === 0 ? (
        <div className="si-empty">No rules in registry — edit <code>src/validations/index.ts</code></div>
      ) : (
        <table className="si-table">
          <thead><tr><th>Tag</th><th>Type</th><th>Value</th><th>Message</th><th>Used by</th></tr></thead>
          <tbody>
            {Object.entries(registry).map(([tag, rule]) => (
              <tr key={tag}>
                <td><span className="si-val-ref"><LabelIcon sx={{ fontSize: 11 }} />{tag}</span></td>
                <td><Badge label={rule.type} color={typeColor[rule.type] ?? "gray"} /></td>
                <td className="si-mono">{rule.value !== undefined ? String(rule.value) : <span className="si-muted">—</span>}</td>
                <td className="si-label-cell">{rule.message}</td>
                <td>
                  {(usedBy[tag] ?? []).length === 0
                    ? <span className="si-muted">unused</span>
                    : <span className="si-val-list">{(usedBy[tag]).map((p) => <span key={p} className="si-val-item">{p}</span>)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Layer 3 — Access Control (RBAC + ABAC)
// ════════════════════════════════════════════════════════════════════════════

interface AccessTabProps {
  schemas:       AllSchemas;
  onAddRBAC:     (path: string, rule: RBACFieldRule)  => void;
  onRemoveRBAC:  (path: string) => void;
  onAddABAC:     (path: string, rule: ABACFieldRule)  => void;
  onRemoveABAC:  (path: string) => void;
  extraRBACKeys: Set<string>;
  extraABACKeys: Set<string>;
}

function AccessTab({
  schemas, onAddRBAC, onRemoveRBAC, onAddABAC, onRemoveABAC, extraRBACKeys, extraABACKeys,
}: AccessTabProps) {
  const [sub, setSub] = useState<"rbac" | "abac">("rbac");
  const rbac = schemas._layers?.rbac;
  const abac = schemas._layers?.abac;
  const fieldPaths = getAllFieldPaths(schemas);

  return (
    <div className="si-domains">
      <div className="si-sub-tabs">
        <button className={`si-sub-btn ${sub === "rbac" ? "si-sub-btn--active" : ""}`} type="button" onClick={() => setSub("rbac")}>
          <LockOutlinedIcon sx={{ fontSize: 15 }} />RBAC — Role-Based
        </button>
        <button className={`si-sub-btn ${sub === "abac" ? "si-sub-btn--active" : ""}`} type="button" onClick={() => setSub("abac")}>
          <CodeIcon sx={{ fontSize: 15 }} />ABAC — Attribute-Based
        </button>
      </div>

      {sub === "rbac" && (
        <>
          <div className="si-card">
            <AddSection label="Add RBAC Rule" icon={<LockOutlinedIcon sx={{ fontSize: 16 }} />}>
              <AddRBACForm fieldPaths={fieldPaths} onAdd={onAddRBAC} />
            </AddSection>
          </div>
          <div className="si-card">
            <div className="si-card-header">
              <LockOutlinedIcon sx={{ fontSize: 16, color: "#a16207" }} />
              <span className="si-domain-name">RBAC Rules</span>
              <span className="si-field-count">role arrays → compiled to auth expressions</span>
              <span className="si-layer-tag si-layer-tag--rbac">RBAC</span>
            </div>
            {!rbac || Object.keys(rbac.fields).length === 0 ? (
              <div className="si-empty">No RBAC rules — add one above or edit <code>src/access-config/rbac.ts</code></div>
            ) : (
              <table className="si-table">
                <thead>
                  <tr><th>Field</th><th>visible (roles)</th><th>read (roles)</th><th>write (roles)</th><th>disabled (roles)</th><th>Compiled</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {Object.entries(rbac.fields).map(([path, rule]) => {
                    const compiled = schemas.access[path];
                    const isExtra  = extraRBACKeys.has(path);
                    return (
                      <tr key={path}>
                        <td className="si-field-name">{path}</td>
                        <td>{renderRoles(rule.visible)}</td>
                        <td>{renderRoles(rule.read)}</td>
                        <td>{renderRoles(rule.write)}</td>
                        <td>{renderRoles(rule.disabled)}</td>
                        <td>
                          {compiled?.visible  !== undefined && <div><code className="si-expr">visible: {String(compiled.visible)}</code></div>}
                          {compiled?.write    !== undefined && <div><code className="si-expr">write: {String(compiled.write)}</code></div>}
                          {compiled?.disabled !== undefined && <div><code className="si-expr">disabled: {String(compiled.disabled)}</code></div>}
                        </td>
                        <td>
                          {isExtra
                            ? <span className="si-source-live"><span>live</span><button className="si-remove-btn" type="button" onClick={() => onRemoveRBAC(path)}><DeleteOutlinedIcon sx={{ fontSize: 13 }} /></button></span>
                            : <span className="si-muted">static</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {Object.keys(rbac?.fields ?? {}).length > 0 && (
            <CopyBlock title="Generated RBAC snippet" code={genRBACSnippet(rbac!.fields)} />
          )}
        </>
      )}

      {sub === "abac" && (
        <>
          <div className="si-card">
            <AddSection label="Add ABAC Rule" icon={<CodeIcon sx={{ fontSize: 16 }} />}>
              <AddABACForm fieldPaths={fieldPaths} onAdd={onAddABAC} />
            </AddSection>
          </div>
          <div className="si-card">
            <div className="si-card-header">
              <CodeIcon sx={{ fontSize: 16, color: "#c2410c" }} />
              <span className="si-domain-name">ABAC Rules</span>
              <span className="si-field-count">expression-based access evaluated at runtime</span>
              <span className="si-layer-tag si-layer-tag--abac">ABAC</span>
            </div>
            {!abac || Object.keys(abac.rules).length === 0 ? (
              <div className="si-empty">No ABAC rules — add one above or edit <code>src/access-config/abac.ts</code></div>
            ) : (
              <table className="si-table">
                <thead>
                  <tr><th>Field</th><th>visible</th><th>disabled</th><th>read</th><th>write</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {Object.entries(abac.rules).map(([path, rule]) => {
                    const isExtra = extraABACKeys.has(path);
                    return (
                      <tr key={path}>
                        <td className="si-field-name">{path}</td>
                        <td>{rule.visible  !== undefined ? <code className="si-expr">{String(rule.visible)}</code>  : <span className="si-muted">—</span>}</td>
                        <td>{rule.disabled !== undefined ? <code className="si-expr">{String(rule.disabled)}</code> : <span className="si-muted">—</span>}</td>
                        <td>{rule.read     !== undefined ? <code className="si-expr">{String(rule.read)}</code>     : <span className="si-muted">—</span>}</td>
                        <td>{rule.write    !== undefined ? <code className="si-expr">{String(rule.write)}</code>    : <span className="si-muted">—</span>}</td>
                        <td>
                          {isExtra
                            ? <span className="si-source-live"><span>live</span><button className="si-remove-btn" type="button" onClick={() => onRemoveABAC(path)}><DeleteOutlinedIcon sx={{ fontSize: 13 }} /></button></span>
                            : <span className="si-muted">static</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {Object.keys(abac?.rules ?? {}).length > 0 && (
            <CopyBlock title="Generated ABAC snippet" code={genABACSnippet(abac!.rules)} />
          )}
        </>
      )}
    </div>
  );
}

function renderRoles(roles: string[] | undefined): React.ReactNode {
  if (roles === undefined) return <span className="si-muted">all</span>;
  if (roles.length === 0)  return <Badge label="∅ none" color="gray" />;
  return <span className="si-val-list">{roles.map((r) => <Badge key={r} label={r} color="purple" />)}</span>;
}

function AddRBACForm({ fieldPaths, onAdd }: { fieldPaths: string[]; onAdd: (path: string, rule: RBACFieldRule) => void }) {
  const [path, setPath]       = useState("");
  const [visible, setVisible] = useState("");
  const [read, setRead]       = useState("");
  const [write, setWrite]     = useState("");
  const [disabled, setDis]    = useState("");
  const [saved, setSaved]     = useState(false);

  function parseRoles(s: string): string[] | undefined {
    const t = s.trim();
    return t === "" ? undefined : t.split(",").map((r) => r.trim()).filter(Boolean);
  }

  function submit() {
    if (!path.trim()) return;
    const rule: RBACFieldRule = {};
    const v = parseRoles(visible); if (v) rule.visible  = v;
    const r = parseRoles(read);    if (r) rule.read     = r;
    const w = parseRoles(write);   if (w) rule.write    = w;
    const d = parseRoles(disabled);if (d) rule.disabled = d;
    if (!Object.keys(rule).length) return;
    onAdd(path.trim(), rule);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setPath(""); setVisible(""); setRead(""); setWrite(""); setDis("");
  }

  return (
    <div className="si-layer-section si-layer-section--rbac">
      <div className="si-rbac-help">Leave blank = unrestricted (all roles). Enter comma-separated roles to restrict.</div>
      <div className="si-form-row">
        <label className="si-form-label" style={{ flex: 2 }}>
          Field path
          <input className="si-form-input" list="rbac-fp" value={path} onChange={(e) => setPath(e.target.value)} placeholder="user.role" />
          <datalist id="rbac-fp">{fieldPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="si-form-label">visible roles<input className="si-form-input" value={visible} onChange={(e) => setVisible(e.target.value)} placeholder="admin, manager" /></label>
        <label className="si-form-label">read roles<input className="si-form-input" value={read} onChange={(e) => setRead(e.target.value)} placeholder="admin" /></label>
        <label className="si-form-label">write roles<input className="si-form-input" value={write} onChange={(e) => setWrite(e.target.value)} placeholder="admin" /></label>
        <label className="si-form-label">disabled roles<input className="si-form-input" value={disabled} onChange={(e) => setDis(e.target.value)} placeholder="viewer" /></label>
      </div>
      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved ? <><CheckIcon sx={{ fontSize: 15 }} />Rule Added</> : <><LockOutlinedIcon sx={{ fontSize: 15 }} />Add RBAC Rule</>}
        </button>
      </div>
    </div>
  );
}

function AddABACForm({ fieldPaths, onAdd }: { fieldPaths: string[]; onAdd: (path: string, rule: ABACFieldRule) => void }) {
  const [path, setPath]         = useState("");
  const [visible, setVisible]   = useState("");
  const [abacWrite, setWrite]   = useState<"" | "false">("");
  const [abacDis, setDisabled]  = useState<"" | "true">("");
  const [saved, setSaved]       = useState(false);

  function submit() {
    if (!path.trim()) return;
    const rule: ABACFieldRule = {};
    if (visible)   rule.visible  = visible;
    if (abacWrite) rule.write    = false;
    if (abacDis)   rule.disabled = true;
    if (!Object.keys(rule).length) return;
    onAdd(path.trim(), rule);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setPath(""); setVisible(""); setWrite(""); setDisabled("");
  }

  return (
    <div className="si-layer-section si-layer-section--abac">
      <div className="si-form-row">
        <label className="si-form-label" style={{ flex: 2 }}>
          Field path
          <input className="si-form-input" list="abac-fp" value={path} onChange={(e) => setPath(e.target.value)} placeholder="order.total" />
          <datalist id="abac-fp">{fieldPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="si-form-label" style={{ flex: 2 }}>
          Visible when <span className="si-hint">expression</span>
          <input className="si-form-input" value={visible} onChange={(e) => setVisible(e.target.value)} placeholder="user.country != ''" />
        </label>
        <label className="si-form-label">
          write
          <select className="si-form-select" value={abacWrite} onChange={(e) => setWrite(e.target.value as any)}>
            <option value="">no rule</option>
            <option value="false">false (read-only)</option>
          </select>
        </label>
        <label className="si-form-label">
          disabled
          <select className="si-form-select" value={abacDis} onChange={(e) => setDisabled(e.target.value as any)}>
            <option value="">no rule</option>
            <option value="true">true (always disabled)</option>
          </select>
        </label>
      </div>
      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved ? <><CheckIcon sx={{ fontSize: 15 }} />Rule Added</> : <><CodeIcon sx={{ fontSize: 15 }} />Add ABAC Rule</>}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Shared FieldDraft — all 4 layers: Domain + UI (with styling) + RBAC + ABAC
// ════════════════════════════════════════════════════════════════════════════

export interface FieldDraft {
  // Layer 1 — domain
  type:           FieldType;
  default:        string;
  computed:       boolean;
  datasource:     string;    // ← moved from Layer 2
  validationRefs: string[];
  validations:    DraftValidation[];
  exprStr:        string;
  depsStr:        string;
  // Layer 2 — UI (visual styling only — no datasource)
  component:       ComponentType;
  label:           string;
  placeholder:     string;
  color:           string;
  backgroundColor: string;
  borderColor:     string;
  fontSize:        string;
  fontWeight:      string;
  textAlign:       string;
  width:           string;
  icon:            string;
  tooltip:         string;
  hidden:          boolean;
  readOnly:        boolean;
  // Layer 3a — ABAC
  abacVisible:  string;
  abacWrite:    boolean | null;
  abacDisabled: boolean | null;
  // Layer 3b — RBAC
  rbacVisible:  string;
  rbacRead:     string;
  rbacWrite:    string;
  rbacDisabled: string;
}

const BLANK_DRAFT: FieldDraft = {
  type: "string", default: "", computed: false, datasource: "",
  validationRefs: [], validations: [], exprStr: "", depsStr: "",
  component: "text", label: "", placeholder: "",
  color: "", backgroundColor: "", borderColor: "",
  fontSize: "", fontWeight: "", textAlign: "", width: "",
  icon: "", tooltip: "", hidden: false, readOnly: false,
  abacVisible: "", abacWrite: null, abacDisabled: null,
  rbacVisible: "", rbacRead: "", rbacWrite: "", rbacDisabled: "",
};

// ════════════════════════════════════════════════════════════════════════════
// ValidationRefPicker — browse + click registry tags instead of typing them
// ════════════════════════════════════════════════════════════════════════════

const VAL_TYPE_GROUP: Record<string, string> = {
  required: "Presence",
  minLength: "Length", maxLength: "Length",
  min: "Numeric", max: "Numeric",
  pattern: "Format",
  custom: "Custom",
};

function ValidationRefPicker({
  selected, registry, onChange,
}: {
  selected: string[];
  registry: Record<string, ValidationRule>;
  onChange: (tags: string[]) => void;
}) {
  const groups: Record<string, Array<[string, ValidationRule]>> = {};
  for (const [tag, rule] of Object.entries(registry)) {
    const g = VAL_TYPE_GROUP[rule.type] ?? "Other";
    if (!groups[g]) groups[g] = [];
    groups[g].push([tag, rule]);
  }

  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  if (Object.keys(registry).length === 0) {
    return (
      <div className="si-ref-picker-empty">
        No validation rules in registry yet — use Inline Validations below.
      </div>
    );
  }

  return (
    <div className="si-ref-picker">
      {selected.length > 0 && (
        <div className="si-val-tags si-val-tags--selected">
          {selected.map((tag) => (
            <span key={tag} className="si-val-tag si-val-tag--ref">
              <LabelIcon sx={{ fontSize: 11 }} />{tag}
              <button type="button" onClick={() => toggle(tag)} title="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="si-ref-picker-groups">
        {Object.entries(groups).map(([group, rules]) => (
          <div key={group} className="si-ref-group">
            <span className="si-ref-group-label">{group}</span>
            <div className="si-ref-chips">
              {rules.map(([tag, rule]) => {
                const active = selected.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`si-ref-chip${active ? " si-ref-chip--active" : ""}`}
                    onClick={() => toggle(tag)}
                    title={rule.message}
                  >
                    {active && <CheckIcon sx={{ fontSize: 11 }} />}
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FieldBuilderProps {
  submitLabel:    string;
  initialName?:   string;
  initialDraft?:  FieldDraft;
  onSubmit:       (name: string, draft: FieldDraft) => void;
  onCancel?:      () => void;
  /** When false, only Layer 1 (Domain Model) is shown. Defaults to true. */
  showAllLayers?: boolean;
  /** Validation registry for the ref picker. */
  registry?:      Record<string, ValidationRule>;
}

function FieldBuilder({ submitLabel, initialName = "", initialDraft, onSubmit, onCancel, showAllLayers = true, registry = {} }: FieldBuilderProps) {
  const [fieldName, setFieldName] = useState(initialName);
  const [draft,     setDraft]     = useState<FieldDraft>(initialDraft ? { ...initialDraft } : { ...BLANK_DRAFT });
  const [draftVal,  setDraftVal]  = useState<DraftValidation>({ type: "required", value: "", message: "" });

  function set<K extends keyof FieldDraft>(key: K, val: FieldDraft[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function addValidation() {
    if (!draftVal.message.trim()) return;
    set("validations", [...draft.validations, { ...draftVal }]);
    setDraftVal({ type: "required", value: "", message: "" });
  }

  function submit() {
    if (!fieldName.trim()) return;
    onSubmit(fieldName.trim(), { ...draft });
    if (!initialName) { setFieldName(""); setDraft({ ...BLANK_DRAFT }); }
  }

  return (
    <div className="si-field-builder">
      {/* ── Layer 1: Domain ── */}
      <div className="si-layer-section si-layer-section--domain">
        <div className="si-layer-section-label">Layer 1 — Domain Model</div>
        <div className="si-form-row">
          <label className="si-form-label">
            Field name *
            <input className="si-form-input" value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="e.g. phoneNumber" />
          </label>
          <label className="si-form-label">
            Type
            <select className="si-form-select" value={draft.type} onChange={(e) => set("type", e.target.value as FieldType)}>
              {FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="si-form-label">
            Default
            <input className="si-form-input" value={draft.default} onChange={(e) => set("default", e.target.value)} placeholder='e.g. "" or 0' />
          </label>
          <label className="si-form-label">
            Datasource <span className="si-hint">for select/autocomplete</span>
            <input className="si-form-input" value={draft.datasource} onChange={(e) => set("datasource", e.target.value)} placeholder="countries" />
          </label>
          <label className="si-checkbox-label" style={{ marginTop: 22 }}>
            <input type="checkbox" checked={draft.computed} onChange={(e) => set("computed", e.target.checked)} /> Computed
          </label>
        </div>
        {draft.computed && (
          <div className="si-form-row">
            <label className="si-form-label" style={{ flex: 2 }}>
              Computed expression
              <input className="si-form-input" value={draft.exprStr} onChange={(e) => set("exprStr", e.target.value)} placeholder="quantity * price" />
            </label>
            <label className="si-form-label" style={{ flex: 2 }}>
              dependsOn (comma-separated)
              <input className="si-form-input" value={draft.depsStr} onChange={(e) => set("depsStr", e.target.value)} placeholder="quantity, price" />
            </label>
          </div>
        )}
        <div className="si-val-builder">
          <div className="si-val-section-header">
            <CheckCircleOutlinedIcon sx={{ fontSize: 14 }} />
            <span className="si-form-sublabel">Validation Rules</span>
          </div>

          {/* ── Registry ref picker ── */}
          <div className="si-val-subsection">
            <div className="si-val-subsection-label">
              Registry rules
              <span className="si-hint">click to attach named rules from the registry</span>
            </div>
            <ValidationRefPicker
              selected={draft.validationRefs}
              registry={registry}
              onChange={(tags) => set("validationRefs", tags)}
            />
          </div>

          {/* ── Inline one-off rule builder ── */}
          <div className="si-val-subsection">
            <div className="si-val-subsection-label">
              Custom rule
              <span className="si-hint">one-off rule not in the registry</span>
            </div>
            <div className="si-form-row si-form-row--inline">
              <select
                className="si-form-select"
                style={{ maxWidth: 130 }}
                value={draftVal.type}
                onChange={(e) => setDraftVal((d) => ({ ...d, type: e.target.value, value: "" }))}
              >
                {VAL_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              {draftVal.type !== "required" && (
                <input
                  className="si-form-input"
                  type={["min", "max", "minLength", "maxLength"].includes(draftVal.type) ? "number" : "text"}
                  placeholder={
                    draftVal.type === "pattern" ? "regex, e.g. ^[A-Z]+" :
                    draftVal.type === "custom"  ? "expression, e.g. value > 0" :
                    "value"
                  }
                  value={draftVal.value}
                  onChange={(e) => setDraftVal((d) => ({ ...d, value: e.target.value }))}
                />
              )}
              <input
                className="si-form-input"
                placeholder="error message *"
                value={draftVal.message}
                onChange={(e) => setDraftVal((d) => ({ ...d, message: e.target.value }))}
              />
              <button className="si-btn-add" type="button" onClick={addValidation}>
                <AddIcon sx={{ fontSize: 14 }} />Add
              </button>
            </div>
            {draft.validations.length > 0 && (
              <div className="si-val-tags">
                {draft.validations.map((v, i) => (
                  <span key={i} className="si-val-tag">
                    {v.type}{v.value ? `(${v.value})` : ""}: "{v.message}"
                    <button type="button" onClick={() => set("validations", draft.validations.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Layer 2: UI Config + Visual Styling ── */}
      {showAllLayers && <div className="si-layer-section si-layer-section--ui">
        <div className="si-layer-section-label">Layer 2 — UI Configuration &amp; Visual Styling</div>
        <div className="si-form-row">
          <label className="si-form-label">
            Component
            <select className="si-form-select" value={draft.component} onChange={(e) => set("component", e.target.value as ComponentType)}>
              {COMPONENTS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="si-form-label">
            Label
            <input className="si-form-input" value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="Phone Number" />
          </label>
          <label className="si-form-label">
            Placeholder
            <input className="si-form-input" value={draft.placeholder} onChange={(e) => set("placeholder", e.target.value)} placeholder="+1 555 0100" />
          </label>
        </div>

        {/* Styling sub-section */}
        <div className="si-style-section-label">
          <FormatPaintOutlinedIcon sx={{ fontSize: 13 }} />
          Visual Styling
        </div>
        <div className="si-form-row">
          <label className="si-form-label">
            Text color
            <div className="si-color-row">
              <input type="color" className="si-color-input"
                value={draft.color || "#000000"}
                onChange={(e) => set("color", e.target.value)} />
              <input className="si-form-input" value={draft.color}
                onChange={(e) => set("color", e.target.value)} placeholder="#374151" />
              {draft.color && <button className="si-clear-btn" type="button" onClick={() => set("color", "")}>×</button>}
            </div>
          </label>
          <label className="si-form-label">
            Background
            <div className="si-color-row">
              <input type="color" className="si-color-input"
                value={draft.backgroundColor || "#ffffff"}
                onChange={(e) => set("backgroundColor", e.target.value)} />
              <input className="si-form-input" value={draft.backgroundColor}
                onChange={(e) => set("backgroundColor", e.target.value)} placeholder="#f8fafc" />
              {draft.backgroundColor && <button className="si-clear-btn" type="button" onClick={() => set("backgroundColor", "")}>×</button>}
            </div>
          </label>
          <label className="si-form-label">
            Border color
            <div className="si-color-row">
              <input type="color" className="si-color-input"
                value={draft.borderColor || "#e2e8f0"}
                onChange={(e) => set("borderColor", e.target.value)} />
              <input className="si-form-input" value={draft.borderColor}
                onChange={(e) => set("borderColor", e.target.value)} placeholder="#e2e8f0" />
              {draft.borderColor && <button className="si-clear-btn" type="button" onClick={() => set("borderColor", "")}>×</button>}
            </div>
          </label>
        </div>
        <div className="si-form-row">
          <label className="si-form-label">
            Font size
            <select className="si-form-select" value={draft.fontSize} onChange={(e) => set("fontSize", e.target.value)}>
              <option value="">— default —</option>
              {FONT_SIZES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="si-form-label">
            Font weight
            <select className="si-form-select" value={draft.fontWeight} onChange={(e) => set("fontWeight", e.target.value)}>
              <option value="">— default —</option>
              {FONT_WEIGHTS.map((w) => <option key={w}>{w}</option>)}
            </select>
          </label>
          <label className="si-form-label">
            Text align
            <select className="si-form-select" value={draft.textAlign} onChange={(e) => set("textAlign", e.target.value)}>
              <option value="">— default —</option>
              {TEXT_ALIGNS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="si-form-label">
            Width
            <select className="si-form-select" value={draft.width} onChange={(e) => set("width", e.target.value)}>
              <option value="">— default —</option>
              {FIELD_WIDTHS.map((w) => <option key={w}>{w}</option>)}
            </select>
          </label>
        </div>
        <div className="si-form-row">
          <label className="si-form-label" style={{ flex: 2 }}>
            Tooltip
            <input className="si-form-input" value={draft.tooltip} onChange={(e) => set("tooltip", e.target.value)} placeholder="Help text shown on hover" />
          </label>
          <label className="si-form-label">
            Icon key
            <input className="si-form-input" value={draft.icon} onChange={(e) => set("icon", e.target.value)} placeholder="email" />
          </label>
          <label className="si-checkbox-label" style={{ marginTop: 22 }}>
            <input type="checkbox" checked={draft.hidden} onChange={(e) => set("hidden", e.target.checked)} />
            Hidden
          </label>
          <label className="si-checkbox-label" style={{ marginTop: 22 }}>
            <input type="checkbox" checked={draft.readOnly} onChange={(e) => set("readOnly", e.target.checked)} />
            Read-only
          </label>
        </div>
      </div>}

      {/* ── Layer 3a: ABAC ── */}
      {showAllLayers && <div className="si-layer-section si-layer-section--abac">
        <div className="si-layer-section-label">Layer 3a — ABAC Access Rules (expressions)</div>
        <div className="si-form-row">
          <label className="si-form-label" style={{ flex: 2 }}>
            Visible when <span className="si-hint">e.g. <code>user.country != ''</code></span>
            <input className="si-form-input" value={draft.abacVisible} onChange={(e) => set("abacVisible", e.target.value)} placeholder="user.country != ''" />
          </label>
          <label className="si-form-label">
            write
            <select className="si-form-select" value={draft.abacWrite === null ? "" : String(draft.abacWrite)} onChange={(e) => set("abacWrite", e.target.value === "" ? null : e.target.value === "false" ? false : null)}>
              <option value="">no rule</option>
              <option value="false">false (read-only)</option>
            </select>
          </label>
          <label className="si-form-label">
            disabled
            <select className="si-form-select" value={draft.abacDisabled === null ? "" : String(draft.abacDisabled)} onChange={(e) => set("abacDisabled", e.target.value === "" ? null : e.target.value === "true" ? true : null)}>
              <option value="">no rule</option>
              <option value="true">true (always disabled)</option>
            </select>
          </label>
        </div>
      </div>}

      {/* ── Layer 3b: RBAC ── */}
      {showAllLayers && <div className="si-layer-section si-layer-section--rbac">
        <div className="si-layer-section-label">Layer 3b — RBAC Role Rules</div>
        <div className="si-rbac-help">
          Leave blank = all roles allowed. Comma-separated role names to restrict.
        </div>
        <div className="si-form-row">
          <label className="si-form-label">visible roles<input className="si-form-input" value={draft.rbacVisible} onChange={(e) => set("rbacVisible", e.target.value)} placeholder="admin, manager" /></label>
          <label className="si-form-label">read roles<input className="si-form-input" value={draft.rbacRead} onChange={(e) => set("rbacRead", e.target.value)} placeholder="admin" /></label>
          <label className="si-form-label">write roles<input className="si-form-input" value={draft.rbacWrite} onChange={(e) => set("rbacWrite", e.target.value)} placeholder="admin" /></label>
          <label className="si-form-label">disabled roles<input className="si-form-input" value={draft.rbacDisabled} onChange={(e) => set("rbacDisabled", e.target.value)} placeholder="viewer" /></label>
        </div>
      </div>}

      <div className="si-form-actions si-form-actions--gap">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!fieldName.trim()}>
          <AddCircleOutlinedIcon sx={{ fontSize: 16 }} />{submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Draft → typed layer converters
// ════════════════════════════════════════════════════════════════════════════

function draftToDomainFieldCore(draft: FieldDraft): DomainFieldCore {
  const refs   = draft.validationRefs.filter(Boolean);
  const vRules: ValidationRule[] = draft.validations.map((v) => ({
    type: v.type as ValidationRule["type"], value: v.value || undefined, message: v.message,
  }));
  return {
    type:           draft.type,
    default:        draft.default || undefined,
    computed:       draft.computed || undefined,
    datasource:     draft.datasource || undefined,
    validationRefs: refs.length ? refs : undefined,
    validations:    vRules.length ? vRules : undefined,
    computedExpr:   draft.exprStr ? {
      expression: draft.exprStr,
      dependsOn:  draft.depsStr.split(",").map((s) => s.trim()).filter(Boolean),
    } : undefined,
  };
}

function draftToUIHint(draft: FieldDraft): FieldUIConfig {
  const hint: FieldUIConfig = {};
  if (draft.component)       hint.component       = draft.component;
  if (draft.label)           hint.label           = draft.label;
  if (draft.placeholder)     hint.placeholder     = draft.placeholder;
  if (draft.color)           hint.color           = draft.color;
  if (draft.backgroundColor) hint.backgroundColor = draft.backgroundColor;
  if (draft.borderColor)     hint.borderColor     = draft.borderColor;
  if (draft.fontSize)        hint.fontSize        = draft.fontSize as FontSize;
  if (draft.fontWeight)      hint.fontWeight      = draft.fontWeight as FontWeight;
  if (draft.textAlign)       hint.textAlign       = draft.textAlign as TextAlign;
  if (draft.width)           hint.width           = draft.width as FieldWidth;
  if (draft.icon)            hint.icon            = draft.icon;
  if (draft.tooltip)         hint.tooltip         = draft.tooltip;
  if (draft.hidden)          hint.hidden          = true;
  if (draft.readOnly)        hint.readOnly        = true;
  return hint;
}

function draftToABACRule(draft: FieldDraft): ABACFieldRule | null {
  const rule: ABACFieldRule = {};
  if (draft.abacVisible)           rule.visible  = draft.abacVisible;
  if (draft.abacWrite    !== null)  rule.write    = draft.abacWrite;
  if (draft.abacDisabled !== null)  rule.disabled = draft.abacDisabled;
  return Object.keys(rule).length ? rule : null;
}

function draftToRBACRule(draft: FieldDraft): RBACFieldRule | null {
  function parseRoles(s: string): string[] | undefined {
    const t = s.trim();
    return t === "" ? undefined : t.split(",").map((r) => r.trim()).filter(Boolean);
  }
  const rule: RBACFieldRule = {};
  const v = parseRoles(draft.rbacVisible);  if (v) rule.visible  = v;
  const r = parseRoles(draft.rbacRead);     if (r) rule.read     = r;
  const w = parseRoles(draft.rbacWrite);    if (w) rule.write    = w;
  const d = parseRoles(draft.rbacDisabled); if (d) rule.disabled = d;
  return Object.keys(rule).length ? rule : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Tab: Create Domain (all 3 layers at once for a brand-new domain)
// ════════════════════════════════════════════════════════════════════════════

interface CreateDomainTabProps {
  onAdd:      (payload: CreateDomainPayload) => void;
  registry?:  Record<string, ValidationRule>;
}

export interface CreateDomainPayload {
  domain:    DomainDefinition;
  uiHints:   Record<string, FieldUIConfig>;
  rbacRules: Record<string, RBACFieldRule>;
  abacRules: Record<string, ABACFieldRule>;
}

function CreateDomainTab({ onAdd, registry = {} }: CreateDomainTabProps) {
  const [domainName, setDomainName] = useState("");
  const [fields,     setFields]     = useState<Record<string, FieldDraft>>({});
  const [generated,  setGenerated]  = useState(false);

  // Single unified status for the create action
  type Status = { state: "idle" | "loading" | "ok" | "err"; msg: string };
  const [status, setStatus] = useState<Status>({ state: "idle", msg: "" });

  const validName = /^[a-z][a-zA-Z0-9]*$/.test(domainName);
  const hasFields = Object.keys(fields).length > 0;
  const canCreate = validName && hasFields && status.state !== "loading";

  function handleAddField(name: string, draft: FieldDraft) {
    setFields((p) => ({ ...p, [name]: draft }));
    setStatus({ state: "idle", msg: "" });
    setGenerated(false);
  }

  function removeField(name: string) {
    setFields((p) => { const n = { ...p }; delete n[name]; return n; });
    setStatus({ state: "idle", msg: "" });
    setGenerated(false);
  }

  function buildPayload(): CreateDomainPayload {
    const domainFields: Record<string, DomainFieldCore> = {};
    const uiHints: Record<string, FieldUIConfig>        = {};
    for (const [n, d] of Object.entries(fields)) {
      domainFields[n] = draftToDomainFieldCore(d);
      // Always store the label so it round-trips correctly from the DB
      uiHints[`${domainName}.${n}`] = { label: d.label || n };
    }
    return { domain: { name: domainName, fields: domainFields }, uiHints, rbacRules: {}, abacRules: {} };
  }

  /**
   * Single action: saves schema to backend DB AND adds to live React schema.
   * Works with both DynamoDB and PostgreSQL depending on server DB_BACKEND.
   */
  async function createDomain() {
    if (!canCreate) return;
    setStatus({ state: "loading", msg: "Creating table in database..." });

    const payload = buildPayload();
    const req = domainToBackendRequest({
      domainName: payload.domain.name,
      fields:     payload.domain.fields as any,
      uiHints:    payload.uiHints    as any,
      rbacRules:  payload.rbacRules  as any,
      abacRules:  payload.abacRules  as any,
    });

    try {
      const res = await apiCreateDomain(req);

      if (res.status === "success") {
        // ① Update live React schema
        onAdd(payload);

        // ② Build user-facing confirmation
        const action  = res.table_created ? "created" : "already existed";
        const loc     = dbLocation(res);
        const nFields = res.total_fields  ?? Object.keys(fields).length;
        setStatus({
          state: "ok",
          msg: `✅ Table "${res.table_name}" ${action} in ${loc} with ${nFields} field(s). Visible in all tabs now.`,
        });
      } else {
        setStatus({ state: "err", msg: `❌ Backend error: ${res.message ?? "Unknown error"}` });
      }
    } catch (err: any) {
      // Network failure — still update React state so UI works offline
      onAdd(payload);
      setStatus({
        state: "err",
        msg: `⚠️ Added to live schema, but backend unreachable: ${err?.message ?? String(err)}`,
      });
    }
  }

  // Code-gen fields (domain only — Layer 1)
  const codeGenFields: Record<string, DomainFieldCore> = {};
  for (const [n, d] of Object.entries(fields)) {
    codeGenFields[n] = draftToDomainFieldCore(d);
  }

  return (
    <div className="si-add-panel">
      <div className="si-card-header">
        <AddCircleOutlinedIcon sx={{ fontSize: 18, color: "#6366f1" }} />
        <span className="si-domain-name">Create new domain</span>
        <span className="si-field-count">Defines the Domain Model (Layer 1) and creates a table in the configured database</span>
      </div>

      <div className="si-add-form">
        {/* Step 1: Domain name */}
        <div className="si-step">
          <div className="si-step-label">Step 1 — Domain name</div>
          <div className="si-form-row">
            <label className="si-form-label" style={{ maxWidth: 280 }}>
              camelCase, e.g. <code>product</code>
              <input
                className={`si-form-input ${domainName && !validName ? "si-form-input--error" : ""}`}
                value={domainName}
                onChange={(e) => { setDomainName(e.target.value); setStatus({ state: "idle", msg: "" }); setGenerated(false); }}
                placeholder="product"
              />
            </label>
            {domainName && !validName && <span className="si-inline-error">Use camelCase starting with a lowercase letter</span>}
          </div>
        </div>

        {/* Step 2: Add fields */}
        <div className="si-step">
          <div className="si-step-label">Step 2 — Add fields</div>
          <FieldBuilder submitLabel="Add field" onSubmit={handleAddField} showAllLayers={false} registry={registry} />
        </div>

        {/* Field preview */}
        {hasFields && (
          <div className="si-field-list">
            <div className="si-form-sublabel">Fields added ({Object.keys(fields).length})</div>
            <div className="si-card">
              <table className="si-table">
                <thead><tr><th>Field</th><th>Type</th><th>Default</th><th>Datasource</th><th>Computed</th><th>Val Refs</th><th></th></tr></thead>
                <tbody>
                  {Object.entries(fields).map(([name, d]) => {
                    const refs = d.validationRefs;
                    return (
                      <tr key={name}>
                        <td className="si-field-name">{name}</td>
                        <td><Badge label={d.type} color="purple" /></td>
                        <td>{d.default ? <code style={{ fontSize: 11 }}>{d.default}</code> : <span className="si-muted">—</span>}</td>
                        <td>{d.datasource ? <Badge label={d.datasource} color="blue" /> : <span className="si-muted">—</span>}</td>
                        <td>{d.computed ? <Badge label="yes" color="teal" /> : <span className="si-muted">—</span>}</td>
                        <td>
                          {refs.length > 0
                            ? <span className="si-val-list">{refs.map((t) => <span key={t} className="si-val-ref"><LabelIcon sx={{ fontSize: 10 }} />{t}</span>)}</span>
                            : <span className="si-muted">—</span>}
                        </td>
                        <td>
                          <button className="si-remove-btn" type="button" onClick={() => removeField(name)}>
                            <DeleteOutlinedIcon sx={{ fontSize: 14 }} />Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Step 3: Create Domain */}
        <div className="si-step">
          <div className="si-step-label">Step 3 — Create domain in DynamoDB</div>

          <div className="si-create-explainer">
            <CloudUploadOutlinedIcon sx={{ fontSize: 15 }} />
            One click: creates the table in your database (DynamoDB <strong>or</strong> PostgreSQL) <strong>and</strong> adds it to the live schema.
          </div>

          <div className="si-form-actions si-form-actions--gap">
            {/* Primary: create in DynamoDB + live schema */}
            <button
              className="btn btn-create-domain"
              type="button"
              onClick={createDomain}
              disabled={!canCreate}
            >
              {status.state === "loading"
                ? <><span className="si-spinner" />Creating table in database...</>
                : status.state === "ok"
                  ? <><CheckIcon sx={{ fontSize: 16 }} />Domain Created</>
                  : <><CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />Create Domain</>}
            </button>

            {/* Secondary: generate code files */}
            <button className="btn btn-secondary" type="button" onClick={() => setGenerated(true)} disabled={!validName || !hasFields}>
              <CodeIcon sx={{ fontSize: 16 }} />Generate Files
            </button>
          </div>

          {/* Status feedback */}
          {status.state === "ok" && (
            <div className="si-backend-notice si-backend-notice--ok">
              {status.msg}
            </div>
          )}
          {status.state === "err" && (
            <div className="si-backend-notice si-backend-notice--err">
              {status.msg}
            </div>
          )}
        </div>

        {/* Generated output */}
        {generated && hasFields && (
          <div className="si-generated-layers">
            <div className="si-generated-header">Generated — Domain Model (Layer 1)</div>

            <div className="si-generated-layer">
              <div className="si-layer-label si-layer-label--domain"><StorageIcon sx={{ fontSize: 11 }} style={{ marginRight: 4 }} />Layer 1 · Domain Model</div>
              <CopyBlock title={<>Save as <code>src/domains/{domainName}.domain.ts</code></>} code={genDomainFile(domainName, codeGenFields)} />
              <div className="si-register-steps">
                <CopyBlock title={<>Add to <code>src/domains/index.ts</code></>} code={`export { ${domainName}Domain } from "./${domainName}.domain";`} />
                <CopyBlock title={<>Add to <code>src/schemas/index.ts</code> → domains array</>} code={`// domains: [ ...existing, ${domainName}Domain ]`} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Data Tab — Insert rows + view rows from DynamoDB
// ════════════════════════════════════════════════════════════════════════════

function DataTab({ schemas }: { schemas: AllSchemas }) {
  const domainNames = Object.keys(schemas.domains);
  const [selectedDomain, setSelectedDomain] = useState(domainNames[0] ?? "");
  const [formValues,     setFormValues]     = useState<Record<string, string>>({});
  const [rows,           setRows]           = useState<Record<string, any>[] | null>(null);
  const [status,         setStatus]         = useState<{ state: "idle" | "loading" | "ok" | "err"; msg: string }>({ state: "idle", msg: "" });
  const [loadingRows,    setLoadingRows]    = useState(false);

  const domainFields = selectedDomain ? Object.entries(schemas.domains[selectedDomain]?.fields ?? {}) : [];

  // Reset form + rows when domain changes
  function selectDomain(name: string) {
    setSelectedDomain(name);
    setFormValues({});
    setRows(null);
    setStatus({ state: "idle", msg: "" });
  }

  function setField(fieldName: string, value: string) {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleInsert() {
    if (!selectedDomain) return;
    setStatus({ state: "loading", msg: "Inserting row…" });
    try {
      // Convert form string values to correct types based on schema
      const row: Record<string, any> = {};
      for (const [fieldName, fieldDef] of domainFields) {
        const raw = formValues[fieldName] ?? "";
        if (raw === "") continue;
        if (fieldDef.type === "number") row[fieldName] = Number(raw);
        else if (fieldDef.type === "boolean") row[fieldName] = raw === "true";
        else row[fieldName] = raw;
      }
      const res = await apiInsertRow(selectedDomain, row);
      if (res.status === "success") {
        setStatus({ state: "ok", msg: `✅ Row inserted! ID: ${res.record_id}` });
        setFormValues({});
        // Auto-refresh the rows list
        await loadRows();
      } else {
        setStatus({ state: "err", msg: `❌ Insert failed: ${res.message}` });
      }
    } catch (err: any) {
      setStatus({ state: "err", msg: `❌ Error: ${err?.message ?? String(err)}` });
    }
  }

  async function loadRows() {
    if (!selectedDomain) return;
    setLoadingRows(true);
    try {
      const res = await apiListRows(selectedDomain);
      if (res.status === "success") {
        setRows(res.data ?? []);
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }

  // columns to show in the rows table: id + field_ids + created_at
  const rowColumns = ["id", ...domainFields.map(([k]) => k), "created_at"];

  return (
    <div className="si-data-tab">
      {/* Domain selector */}
      <div className="si-data-domain-bar">
        <span className="si-data-label">Domain (table):</span>
        <div className="si-data-domain-pills">
          {domainNames.length === 0 ? (
            <span className="si-data-empty-hint">No domains yet — create one in "Create Domain" tab first.</span>
          ) : (
            domainNames.map((name) => (
              <button
                key={name}
                type="button"
                className={`si-data-pill ${selectedDomain === name ? "si-data-pill--active" : ""}`}
                onClick={() => selectDomain(name)}
              >
                <StorageIcon sx={{ fontSize: 12 }} />
                {name}
              </button>
            ))
          )}
        </div>
      </div>

      {selectedDomain && (
        <>
          {/* ── Insert Row Form ── */}
          <div className="si-data-section">
            <div className="si-data-section-title">
              <AddIcon sx={{ fontSize: 14 }} />
              Insert a new row into <strong>{selectedDomain}</strong>
            </div>
            {domainFields.length === 0 ? (
              <p className="si-data-empty-hint">This domain has no fields defined yet.</p>
            ) : (
              <div className="si-data-form">
                {domainFields.map(([fieldName, fieldDef]) => {
                  const uiHint = schemas.uiHints?.[`${selectedDomain}.${fieldName}`];
                  const label  = uiHint?.label ?? fieldName;
                  const ph     = uiHint?.placeholder ?? "";
                  return (
                    <div key={fieldName} className="si-data-field-row">
                      <label className="si-data-field-label">
                        {label}
                        <span className="si-data-field-type">{fieldDef.type}</span>
                      </label>
                      {fieldDef.type === "boolean" ? (
                        <select
                          className="si-data-input"
                          value={formValues[fieldName] ?? ""}
                          onChange={(e) => setField(fieldName, e.target.value)}
                        >
                          <option value="">— select —</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type={fieldDef.type === "number" ? "number" : fieldDef.type === "date" ? "date" : "text"}
                          className="si-data-input"
                          placeholder={ph || `Enter ${label}…`}
                          value={formValues[fieldName] ?? ""}
                          onChange={(e) => setField(fieldName, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
                <div className="si-data-form-actions">
                  <button
                    type="button"
                    className="btn si-data-insert-btn"
                    onClick={handleInsert}
                    disabled={status.state === "loading"}
                  >
                    {status.state === "loading" ? (
                      <><span className="si-spinner" /> Inserting…</>
                    ) : (
                      <><SaveOutlinedIcon sx={{ fontSize: 14 }} /> Insert Row</>
                    )}
                  </button>
                  {status.state !== "idle" && status.state !== "loading" && (
                    <span className={`si-data-status ${status.state === "ok" ? "si-data-status--ok" : "si-data-status--err"}`}>
                      {status.msg}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── View Rows ── */}
          <div className="si-data-section">
            <div className="si-data-section-title" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <TableChartOutlinedIcon sx={{ fontSize: 14 }} />
                Rows in <strong>{selectedDomain}</strong>
                {rows !== null && <span className="si-tab-count">{rows.length}</span>}
              </span>
              <button
                type="button"
                className="btn btn-backend"
                onClick={loadRows}
                disabled={loadingRows}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                {loadingRows ? <><span className="si-spinner" /> Loading…</> : <><CloudDownloadOutlinedIcon sx={{ fontSize: 13 }} /> Load Rows</>}
              </button>
            </div>

            {rows === null ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0" }}>
                Click <strong>Load Rows</strong> to fetch data from DynamoDB.
              </div>
            ) : rows.length === 0 ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0" }}>
                No rows yet — insert one above and it will appear here.
              </div>
            ) : (
              <div className="si-data-rows-wrap">
                <table className="si-table si-data-rows-table">
                  <thead>
                    <tr>
                      {rowColumns.map((col) => (
                        <th key={col}>{col === "id" ? "ID" : col === "created_at" ? "Created" : col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {rowColumns.map((col) => {
                          const val = row[col];
                          return (
                            <td key={col} title={String(val ?? "")}>
                              {col === "id" ? (
                                <code className="si-data-id">{String(val ?? "").slice(0, 8)}…</code>
                              ) : col === "created_at" ? (
                                <span className="si-data-date">{val ? new Date(val).toLocaleString() : "—"}</span>
                              ) : val === undefined || val === null || val === "" ? (
                                <span className="si-data-empty">—</span>
                              ) : (
                                <span>{String(val)}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main export — SchemaInspector
// ════════════════════════════════════════════════════════════════════════════

type MainTab = "domain" | "ui" | "validations" | "access" | "create" | "data";

export function SchemaInspector({ schemas }: { schemas: AllSchemas }) {
  const [tab,   setTab]   = useState<MainTab>("domain");
  const [extra, setExtra] = useState<ExtraSchemaState>(EMPTY_EXTRA);
  const [backendLoadStatus, setBackendLoadStatus] = useState<string | null>(null);

  const liveSchemas = useMemo(() => mergeAll(schemas, extra), [schemas, extra]);

  // Auto-load domains from the backend the first time the component mounts.
  // Uses a ref-guard so strict-mode double-invocation doesn't cause duplicate toasts.
  const didAutoLoad = useRef(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddFieldToExisting(domainName: string, fieldName: string, draft: FieldDraft) {
    const fullPath   = `${domainName}.${fieldName}`;
    const uiHint     = draftToUIHint(draft);
    const abac       = draftToABACRule(draft);
    const rbac       = draftToRBACRule(draft);
    const newField   = draftToDomainFieldCore(draft);

    // 1. Update React state
    setExtra((prev) => ({
      ...prev,
      extraFields: {
        ...prev.extraFields,
        [domainName]: {
          ...(prev.extraFields[domainName] ?? {}),
          [fieldName]: newField,
        },
      },
      uiHints:   Object.values(uiHint).some((v) => v !== undefined)
        ? { ...prev.uiHints, [fullPath]: uiHint } : prev.uiHints,
      abacRules: abac ? { ...prev.abacRules, [fullPath]: abac } : prev.abacRules,
      rbacRules: rbac ? { ...prev.rbacRules, [fullPath]: rbac } : prev.rbacRules,
    }));

    // 2. Push the full updated schema to DynamoDB.
    // Build the combined field set inline (can't use liveSchemas yet — setExtra is async).
    try {
      const existingFields = liveSchemas.domains[domainName]?.fields ?? {};
      const updatedFields  = { ...existingFields, [fieldName]: newField };
      const updatedUIHints = {
        ...(liveSchemas.uiHints ?? {}),
        ...(Object.values(uiHint).some((v) => v !== undefined) ? { [fullPath]: uiHint } : {}),
      };
      const req = domainToBackendRequest({
        domainName,
        fields:    updatedFields as any,
        uiHints:   updatedUIHints as any,
        rbacRules: extra.rbacRules as any,
        abacRules: extra.abacRules as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "column added";
        setBackendLoadStatus(`✅ Field "${fieldName}" added to "${domainName}" in ${dbLocation(res)} — ${action}.`);
      } else {
        setBackendLoadStatus(`⚠️ Field added locally, but backend error: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Field added locally, but backend unreachable: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 5000);
  }

  /** Edit an existing field — supports rename. Updates React state then syncs to backend. */
  async function handleEditField(domainName: string, oldName: string, newName: string, draft: FieldDraft) {
    const updatedField = draftToDomainFieldCore(draft);
    const uiHint       = draftToUIHint(draft);
    const abac         = draftToABACRule(draft);
    const rbac         = draftToRBACRule(draft);
    const oldPath      = `${domainName}.${oldName}`;
    const newPath      = `${domainName}.${newName}`;
    const isRename     = oldName !== newName;

    // Determine whether this domain lives in newDomains (loaded from backend / created this session)
    // BEFORE the state update so we can also use this for the backend payload.
    const domainInNewDomains = extra.newDomains.find((d) => d.name === domainName);

    // 1. Update React state ─────────────────────────────────────────────────
    setExtra((prev) => {
      // ── uiHints ───────────────────────────────────────────────────────────
      const uiHints = { ...prev.uiHints };
      if (isRename && uiHints[oldPath]) { uiHints[newPath] = uiHints[oldPath]; delete uiHints[oldPath]; }
      if (Object.values(uiHint).some((v) => v !== undefined)) uiHints[newPath] = uiHint;

      // ── abacRules ─────────────────────────────────────────────────────────
      const abacRules = { ...prev.abacRules };
      if (isRename && abacRules[oldPath]) { abacRules[newPath] = abacRules[oldPath]; delete abacRules[oldPath]; }
      if (abac) abacRules[newPath] = abac;

      // ── rbacRules ─────────────────────────────────────────────────────────
      const rbacRules = { ...prev.rbacRules };
      if (isRename && rbacRules[oldPath]) { rbacRules[newPath] = rbacRules[oldPath]; delete rbacRules[oldPath]; }
      if (rbac) rbacRules[newPath] = rbac;

      if (prev.newDomains.some((d) => d.name === domainName)) {
        // ── Domain is in newDomains — update it directly so mergeAll never
        //    sees both the old key (from newDomains) AND the new key (from
        //    extraFields) at the same time, which would produce a duplicate field.
        const updatedNewDomains = prev.newDomains.map((d) => {
          if (d.name !== domainName) return d;
          const fields = { ...d.fields };
          if (isRename) delete fields[oldName];
          fields[newName] = updatedField;
          return { ...d, fields };
        });

        // Clean up any stale extraFields entries for this domain/field so
        // they don't shadow the authoritative newDomains data.
        const domainExtraFields = { ...(prev.extraFields[domainName] ?? {}) };
        if (isRename) delete domainExtraFields[oldName];
        delete domainExtraFields[newName];

        return {
          ...prev,
          newDomains:  updatedNewDomains,
          extraFields: { ...prev.extraFields, [domainName]: domainExtraFields },
          uiHints,
          abacRules,
          rbacRules,
        };
      } else {
        // ── Domain is from the static base schema — use extraFields as before
        const domainFields = { ...(prev.extraFields[domainName] ?? {}) };
        if (isRename) delete domainFields[oldName];
        domainFields[newName] = updatedField;

        return {
          ...prev,
          extraFields: { ...prev.extraFields, [domainName]: domainFields },
          uiHints,
          abacRules,
          rbacRules,
        };
      }
    });

    // 2. Build the full updated domain and push to backend ──────────────────
    // Use raw DomainFieldCore data from newDomains (when available) rather than
    // the compiled DomainFieldDef from liveSchemas so we don't send extra runtime
    // properties back to the API.
    try {
      let rawFields: Record<string, DomainFieldCore>;
      if (domainInNewDomains) {
        rawFields = { ...domainInNewDomains.fields };
      } else {
        // Base-schema domain: grab the extra fields we have accumulated
        rawFields = { ...(extra.extraFields[domainName] ?? {}) } as Record<string, DomainFieldCore>;
      }
      if (isRename) delete rawFields[oldName];
      rawFields[newName] = updatedField;

      const updatedUIHints = { ...(liveSchemas.uiHints ?? {}) };
      if (isRename && updatedUIHints[oldPath]) { updatedUIHints[newPath] = updatedUIHints[oldPath]; delete updatedUIHints[oldPath]; }
      if (Object.values(uiHint).some((v) => v !== undefined)) updatedUIHints[newPath] = uiHint;

      const req = domainToBackendRequest({
        domainName,
        fields:    rawFields as any,
        uiHints:   updatedUIHints as any,
        rbacRules: extra.rbacRules as any,
        abacRules: extra.abacRules as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "schema updated";
        const label  = isRename ? `"${oldName}" → "${newName}"` : `"${newName}"`;
        setBackendLoadStatus(`✅ Field ${label} saved — table "${domainName}" ${action} in ${dbLocation(res)}.`);
      } else {
        setBackendLoadStatus(`⚠️ Field saved locally, but backend error: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Field saved locally, but backend unreachable: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 5000);
  }

  function handleDomainCreated(payload: CreateDomainPayload) {
    setExtra((prev) => ({
      ...prev,
      newDomains: [
        ...prev.newDomains.filter((d) => d.name !== payload.domain.name),
        payload.domain,
      ],
      uiHints:   { ...prev.uiHints,   ...payload.uiHints   },
      rbacRules: { ...prev.rbacRules, ...payload.rbacRules },
      abacRules: { ...prev.abacRules, ...payload.abacRules },
    }));
  }

  function handleAddUIHint(path: string, hint: FieldUIConfig) {
    setExtra((prev) => ({ ...prev, uiHints: { ...prev.uiHints, [path]: hint } }));
  }
  function handleRemoveUIHint(path: string) {
    setExtra((prev) => { const n = { ...prev.uiHints }; delete n[path]; return { ...prev, uiHints: n }; });
  }

  function handleAddRBAC(path: string, rule: RBACFieldRule) {
    setExtra((prev) => ({ ...prev, rbacRules: { ...prev.rbacRules, [path]: rule } }));
  }
  function handleRemoveRBAC(path: string) {
    setExtra((prev) => { const n = { ...prev.rbacRules }; delete n[path]; return { ...prev, rbacRules: n }; });
  }

  function handleAddABAC(path: string, rule: ABACFieldRule) {
    setExtra((prev) => ({ ...prev, abacRules: { ...prev.abacRules, [path]: rule } }));
  }
  function handleRemoveABAC(path: string) {
    setExtra((prev) => { const n = { ...prev.abacRules }; delete n[path]; return { ...prev, abacRules: n }; });
  }

  function handleViewConfig(domainName: string, cfg: DomainViewConfig) {
    setExtra((prev) => ({ ...prev, viewConfigs: { ...prev.viewConfigs, [domainName]: cfg } }));
  }

  /** Save a specific domain from the Domain Model tab to the backend */
  async function handleSaveDomainToBackend(domainName: string) {
    const domainDef = liveSchemas.domains[domainName];
    if (!domainDef) return;
    try {
      const req = domainToBackendRequest({
        domainName,
        fields:    domainDef.fields as any,
        uiHints:   liveSchemas.uiHints   as any,
        rbacRules: extra.rbacRules       as any,
        abacRules: extra.abacRules       as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action  = res.table_created ? "created" : "already existed";
        const loc     = dbLocation(res);
        const nFields = res.total_fields ?? Object.keys(domainDef.fields).length;
        setBackendLoadStatus(
          `✅ Table "${domainName}" ${action} in ${loc} — ${nFields} field(s).`
        );
      } else {
        setBackendLoadStatus(`❌ Backend error: ${res.message}`);
      }
      setTimeout(() => setBackendLoadStatus(null), 4000);
    } catch (err: any) {
      setBackendLoadStatus(`❌ Network error: ${err?.message ?? String(err)}`);
      setTimeout(() => setBackendLoadStatus(null), 5000);
    }
  }

  /** Load schemas from the backend and merge them into live state */
  async function handleLoadFromBackend() {
    try {
      const res = await apiListSchemas();
      if (res.status !== "success" || !res.schemas?.length) {
        setBackendLoadStatus("ℹ️ No schemas found in backend.");
        setTimeout(() => setBackendLoadStatus(null), 3000);
        return;
      }
      let count = 0;
      setExtra((prev) => {
        let next = { ...prev };
        for (const entry of res.schemas as unknown as BackendSchemaEntry[]) {
          const converted = backendSchemaToFrontend(entry);
          count++;
          const domainDef: DomainDefinition = {
            name: converted.domainName,
            fields: Object.fromEntries(
              Object.entries(converted.fields).map(([k, v]) => [k, {
                type: v.type as FieldType,
                default: v.default,
                datasource: v.datasource,
              }])
            ),
          };
          next = {
            ...next,
            newDomains: [...next.newDomains.filter((d) => d.name !== converted.domainName), domainDef],
            uiHints:   { ...next.uiHints,   ...converted.uiHints   },
            rbacRules: { ...next.rbacRules, ...converted.rbacRules },
            abacRules: { ...next.abacRules, ...converted.abacRules },
          };
        }
        return next;
      });
      setBackendLoadStatus(`✅ Loaded ${count} schema(s) from backend.`);
      setTimeout(() => setBackendLoadStatus(null), 4000);
    } catch (err: any) {
      setBackendLoadStatus(`❌ Load failed: ${err?.message ?? String(err)}`);
      setTimeout(() => setBackendLoadStatus(null), 5000);
    }
  }

  // Auto-load on mount (once) so the domain list is populated immediately
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    handleLoadFromBackend();
  }, []);

  // ── Tab metadata ──────────────────────────────────────────────────────────
  const domainCount = Object.keys(liveSchemas.domains).length;
  const regCount    = Object.keys(schemas._layers?.validationRegistry ?? {}).length;
  const uiCount     = Object.keys(liveSchemas.uiHints ?? {}).length;
  const rbacCount   = Object.keys(liveSchemas._layers?.rbac?.fields ?? {}).length;
  const abacCount   = Object.keys(liveSchemas._layers?.abac?.rules  ?? {}).length;

  const tabs: Array<{ id: MainTab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: "domain",      label: "Domain Model",  icon: <StorageIcon sx={{ fontSize: 15 }} />,             count: domainCount },
    { id: "ui",          label: "UI Config",      icon: <PaletteOutlinedIcon sx={{ fontSize: 15 }} />,     count: uiCount     },
    { id: "validations", label: "Validations",    icon: <CheckCircleOutlinedIcon sx={{ fontSize: 15 }} />, count: regCount    },
    { id: "access",      label: "Access Control", icon: <LockOutlinedIcon sx={{ fontSize: 15 }} />,        count: rbacCount + abacCount },
    { id: "create",      label: "Create Domain",  icon: <AddCircleOutlinedIcon sx={{ fontSize: 15 }} />  },
    { id: "data",        label: "Data",            icon: <TableChartOutlinedIcon sx={{ fontSize: 15 }} />, count: domainCount > 0 ? domainCount : undefined },
  ];

  return (
    <div className="si-root">
      {/* Tab bar + backend actions */}
      <div className="si-top-bar">
        <div className="si-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`si-tab-btn ${tab === t.id ? "si-tab-btn--active" : ""}`}
              type="button"
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.count !== undefined && t.count > 0 && <span className="si-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="si-backend-bar">
          <button className="btn btn-backend" type="button" onClick={handleLoadFromBackend}>
            <CloudDownloadOutlinedIcon sx={{ fontSize: 15 }} />
            Load from Backend
          </button>
        </div>
      </div>

      {/* Backend status toast */}
      {backendLoadStatus && (
        <div className={`si-toast ${backendLoadStatus.startsWith("✅") ? "si-toast--ok" : backendLoadStatus.startsWith("ℹ️") ? "si-toast--info" : "si-toast--err"}`}>
          {backendLoadStatus}
        </div>
      )}

      {/* Tab panels */}
      {tab === "domain" && (
        <DomainModelTab
          schemas={liveSchemas}
          viewConfigs={extra.viewConfigs}
          onAddField={handleAddFieldToExisting}
          onEditField={(domainName, oldName, newName, draft) => handleEditField(domainName, oldName, newName, draft)}
          onViewConfig={handleViewConfig}
          onSaveBackend={handleSaveDomainToBackend}
        />
      )}
      {tab === "ui" && (
        <UIConfigTab
          schemas={liveSchemas}
          onAdd={handleAddUIHint}
          onRemove={handleRemoveUIHint}
          extraHints={extra.uiHints}
        />
      )}
      {tab === "validations" && <ValidationsTab schemas={liveSchemas} />}
      {tab === "access" && (
        <AccessTab
          schemas={liveSchemas}
          onAddRBAC={handleAddRBAC}
          onRemoveRBAC={handleRemoveRBAC}
          onAddABAC={handleAddABAC}
          onRemoveABAC={handleRemoveABAC}
          extraRBACKeys={new Set(Object.keys(extra.rbacRules))}
          extraABACKeys={new Set(Object.keys(extra.abacRules))}
        />
      )}
      {tab === "create" && <CreateDomainTab onAdd={handleDomainCreated} registry={liveSchemas._layers?.validationRegistry ?? {}} />}
      {tab === "data"   && <DataTab schemas={liveSchemas} />}
    </div>
  );
}
