import React, { useState, useMemo } from "react";
import { useAuthStore } from "../../../store/authStore";
import StorageIcon             from "@mui/icons-material/Storage";
import LinkOutlinedIcon        from "@mui/icons-material/LinkOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import AddCircleOutlinedIcon   from "@mui/icons-material/AddCircleOutlined";
import EditOutlinedIcon        from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon          from "@mui/icons-material/ExpandMore";
import ExpandLessIcon          from "@mui/icons-material/ExpandLess";
import LabelIcon               from "@mui/icons-material/Label";
import CodeIcon                from "@mui/icons-material/Code";
import TableChartOutlinedIcon  from "@mui/icons-material/TableChartOutlined";
import type {
  AllSchemas, ComponentType, DomainViewConfig, NamedValidationRule,
} from "../../schema/types";
import { Badge, AddSection } from "./helpers";
import { ViewConfigForm } from "./ViewConfigForm";
import { FieldBuilder } from "./FieldBuilder";
import type { FieldDraft } from "./fieldDraftTypes";
import type { QuickCreateField } from "./DomainPickers";
import { buildDomainModelJson } from "./exportJson";
import { DomainJsonModal } from "./DomainJsonModal";
import { useProjectStore } from "../../store/projectStore";

export interface DomainModelTabProps {
  schemas:               AllSchemas;
  viewConfigs:           Record<string, DomainViewConfig>;
  dbBackends:            Record<string, string>;
  versioned:             Record<string, boolean>;
  /** domainName -> project_id, for the project badge next to each card.
   *  Optional — omitted entirely if the caller doesn't track projects. */
  projectIds?:           Record<string, string>;
  junctionDomains:       Set<string>;
  onAddField:            (domainName: string, fieldName: string, draft: FieldDraft) => void;
  onEditField:           (domainName: string, oldName: string, newName: string, draft: FieldDraft) => void;
  onViewConfig:          (domainName: string, cfg: DomainViewConfig) => void;
  onSaveBackend:         (domainName: string) => void;
  onQuickCreateDomain:   (name: string, fields: QuickCreateField[]) => void;
  /** Fires when a domain is created via the "rich" flow (LinkDomainModal's
   *  embedded compact FieldBuilder) — full FieldDraft objects per field,
   *  as opposed to onQuickCreateDomain's flattened {name,type}[] shape.
   *  Matches SchemaInspector's handleRichCreateDomain signature. */
  onRichCreateDomain?:   (
    name: string,
    fieldDrafts: Record<string, FieldDraft>,
    isPartOf: boolean,
    parentDomainName?: string,
  ) => void;
  onRedirectToCreate: (domainName: string, parentDomain?: string, fieldName?: string) => void;
  onGoToCreateDomain: () => void;
  onAddValidationRule?: (tag: string, rule: NamedValidationRule) => void;
}

/**
 * The backend always persists FK columns as plain type:"text"/"string"
 * and never stores relatedDomain — both are frontend-only conveniences
 * that don't survive a reload. So `fieldDef.type === "relation"` is only
 * ever true within the same session, before a reload — after a reload
 * it's always false, which is why a field like grade.designationId shows
 * up as a plain "string" instead of a relation once you reload from the
 * backend, even though it genuinely references the "designation" domain.
 *
 * Infer it the same way the view-builder does instead: a field named
 * "xId" whose prefix matches a domain that actually exists is treated as
 * a relation, regardless of what raw `type` came back from the backend.
 * Shared by both the table display below and fieldDefToDraft (for the
 * edit form), so the two never disagree with each other.
 */
export function inferFieldRelation(
  fieldName: string,
  fieldDef: any,
  schemas: AllSchemas,
): { isRelation: boolean; relatedDomain: string } {
  if (fieldDef?.type === "relation" && fieldDef?.relatedDomain) {
    return { isRelation: true, relatedDomain: fieldDef.relatedDomain };
  }
  if (fieldName.endsWith("Id")) {
    const inferredDomain = fieldName.slice(0, -2);
    if (schemas.domains?.[inferredDomain]) {
      return { isRelation: true, relatedDomain: inferredDomain };
    }
  }
  return { isRelation: false, relatedDomain: "" };
}

