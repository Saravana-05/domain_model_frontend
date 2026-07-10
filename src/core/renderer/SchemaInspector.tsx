import React, { useState, useMemo, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { useAuthStore } from "../../store/authStore";
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
import LinkOutlinedIcon         from "@mui/icons-material/LinkOutlined";
import CloseIcon                from "@mui/icons-material/Close";
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
  apiSaveAttribute,
  apiSaveAttributeTranslation,
  type BackendSchemaEntry,
  type BackendCreateResponse,
} from "../api/datastoreApi";
import { LinkDomainModal } from "../../../src/modal/LinkDomainModal";


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
// Junction table helper
// Given parentDomain + relatedDomain, returns the junction DomainDefinition.
// e.g. student + subject → student_subject with studentId + subjectId fields
// ════════════════════════════════════════════════════════════════════════════

function buildJunctionDomain(
  parentDomainName: string,
  relatedDomainName: string,
): DomainDefinition {
  const junctionName = `${parentDomainName}_${relatedDomainName}`;
  const parentIdField  = `${parentDomainName}Id`;
  const relatedIdField = `${relatedDomainName}Id`;
  return {
    name: junctionName,
    fields: {
      [parentIdField]:  { type: "string" },
      [relatedIdField]: { type: "string" },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Unified extra-schema state (all live additions across all 3 layers)
// ════════════════════════════════════════════════════════════════════════════

interface ExtraSchemaState {
  newDomains:  DomainDefinition[];
  extraFields: Record<string, Record<string, DomainFieldCore>>;
  uiHints:     Record<string, FieldUIConfig>;
  rbacRules:   Record<string, RBACFieldRule>;
  abacRules:   Record<string, ABACFieldRule>;
  viewConfigs: Record<string, DomainViewConfig>;
  dbBackends:  Record<string, string>;
  versioned:   Record<string, boolean>;   

  /** Tracks which domain pairs already have a junction table to avoid duplicates */
  junctionPairs: Set<string>;
}

const EMPTY_EXTRA: ExtraSchemaState = {
  newDomains: [], extraFields: {}, uiHints: {}, rbacRules: {}, abacRules: {},
  viewConfigs: {}, dbBackends: {}, versioned: {}, junctionPairs: new Set(),
};
// ════════════════════════════════════════════════════════════════════════════
// Merge helper
// ════════════════════════════════════════════════════════════════════════════

function mergeAll(base: AllSchemas, extra: ExtraSchemaState): AllSchemas {
  const isEmpty =
    extra.newDomains.length === 0 &&
    Object.keys(extra.extraFields).length === 0 &&
    Object.keys(extra.uiHints).length === 0 &&
    Object.keys(extra.rbacRules).length === 0 &&
    Object.keys(extra.abacRules).length === 0;
  if (isEmpty) return base;

  const newDomainNames = new Set(extra.newDomains.map((d) => d.name));
  const mergedNewDomains: DomainDefinition[] = extra.newDomains.map((dom) => ({
    ...dom,
    fields: { ...dom.fields, ...(extra.extraFields[dom.name] ?? {}) },
  }));
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

const FIELD_TYPES: FieldType[] = ["string", "number", "decimal", "boolean", "date", "image", "relation"];
const COMPONENTS:  ComponentType[] = ["text", "number", "select", "checkbox", "textarea", "date"];
const FONT_SIZES:  FontSize[]      = ["xs", "sm", "base", "lg", "xl", "2xl"];
const FONT_WEIGHTS: FontWeight[]   = ["light", "normal", "medium", "semibold", "bold"];
const TEXT_ALIGNS: TextAlign[]     = ["left", "center", "right"];
const FIELD_WIDTHS: FieldWidth[]   = ["auto", "quarter", "third", "half", "full"];
const VAL_TYPES = ["required", "unique", "minLength", "maxLength", "min", "max", "pattern"] as const;

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
  if (def.relatedDomain)
    lines.push(`${i}  relatedDomain: "${def.relatedDomain}",`);
  if (def.listDomain)
    lines.push(`${i}  listDomain: "${def.listDomain}",`);
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
// ListDomainPicker — multi-select relation (type = "list")
// ════════════════════════════════════════════════════════════════════════════

interface ListDomainPickerProps {
  domainNames:    string[];
  value:          string;
  suggestedName:  string;
  onChange:       (domainName: string) => void;
  onCreateDomain: (name: string, fields: QuickCreateField[]) => void;
}

function ListDomainPicker({
  domainNames, value, suggestedName, onChange, onCreateDomain,
}: ListDomainPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState(suggestedName);

  useEffect(() => { setNewName(suggestedName); }, [suggestedName]);

  const validNew  = /^[a-z][a-zA-Z0-9_]*$/.test(newName);
  const canCommit = validNew;

  function handleSelect(val: string) {
    if (val === "__create__") { setShowCreate(true); }
    else { onChange(val); setShowCreate(false); }
  }

  function commitCreate() {
    if (!canCommit) return;
    onCreateDomain(newName, []);
    onChange(newName);
    setShowCreate(false);
  }

  return (
    <div className="si-list-picker">
      <label className="si-form-label" style={{ flex: 2 }}>
        Target domain
        <span className="si-hint">each record stores IDs of items from this domain</span>
        {domainNames.length > 0 ? (
          <select className="si-form-select si-list-select" value={value}
            onChange={e => handleSelect(e.target.value)}>
            <option value="">— select domain —</option>
            {domainNames.map(d => <option key={d} value={d}>{d}</option>)}
            <option disabled>──────────</option>
            <option value="__create__">＋ Create new domain…</option>
          </select>
        ) : (
          <div className="si-relation-empty">
            <span className="si-muted si-relation-empty-msg">No domains exist yet.</span>
            <button type="button" className="si-btn-add" onClick={() => setShowCreate(true)}>
              <AddIcon sx={{ fontSize: 14 }} />Create domain
            </button>
          </div>
        )}
      </label>

      {showCreate && (
        <div className="si-list-create-box">
          <div className="si-list-create-title">
            <AddCircleOutlinedIcon sx={{ fontSize: 14 }} />
            Quick-create target domain
            <span className="si-hint">auto-named from parent + field name</span>
          </div>
          <div className="si-form-row">
            <label className="si-form-label" style={{ maxWidth: 300 }}>
              Domain name <span className="si-hint">edit if needed</span>
              <input
                className={`si-form-input ${newName && !validNew ? "si-form-input--error" : ""}`}
                value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
              {newName && !validNew && (
                <span className="si-inline-error">Use camelCase or snake_case starting with a lowercase letter</span>
              )}
            </label>
          </div>
          <div className="si-form-actions si-form-actions--gap">
            <button className="btn btn-primary" type="button" onClick={commitCreate} disabled={!canCommit}>
              <CheckIcon sx={{ fontSize: 14 }} />Use this domain
            </button>
            <button className="btn btn-secondary" type="button"
              onClick={() => { setShowCreate(false); setNewName(suggestedName); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {value && !showCreate && (
        <div className="si-list-preview">
          <LinkOutlinedIcon sx={{ fontSize: 13 }} />
          Stores IDs from&nbsp;<Badge label={value} color="green" />
          <span className="si-list-cardinality-badge">[ ] many</span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RelationDomainPicker
// ════════════════════════════════════════════════════════════════════════════

interface QuickCreateField { name: string; type: FieldType }

interface RelationDomainPickerProps {
  domainNames: string[];
  value:       string;
  onChange:    (value: string) => void;
}

function RelationDomainPicker({ domainNames, value, onChange }: RelationDomainPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState("");
  const [qcSaved,    setQcSaved]    = useState(false);

  const validNew  = /^[a-z][a-zA-Z0-9]*$/.test(newName);
  const canCommit = validNew;

  const displayValue = value.startsWith("__new__:") ? value.split(":")[1] : value;

  function commitCreate() {
    if (!canCommit) return;
    const sentinel = `__new__:${newName}:${JSON.stringify([])}`;
    onChange(sentinel);
    setQcSaved(true);
    setShowCreate(false);
    setTimeout(() => setQcSaved(false), 2500);
  }

  function handleSelectChange(val: string) {
    if (val === "__create__") { setShowCreate(true); }
    else { onChange(val); setShowCreate(false); }
  }

  return (
    <div className="si-relation-picker">
      <label className="si-form-label" style={{ flex: 2 }}>
        Related domain
        <span className="si-hint">the domain this field references (foreign key)</span>
        {domainNames.length > 0 ? (
          <select className="si-form-select si-relation-select" value={displayValue}
            onChange={(e) => handleSelectChange(e.target.value)}>
            <option value="">— select domain —</option>
            {domainNames.map((d) => <option key={d} value={d}>{d}</option>)}
            <option disabled>──────────</option>
            <option value="__create__">＋ Create new domain…</option>
          </select>
        ) : (
          <div className="si-relation-empty">
            <span className="si-muted si-relation-empty-msg">No domains exist yet.</span>
            <button type="button" className="si-btn-add" onClick={() => setShowCreate(true)}>
              <AddIcon sx={{ fontSize: 14 }} />Create domain
            </button>
          </div>
        )}
      </label>

      {showCreate && (
        <div className="si-relation-create-box">
          <div className="si-relation-create-title">
            <AddCircleOutlinedIcon sx={{ fontSize: 14 }} />
            Quick-create a new domain
            <span className="si-hint">it will be added to the live schema after you save this field</span>
          </div>
          <div className="si-form-row">
            <label className="si-form-label" style={{ maxWidth: 260 }}>
              Domain name <span className="si-hint">camelCase</span>
              <input
                className={`si-form-input ${newName && !validNew ? "si-form-input--error" : ""}`}
                value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. category" autoFocus />
              {newName && !validNew && (
                <span className="si-inline-error">camelCase starting with a lowercase letter</span>
              )}
            </label>
          </div>
          <div className="si-relation-fields-label">
            <CheckCircleOutlinedIcon sx={{ fontSize: 12 }} />
            Fields (at least one required)
          </div>
          <div className="si-form-actions si-form-actions--gap">
            <button className="btn btn-primary" type="button" onClick={commitCreate} disabled={!canCommit}>
              {qcSaved
                ? <><CheckIcon sx={{ fontSize: 14 }} />Domain queued</>
                : <><LinkOutlinedIcon sx={{ fontSize: 14 }} />Use this domain</>}
            </button>
            <button className="btn btn-secondary" type="button"
              onClick={() => { setShowCreate(false); setNewName(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {displayValue && !showCreate && (
        <div className="si-relation-preview">
          <LinkOutlinedIcon sx={{ fontSize: 13 }} />
          References&nbsp;<Badge label={displayValue} color="indigo" />
          {value.startsWith("__new__:") && (
            <span className="si-relation-pending-badge">pending creation</span>
          )}
          {/* Junction table preview */}
          {displayValue && (
            <span className="si-junction-hint" title="A junction table will be auto-created for this relation">
              <StorageIcon sx={{ fontSize: 11 }} />
              junction table will be auto-created
            </span>
          )}
        </div>
      )}
    </div>
  );
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

  function setTable(patch: Partial<typeof tv>) { onChange({ ...current, tableView: { ...tv, ...patch } }); }
  function setForm(patch: Partial<typeof fv>)  { onChange({ ...current, formView:  { ...fv, ...patch } }); }
  function setCard(patch: Partial<typeof cv>)  { onChange({ ...current, cardView:  { ...cv, ...patch } }); }

  return (
    <div className="si-view-config">
      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!tv.enabled} onChange={(e) => setTable({ enabled: e.target.checked })} />
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
                  value={tv.pageSize ?? 25} onChange={(e) => setTable({ pageSize: Number(e.target.value) })} />
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.sortable} onChange={(e) => setTable({ sortable: e.target.checked })} />Sortable columns
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.filterable} onChange={(e) => setTable({ filterable: e.target.checked })} />Column filters
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.searchable} onChange={(e) => setTable({ searchable: e.target.checked })} />Global search
              </label>
            </div>
            <label className="si-form-label si-form-label--full">
              Visible fields <span className="si-hint">comma-separated; leave blank = all</span>
              <input className="si-form-input"
                value={(tv.visibleFields ?? []).join(", ")}
                onChange={(e) => setTable({ visibleFields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder={fieldNames.slice(0, 3).join(", ")} />
            </label>
          </div>
        )}
      </div>

      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!fv.enabled} onChange={(e) => setForm({ enabled: e.target.checked })} />
          <CodeIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Form View</span>
          <span className="si-hint">Create / edit instances in a form</span>
        </label>
        {fv.enabled && (
          <div className="si-view-body">
            <label className="si-form-label">
              Layout
              <select className="si-form-select" value={fv.layout ?? "single"} onChange={(e) => setForm({ layout: e.target.value as any })}>
                <option value="single">Single column</option>
                <option value="two-column">Two columns</option>
                <option value="multi-column">Multi-column</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!cv.enabled} onChange={(e) => setCard({ enabled: e.target.checked })} />
          <PaletteOutlinedIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Card / Gallery View</span>
          <span className="si-hint">Show instances as visual cards</span>
        </label>
        {cv.enabled && (
          <div className="si-view-body">
            <div className="si-form-row">
              <label className="si-form-label">
                Title field
                <select className="si-form-select" value={cv.titleField ?? ""} onChange={(e) => setCard({ titleField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="si-form-label">
                Subtitle field
                <select className="si-form-select" value={cv.subtitleField ?? ""} onChange={(e) => setCard({ subtitleField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="si-form-label">
                Image field
                <select className="si-form-select" value={cv.imageField ?? ""} onChange={(e) => setCard({ imageField: e.target.value || undefined })}>
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
  schemas:               AllSchemas;
  viewConfigs:           Record<string, DomainViewConfig>;
  dbBackends:            Record<string, string>;
  versioned:             Record<string, boolean>;
  junctionDomains:       Set<string>;
  onAddField:            (domainName: string, fieldName: string, draft: FieldDraft) => void;
  onEditField:           (domainName: string, oldName: string, newName: string, draft: FieldDraft) => void;
  onViewConfig:          (domainName: string, cfg: DomainViewConfig) => void;
  onSaveBackend:         (domainName: string) => void;
  onQuickCreateDomain:   (name: string, fields: QuickCreateField[]) => void;
}

function DomainModelTab({
  schemas, viewConfigs, dbBackends, versioned, junctionDomains,
  onAddField, onEditField, onViewConfig, onSaveBackend, onQuickCreateDomain,
}: DomainModelTabProps) {
  const registry      = schemas._layers?.validationRegistry ?? {};
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [editing, setEditing] = useState<{ domain: string; field: string } | null>(null);
  const [expandedChildren, setExpandedChildren] = useState<Record<string, boolean>>({});
  const domainNames   = Object.keys(schemas.domains);

// Build parent → children map
  // A domain is a child if it has a parentId field (e.g. kaId in ak means ak is child of ka)
  const childrenMap: Record<string, string[]> = {};

  for (const [domainName] of Object.entries(schemas.domains)) {
    // Check every OTHER domain to see if it has domainNameId field
    for (const [otherName, otherDef] of Object.entries(schemas.domains)) {
      if (otherName === domainName) continue;
      const parentIdField = `${domainName}Id`;
      const hasParentId = Object.keys(otherDef.fields).includes(parentIdField);
      if (hasParentId) {
        // otherName is a child of domainName
        if (!childrenMap[domainName]) childrenMap[domainName] = [];
        if (!childrenMap[domainName].includes(otherName)) {
          childrenMap[domainName].push(otherName);
        }
      }
    }
  }

  // Domains that appear as children — don't show them at top level
  const childDomains = new Set(Object.values(childrenMap).flat());

  return (
    <div className="si-domains">
{Object.keys(schemas.domains).filter((d) => !childDomains.has(d)).map((domainName) => {
        const fields     = schemas.domains[domainName].fields;
        const fieldNames = Object.keys(fields);
        const viewCfg    = viewConfigs[domainName] ?? {};
        const isJunction = junctionDomains.has(domainName) && 
  Object.keys(fields).length === 2 &&
  Object.keys(fields).every((f) => f.endsWith("Id"));

        return (
          <div className={`si-card ${isJunction ? "si-card--junction" : ""}`} key={domainName}>
            <div className="si-card-header">
              <StorageIcon sx={{ fontSize: 16, color: isJunction ? "#0369a1" : "#7e22ce" }} />
              <span className="si-domain-name">{domainName}</span>
              <span className="si-field-count">{fieldNames.length} fields</span>
              {/* Junction badge */}
              {isJunction ? (
                <span className="si-layer-tag si-layer-tag--junction">
                  <LinkOutlinedIcon sx={{ fontSize: 11 }} /> Junction Table
                </span>
              ) : (
                <span className="si-layer-tag si-layer-tag--domain">Domain Model</span>
              )}
{dbBackends[domainName] && (
                <Badge
                  label={dbBackends[domainName] === "dynamodb" ? "DynamoDB" : "PostgreSQL"}
                  color={dbBackends[domainName] === "dynamodb" ? "orange" : "teal"}
                />
              )}
              {versioned[domainName] && (
                <Badge label="Versioned" color="indigo" />
              )}
              <button className="si-icon-btn si-icon-btn--cloud" type="button"
                title="Save to backend" onClick={() => onSaveBackend(domainName)}>
                <CloudUploadOutlinedIcon sx={{ fontSize: 15 }} />
                <span>Save to Backend</span>
              </button>
            </div>

           

            <table className="si-table">
              <thead>
                <tr>
                  <th>Field</th><th>Type</th><th>Cardinality</th><th>Format</th>
                  <th>Default</th><th>Datasource</th><th>Computed</th>
                  <th>Validation Refs</th><th>Inline Rules</th><th>Computed Expr</th>
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
                       <td>
                         {fieldDef.type === "relation"
                            ? <Badge label="relation 🔗" color="indigo" />
                            : <Badge label={fieldDef.type} color="purple" />}
                        </td>
                      <td>
                          {(fieldDef as any).cardinality
                            ? <Badge label={(fieldDef as any).cardinality} color="blue" />
                            : <span className="si-muted">—</span>}
                        </td>
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
                          {!isJunction && hasPermission(domainName, "edit") ? (
                            <button
                              className={`si-edit-btn ${isEditing ? "si-edit-btn--active" : ""}`}
                              type="button"
                              onClick={() => setEditing(isEditing ? null : { domain: domainName, field: fieldName })}
                              title="Edit field">
                              <EditOutlinedIcon sx={{ fontSize: 13 }} />
                              {isEditing ? "Close" : "Edit"}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: "#9ca3af" }} title={isJunction ? "Junction fields are auto-managed" : "No edit permission"}>
                              {isJunction ? "🔗" : "🔒"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={11} className="si-edit-row">
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
                                domainNames={domainNames}
                                parentDomainName={domainName}
                                onNewDomainFromRelation={onQuickCreateDomain}
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
{/* Child domains — shown nested under parent */}
           {/* Child domains — nested inside parent card, collapsible */}
            {(childrenMap[domainName] ?? []).length > 0 && (
              <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)", padding: "8px 0 8px 0" }}>
                {(childrenMap[domainName] ?? []).map((childName) => {
                  const childFields     = schemas.domains[childName]?.fields ?? {};
                  const childFieldNames = Object.keys(childFields);
                  const isExpanded      = expandedChildren[childName] ?? false;
                  return (
                    <div key={childName} style={{ margin: "6px 12px 6px 32px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", overflow: "hidden" }}>
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", userSelect: "none" }}
                        onClick={() => setExpandedChildren((prev) => ({ ...prev, [childName]: !isExpanded }))}
                      >
                        <StorageIcon sx={{ fontSize: 14, color: "#0F6E56" }} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>{childName}</span>
                        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{childFieldNames.length} fields</span>
                        <span style={{ fontSize: 11, background: "#F1EFE8", color: "#5F5E5A", borderRadius: 20, padding: "1px 8px", fontWeight: 500 }}>
                          child of {domainName}
                        </span>
                        <span style={{ marginLeft: "auto", color: "var(--color-text-secondary)", display: "flex", alignItems: "center" }}>
                          {isExpanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
                        </span>
                      </div>
                     {isExpanded && (
                        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                          <table className="si-table">
                            <thead>
                              <tr><th>Field</th><th>Type</th><th>Default</th></tr>
                            </thead>
                            <tbody>
                              {Object.entries(childFields).map(([cfName, cfDef]) => (
                                <tr key={cfName}>
                                  <td className="si-field-name">
                                    {cfName}
                                    {cfName === `${domainName}Id` && (
                                      <span style={{ fontSize: 10, background: "#E6F1FB", color: "#185FA5", borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 500 }}>FK</span>
                                    )}
                                  </td>
                                  <td><Badge label={cfDef.type} color="purple" /></td>
                                  <td className="si-mono">{JSON.stringify(cfDef.default) ?? <span className="si-muted">—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div style={{ padding: "0 12px 12px 12px" }}>
                            <AddSection label={`Add field to "${childName}"`}>
                              <FieldBuilder
                                submitLabel={`Add to ${childName}`}
                                registry={registry}
                                domainNames={domainNames}
                                parentDomainName={childName}
                                onNewDomainFromRelation={onQuickCreateDomain}
                                onSubmit={(fieldName, draft) => onAddField(childName, fieldName, draft)}
                              />
                            </AddSection>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!isJunction && (
              <div className="si-card-footer">
                <AddSection label="Domain View Configuration" icon={<TableChartOutlinedIcon sx={{ fontSize: 16 }} />}>
                  <ViewConfigForm
                    domainName={domainName} current={viewCfg} fieldNames={fieldNames}
                    onChange={(cfg) => onViewConfig(domainName, cfg)} />
                  <div className="si-view-badges">
                    {viewCfg.tableView?.enabled && <Badge label="Table View ON" color="purple" />}
                    {viewCfg.formView?.enabled  && <Badge label="Form View ON" color="teal" />}
                    {viewCfg.cardView?.enabled  && <Badge label="Card View ON" color="blue" />}
                  </div>
                </AddSection>
              </div>
            )}

{!isJunction && (
              <div className="si-card-footer">
                <AddSection label={`Add field to "${domainName}"`}>
                  <FieldBuilder
                    submitLabel={`Add to ${domainName}`}
                    registry={registry}
                    domainNames={domainNames}
                    parentDomainName={domainName}
                    onNewDomainFromRelation={onQuickCreateDomain}
                    onSubmit={(fieldName, draft) => onAddField(domainName, fieldName, draft)}
                  />
                </AddSection>
              </div>
            )}
          </div>
        );
      })}

      <div className="si-tip">
        <span>💡 Use the <strong>Create Domain</strong> tab to add a brand-new domain. Relation fields automatically generate a <strong>junction table</strong> (e.g. <code>student_subject</code>).</span>
      </div>
    </div>
  );
}

function fieldDefToDraft(fieldDef: any, schemas: AllSchemas, fullPath: string): FieldDraft {
  const uiHint  = schemas.uiHints?.[fullPath] ?? {};
  const rbac    = schemas._layers?.rbac?.fields?.[fullPath];
  const abac    = schemas._layers?.abac?.rules?.[fullPath];
  const comp    = schemas.computed[fullPath];
  const valRefs = schemas._layers?.validationRefs?.[fullPath] ?? [];

  return {
    type:           fieldDef.type ?? "string",
    default:        fieldDef.default !== undefined ? String(fieldDef.default) : "",
    computed:       !!fieldDef.computed,
    datasource:     (fieldDef as any).datasource ?? "",
    relatedDomain:  (fieldDef as any).relatedDomain ?? "",
        cardinality:    (fieldDef as any).cardinality ?? "",

    listDomain:     (fieldDef as any).listDomain     ?? "",
    validationRefs: valRefs,
    validations:    [],
    isPartOf:       true,
    exprStr:        comp?.expression ?? "",
    depsStr:        comp?.dependsOn?.join(", ") ?? "",
component:       (uiHint.component ?? "text") as ComponentType,
    labels:          { en: uiHint.label ?? "", ta: "", ar: "" },
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
    abacVisible:  typeof abac?.visible  === "string" ? abac.visible  : "",
    abacWrite:    abac?.write    !== undefined ? (abac.write    as boolean | null) : null,
    abacDisabled: abac?.disabled !== undefined ? (abac.disabled as boolean | null) : null,
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
        <AddSection label="Add UI Configuration for a field" icon={<PaletteOutlinedIcon sx={{ fontSize: 16 }} />}>
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
                      <td>{hint.color ? <span className="si-color-swatch" style={{ background: hint.color }} title={hint.color}>{hint.color}</span> : <span className="si-muted">—</span>}</td>
                      <td>{hint.backgroundColor ? <span className="si-color-swatch" style={{ background: hint.backgroundColor }} title={hint.backgroundColor}>{hint.backgroundColor}</span> : <span className="si-muted">—</span>}</td>
                      <td>{hint.fontSize   ? <Badge label={hint.fontSize}   color="blue"   /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.fontWeight ? <Badge label={hint.fontWeight} color="purple" /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.textAlign  ? <Badge label={hint.textAlign}  color="gray"   /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.width      ? <Badge label={hint.width}      color="teal"   /> : <span className="si-muted">—</span>}</td>
                      <td className="si-label-cell">{hint.tooltip ?? <span className="si-muted">—</span>}</td>
                      <td>
                        <span className="si-val-list">
                          {hint.hidden   && <Badge label="hidden"   color="gray" />}
                          {hint.readOnly && <Badge label="readOnly" color="orange" />}
                        </span>
                      </td>
                      <td>
                        {isExtra
                          ? <span className="si-source-live"><span>live</span><button className="si-remove-btn" type="button" onClick={() => onRemove(fp)}><DeleteOutlinedIcon sx={{ fontSize: 13 }} /></button></span>
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

function AddUIConfigForm({ fieldPaths, onAdd }: { fieldPaths: string[]; onAdd: (path: string, hint: FieldUIConfig) => void }) {
  const [path, setPath]               = useState("");
  const [component, setComponent]     = useState<ComponentType>("text");
  const [label, setLabel]             = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [color, setColor]             = useState("");
  const [bgColor, setBgColor]         = useState("");
  const [borderColor, setBorderColor] = useState("");
  const [fontSize, setFontSize]       = useState<FontSize | "">("");
  const [fontWeight, setFontWeight]   = useState<FontWeight | "">("");
  const [textAlign, setTextAlign]     = useState<TextAlign | "">("");
  const [width, setWidth]             = useState<FieldWidth | "">("");
  const [tooltip, setTooltip]         = useState("");
  const [hidden, setHidden]           = useState(false);
  const [readOnly, setReadOnly]       = useState(false);
  const [saved, setSaved]             = useState(false);

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
    setSaved(true); setTimeout(() => setSaved(false), 2000);
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
          <datalist id="ui-field-paths">{fieldPaths.map((p) => <option key={p} value={p} />)}</datalist>
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
      <div className="si-style-section-label"><FormatPaintOutlinedIcon sx={{ fontSize: 13 }} />Visual Styling</div>
      <div className="si-form-row">
        <label className="si-form-label">
          Text color
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={color || "#000000"} onChange={(e) => setColor(e.target.value)} />
            <input className="si-form-input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#374151" />
            {color && <button className="si-clear-btn" type="button" onClick={() => setColor("")}>×</button>}
          </div>
        </label>
        <label className="si-form-label">
          Background
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={bgColor || "#ffffff"} onChange={(e) => setBgColor(e.target.value)} />
            <input className="si-form-input" value={bgColor} onChange={(e) => setBgColor(e.target.value)} placeholder="#f8fafc" />
            {bgColor && <button className="si-clear-btn" type="button" onClick={() => setBgColor("")}>×</button>}
          </div>
        </label>
        <label className="si-form-label">
          Border color
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={borderColor || "#e2e8f0"} onChange={(e) => setBorderColor(e.target.value)} />
            <input className="si-form-input" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} placeholder="#e2e8f0" />
            {borderColor && <button className="si-clear-btn" type="button" onClick={() => setBorderColor("")}>×</button>}
          </div>
        </label>
      </div>
      <div className="si-form-row">
        <label className="si-form-label">
          Font size
          <select className="si-form-select" value={fontSize} onChange={(e) => setFontSize(e.target.value as any)}>
            <option value="">— default —</option>{FONT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Font weight
          <select className="si-form-select" value={fontWeight} onChange={(e) => setFontWeight(e.target.value as any)}>
            <option value="">— default —</option>{FONT_WEIGHTS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Text align
          <select className="si-form-select" value={textAlign} onChange={(e) => setTextAlign(e.target.value as any)}>
            <option value="">— default —</option>{TEXT_ALIGNS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Width
          <select className="si-form-select" value={width} onChange={(e) => setWidth(e.target.value as any)}>
            <option value="">— default —</option>{FIELD_WIDTHS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Tooltip
          <input className="si-form-input" value={tooltip} onChange={(e) => setTooltip(e.target.value)} placeholder="Help text shown on hover" />
        </label>
      </div>
      <div className="si-form-row">
        <label className="si-checkbox-label">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Hidden (not rendered)
        </label>
        <label className="si-checkbox-label">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />Read-only (display only)
        </label>
      </div>
      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved ? <><CheckIcon sx={{ fontSize: 15 }} /> Saved</> : <><SaveOutlinedIcon sx={{ fontSize: 15 }} /> Save UI Config</>}
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
// Shared FieldDraft
// ════════════════════════════════════════════════════════════════════════════

export interface FieldDraft {
  type:           FieldType;
  default:        string;
  computed:       boolean;
  datasource:     string;
  relatedDomain:  string;
  cardinality:    string;
  listDomain:     string;
  isPartOf:       boolean;
  validationRefs: string[];
  validations:    DraftValidation[];
  exprStr:        string;
  depsStr:        string;
  component:       ComponentType;
  labels:          Record<"en" | "ta" | "ar", string>;
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
  abacVisible:  string;
  abacWrite:    boolean | null;
  abacDisabled: boolean | null;
  rbacVisible:  string;
  rbacRead:     string;
  rbacWrite:    string;
  rbacDisabled: string;
}

const BLANK_DRAFT: FieldDraft = {
  type: "string", default: "", computed: false, datasource: "",
relatedDomain: "", listDomain: "", isPartOf: true, cardinality: "",
  validationRefs: [], validations: [], exprStr: "", depsStr: "",
  component: "text", labels: { en: "", ta: "", ar: "" }, placeholder: "",
  color: "", backgroundColor: "", borderColor: "",
  fontSize: "", fontWeight: "", textAlign: "", width: "",
  icon: "", tooltip: "", hidden: false, readOnly: false,
  abacVisible: "", abacWrite: null, abacDisabled: null,
  rbacVisible: "", rbacRead: "", rbacWrite: "", rbacDisabled: "",
};

const LANG_ORDER: Array<"en" | "ta" | "ar"> = ["en", "ta", "ar"];

/** First non-empty label, preferring English, else field name as last resort. */
function primaryLabel(labels: Record<"en" | "ta" | "ar", string>, fallback: string): string {
  for (const lang of LANG_ORDER) {
    if (labels[lang]?.trim()) return labels[lang].trim();
  }
  return fallback;
}

// ════════════════════════════════════════════════════════════════════════════
// ValidationRefPicker
// ════════════════════════════════════════════════════════════════════════════

const VAL_TYPE_GROUP: Record<string, string> = {
  required: "Presence",
  unique: "Presence",
  minLength: "Length", maxLength: "Length",
  min: "Numeric", max: "Numeric",
  pattern: "Format",
};

function ValidationRefPicker({ selected, registry, onChange }: {
  selected: string[];
  registry: Record<string, ValidationRule>;
  onChange: (tags: string[]) => void;
}) {
const groups: Record<string, Array<[string, ValidationRule]>> = {};
  const mergedRegistry = { unique: { type: "required", message: "Value must be unique" } as ValidationRule, ...registry };
  for (const [tag, rule] of Object.entries(mergedRegistry)) {
    const g = VAL_TYPE_GROUP[rule.type] ?? "Other";
    if (!groups[g]) groups[g] = [];
    groups[g].push([tag, rule]);
  }

  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  if (Object.keys(registry).length === 0) {
    return <div className="si-ref-picker-empty">No validation rules in registry yet — use Inline Validations below.</div>;
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
                  <button key={tag} type="button"
                    className={`si-ref-chip${active ? " si-ref-chip--active" : ""}`}
                    onClick={() => toggle(tag)} title={rule.message}>
                    {active && <CheckIcon sx={{ fontSize: 11 }} />}{tag}
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

// ════════════════════════════════════════════════════════════════════════════
// Mini Relation Modal
// ════════════════════════════════════════════════════════════════════════════

interface MiniField { name: string; type: FieldType }

interface MiniRelationModalProps {
  open:           boolean;
  mode:           "create" | "junction";
  domainName:     string;
  parentDomainName: string;
  onClose:        () => void;
  onConfirmCreate: (fields: MiniField[], isParentChild: boolean) => void;
  onConfirmJunction: (isParentChild: boolean) => void;}



function MiniRelationModal({
  open, mode, domainName, parentDomainName, onClose, onConfirmCreate, onConfirmJunction,
}: MiniRelationModalProps) {
const [fields,       setFields]       = useState<MiniField[]>([]);
  const [fieldName,    setFieldName]    = useState("");
  const [fieldType,    setFieldType]    = useState<FieldType>("string");
const [isParentChild, setIsParentChild] = useState(false);

  const validFieldName = /^[a-z][a-zA-Z0-9_]*$/.test(fieldName);
  const junctionName   = `${parentDomainName}_${domainName}`;
  const parentIdField  = `${parentDomainName}Id`;
  const relatedIdField = `${domainName}Id`;

  const MINI_FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "date"];
  const TYPE_COLOR: Record<string, string> = {
    string: "purple", number: "blue", boolean: "teal", date: "orange",
  };

  function addField() {
    if (!fieldName.trim() || !validFieldName) return;
    setFields((prev) => [...prev, { name: fieldName.trim(), type: fieldType }]);
    setFieldName("");
    setFieldType("string");
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, j) => j !== i));
  }

  function handleClose() {
    setFields([]); setFieldName(""); setFieldType("string");
    onClose();
  }

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="ldm-overlay" onClick={handleClose}>
      <div className="ldm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ldm-header">
          {mode === "create"
            ? <StorageIcon sx={{ fontSize: 16 }} />
            : <LinkOutlinedIcon sx={{ fontSize: 16 }} />}
          <span>
            {mode === "create"
              ? `Create "${domainName}" domain`
              : "Create junction table"}
          </span>
          <button className="ldm-close" type="button" onClick={handleClose}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        </div>

        {mode === "create" ? (
          <>
            <div className="ldm-body">
              {/* Info banner */}
              <div style={{
                display:"flex", alignItems:"center", gap:8,
                padding:"8px 12px", marginBottom:14,
                background:"var(--color-background-info)",
                borderRadius:"var(--border-radius-md)",
                fontSize:12, color:"var(--color-text-info)",
              }}>
                <StorageIcon sx={{ fontSize: 14 }} />
                Creating domain <strong>{domainName}</strong>
                <span style={{ opacity:0.7 }}>—&nbsp;
                  <code>{parentIdField}</code> will be added to <strong>{domainName}</strong> automatically
                </span>
              </div>

{/* Relationship type checkbox */}
              <label style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", marginBottom: 14,
                background: "var(--color-background-secondary)",
                border: "1px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)",
                cursor: "pointer", fontSize: 13,
              }}>
                <input
                  type="checkbox"
                  checked={isParentChild}
                  onChange={(e) => setIsParentChild(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "#16a34a", cursor: "pointer" }}
                />
                <span>
                  Add <code style={{ background: "#dcfce7", padding: "1px 5px", borderRadius: 3 }}>
                    {parentIdField}
                  </code> to <strong>{domainName}</strong> (Parent → Child)
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginTop: 2 }}>
                    Uncheck to create a junction table instead
                  </span>
                </span>
              </label>

              {/* Existing fields */}
              {fields.length > 0 && (
                <div style={{ marginBottom:12, display:"flex", flexDirection:"column", gap:6 }}>
                  {fields.map((f, i) => (
                    <div key={i} style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"6px 10px",
                      background:"var(--color-background-secondary)",
                      borderRadius:"var(--border-radius-md)",
                      border:"1px solid var(--color-border-secondary)",
                    }}>
                      <span className="si-badge si-badge--purple">{f.name}</span>
                      <span className={`si-badge si-badge--${TYPE_COLOR[f.type] ?? "gray"}`}>{f.type}</span>
                      <button type="button" onClick={() => removeField(i)}
                        style={{ marginLeft:"auto", background:"none", border:"none",
                          cursor:"pointer", color:"var(--color-text-danger)",
                          display:"flex", alignItems:"center" }}>
                        <DeleteOutlinedIcon sx={{ fontSize: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add field row */}
              <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
                <label className="si-form-label" style={{ flex:2, marginBottom:0 }}>
                  Field name
                  <input
                    className={`si-form-input ${fieldName && !validFieldName ? "si-form-input--error" : ""}`}
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addField(); }}
                    placeholder="e.g. branchName"
                    autoFocus
                  />
                </label>
                <label className="si-form-label" style={{ flex:1, marginBottom:0 }}>
                  Type
                  <select className="si-form-select" value={fieldType}
                    onChange={(e) => setFieldType(e.target.value as FieldType)}>
                    {MINI_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <button type="button" className="si-btn-add" onClick={addField}
                  disabled={!fieldName.trim() || !validFieldName}
                  style={{ marginBottom:1 }}>
                  <AddIcon sx={{ fontSize: 14 }} />Add
                </button>
              </div>
              {fieldName && !validFieldName && (
                <span className="si-inline-error">camelCase starting with a lowercase letter</span>
              )}

              <p style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:12, marginBottom:0, opacity:0.7 }}>
                💡 You can skip and add more fields later from the Domain Model tab.
              </p>
            </div>

            <div className="ldm-footer ldm-footer--gap">
              <button type="button" className="btn btn-primary"
                                onClick={() => { onConfirmCreate(fields, isParentChild); handleClose(); }}>

                <CheckIcon sx={{ fontSize: 15 }} />
                {fields.length > 0
                  ? `Create "${domainName}" with ${fields.length} field(s)`
                  : `Skip & Create "${domainName}"`}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
         <>
            <div className="ldm-body">

              {/* Relationship type toggle */}
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
                <label style={{
                  display:"flex", alignItems:"flex-start", gap:10,
                  padding:"10px 14px",
                  background: isParentChild ? "#f0fdf4" : "var(--color-background-secondary)",
                  border: isParentChild ? "1.5px solid #86efac" : "1.5px solid var(--color-border-secondary)",
                  borderRadius:"var(--border-radius-md)",
                  cursor:"pointer",
                }}>
                  <input type="radio" checked={isParentChild} onChange={() => setIsParentChild(true)}
                    style={{ marginTop:2, accentColor:"#16a34a" }} />
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:"#15803d" }}>
                      Parent → Child (one-to-many)
                    </div>
                    <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:2 }}>
                      Adds <code style={{ background:"#dcfce7", padding:"1px 5px", borderRadius:3 }}>{parentIdField}</code> as FK into <strong>{domainName}</strong> table
                    </div>
                  </div>
                </label>

                <label style={{
                  display:"flex", alignItems:"flex-start", gap:10,
                  padding:"10px 14px",
                  background: !isParentChild ? "#eef2ff" : "var(--color-background-secondary)",
                  border: !isParentChild ? "1.5px solid #a5b4fc" : "1.5px solid var(--color-border-secondary)",
                  borderRadius:"var(--border-radius-md)",
                  cursor:"pointer",
                }}>
                  <input type="radio" checked={!isParentChild} onChange={() => setIsParentChild(false)}
                    style={{ marginTop:2, accentColor:"#4f46e5" }} />
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:"#3730a3" }}>
                      Many-to-Many (junction table)
                    </div>
                    <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:2 }}>
                      Creates <code style={{ background:"#e0e7ff", padding:"1px 5px", borderRadius:3 }}>{junctionName}</code> table with <code>{parentIdField}</code> + <code>{relatedIdField}</code>
                    </div>
                  </div>
                </label>
              </div>

              {/* Preview */}
              {isParentChild ? (
                <div style={{ fontSize:12, color:"var(--color-text-secondary)", padding:"8px 12px", background:"#f0fdf4", borderRadius:"var(--border-radius-md)", border:"1px solid #86efac" }}>
                  <div style={{ fontWeight:600, marginBottom:6, color:"#15803d" }}>What will happen:</div>
                  <div>→ <strong>{domainName}</strong> table gets a new column <code style={{ background:"#dcfce7", padding:"1px 4px", borderRadius:3 }}>{parentIdField}</code> (string FK)</div>
                  <div style={{ marginTop:4, opacity:0.7 }}>e.g. school → department: <code>department.schoolId</code></div>
                </div>
              ) : (
                <div style={{ fontSize:12, color:"var(--color-text-secondary)", padding:"8px 12px", background:"#eef2ff", borderRadius:"var(--border-radius-md)", border:"1px solid #a5b4fc" }}>
                  <div style={{ fontWeight:600, marginBottom:6, color:"#3730a3" }}>What will happen:</div>
                  <div>→ New table <code style={{ background:"#e0e7ff", padding:"1px 4px", borderRadius:3 }}>{junctionName}</code> created with:</div>
                  <div style={{ marginLeft:12, marginTop:4 }}>• <code>{parentIdField}</code> — references {parentDomainName}</div>
                  <div style={{ marginLeft:12 }}>• <code>{relatedIdField}</code> — references {domainName}</div>
                  <div style={{ marginTop:4, opacity:0.7 }}>e.g. student ↔ subject: <code>student_subject</code></div>
                </div>
              )}
            </div>

            <div className="ldm-footer ldm-footer--gap">
              <button type="button" className="btn btn-primary"
                onClick={() => {
                  onConfirmJunction(isParentChild);
                  handleClose();
                }}>
                <CheckIcon sx={{ fontSize: 15 }} />
                {isParentChild ? `Add "${parentIdField}" to ${domainName}` : `Create "${junctionName}" table`}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
interface FieldBuilderProps {
  submitLabel:    string;
  initialName?:   string;
  initialDraft?:  FieldDraft;
  onSubmit:       (name: string, draft: FieldDraft) => void;
  onCancel?:      () => void;
  showAllLayers?: boolean;
  /** Show just the language-aware Label input, even when showAllLayers is false */
  showLabelOnly?: boolean;
  registry?:      Record<string, ValidationRule>;
  domainNames?:   string[];
  parentDomainName?: string;
  onNewDomainFromRelation?: (name: string, fields: QuickCreateField[]) => void;
}

function FieldBuilder({
  submitLabel, initialName = "", initialDraft, onSubmit, onCancel,
  showAllLayers = true, showLabelOnly = false, registry = {}, domainNames = [],
  parentDomainName = "", onNewDomainFromRelation,
}: FieldBuilderProps) {
const [fieldName, setFieldName] = useState(initialName);
  const [enFieldName, setEnFieldName] = useState(initialName);
  const [draft,     setDraft]     = useState<FieldDraft>(initialDraft ? { ...initialDraft } : { ...BLANK_DRAFT });
  const [draftVal,  setDraftVal]  = useState<DraftValidation>({ type: "required", value: "", message: "" });
  const [modalOpen, setModalOpen] = useState(false);
  const [labelLang, setLabelLang] = useState<"en" | "ta" | "ar">("en");
  const isPartOfRef = useRef<boolean>(true);
  const [miniModalOpen, setMiniModalOpen] = useState(false);



  function set<K extends keyof FieldDraft>(key: K, val: FieldDraft[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function setLabelForLang(lang: "en" | "ta" | "ar", value: string) {
    setDraft((d) => ({ ...d, labels: { ...d.labels, [lang]: value } }));
  }

  function addValidation() {
    if (!draftVal.message.trim()) return;
    set("validations", [...draft.validations, { ...draftVal }]);
    setDraftVal({ type: "required", value: "", message: "" });
  }

  function resolveRelatedDomain(raw: string): string {
    if (!raw.startsWith("__new__:")) return raw;
    const colonIdx   = raw.indexOf(":", 7);
    const domainName = raw.slice(7, colonIdx);
    const fieldsJson = raw.slice(colonIdx + 1);
    try {
      const fields = JSON.parse(fieldsJson) as QuickCreateField[];
      onNewDomainFromRelation?.(domainName, fields);
    } catch { /* ignore */ }
    return domainName;
  }

  function submit() {
    if (!fieldName.trim()) return;
    console.log("SUBMIT isPartOfRef:", isPartOfRef.current, "draft.isPartOf:", draft.isPartOf);

    let finalDraft = { ...draft, isPartOf: isPartOfRef.current };
    // Ensure whatever's currently typed is committed to its language slot
    // (covers the case where the user never switched dropdowns and typed straight into EN).
    if (showLabelOnly) {
      finalDraft = { ...finalDraft, labels: { ...finalDraft.labels, [labelLang]: fieldName } };
    }

    // The technical key is always the EN slot — falls back to whatever's in the box
    // if EN was never explicitly filled (covers showAllLayers mode, where this box is plain).
const technicalName = showLabelOnly ? (enFieldName || finalDraft.labels.en || fieldName).trim() : fieldName.trim();
    if (!technicalName) return; // EN (technical key) is mandatory when language-aware

if (draft.type === "relation" && draft.relatedDomain) {
      finalDraft = { ...finalDraft, relatedDomain: resolveRelatedDomain(draft.relatedDomain), isPartOf: isPartOfRef.current };
    }
    console.log("ONSUBMIT finalDraft.isPartOf:", finalDraft.isPartOf);
    onSubmit(technicalName, finalDraft);
if (!initialName) { 
  setFieldName(""); 
  setEnFieldName(""); 
  setLabelLang("en"); 
  setDraft({ ...BLANK_DRAFT }); 
  setMiniModalOpen(false);
}  }

  return (
    <div className="si-field-builder">
      {/* Layer 1 */}
      <div className="si-layer-section si-layer-section--domain">
        <div className="si-layer-section-label">Layer 1 — Domain Model</div>
        <div className="si-form-row">
          <label className="si-form-label">
            Field name (EN) *
            <input
              className="si-form-input"
              value={fieldName}
              onChange={(e) => {
                setFieldName(e.target.value);
                setEnFieldName(e.target.value);
                if (showLabelOnly) setLabelForLang("en", e.target.value);
              }}
              placeholder="e.g. name"
            />
          </label>
        
           <label className="si-form-label">
            Type
           <select
              className="si-form-select"
              value={draft.type}
              onChange={(e) => {
                const selectedType = e.target.value as FieldType;
                set("type", selectedType);
                if (selectedType !== "relation") {
                  set("relatedDomain", "");
                  set("listDomain", "");
                }
                if (selectedType === "relation") {
                  if (fieldName.trim()) {
                    set("relatedDomain", fieldName.trim());
                  }
                }
              }}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="si-form-label">
              Cardinality
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 10px", border: "1px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", background: "var(--color-background-primary)" }}>
                <input
                  type="checkbox"
                  checked={draft.cardinality === "list"}
                  onChange={(e) => set("cardinality", e.target.checked ? "list" : "")}
                  style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#6366f1", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>List</span>
              </label>
            </label>

          {draft.type === "relation" && draft.relatedDomain && (
            <div style={{ display:"flex", alignItems:"flex-end", gap:6 }}>
              {domainNames.includes(draft.relatedDomain) ? (
                <button type="button" className="btn btn-primary" onClick={() => setMiniModalOpen(true)}
                  style={{ whiteSpace:"nowrap", fontSize:12 }}>
                  <LinkOutlinedIcon sx={{ fontSize: 13 }} />
                  Create junction table
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => setMiniModalOpen(true)}
                  style={{ whiteSpace:"nowrap", fontSize:12 }}>
                  <AddIcon sx={{ fontSize: 13 }} />
                  Create {draft.relatedDomain} domain
                </button>
              )}
              <button type="button"
                onClick={() => { set("relatedDomain",""); set("listDomain",""); set("type","string"); }}
                style={{ fontSize:13, color:"#9ca3af", background:"none", border:"none",
                  cursor:"pointer", lineHeight:1, padding:"0 4px" }}>
                ×
              </button>
            </div>
          )}
         
         
        </div>

        

        

       

    
        <div className="si-val-builder">
          <div className="si-val-section-header">
            <CheckCircleOutlinedIcon sx={{ fontSize: 14 }} />
            <span className="si-form-sublabel">Validation Rules</span>
          </div>
          <div className="si-val-subsection">
            <div className="si-val-subsection-label">Registry rules <span className="si-hint">click to attach named rules</span></div>
            <ValidationRefPicker selected={draft.validationRefs} registry={registry} onChange={(tags) => set("validationRefs", tags)} />
          </div>
          
        </div>
      </div>

    

      <div className="si-form-actions si-form-actions--gap">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!fieldName.trim()}>
          <AddCircleOutlinedIcon sx={{ fontSize: 16 }} />{submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>
        )}
      </div>
<MiniRelationModal
        open={miniModalOpen}
        mode={domainNames.includes(draft.relatedDomain) ? "junction" : "create"}
        domainName={draft.relatedDomain}
        parentDomainName={parentDomainName}
        onClose={() => setMiniModalOpen(false)}
       onConfirmCreate={(miniFields, isParentChild) => {
          onNewDomainFromRelation?.(draft.relatedDomain, miniFields);
          isPartOfRef.current = isParentChild;
          const finalDraft: FieldDraft = {
            ...draft,
            isPartOf: isParentChild,
            relatedDomain: draft.relatedDomain,
          };
          if (fieldName.trim()) {
            onSubmit(fieldName.trim(), finalDraft);
          }
          setMiniModalOpen(false);
          if (!initialName) {
            setFieldName("");
            setEnFieldName("");
            setDraft({ ...BLANK_DRAFT });
          }
        }}
        onConfirmJunction={(isParentChild) => {
          isPartOfRef.current = isParentChild;
          set("isPartOf", isParentChild);
          setMiniModalOpen(false);
          if (!initialName) {
            setFieldName("");
            setEnFieldName("");
            setDraft({ ...BLANK_DRAFT });
          }
        }}
      />
      <LinkDomainModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        domainNames={domainNames}
        parentDomainName={parentDomainName}
        initialDomainName={fieldName.trim()}
        onConfirm={(result) => {
          isPartOfRef.current = result.isPartOf;
          set("type", "relation");               // ✅ set type to relation
          set("relatedDomain", result.domainName);
          set("listDomain", "");
          set("isPartOf", result.isPartOf);
          console.log("onConfirm isPartOf:", result.isPartOf);
        }}
        onCreateDomain={(name, fields) => {
          onNewDomainFromRelation?.(name, fields);
        }}
      />
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
    relatedDomain:  draft.type === "relation" && draft.relatedDomain ? draft.relatedDomain : undefined,
    listDomain:     draft.type === "list"     && draft.listDomain     ? draft.listDomain     : undefined,
    validationRefs: refs.length ? refs : undefined,
    validations:    vRules.length ? vRules : undefined,
    cardinality:    draft.cardinality || undefined,
    computedExpr:   draft.exprStr ? {
      expression: draft.exprStr,
      dependsOn:  draft.depsStr.split(",").map((s) => s.trim()).filter(Boolean),
    } : undefined,
  };
}

function draftToUIHint(draft: FieldDraft): FieldUIConfig {
  const hint: FieldUIConfig = {};
  if (draft.component)       hint.component       = draft.component;
  const __label = primaryLabel(draft.labels, "");
  if (__label)                hint.label           = __label;
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
  if (draft.abacVisible)          rule.visible  = draft.abacVisible;
  if (draft.abacWrite    !== null) rule.write    = draft.abacWrite;
  if (draft.abacDisabled !== null) rule.disabled = draft.abacDisabled;
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
// Tab: Create Domain
// ════════════════════════════════════════════════════════════════════════════

interface CreateDomainTabProps {
  onAdd:      (payload: CreateDomainPayload) => void;
  registry?:  Record<string, ValidationRule>;
  domainNames?: string[];
  onQuickCreateDomain?: (name: string, fields: QuickCreateField[]) => void;
  schemas?: AllSchemas;
}
export interface CreateDomainPayload {
  domain:    DomainDefinition;
  uiHints:   Record<string, FieldUIConfig>;
  rbacRules: Record<string, RBACFieldRule>;
  abacRules: Record<string, ABACFieldRule>;
  dbBackend: "postgresql" | "dynamodb";
  versioned: boolean;
  /** Junction domains auto-created from relation fields */
  junctionDomains?: DomainDefinition[];
  /** Related domains auto-created with copied parent fields (only when new) */
  relatedDomains?:  DomainDefinition[];
  /** Per-field, per-language labels — keyed by field name (not full path) */
  fieldLabels?: Record<string, Record<"en" | "ta" | "ar", string>>;
}
function CreateDomainTab({ onAdd, registry = {}, domainNames = [], onQuickCreateDomain, schemas }: CreateDomainTabProps) {
  const [domainName, setDomainName] = useState("");
  const [dbBackend,  setDbBackend]  = useState<"postgresql" | "dynamodb">("postgresql");
  const [fields,     setFields]     = useState<Record<string, FieldDraft>>({});
  const [generated,  setGenerated]  = useState(false);
 const [versioned, setVersioned] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({});


  type Status = { state: "idle" | "loading" | "ok" | "err"; msg: string };
  const [status, setStatus] = useState<Status>({ state: "idle", msg: "" });

  const validName = /^[a-z][a-zA-Z0-9]*$/.test(domainName);
  const hasFields = Object.keys(fields).length > 0;
  const canCreate = validName && hasFields && status.state !== "loading";

  // Compute which junction domains will be created (from relation fields)
  const pendingJunctions: Array<{ parent: string; related: string; junctionName: string }> = useMemo(() => {
    if (!validName) return [];
    return Object.entries(fields)
      .filter(([, d]) => d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:"))
      .map(([, d]) => {
        const related = d.relatedDomain;
        return { parent: domainName, related, junctionName: `${domainName}_${related}` };
      });
  }, [fields, domainName, validName]);

function handleAddField(name: string, draft: FieldDraft) {
    setFields((p) => ({ ...p, [name]: draft }));
    if (draft.type === "relation" && draft.relatedDomain) {
      setExpandedFields((prev) => ({ ...prev, [name]: true }));
    }
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
    const rbacRules: Record<string, RBACFieldRule>      = {};
    const abacRules: Record<string, ABACFieldRule>      = {};
    for (const [n, d] of Object.entries(fields)) {
      domainFields[n] = draftToDomainFieldCore(d);
      const fp = `${domainName}.${n}`;

      const hint = draftToUIHint(d);
      // draftToUIHint already picks primaryLabel() internally for hint.label
      uiHints[fp] = Object.keys(hint).length ? hint : { label: primaryLabel(d.labels, n) };

      const rbac = draftToRBACRule(d);
      if (rbac) rbacRules[fp] = rbac;

      const abac = draftToABACRule(d);
      if (abac) abacRules[fp] = abac;
    }
   if (versioned) {
  domainFields["isActive"]  = { type: "boolean", default: "true" };
  domainFields["fromDate"]  = { type: "date" };
  domainFields["toDate"]    = { type: "date" };
  domainFields["versionOf"] = { type: "string" };
  uiHints[`${domainName}.isActive`]  = { label: "Active Version" };
  uiHints[`${domainName}.fromDate`]  = { label: "Valid From" };
  uiHints[`${domainName}.toDate`]    = { label: "Valid To" };
  uiHints[`${domainName}.versionOf`] = { label: "Version Of", hidden: true };
}

    // Build junction domain definitions
    const junctionDomains: DomainDefinition[] = [];
    const relatedDomains:  DomainDefinition[] = [];
for (const [, d] of Object.entries(fields)) {
      if (d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:")) {
        const parentIdField = `${domainName}Id`;
        const existingFieldCount = Object.keys(
          schemas?.domains?.[d.relatedDomain]?.fields ?? {}
        ).length;
        const relatedAlreadyExists = domainNames.includes(d.relatedDomain) && existingFieldCount > 0;

        if (!relatedAlreadyExists) {
          const rd: DomainDefinition = {
            name:   d.relatedDomain,
            fields: { [parentIdField]: { type: "string" } },
          };
          if (!relatedDomains.find((r) => r.name === rd.name)) {
            relatedDomains.push(rd);
          }
        }
      }
    }

const fieldLabels: Record<string, Record<"en" | "ta" | "ar", string>> = {};
    for (const [n, d] of Object.entries(fields)) fieldLabels[n] = d.labels;

return { domain: { name: domainName, fields: domainFields }, uiHints, rbacRules, abacRules, dbBackend, versioned, junctionDomains: [], relatedDomains, fieldLabels };
  }

  async function createDomain() {
    if (!canCreate) return;
    setStatus({ state: "loading", msg: "Creating tables in database..." });

    const payload = buildPayload();
    const messages: string[] = [];

    // 1. Create main domain table
const req = domainToBackendRequest({
      domainName: payload.domain.name,
      fields:     payload.domain.fields as any,
      uiHints:    payload.uiHints    as any,
      rbacRules:  payload.rbacRules  as any,
      abacRules:  payload.abacRules  as any,
      db_backend: dbBackend,
      versioned:  payload.versioned,
    } as any);

    try {
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action  = res.table_created ? "created" : "already existed";
        const loc     = dbLocation(res);
        messages.push(`✅ "${res.table_name}" ${action} in ${loc}`);
      } else {
        messages.push(`❌ Main table error: ${res.message}`);
      }
    } catch (err: any) {
      messages.push(`⚠️ Main table backend unreachable: ${err?.message ?? String(err)}`);
    }

    // 2. Create each related domain (new only — existing domains are untouched)
    for (const rd of payload.relatedDomains ?? []) {
      const rdReq = domainToBackendRequest({
        domainName: rd.name,
        fields:     rd.fields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: dbBackend,
      });
      try {
        const rdRes = await apiCreateDomain(rdReq);
        if (rdRes.status === "success") {
          const action = rdRes.table_created ? "created" : "already existed";
          messages.push(`✅ Related domain "${rd.name}" ${action} (fields copied from ${domainName})`);
        } else {
          messages.push(`❌ Related domain "${rd.name}" error: ${rdRes.message}`);
        }
      } catch (err: any) {
        messages.push(`⚠️ Related domain "${rd.name}" unreachable: ${err?.message ?? String(err)}`);
      }
    }

    // 3. Create each junction domain table
// 3. Create each junction domain table
    for (const jd of payload.junctionDomains ?? []) {
      const jReq = domainToBackendRequest({
        domainName: jd.name,
        fields:     jd.fields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: dbBackend,
      });
      try {
        const jRes = await apiCreateDomain(jReq);
        if (jRes.status === "success") {
          const action = jRes.table_created ? "created" : "already existed";
          messages.push(`✅ Junction table "${jd.name}" ${action}`);
        } else {
          messages.push(`❌ Junction "${jd.name}" error: ${jRes.message}`);
        }
      } catch (err: any) {
        messages.push(`⚠️ Junction "${jd.name}" backend unreachable: ${err?.message ?? String(err)}`);
      }
    }

// ✅ Always add parentId column to child table for relation fields
    for (const [, d] of Object.entries(fields)) {
      if (d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:")) {
        const parentIdField = `${domainName}Id`;
        try {
          const childExistingFields: Record<string, DomainFieldCore> = {
            ...(schemas?.domains?.[d.relatedDomain]?.fields ?? {}),
            [parentIdField]: { type: "string" },
          };
          const req = domainToBackendRequest({
            domainName:  d.relatedDomain,
            fields:      childExistingFields as any,
            uiHints:     {},
            rbacRules:   {},
            abacRules:   {},
            db_backend:  dbBackend,
          });
          const res = await apiCreateDomain(req);
          if (res.status === "success") {
            const action = res.table_created ? "created" : "column added";
            messages.push(`✅ "${parentIdField}" added to child table "${d.relatedDomain}" — ${action}`);
          } else {
            messages.push(`⚠️ "${parentIdField}" to "${d.relatedDomain}": ${res.message}`);
          }
        } catch (err: any) {
          messages.push(`⚠️ Could not add "${parentIdField}" to "${d.relatedDomain}": ${err?.message}`);
        }
      }
    }

    onAdd(payload);
    const hasErr = messages.some((m) => m.startsWith("❌") || m.startsWith("⚠️"));
    setStatus({
      state: hasErr ? "err" : "ok",
      msg: messages.join(" · "),
    });
  }

  const codeGenFields: Record<string, DomainFieldCore> = {};
  for (const [n, d] of Object.entries(fields)) { codeGenFields[n] = draftToDomainFieldCore(d); }

  return (
    <div className="si-add-panel">
      <div className="si-card-header">
        <AddCircleOutlinedIcon sx={{ fontSize: 18, color: "#6366f1" }} />
        <span className="si-domain-name">Create new domain</span>
        <span className="si-field-count">Defines the Domain Model (Layer 1) and creates a table in the configured database</span>
      </div>

      <div className="si-add-form">
        {/* Step 1 */}
        <div className="si-step">
          <div className="si-step-label">Step 1 — Domain name &amp; storage</div>
          <div className="si-form-row">
            <label className="si-form-label" style={{ maxWidth: 280 }}>
              camelCase, e.g. <code>product</code>
              <input
                className={`si-form-input ${domainName && !validName ? "si-form-input--error" : ""}`}
                value={domainName}
                onChange={(e) => { setDomainName(e.target.value); setStatus({ state: "idle", msg: "" }); setGenerated(false); }}
                placeholder="product" />
            </label>
            {domainName && !validName && <span className="si-inline-error">Use camelCase starting with a lowercase letter</span>}
          </div>
          <div className="si-form-sublabel" style={{ marginBottom: 8 }}>Select database backend</div>
          <div className="si-db-selector">
            <label className={`si-db-option ${dbBackend === "postgresql" ? "si-db-option--active" : ""}`}>
              <input type="radio" name="dbBackend" value="postgresql" checked={dbBackend === "postgresql"} onChange={() => setDbBackend("postgresql")} />
              <StorageIcon sx={{ fontSize: 18, color: dbBackend === "postgresql" ? "#0f766e" : "#6b7280" }} />
              <span className="si-db-option-text"><strong>PostgreSQL</strong><span className="si-hint">Relational, fast queries</span></span>
            </label>
            <label className={`si-db-option ${dbBackend === "dynamodb" ? "si-db-option--active" : ""}`}>
              <input type="radio" name="dbBackend" value="dynamodb" checked={dbBackend === "dynamodb"} onChange={() => setDbBackend("dynamodb")} />
              <StorageIcon sx={{ fontSize: 18, color: dbBackend === "dynamodb" ? "#c2410c" : "#6b7280" }} />
              <span className="si-db-option-text"><strong>DynamoDB</strong><span className="si-hint">AWS NoSQL, auto-scale</span></span>
            </label>
            <label className={`si-db-option ${versioned ? "si-db-option--active" : ""}`}>
              <input type="checkbox" checked={versioned} onChange={(e) => setVersioned(e.target.checked)} />
              <CheckCircleOutlinedIcon sx={{ fontSize: 18, color: versioned ? "#0f766e" : "#6b7280" }} />
              <span className="si-db-option-text">
                <strong>Enable Versioning</strong>
                
              </span>
            </label>
          </div>
        </div>

        {/* Step 2 */}
        <div className="si-step">
          <div className="si-step-label">Step 2 — Add fields</div>


        {/* Field preview */}
        {hasFields && (
          <div className="si-field-list">
            <div className="si-form-sublabel">Fields added ({Object.keys(fields).length})</div>
            <div className="si-card">
              <table className="si-table">
                <thead>
                  <tr><th>Field</th><th>Type</th><th>Related Domain</th><th>Default</th><th>Datasource</th><th>Computed</th><th>Val Refs</th><th></th></tr>
                </thead>
                <tbody>
                  {Object.entries(fields).map(([name, d]) => {
                    const isRelation = d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:");
                    const parentIdField = `${domainName}Id`;
                    return (
                      <React.Fragment key={name}>
                        <tr>
                          <td className="si-field-name">
                           {isRelation && (
                              <button
                                type="button"
                                onClick={() => setExpandedFields(prev => ({ ...prev, [name]: !prev[name] }))}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px 0 0", color: "#6366f1", display: "inline-flex", alignItems: "center" }}
                              >
                                {expandedFields[name]
                                  ? <ExpandLessIcon sx={{ fontSize: 14 }} />
                                  : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                              </button>
                            )}
                            {name}
                          </td>
                          <td>
                            {d.type === "relation" ? <Badge label="relation" color="indigo" />
                              : d.type === "list" ? <Badge label="list" color="green" />
                              : <Badge label={d.type} color="purple" />}
                          </td>
                          <td>
                            {d.relatedDomain ? (
                              <span className="si-relation-cell">
                                <LinkOutlinedIcon sx={{ fontSize: 11 }} />
                                <Badge label={d.relatedDomain.startsWith("__new__:") ? d.relatedDomain.split(":")[1] + " (pending)" : d.relatedDomain} color="indigo" />
                              </span>
                            ) : d.listDomain ? (
                              <span className="si-list-cell">
                                <LinkOutlinedIcon sx={{ fontSize: 11 }} />
                                <Badge label={d.listDomain} color="green" />
                                <span className="si-list-many-tag">[ ] many</span>
                              </span>
                            ) : <span className="si-muted">—</span>}
                          </td>
                          <td>{d.default ? <code style={{ fontSize: 11 }}>{d.default}</code> : <span className="si-muted">—</span>}</td>
                          <td>{d.datasource ? <Badge label={d.datasource} color="blue" /> : <span className="si-muted">—</span>}</td>
                          <td>{d.computed ? <Badge label="yes" color="teal" /> : <span className="si-muted">—</span>}</td>
                          <td>{d.validationRefs.length > 0
                            ? <span className="si-val-list">{d.validationRefs.map((t) => <span key={t} className="si-val-ref"><LabelIcon sx={{ fontSize: 10 }} />{t}</span>)}</span>
                            : <span className="si-muted">—</span>}</td>
                          <td>
                            <button className="si-remove-btn" type="button" onClick={() => removeField(name)}>
                              <DeleteOutlinedIcon sx={{ fontSize: 14 }} />Remove
                            </button>
                          </td>
                        </tr>

                        {/* ── Child domain tree row ── */}
                        
                        {isRelation && expandedFields[name] && (
                          <tr>
                            <td colSpan={8} style={{ padding: "0 0 0 24px", background: "var(--color-background-secondary)" }}>
                              <div style={{
                                margin: "8px 12px 8px 0",
                                border: "1px solid #c7d2fe",
                                borderRadius: "var(--border-radius-md)",
                                overflow: "hidden",
                                background: "var(--color-background-primary)",
                              }}>
                                {/* Child domain header */}
                                <div style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  padding: "8px 12px",
                                  background: "#eef2ff",
                                  borderBottom: "1px solid #c7d2fe",
                                }}>
                                  <StorageIcon sx={{ fontSize: 14, color: "#4f46e5" }} />
                                  <span style={{ fontSize: 13, fontWeight: 600, color: "#3730a3" }}>
                                    {d.relatedDomain}
                                  </span>
                                  <span style={{
                                    fontSize: 11, background: "#e0e7ff", color: "#3730a3",
                                    borderRadius: 20, padding: "1px 8px", fontWeight: 500,
                                  }}>
                                    child domain
                                  </span>
                                  <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>
                                    will be created with FK column
                                  </span>
                                </div>

                                {/* Child domain fields */}
                                <table className="si-table" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>Field</th>
                                      <th>Type</th>
                                      <th>Note</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {/* Auto FK field */}
                                    <tr style={{ background: "#f5f3ff" }}>
                                      <td className="si-field-name" style={{ color: "#4f46e5" }}>
                                        {parentIdField}
                                        <span style={{
                                          fontSize: 10, background: "#e0e7ff", color: "#3730a3",
                                          borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 600,
                                        }}>FK</span>
                                      </td>
                                      <td><Badge label="string" color="purple" /></td>
                                      <td style={{ fontSize: 11, color: "#6366f1" }}>
                                        Auto-added → references <strong>{domainName}</strong>
                                      </td>
                                    </tr>
                                    {/* Existing child fields if domain already exists */}
                                    {Object.entries(schemas?.domains?.[d.relatedDomain]?.fields ?? {}).map(([cf, cfd]) => (
                                      <tr key={cf}>
                                        <td className="si-field-name">{cf}</td>
                                        <td><Badge label={(cfd as any).type} color="purple" /></td>
                                        <td style={{ fontSize: 11, color: "#6b7280" }}>existing field</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            
          </div>
        )}
<FieldBuilder
            submitLabel="Add field" onSubmit={handleAddField} showAllLayers={false} showLabelOnly
            registry={registry} domainNames={domainNames} parentDomainName={domainName}
            onNewDomainFromRelation={onQuickCreateDomain} />
        </div>
        {/* Step 3 */}
        <div className="si-step">
          
         
          <div className="si-form-actions si-form-actions--gap">
            <button className="btn btn-create-domain" type="button" onClick={createDomain} disabled={!canCreate}>
              {status.state === "loading"
                ? <><span className="si-spinner" />Creating tables...</>
                : status.state === "ok"
                  ? <><CheckIcon sx={{ fontSize: 16 }} />Domains Created</>
                  : <><CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />Create Domain</>}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setGenerated(true)} disabled={!validName || !hasFields}>
              <CodeIcon sx={{ fontSize: 16 }} />Generate Files
            </button>
          </div>
          {status.state === "ok"  && <div className="si-backend-notice si-backend-notice--ok">{status.msg}</div>}
          {status.state === "err" && <div className="si-backend-notice si-backend-notice--err">{status.msg}</div>}
        </div>

        {/* Generated output */}
        {generated && hasFields && (
          <div className="si-generated-layers">
            <div className="si-generated-header">Generated — Domain Model (Layer 1)</div>
            <div className="si-generated-layer">
              <div className="si-layer-label si-layer-label--domain"><StorageIcon sx={{ fontSize: 11 }} style={{ marginRight: 4 }} />Layer 1 · Domain Model</div>
              <CopyBlock title={<>Save as <code>src/domains/{domainName}.domain.ts</code></>} code={genDomainFile(domainName, codeGenFields)} />
              {/* Junction file outputs */}
              {pendingJunctions.map(({ junctionName, parent, related }) => (
                <CopyBlock
                  key={junctionName}
                  title={<>Junction table — save as <code>src/domains/{junctionName}.domain.ts</code></>}
                  code={genDomainFile(junctionName, {
                    [`${parent}Id`]:  { type: "string" },
                    [`${related}Id`]: { type: "string" },
                  })}
                />
              ))}
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
// Data Tab
// ════════════════════════════════════════════════════════════════════════════

function DataTab({ schemas, dbBackends = {} }: { schemas: AllSchemas; dbBackends?: Record<string, string> }) {
  const domainNames    = Object.keys(schemas.domains);
  const hasPermission  = useAuthStore((s) => s.hasPermission);
  const [selectedDomain, setSelectedDomain] = useState(domainNames[0] ?? "");
  const [formValues,     setFormValues]     = useState<Record<string, string>>({});
  const [rows,           setRows]           = useState<Record<string, any>[] | null>(null);
  const [status,         setStatus]         = useState<{ state: "idle" | "loading" | "ok" | "err"; msg: string }>({ state: "idle", msg: "" });
  const [loadingRows,    setLoadingRows]    = useState(false);

  const activeBackend = dbBackends[selectedDomain] ?? "postgresql";
  const dbLabel = activeBackend === "dynamodb" ? "DynamoDB" : "PostgreSQL";

  const canCreate = !selectedDomain || hasPermission(selectedDomain, "create");
  const canView   = !selectedDomain || hasPermission(selectedDomain, "view");

  const domainFields = selectedDomain ? Object.entries(schemas.domains[selectedDomain]?.fields ?? {}) : [];

  function selectDomain(name: string) {
    setSelectedDomain(name); setFormValues({}); setRows(null); setStatus({ state: "idle", msg: "" });
  }

  function setField(fieldName: string, value: string) {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleInsert() {
    if (!selectedDomain) return;
    setStatus({ state: "loading", msg: "Inserting row…" });
    try {
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
      if (res.status === "success") setRows(res.data ?? []);
      else setRows([]);
    } catch { setRows([]); }
    finally { setLoadingRows(false); }
  }

  const rowColumns = ["id", ...domainFields.map(([k]) => k), "created_at"];

  return (
    <div className="si-data-tab">
      <div className="si-data-domain-bar">
        <span className="si-data-label">Domain (table):</span>
        <div className="si-data-domain-pills">
          {domainNames.length === 0 ? (
            <span className="si-data-empty-hint">No domains yet — create one in "Create Domain" tab first.</span>
          ) : (
            domainNames.map((name) => {
              const backend = dbBackends[name] ?? "postgresql";
              return (
                <button key={name} type="button"
                  className={`si-data-pill ${selectedDomain === name ? "si-data-pill--active" : ""}`}
                  onClick={() => selectDomain(name)}>
                  <StorageIcon sx={{ fontSize: 12 }} />
                  {name}
                  <Badge label={backend === "dynamodb" ? "DynamoDB" : "PostgreSQL"} color={backend === "dynamodb" ? "orange" : "teal"} />
                </button>
              );
            })
          )}
        </div>
      </div>

      {selectedDomain && (
        <>
          <div className="si-data-section">
            <div className="si-data-section-title">
              <AddIcon sx={{ fontSize: 14 }} />
              Insert a new row into <strong>{selectedDomain}</strong>
              <Badge label={dbLabel} color={activeBackend === "dynamodb" ? "orange" : "teal"} />
            </div>
            {!canCreate ? (
              <p className="si-data-empty-hint" style={{ color: "#b91c1c" }}>
                🔒 You don't have <strong>create</strong> permission for <strong>{selectedDomain}</strong>.
              </p>
            ) : domainFields.length === 0 ? (
              <p className="si-data-empty-hint">This domain has no fields defined yet.</p>
            ) : (
              <div className="si-data-form">
                {domainFields.map(([fieldName, fieldDef]) => {
                  const uiHint = schemas.uiHints?.[`${selectedDomain}.${fieldName}`];
                  const label  = uiHint?.label ?? fieldName;
                  const ph     = uiHint?.placeholder ?? "";
                  const isRelation = fieldDef.type === "relation";
                  const isList     = fieldDef.type === "list";
                  return (
                    <div key={fieldName} className="si-data-field-row">
                      <label className="si-data-field-label">
                        {label}
                        <span className="si-data-field-type">
                          {isRelation ? <><Badge label="relation" color="indigo" /> → {(fieldDef as any).relatedDomain ?? "?"}</>
                            : isList ? <><Badge label="list" color="green" /> → {(fieldDef as any).listDomain ?? "?"}</>
                            : fieldDef.type}
                        </span>
                      </label>
                      {fieldDef.type === "boolean" ? (
                        <select className="si-data-input" value={formValues[fieldName] ?? ""} onChange={(e) => setField(fieldName, e.target.value)}>
                          <option value="">— select —</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type={fieldDef.type === "number" ? "number" : fieldDef.type === "date" ? "date" : "text"}
                          className="si-data-input"
                          placeholder={isRelation ? `ID of related ${(fieldDef as any).relatedDomain ?? "record"}` : isList ? `Comma-separated IDs from ${(fieldDef as any).listDomain ?? "domain"}` : (ph || `Enter ${label}…`)}
                          value={formValues[fieldName] ?? ""} onChange={(e) => setField(fieldName, e.target.value)} />
                      )}
                    </div>
                  );
                })}
                <div className="si-data-form-actions">
                  <button type="button" className="btn si-data-insert-btn" onClick={handleInsert} disabled={status.state === "loading"}>
                    {status.state === "loading" ? <><span className="si-spinner" /> Inserting…</> : <><SaveOutlinedIcon sx={{ fontSize: 14 }} /> Insert Row</>}
                  </button>
                  {status.state !== "idle" && status.state !== "loading" && (
                    <span className={`si-data-status ${status.state === "ok" ? "si-data-status--ok" : "si-data-status--err"}`}>{status.msg}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="si-data-section">
            <div className="si-data-section-title" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <TableChartOutlinedIcon sx={{ fontSize: 14 }} />
                Rows in <strong>{selectedDomain}</strong>
                {rows !== null && <span className="si-tab-count">{rows.length}</span>}
              </span>
              {canView && (
                <button type="button" className="btn btn-backend" onClick={loadRows} disabled={loadingRows} style={{ fontSize: 12, padding: "4px 10px" }}>
                  {loadingRows ? <><span className="si-spinner" /> Loading…</> : <><CloudDownloadOutlinedIcon sx={{ fontSize: 13 }} /> Load Rows</>}
                </button>
              )}
            </div>
            {!canView ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0", color: "#b91c1c" }}>
                🔒 You don't have <strong>view</strong> permission for <strong>{selectedDomain}</strong>.
              </div>
            ) : rows === null ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0" }}>Click <strong>Load Rows</strong> to fetch data from {dbLabel}.</div>
            ) : rows.length === 0 ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0" }}>No rows yet — insert one above.</div>
            ) : (
              <div className="si-data-rows-wrap">
                <table className="si-table si-data-rows-table">
                  <thead>
                    <tr>{rowColumns.map((col) => <th key={col}>{col === "id" ? "ID" : col === "created_at" ? "Created" : col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {rowColumns.map((col) => {
                          const val = row[col];
                          return (
                            <td key={col} title={String(val ?? "")}>
                              {col === "id" ? <code className="si-data-id">{String(val ?? "").slice(0, 8)}…</code>
                                : col === "created_at" ? <span className="si-data-date">{val ? new Date(val).toLocaleString() : "—"}</span>
                                : val === undefined || val === null || val === "" ? <span className="si-data-empty">—</span>
                                : <span>{String(val)}</span>}
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
// Tab: Translations
// ════════════════════════════════════════════════════════════════════════════

interface TranslationsTabProps {
  schemas: AllSchemas;
  onSave:  (domainName: string, fieldName: string, lang: "en" | "ta" | "ar", text: string) => void;
}

function TranslationsTab({ schemas, onSave }: TranslationsTabProps) {
  const [edits, setEdits] = useState<Record<string, Record<"en" | "ta" | "ar", string>>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

const langs: Array<{ code: "ta" | "ar"; label: string; dir?: string }> = [
    { code: "ta", label: "Tamil (TA)" },
    { code: "ar", label: "Arabic (AR)", dir: "rtl" },
  ];

function getEdit(path: string, lang: "ta" | "ar"): string {
    // Only use stored edit value — don't fall back to shared label
    // (shared label causes both TA and AR to show same value and clear together)
    return edits[path]?.[lang] ?? "";
  }

function setEdit(path: string, lang: "ta" | "ar", value: string) {
    setEdits((prev) => ({
      ...prev,
      [path]: { ...(prev[path] ?? { ta: "", ar: "" }), [lang]: value },
    }));
  }

async function handleSave(domainName: string, fieldName: string, path: string) {
    const langEdits = edits[path] ?? {};
    for (const lang of (["ta", "ar"] as const)) {
      const text = langEdits[lang];
      if (text !== undefined && text.trim()) {
        await onSave(domainName, fieldName, lang, text.trim());
      }
    }
    setSaved((prev) => ({ ...prev, [path]: true }));
    setTimeout(() => setSaved((prev) => ({ ...prev, [path]: false })), 2000);
  }

  return (
    <div className="si-domains">
      {Object.entries(schemas.domains).map(([domainName, domainDef]) => (
        <div className="si-card" key={domainName}>
          <div className="si-card-header">
            <StorageIcon sx={{ fontSize: 16, color: "#7e22ce" }} />
            <span className="si-domain-name">{domainName}</span>
            <span className="si-field-count">{Object.keys(domainDef.fields).length} fields</span>
            <span className="si-layer-tag si-layer-tag--ui">Translations</span>
          </div>

          <table className="si-table">
            <thead>
              <tr>
                <th>Field</th>
                {langs.map((l) => <th key={l.code}>{l.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(domainDef.fields).map((fieldName) => {
                const path = `${domainName}.${fieldName}`;
                return (
                  <tr key={fieldName}>
                    <td className="si-field-name">{fieldName}</td>
                    {langs.map((l) => (
                      <td key={l.code}>
                        <input
                          className="si-form-input"
                          style={{ minWidth: 140 }}
                          value={getEdit(path, l.code)}
                          onChange={(e) => setEdit(path, l.code, e.target.value)}
                          placeholder={
                            l.code === "ta" ? "தமிழ்" :
                            l.code === "ar" ? "ا العربية" :
                            "English "
                          }
                          dir={l.dir}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className={`btn ${saved[path] ? "btn-secondary" : "btn-primary"}`}
                        type="button"
                        style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
                        onClick={() => handleSave(domainName, fieldName, path)}
                      >
                        {saved[path]
                          ? <><CheckIcon sx={{ fontSize: 13 }} /> Saved</>
                          : <><SaveOutlinedIcon sx={{ fontSize: 13 }} /> Save</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {Object.keys(schemas.domains).length === 0 && (
        <div className="si-card">
          <div className="si-empty">No domains yet — create one in "Create Domain" tab first.</div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main export — SchemaInspector
// ════════════════════════════════════════════════════════════════════════════

type MainTab = "domain" | "ui" | "validations" | "access" | "create" | "data" | "tables" | "translations";
export function SchemaInspector({ schemas }: { schemas: AllSchemas }) {
  const [tab,   setTab]   = useState<MainTab>("domain");
  const [extra, setExtra] = useState<ExtraSchemaState>(EMPTY_EXTRA);
  const [backendLoadStatus, setBackendLoadStatus] = useState<string | null>(null);

  const baseSchemas = useMemo(
    () => ({ ...schemas, domains: {} as typeof schemas.domains }),
    [schemas],
  );

  const liveSchemas = useMemo(() => mergeAll(baseSchemas, extra), [baseSchemas, extra]);
  const liveDomainNames = useMemo(() => Object.keys(liveSchemas.domains), [liveSchemas]);

  const didAutoLoad = useRef(false);

  // ── Quick-create domain from RelationDomainPicker ─────────────────────────
// AFTER
// AFTER
async function handleQuickCreateDomain(name: string, fields: QuickCreateField[]) {
  const domainFields: Record<string, DomainFieldCore> = {};
  for (const f of fields) { domainFields[f.name] = { type: f.type }; }

  // Backend auto-creates id — just add a name field so domain isn't empty



    const domainDef: DomainDefinition = { name, fields: domainFields };
    setExtra((prev) => ({
      ...prev,
      newDomains: [...prev.newDomains.filter((d) => d.name !== name), domainDef],
      dbBackends: { ...prev.dbBackends, [name]: "postgresql" },
    }));

    // Also create the actual table in the backend
    try {
      const req = domainToBackendRequest({
        domainName: name,
        fields:     domainFields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: "postgresql",
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "already existed";
        setBackendLoadStatus(`✅ Domain "${name}" ${action} in PostgreSQL.`);
      } else {
        setBackendLoadStatus(`⚠️ Domain "${name}" added to schema, but backend: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Domain "${name}" added to schema but backend unreachable: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 4000);
  }

  // ── Core junction creation helper ─────────────────────────────────────────
async function ensureJunctionDomain(
  parentDomainName: string,
  relatedDomainName: string,
  dbBackend: string,
) {
  const pairKey = [parentDomainName, relatedDomainName].sort().join("__");
  if (extra.junctionPairs.has(pairKey)) return; // ✅ deduplicate

  const jd = buildJunctionDomain(parentDomainName, relatedDomainName);

  // Always build rd with parent fields
  // If cbranch was quick-created with empty fields, use parent fields
  // If cbranch already has its own fields, keep those
  const parentFields = liveSchemas.domains[parentDomainName]?.fields ?? {};
  const relatedExistingFields = liveSchemas.domains[relatedDomainName]?.fields ?? {};
  const hasExistingFields = Object.keys(relatedExistingFields).length > 0;

const rd: DomainDefinition = {
    name:   relatedDomainName,
    fields: hasExistingFields
      ? { ...relatedExistingFields } as Record<string, DomainFieldCore>
      : {} as Record<string, DomainFieldCore>,
  };
  // Always add both rd and jd to live schema
setExtra((prev) => {
    const nextPairs = new Set(prev.junctionPairs);
    nextPairs.add(pairKey);
    const toAdd = [jd]; // junction only — no parent ID in either table
    return {
      ...prev,
      newDomains: [
        ...prev.newDomains.filter((d) => !toAdd.find((n) => n.name === d.name)),
        ...toAdd,
      ],
      dbBackends: {
        ...prev.dbBackends,
        ...Object.fromEntries(toAdd.map((d) => [d.name, dbBackend])),
      },
      junctionPairs: nextPairs,
    };
  });

  // Always push both rd and jd to backend
  // apiCreateDomain returns table_created: false if already exists — safe to call always
const domainsToPush = [jd];
  for (const domain of domainsToPush) {
    const isJunction = true;
    try {
      const req = domainToBackendRequest({
        domainName: domain.name,
        fields:     domain.fields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: dbBackend as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "already existed";
        const label  = isJunction ? "Junction table" : "Related domain";
        setBackendLoadStatus(`✅ ${label} "${domain.name}" ${action}.`);
      } else {
        setBackendLoadStatus(`⚠️ "${domain.name}" added to schema, but backend: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ "${domain.name}" backend unreachable: ${err?.message}`);
    }
  }
  setTimeout(() => setBackendLoadStatus(null), 5000);
}

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddFieldToExisting(domainName: string, fieldName: string, draft: FieldDraft) {
    console.log("handleAddFieldToExisting called — type:", draft.type, "isPartOf:", draft.isPartOf, "relatedDomain:", draft.relatedDomain);
    const fullPath = `${domainName}.${fieldName}`;
    const uiHint   = draftToUIHint(draft);
    const abac     = draftToABACRule(draft);
    const rbac     = draftToRBACRule(draft);
    const newField = draftToDomainFieldCore(draft);

setExtra((prev) => ({
      ...prev,
      // ✅ relation fields never become columns in the parent table
      extraFields: draft.type === "relation"
        ? prev.extraFields
        : { ...prev.extraFields, [domainName]: { ...(prev.extraFields[domainName] ?? {}), [fieldName]: newField } },
      uiHints:     Object.values(uiHint).some((v) => v !== undefined) ? { ...prev.uiHints, [fullPath]: uiHint } : prev.uiHints,
      abacRules:   abac ? { ...prev.abacRules, [fullPath]: abac } : prev.abacRules,
      rbacRules:   rbac ? { ...prev.rbacRules, [fullPath]: rbac } : prev.rbacRules,
    }));
    try {
      await apiSaveAttribute(domainName, fieldName, primaryLabel(draft.labels, fieldName), draft.type);
      for (const lang of LANG_ORDER) {
        const text = draft.labels[lang]?.trim();
        if (!text) continue;
        await apiSaveAttributeTranslation(domainName, fieldName, lang, text);
      }
    } catch (err: any) {
      console.warn("Could not save attribute/translations:", err?.message);
    }

    // Auto-create junction table if this is a relation field
if (draft.type === "relation" && draft.relatedDomain && !draft.relatedDomain.startsWith("__new__:")) {
      const dbBackend = extra.dbBackends[domainName] ?? "postgresql";
console.log("handleAddFieldToExisting — isPartOf:", draft.isPartOf, "domain:", domainName, "related:", draft.relatedDomain);

if (draft.isPartOf) {
        // ✅ CHECKED — add parentId FK into child (relatedDomain) table
        const parentIdField = `${domainName}Id`;
        setExtra((prev) => ({
          ...prev,
          extraFields: {
            ...prev.extraFields,
            [draft.relatedDomain]: {
              ...(prev.extraFields[draft.relatedDomain] ?? {}),
              [parentIdField]: { type: "string" },
            },
          },
        }));
        try {
          const childExistingFields = liveSchemas.domains[draft.relatedDomain]?.fields ?? {};
          const childUpdatedFields = {
            ...childExistingFields,
            [parentIdField]: { type: "string" as FieldType },
          };
          const req = domainToBackendRequest({
            domainName:  draft.relatedDomain,
            fields:      childUpdatedFields as any,
            uiHints:     {},
            rbacRules:   {},
            abacRules:   {},
            db_backend:  dbBackend as any,
          });
          const res = await apiCreateDomain(req);
          if (res.status === "success") {
            setBackendLoadStatus(
              `✅ "${parentIdField}" added to child table "${draft.relatedDomain}" — ${dbLocation(res)}`
            );
          } else {
            setBackendLoadStatus(`⚠️ "${parentIdField}" to "${draft.relatedDomain}": ${res.message}`);
          }
        } catch (err: any) {
          setBackendLoadStatus(`⚠️ Could not add "${parentIdField}" to "${draft.relatedDomain}": ${err?.message}`);
        }
        setTimeout(() => setBackendLoadStatus(null), 5000);
      } else {
        // ❌ UNCHECKED — create junction table
        await ensureJunctionDomain(domainName, draft.relatedDomain, dbBackend);
      }
      
    }
    // ✅ skip backend column for relation — handled by child table or junction
if (draft.type !== "relation") {
      try {
        const existingFields = liveSchemas.domains[domainName]?.fields ?? {};
        const updatedFields  = { ...existingFields, [fieldName]: newField };
        const updatedUIHints = {
          ...(liveSchemas.uiHints ?? {}),
          ...(Object.values(uiHint).some((v) => v !== undefined) ? { [fullPath]: uiHint } : {}),
        };
        const req = domainToBackendRequest({
          domainName, fields: updatedFields as any, uiHints: updatedUIHints as any,
          rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
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
  }

  async function handleEditField(domainName: string, oldName: string, newName: string, draft: FieldDraft) {
    const updatedField = draftToDomainFieldCore(draft);
    const uiHint       = draftToUIHint(draft);
    const abac         = draftToABACRule(draft);
    const rbac         = draftToRBACRule(draft);
    const oldPath      = `${domainName}.${oldName}`;
    const newPath      = `${domainName}.${newName}`;
    const isRename     = oldName !== newName;

    const domainInNewDomains = extra.newDomains.find((d) => d.name === domainName);

    setExtra((prev) => {
      const uiHints = { ...prev.uiHints };
      if (isRename && uiHints[oldPath]) { uiHints[newPath] = uiHints[oldPath]; delete uiHints[oldPath]; }
      if (Object.values(uiHint).some((v) => v !== undefined)) uiHints[newPath] = uiHint;

      const abacRules = { ...prev.abacRules };
      if (isRename && abacRules[oldPath]) { abacRules[newPath] = abacRules[oldPath]; delete abacRules[oldPath]; }
      if (abac) abacRules[newPath] = abac;

      const rbacRules = { ...prev.rbacRules };
      if (isRename && rbacRules[oldPath]) { rbacRules[newPath] = rbacRules[oldPath]; delete rbacRules[oldPath]; }
      if (rbac) rbacRules[newPath] = rbac;

      if (prev.newDomains.some((d) => d.name === domainName)) {
        const updatedNewDomains = prev.newDomains.map((d) => {
          if (d.name !== domainName) return d;
          const fields = { ...d.fields };
          if (isRename) delete fields[oldName];
          fields[newName] = updatedField;
          return { ...d, fields };
        });
        const domainExtraFields = { ...(prev.extraFields[domainName] ?? {}) };
        if (isRename) delete domainExtraFields[oldName];
        delete domainExtraFields[newName];
        return { ...prev, newDomains: updatedNewDomains, extraFields: { ...prev.extraFields, [domainName]: domainExtraFields }, uiHints, abacRules, rbacRules };
      } else {
        const domainFields = { ...(prev.extraFields[domainName] ?? {}) };
        if (isRename) delete domainFields[oldName];
        domainFields[newName] = updatedField;
        return { ...prev, extraFields: { ...prev.extraFields, [domainName]: domainFields }, uiHints, abacRules, rbacRules };
      }
    });

try {
      await apiSaveAttribute(domainName, newName, primaryLabel(draft.labels, newName), draft.type);
      for (const lang of LANG_ORDER) {
        const text = draft.labels[lang]?.trim();
        if (!text) continue;
        await apiSaveAttributeTranslation(domainName, newName, lang, text);
      }
    } catch (err: any) {
      console.warn("Could not save attribute/translations:", err?.message);
    }

if (draft.type === "relation" && draft.relatedDomain && !draft.relatedDomain.startsWith("__new__:")) {
      const dbBackend = extra.dbBackends[domainName] ?? "postgresql";
      console.log("HANDLER isPartOf:", draft.isPartOf, "relatedDomain:", draft.relatedDomain);

if (!draft.isPartOf) {
        // ❌ UNCHECKED — create junction table
        await ensureJunctionDomain(domainName, draft.relatedDomain, dbBackend);
      } else {
        // ✅ CHECKED — add domainNameId into child (relatedDomain) table only
        const parentIdField = `${domainName}Id`;
        setExtra((prev) => ({
          ...prev,
          extraFields: {
            ...prev.extraFields,
            [draft.relatedDomain]: {
              ...(prev.extraFields[draft.relatedDomain] ?? {}),
              [parentIdField]: { type: "string" },
            },
          },
        }));
        try {
          const childExistingFields = liveSchemas.domains[draft.relatedDomain]?.fields ?? {};
          const childUpdatedFields  = {
            ...childExistingFields,
            [parentIdField]: { type: "string" as FieldType },
          };
          const req = domainToBackendRequest({
            domainName:  draft.relatedDomain,
            fields:      childUpdatedFields as any,
            uiHints:     {},
            rbacRules:   {},
            abacRules:   {},
            db_backend:  dbBackend as any,
          });
          const res = await apiCreateDomain(req);
          if (res.status === "success") {
            setBackendLoadStatus(
              `✅ "${parentIdField}" added to "${draft.relatedDomain}" — ${dbLocation(res)}.`
            );
          } else {
            setBackendLoadStatus(`⚠️ "${parentIdField}" added locally, backend: ${res.message}`);
          }
        } catch (err: any) {
          setBackendLoadStatus(`⚠️ Could not add "${parentIdField}" to backend: ${err?.message}`);
        }
        setTimeout(() => setBackendLoadStatus(null), 5000);

      } 
    }

    try {
      let rawFields: Record<string, DomainFieldCore>;
      if (domainInNewDomains) {
        rawFields = { ...domainInNewDomains.fields };
      } else {
        rawFields = { ...(extra.extraFields[domainName] ?? {}) } as Record<string, DomainFieldCore>;
      }
      if (isRename) delete rawFields[oldName];
      rawFields[newName] = updatedField;

      const updatedUIHints = { ...(liveSchemas.uiHints ?? {}) };
      if (isRename && updatedUIHints[oldPath]) { updatedUIHints[newPath] = updatedUIHints[oldPath]; delete updatedUIHints[oldPath]; }
      if (Object.values(uiHint).some((v) => v !== undefined)) updatedUIHints[newPath] = uiHint;

      const req = domainToBackendRequest({
        domainName, fields: rawFields as any, uiHints: updatedUIHints as any,
        rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
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
    setExtra((prev) => {
      const nextPairs = new Set(prev.junctionPairs);
      const newJunctionDomains: DomainDefinition[] = [];

      for (const jd of payload.junctionDomains ?? []) {
        const parts  = jd.name.split("_");
        const pairKey = parts.sort().join("__");
        if (!nextPairs.has(pairKey)) {
          nextPairs.add(pairKey);
          newJunctionDomains.push(jd);
        }
      }
      const newRelatedDomains = (payload as any).relatedDomains ?? [];
      const allNew = [payload.domain, ...newRelatedDomains, ...newJunctionDomains];
       return {
        ...prev,
        newDomains: [
          ...prev.newDomains.filter((d) => !allNew.find((n: DomainDefinition) => n.name === d.name)),
          ...allNew,
        ],
        uiHints:    { ...prev.uiHints,   ...payload.uiHints   },
        rbacRules:  { ...prev.rbacRules, ...payload.rbacRules },
        abacRules:  { ...prev.abacRules, ...payload.abacRules },
        dbBackends: {
          ...prev.dbBackends,
          ...Object.fromEntries(allNew.map((d: DomainDefinition) => [d.name, payload.dbBackend])),
        },
        versioned: { ...prev.versioned, [payload.domain.name]: payload.versioned },
        junctionPairs: nextPairs,
      };
    });

   
for (const [fieldName, fieldDef] of Object.entries(payload.domain.fields)) {
      const fieldUiHint = payload.uiHints[`${payload.domain.name}.${fieldName}`];
      const draftLabels = payload.fieldLabels?.[fieldName];

      apiSaveAttribute(
        payload.domain.name, fieldName,
        fieldUiHint?.label || fieldName, fieldDef.type,
      ).then(() => {
        if (!draftLabels) return;
        for (const lang of LANG_ORDER) {
          const text = draftLabels[lang]?.trim();
          if (!text) continue;
          apiSaveAttributeTranslation(payload.domain.name, fieldName, lang, text).catch(console.warn);
        }
      }).catch(console.warn);
    }
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

  async function handleSaveTranslation(domainName: string, fieldName: string, lang: "en" | "ta" | "ar", text: string) {
    try {
      await apiSaveAttributeTranslation(domainName, fieldName, lang, text);
      setBackendLoadStatus(`✅ Translation saved for "${domainName}.${fieldName}" [${lang.toUpperCase()}]`);
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Translation save failed: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 3000);
  }

  async function handleSaveDomainToBackend(domainName: string) {
    const domainDef = liveSchemas.domains[domainName];
    if (!domainDef) return;
    try {
      const req = domainToBackendRequest({
        domainName, fields: domainDef.fields as any, uiHints: liveSchemas.uiHints as any,
        rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action  = res.table_created ? "created" : "already existed";
        const loc     = dbLocation(res);
        const nFields = res.total_fields ?? Object.keys(domainDef.fields).length;
        setBackendLoadStatus(`✅ Table "${domainName}" ${action} in ${loc} — ${nFields} field(s).`);
      } else {
        setBackendLoadStatus(`❌ Backend error: ${res.message}`);
      }
      setTimeout(() => setBackendLoadStatus(null), 4000);
    } catch (err: any) {
      setBackendLoadStatus(`❌ Network error: ${err?.message ?? String(err)}`);
      setTimeout(() => setBackendLoadStatus(null), 5000);
    }
  }

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
                type: v.type as FieldType, default: v.default, datasource: v.datasource,
              }])
            ),
          };
          const dbBackend = (entry as any).db_backend ?? "postgresql";
          next = {
            ...next,
            newDomains: [...next.newDomains.filter((d) => d.name !== converted.domainName), domainDef],
            uiHints:    { ...next.uiHints,   ...converted.uiHints   },
            rbacRules:  { ...next.rbacRules, ...converted.rbacRules },
            abacRules:  { ...next.abacRules, ...converted.abacRules },
            dbBackends: { ...next.dbBackends, [converted.domainName]: dbBackend },
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

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    handleLoadFromBackend();
  }, []);

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
    { id: "create",      label: "Create domain",  icon: <TableChartOutlinedIcon sx={{ fontSize: 15 }} />  },
    { id: "data",        label: "Data",            icon: <TableChartOutlinedIcon sx={{ fontSize: 15 }} />, count: domainCount > 0 ? domainCount : undefined },
    { id: "translations", label: "Translations",   icon: <PaletteOutlinedIcon sx={{ fontSize: 15 }} /> },

  ];

  return (
    <div className="si-root">
      <div className="si-top-bar">
        <div className="si-tabs">
          {tabs.map((t) => (
            <button key={t.id} className={`si-tab-btn ${tab === t.id ? "si-tab-btn--active" : ""}`}
              type="button" onClick={() => setTab(t.id)}>
              {t.icon}<span>{t.label}</span>
              {t.count !== undefined && t.count > 0 && <span className="si-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="si-backend-bar">
          <button className="btn btn-backend" type="button" onClick={handleLoadFromBackend}>
            <CloudDownloadOutlinedIcon sx={{ fontSize: 15 }} />Load from Backend
          </button>
        </div>
      </div>

      {backendLoadStatus && (
        <div className={`si-toast ${backendLoadStatus.startsWith("✅") ? "si-toast--ok" : backendLoadStatus.startsWith("ℹ️") ? "si-toast--info" : "si-toast--err"}`}>
          {backendLoadStatus}
        </div>
      )}

{tab === "domain" && (
        <DomainModelTab
          schemas={liveSchemas}
          viewConfigs={extra.viewConfigs}
          dbBackends={extra.dbBackends}
          versioned={extra.versioned}
         junctionDomains={new Set(
  Array.from(extra.junctionPairs).flatMap((pairKey) => {
    const parts = pairKey.split("__");
    const name1 = `${parts[0]}_${parts[1]}`;
    const name2 = `${parts[1]}_${parts[0]}`;
    return [name1, name2].filter((n) => n in liveSchemas.domains);
  })
)}
          onAddField={handleAddFieldToExisting}
          onEditField={handleEditField}
          onViewConfig={handleViewConfig}
          onSaveBackend={handleSaveDomainToBackend}
          onQuickCreateDomain={handleQuickCreateDomain}
        />
      )}
      {tab === "ui" && (
        <UIConfigTab schemas={liveSchemas} onAdd={handleAddUIHint} onRemove={handleRemoveUIHint} extraHints={extra.uiHints} />
      )}
      {tab === "validations" && <ValidationsTab schemas={liveSchemas} />}
      {tab === "access" && (
        <AccessTab
          schemas={liveSchemas}
          onAddRBAC={handleAddRBAC} onRemoveRBAC={handleRemoveRBAC}
          onAddABAC={handleAddABAC} onRemoveABAC={handleRemoveABAC}
          extraRBACKeys={new Set(Object.keys(extra.rbacRules))}
          extraABACKeys={new Set(Object.keys(extra.abacRules))}
        />
      )}
     {tab === "create" && (
        <CreateDomainTab
          onAdd={handleDomainCreated}
          registry={liveSchemas._layers?.validationRegistry ?? {}}
          domainNames={liveDomainNames}
          onQuickCreateDomain={handleQuickCreateDomain}
          schemas={liveSchemas}
        />
      )}
      {tab === "data" && <DataTab schemas={liveSchemas} dbBackends={extra.dbBackends} />}
      {tab === "translations" && <TranslationsTab schemas={liveSchemas} onSave={handleSaveTranslation} />}

  
    </div>
  );
}