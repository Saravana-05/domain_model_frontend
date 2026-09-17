import React, { useState } from "react";
import ReactDOM from "react-dom";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import StorageIcon from "@mui/icons-material/Storage";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import type { NamedValidationRule } from "../core/schema/types";
import { FieldBuilder } from "../core/renderer/domain model/FieldBuilder";
import type { FieldDraft } from "../core/renderer/domain model/fieldDraftTypes";
import { toPascalCase } from "../core/renderer/domain model/helpers";

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
  /**
   * Now receives the full per-field FieldDraft map (name → draft) instead
   * of a flattened {name,type} list, so quick-created domains get real
   * labels/validations/relations — the same shape CreateDomainTab already
   * produces — instead of a stripped-down subset. `isPartOf` tells the
   * caller whether to inject the parent FK field.
   */
  onCreateDomain:   (name: string, fieldDrafts: Record<string, FieldDraft>, isPartOf: boolean, parentDomainName?: string) => void;
  parentDomainName?: string;
  /** Passed straight through to the embedded FieldBuilder so the quick-
   *  create flow can attach registry validation refs / create new rules,
   *  same as the full Create Domain tab. */
  registry?: Record<string, NamedValidationRule>;
  onAddValidationRule?: (tag: string, rule: NamedValidationRule) => void;
  /** Escape hatch — hands off to the full Create Domain tab. Passed
   *  through to FieldBuilder's compact-mode "open in full editor" link. */
  onRedirectToCreate?: (domainName: string, parentDomain?: string, fieldName?: string) => void;
}

export function LinkDomainModal({
  open, onClose, domainNames, onConfirm, onCreateDomain, parentDomainName = "",
  registry = {}, onAddValidationRule, onRedirectToCreate,
}: LinkDomainModalProps) {
  const [view,        setView]        = useState<"list" | "create" | "fields" | "preview">("list");
  const [newName,     setNewName]     = useState("");
  const [selected,    setSelected]    = useState("");
  const [fkName,      setFkName]      = useState("");

  // Quick field builder state — now keyed by field name, holding full
  // FieldDraft objects (same shape the Create Domain tab works with),
  // instead of a flattened {name,type}[] list.
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, FieldDraft>>({});
  const [isPartOf,    setIsPartOf]    = useState(true);
  const validNew = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(newName.trim());

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
    // Go to fields view — don't create yet. Domain model names are
    // stored PascalCase, however they were typed.
    const name = toPascalCase(newName);
    setSelected(name);
    setFkName(deriveFK(name));
    setView("fields");
  }

  function handleAddFieldDraft(name: string, draft: FieldDraft) {
    setFieldDrafts((prev) => ({ ...prev, [name]: draft }));
  }

  function removeField(name: string) {
    setFieldDrafts((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function handleDoneFields() {
    onCreateDomain(selected, fieldDrafts, isPartOf && !!parentDomainName, parentDomainName || undefined);
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
    setView("list"); setFieldDrafts({});
    setIsPartOf(true);
    onClose();
  }

  const TYPE_COLOR: Record<string, string> = {
    string: "purple", number: "blue", boolean: "teal", date: "orange",
    relation: "indigo", list: "green",
  };

  const fieldEntries = Object.entries(fieldDrafts);

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
                Domain name <span className="si-hint">{newName.trim() ? `saved as ${toPascalCase(newName)}` : "PascalCase"}</span>
                <input
                  className={`si-form-input ${newName && !validNew ? "si-form-input--error" : ""}`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => { if (newName.trim()) setNewName(toPascalCase(newName)); }}
                  placeholder="e.g. Branch"
                  autoFocus
                />
                {newName && !validNew && (
                  <span className="si-inline-error">Name can only contain letters, numbers, spaces, - and _</span>
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
              {fieldEntries.length > 0 && (
                <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {fieldEntries.map(([name, d]) => (
                    <div key={name} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 10px",
                      background: "var(--color-background-secondary)",
                      borderRadius: "var(--border-radius-md)",
                      border: "1px solid var(--color-border-secondary)",
                    }}>
                      <span className="si-badge si-badge--purple">{name}</span>
                      <span className={`si-badge si-badge--${TYPE_COLOR[d.type as string] ?? "gray"}`}>{d.type}</span>
                      {d.validationRefs?.length > 0 && (
                        <span className="si-hint" style={{ fontSize: 11 }}>
                          {d.validationRefs.length} rule(s)
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeField(name)}
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

              {/* Full field builder, in compact mode — same component the
                  Create Domain tab uses, so name/type/labels/relations all
                  behave identically. Validation-rule sections are hidden
                  here (compact) to keep this a modal, not a second page;
                  the "open in full editor" link inside it hands off to
                  the real Create Domain tab if those are needed. */}
              <FieldBuilder
                submitLabel="Add field"
                onSubmit={handleAddFieldDraft}
                showAllLayers={false}
                showLabelOnly
                compact
                registry={registry}
                domainNames={domainNames}
                parentDomainName={selected}
                onAddValidationRule={onAddValidationRule}
                onRedirectToCreate={onRedirectToCreate}
              />

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
                {fieldEntries.length > 0 ? `Create "${selected}" with ${fieldEntries.length} field(s)` : `Skip & Create "${selected}"`}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => { setView("create"); setFieldDrafts({}); }}>
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
              {fieldEntries.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 6 }}>
                    Fields being created in <strong>{selected}</strong>:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span className="si-badge si-badge--gray">id (auto)</span>
                    {fieldEntries.map(([name]) => (
                      <span key={name} className="si-badge si-badge--purple">{name}</span>
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
                onClick={() => setView(fieldEntries.length > 0 || !domainNames.includes(selected) ? "fields" : "list")}
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