export function DomainModelTab({
  schemas, viewConfigs, dbBackends, versioned, projectIds, junctionDomains,
  onAddField, onEditField, onViewConfig, onSaveBackend, onQuickCreateDomain, onRedirectToCreate,
  onGoToCreateDomain,
  onAddValidationRule,
}: DomainModelTabProps) {
  const registry      = schemas._layers?.validationRegistry ?? {};
  const projects      = useProjectStore((s) => s.projects);
  const projectName   = (id: string) => projects.find((p) => p.id === id)?.name ?? `Project ${id}`;
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [editing, setEditing] = useState<{ domain: string; field: string } | null>(null);
  const [expandedChildren, setExpandedChildren] = useState<Record<string, boolean>>({});
  const [jsonModalDomain, setJsonModalDomain] = useState<string | null>(null);
  const domainNames   = Object.keys(schemas.domains);

  const domainModelJson = useMemo(() => buildDomainModelJson(schemas), [schemas]);

  const childrenMap: Record<string, string[]> = {};

  return (
    <div className="si-domains">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <button
          type="button"
          className="page-header-btn page-header-btn--import"
          onClick={onGoToCreateDomain}
        >
          <AddCircleOutlinedIcon sx={{ fontSize: 17 }} />
          Create Domain
        </button>
      </div>
      {Object.keys(schemas.domains).length === 0 && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-secondary, #b3abc7)" }}>
          No domain models here yet. Use "Create Domain" above, or pick a different project from the filter.
        </div>
      )}
{Object.keys(schemas.domains).map((domainName) => {
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
              {projectIds?.[domainName] && (
                <Badge label={projectName(projectIds[domainName])} color="purple" />
              )}
              <div className="si-card-header-actions">
                <button className="si-icon-btn si-icon-btn--cloud" type="button"
                  title="Save to backend" onClick={() => onSaveBackend(domainName)}>
                  <CloudUploadOutlinedIcon sx={{ fontSize: 15 }} />
                  <span>Save to Backend</span>
                </button>
                <button className="si-icon-btn" type="button"
                  title="Show this domain's JSON" onClick={() => setJsonModalDomain(domainName)}>
                  <CodeIcon sx={{ fontSize: 15 }} />
                  <span>Export</span>
                </button>
              </div>
            </div>

           

            <table className="si-table">
              <thead>
                <tr>
                  <th>Field</th><th>Type</th><th>Cardinality</th><th>Format</th>
                  <th>Validation Refs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fields).map(([fieldName, fieldDef]) => {
                  const fp          = `${domainName}.${fieldName}`;
                  const refs        = schemas._layers?.validationRefs?.[fp] ?? [];
                  const isEditing   = editing?.domain === domainName && editing?.field === fieldName;
                  const { isRelation, relatedDomain } = inferFieldRelation(fieldName, fieldDef, schemas);

                  return (
                    <React.Fragment key={fieldName}>
                      <tr>
                        <td className="si-field-name">{fieldName}</td>
                       <td>
                         {isRelation ? (
                            <span className="si-relation-cell" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Badge label="relation 🔗" color="indigo" />
                              <LinkOutlinedIcon sx={{ fontSize: 11 }} />
                              <Badge label={relatedDomain} color="indigo" />
                            </span>
                          ) : (
                            <Badge label={fieldDef.type} color="purple" />
                          )}
                        </td>
                      <td>
                          {(fieldDef as any).cardinality
                            ? <Badge label={(fieldDef as any).cardinality} color="blue" />
                            : <span className="si-muted">—</span>}
                        </td>
                        <td>{fieldDef.format ? <Badge label={fieldDef.format} color="blue" /> : <span className="si-muted">—</span>}</td>
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
                          <td colSpan={6} className="si-edit-row">
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
  onAddValidationRule={onAddValidationRule}
  onRedirectToCreate={onRedirectToCreate}
  onCreateRelatedDomain={(fName, draft) => {
    if (draft.relatedDomain) onRedirectToCreate(draft.relatedDomain, domainName, fName);
  }}
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
  onAddValidationRule={onAddValidationRule}
  onRedirectToCreate={onRedirectToCreate}
  onCreateRelatedDomain={(fieldName, draft) => {
    if (draft.relatedDomain) onRedirectToCreate(draft.relatedDomain, childName, fieldName);
  }}
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

            {/* {!isJunction && (
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
            )} */}

{!isJunction && (
              <div className="si-card-footer">
                <AddSection label={`Add field to "${domainName}"`}>
                  <FieldBuilder
  submitLabel={`Add to ${domainName}`}
  registry={registry}
  domainNames={domainNames}
  parentDomainName={domainName}
  onNewDomainFromRelation={onQuickCreateDomain}
  onAddValidationRule={onAddValidationRule}
  onRedirectToCreate={onRedirectToCreate}
  onCreateRelatedDomain={(fieldName, draft) => {
    if (draft.relatedDomain) onRedirectToCreate(draft.relatedDomain, domainName, fieldName);
  }}
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

      <DomainJsonModal
        open={!!jsonModalDomain}
        domainName={jsonModalDomain}
        json={JSON.stringify(
          {
            domain_models: jsonModalDomain
              ? domainModelJson.domain_models.filter((d) => d.name === jsonModalDomain)
              : [],
          },
          null,
          2,
        )}
        onClose={() => setJsonModalDomain(null)}
      />
    </div>
  );
}

export function fieldDefToDraft(fieldDef: any, schemas: AllSchemas, fullPath: string): FieldDraft {
  const uiHint  = schemas.uiHints?.[fullPath] ?? {};
  const rbac    = schemas._layers?.rbac?.fields?.[fullPath];
  const abac    = schemas._layers?.abac?.rules?.[fullPath];
  const comp    = schemas.computed[fullPath];
  const valRefs = schemas._layers?.validationRefs?.[fullPath] ?? [];

  const fieldId = fullPath.split(".").pop() ?? "";
  const { isRelation: isExistingDomainRelation, relatedDomain } = inferFieldRelation(fieldId, fieldDef, schemas);

  return {
    type:           isExistingDomainRelation ? "relation" : (fieldDef.type ?? "string"),
    default:        fieldDef.default !== undefined ? String(fieldDef.default) : "",
    computed:       !!fieldDef.computed,
    datasource:     (fieldDef as any).datasource ?? "",
    relatedDomain,
        cardinality:    (fieldDef as any).cardinality ?? "",

    listDomain:     (fieldDef as any).listDomain     ?? "",
    validationRefs: valRefs,
    validations:    [],
    isPartOf:       isExistingDomainRelation ? "fk" : true,
    relationKind:   (fieldDef as any).relationKind === "integral" ? "integral" : "association",
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