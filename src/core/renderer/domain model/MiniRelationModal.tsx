import React, { useState } from "react";
import ReactDOM from "react-dom";
import StorageIcon        from "@mui/icons-material/Storage";
import LinkOutlinedIcon   from "@mui/icons-material/LinkOutlined";
import CloseIcon          from "@mui/icons-material/Close";
import CheckIcon          from "@mui/icons-material/Check";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import AddIcon            from "@mui/icons-material/Add";
import type { FieldType } from "../../schema/types";
import { FIELD_TYPE_LABELS } from "./constants";
import { toCamelCase } from "./helpers";

export interface MiniField { name: string; type: FieldType }

export interface MiniRelationModalProps {
  open:           boolean;
  mode:           "create" | "junction";
  domainName:     string;
  parentDomainName: string;
  onClose:        () => void;
  onConfirmCreate: (fields: MiniField[], isParentChild: boolean) => void;
  onConfirmJunction: (isParentChild: boolean) => void;}



export function MiniRelationModal({
  open, mode, domainName, parentDomainName, onClose, onConfirmCreate, onConfirmJunction,
}: MiniRelationModalProps) {
const [fields,       setFields]       = useState<MiniField[]>([]);
  const [fieldName,    setFieldName]    = useState("");
  const [fieldType,    setFieldType]    = useState<FieldType>("string");
const [isParentChild, setIsParentChild] = useState(false);

  const validFieldName = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(fieldName.trim());
  const junctionName   = `${parentDomainName}_${domainName}`;
  const parentIdField  = `${parentDomainName}Id`;
  const relatedIdField = `${domainName}Id`;

  const MINI_FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "date"];
  const TYPE_COLOR: Record<string, string> = {
    string: "purple", number: "blue", boolean: "teal", date: "orange",
  };

  function addField() {
    if (!fieldName.trim() || !validFieldName) return;
    setFields((prev) => [...prev, { name: toCamelCase(fieldName), type: fieldType }]);
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
                  Field name {fieldName.trim() && <span className="si-hint">saved as {toCamelCase(fieldName)}</span>}
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
                    {MINI_FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t] ?? t}</option>)}
                  </select>
                </label>
                <button type="button" className="si-btn-add" onClick={addField}
                  disabled={!fieldName.trim() || !validFieldName}
                  style={{ marginBottom:1 }}>
                  <AddIcon sx={{ fontSize: 14 }} />Add
                </button>
              </div>
              {fieldName && !validFieldName && (
                <span className="si-inline-error">Name can only contain letters, numbers, spaces, - and _</span>
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