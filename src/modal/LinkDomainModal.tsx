import React, { useState } from "react";
import ReactDOM from "react-dom";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import StorageIcon from "@mui/icons-material/Storage";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon from "@mui/icons-material/Add";
import type { FieldType } from "../schema/types";

interface QuickCreateField { name: string; type: FieldType }

export interface LinkDomainResult {
  domainName:  string;
  fkFieldName: string;
  isPartOf:    boolean;
}

interface LinkDomainModalProps {
  open:             boolean;
  onClose:          () => void;
  domainNames:      string[];
  onConfirm:        (result: LinkDomainResult) => void;
  onCreateDomain:   (name: string, fields: QuickCreateField[]) => void;
  parentDomainName?: string;
}

export function LinkDomainModal({
  open, onClose, domainNames, onConfirm, onCreateDomain, parentDomainName = "",
}: LinkDomainModalProps) {
  const [view,        setView]        = useState<"list" | "create" | "fields" | "preview">("list");
  const [newName,     setNewName]     = useState("");
  const [selected,    setSelected]    = useState("");
  const [fkName,      setFkName]      = useState("");

  // Quick field builder state
  const [fields,      setFields]      = useState<QuickCreateField[]>([]);
  const [fieldName,   setFieldName]   = useState("");
  const [fieldType,   setFieldType]   = useState<FieldType>("string");
  const [isPartOf,    setIsPartOf]    = useState(true);
  const validNew = /^[a-z][a-zA-Z0-9_]*$/.test(newName);
  const validFieldName = /^[a-z][a-zA-Z0-9_]*$/.test(fieldName);

  if (!open) return null;

  function deriveFK(domain: string) {
    return domain ? `${domain}Id` : "";
  }

  function handleSelect(name: string) {
    setSelected(name);
    setFkName(deriveFK(name));
    setView("preview");
  }

  function handleCreate() {
    if (!validNew) return;
    // Go to fields view — don't create yet
    setSelected(newName.trim());
    setFkName(deriveFK(newName.trim()));
    setView("fields");
  }

  function addField() {
    if (!fieldName.trim() || !validFieldName) return;
    setFields(prev => [...prev, { name: fieldName.trim(), type: fieldType }]);
    setFieldName("");
    setFieldType("string");
  }

  function removeField(i: number) {
    setFields(prev => prev.filter((_, j) => j !== i));
  }

function handleDoneFields() {
    const autoFields: QuickCreateField[] = [...fields];
    const parentIdFieldName = deriveFK(parentDomainName);
    const alreadyHasParentFK = autoFields.some(f => f.name === parentIdFieldName);

    // Only auto-add parent FK if "part of" is checked
    if (isPartOf && parentDomainName && !alreadyHasParentFK) {
      autoFields.unshift({ name: parentIdFieldName, type: "string" });
    }

    onCreateDomain(selected, autoFields);
    setView("preview");
  }

function handleConfirm() {
    if (!selected) return;
    console.log("MODAL CONFIRM isPartOf:", isPartOf, "selected:", selected);
    onConfirm({
      domainName:  selected,
      fkFieldName: selected,
      isPartOf,
    });
    handleClose();
  }

function handleClose() {
    setNewName(""); setSelected(""); setFkName("");
    setView("list"); setFields([]);
    setFieldName(""); setFieldType("string");
    setIsPartOf(true);
    onClose();
  }

  const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "date"];

  const TYPE_COLOR: Record<string, string> = {
    string: "purple", number: "blue", boolean: "teal", date: "orange",
  };

  return ReactDOM.createPortal(
    <div className="ldm-overlay" onClick={handleClose}>
      <div className="ldm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ldm-header">
          <LinkOutlinedIcon sx={{ fontSize: 16 }} />
          <span>
            {view === "list"    && "Link a Domain Model"}
            {view === "create"  && "Create Domain Model"}
            {view === "fields"  && `Add fields to "${selected}"`}
            {view === "preview" && "Preview FK field"}
          </span>
          <button className="ldm-close" type="button" onClick={handleClose}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        </div>

        {/* ── View: list ── */}
        {view === "list" && (
          <>
            <div className="ldm-body">
              {domainNames.length === 0 ? (
                <p className="ldm-empty">No domains yet. Create one below.</p>
              ) : (
                <ul className="ldm-list">
                  {domainNames.map((name) => (
                    <li key={name}>
                      <button className="ldm-item" type="button" onClick={() => handleSelect(name)}>
                        <LinkOutlinedIcon sx={{ fontSize: 13 }} />
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="ldm-footer">
              <button className="btn btn-primary" type="button" onClick={() => setView("create")}>
                <AddCircleOutlinedIcon sx={{ fontSize: 15 }} /> Create Domain Model
              </button>
            </div>
          </>
        )}

        {/* ── View: create (name input) ── */}
        {view === "create" && (
          <>
            <div className="ldm-body">
              <label className="si-form-label">
                Domain name <span className="si-hint">camelCase</span>
                <input
                  className={`si-form-input ${newName && !validNew ? "si-form-input--error" : ""}`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. branch"
                  autoFocus
                />
                {newName && !validNew && (
                  <span className="si-inline-error">camelCase starting with a lowercase letter</span>
                )}
              </label>
            </div>
            <div className="ldm-footer ldm-footer--gap">
              <button className="btn btn-primary" type="button" onClick={handleCreate} disabled={!validNew}>
                Next → Add fields
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => { setView("list"); setNewName(""); }}>
                ← Back
              </button>
            </div>
          </>
        )}

        {/* ── View: fields (add fields to new domain) ── */}
        {view === "fields" && (
          <>
            <div className="ldm-body">

              {/* Domain being created */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", marginBottom: 14,
                background: "var(--color-background-info)",
                borderRadius: "var(--border-radius-md)",
                fontSize: 12, color: "var(--color-text-info)",
              }}>
                <StorageIcon sx={{ fontSize: 14 }} />
                Creating domain <strong>{selected}</strong>
                <span style={{ opacity: 0.7 }}>— id &amp; created_at auto-added by PostgreSQL</span>
              </div>

              {/* Relationship type */}
              {parentDomainName && (
                <label style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", marginBottom: 14,
                  background: isPartOf ? "#eef2ff" : "var(--color-background-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  border: `1px solid ${isPartOf ? "#c7d2fe" : "var(--color-border-secondary)"}`,
                  cursor: "pointer", fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={isPartOf}
                    onChange={(e) => setIsPartOf(e.target.checked)}
                  />
                  <div>
                    <strong style={{ color: isPartOf ? "#3730a3" : "var(--color-text-primary)" }}>
                      {isPartOf
                        ? `"${selected}" is part of "${parentDomainName}"`
                        : `"${selected}" is independent of "${parentDomainName}"`}
                    </strong>
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      {isPartOf ? (
                        <span style={{ color: "#4338ca" }}>
                          ✅ <code>{parentDomainName}Id</code> will be added to <strong>{selected}</strong> table only — no column in <strong>{parentDomainName}</strong>
                        </span>
                      ) : (
                        <span style={{ color: "#854d0e" }}>
                          🔀 Junction table <code>{parentDomainName}_{selected}</code> will be created — no ID column in either table
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              )}

              {/* Existing fields list */}
              {fields.length > 0 && (
                <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {fields.map((f, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 10px",
                      background: "var(--color-background-secondary)",
                      borderRadius: "var(--border-radius-md)",
                      border: "1px solid var(--color-border-secondary)",
                    }}>
                      <span className={`si-badge si-badge--purple`}>{f.name}</span>
                      <span className={`si-badge si-badge--${TYPE_COLOR[f.type] ?? "gray"}`}>{f.type}</span>
                      <button
                        type="button"
                        onClick={() => removeField(i)}
                        style={{
                          marginLeft: "auto", background: "none", border: "none",
                          cursor: "pointer", color: "var(--color-text-danger)",
                          display: "flex", alignItems: "center",
                        }}
                      >
                        <DeleteOutlinedIcon sx={{ fontSize: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add field row */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <label className="si-form-label" style={{ flex: 2, marginBottom: 0 }}>
                  Field name
                  <input
                    className={`si-form-input ${fieldName && !validFieldName ? "si-form-input--error" : ""}`}
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addField(); }}
                    placeholder="e.g. branchName"
                  />
                </label>
                <label className="si-form-label" style={{ flex: 1, marginBottom: 0 }}>
                  Type
                  <select
                    className="si-form-select"
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value as FieldType)}
                  >
                    {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="si-btn-add"
                  onClick={addField}
                  disabled={!fieldName.trim() || !validFieldName}
                  style={{ marginBottom: 1 }}
                >
                  <AddIcon sx={{ fontSize: 14 }} />Add
                </button>
              </div>

              {fieldName && !validFieldName && (
                <span className="si-inline-error">camelCase starting with a lowercase letter</span>
              )}

              {/* Skip hint */}
              <p style={{
                fontSize: 11, color: "var(--color-text-secondary)",
                marginTop: 12, marginBottom: 0, opacity: 0.7,
              }}>
                💡 You can skip and add more fields later from the Domain Model tab.
              </p>
            </div>

            <div className="ldm-footer ldm-footer--gap">
              <button className="btn btn-primary" type="button" onClick={handleDoneFields}>
                <CheckIcon sx={{ fontSize: 15 }} />
                {fields.length > 0 ? `Create "${selected}" with ${fields.length} field(s)` : `Skip & Create "${selected}"`}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => { setView("create"); setFields([]); }}>
                ← Back
              </button>
            </div>
          </>
        )}

        {/* ── View: preview ── */}
        {view === "preview" && (
          <>
            <div className="ldm-body">
              <div style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
                padding: "10px 14px",
                background: "var(--color-background-info)",
                borderRadius: "var(--border-radius-md)",
              }}>
                <code style={{ fontSize: 13, color: "#4f46e5", fontWeight: 600 }}>
                  {selected}Id
                </code>
                <span style={{ fontSize: 13, color: "#6b7280" }}>→</span>
                <code style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                  {selected}
                </code>
                <span style={{
                  fontSize: 10, background: "#e0e7ff", color: "#3730a3",
                  borderRadius: 4, padding: "2px 7px", fontWeight: 600,
                }}>FK</span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)", marginLeft: 4 }}>
                  type: string
                </span>
              </div>

              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
                {isPartOf ? (
                  <>Stores the ID of the linked <strong style={{ color: "var(--color-text-primary)" }}>{selected}</strong> record.
                  <code style={{ fontSize: 11 }}> {parentDomainName}Id</code> column will be added to the <strong>{selected}</strong> table.</>
                ) : (
                  <>Junction table <code style={{ fontSize: 11 }}>{parentDomainName}_{selected}</code> will be auto-created — no ID column in either table.</>
                )}
              </div>

              {/* Show fields that will be created if new domain */}
              {fields.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 6 }}>
                    Fields being created in <strong>{selected}</strong>:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span className="si-badge si-badge--gray">id (auto)</span>
                    {fields.map((f, i) => (
                      <span key={i} className="si-badge si-badge--purple">{f.name}</span>
                    ))}
                    <span className="si-badge si-badge--gray">created_at (auto)</span>
                  </div>
                </div>
              )}

              
            </div>

            <div className="ldm-footer ldm-footer--gap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={!selected || !fkName.trim()}
              >
                <CheckIcon sx={{ fontSize: 15 }} /> Add {fkName || "FK"} field
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setView(fields.length > 0 || !domainNames.includes(selected) ? "fields" : "list")}
              >
                ← Back
              </button>
            </div>
          </>
        )}

      </div>
    </div>,
    document.body
  );
}