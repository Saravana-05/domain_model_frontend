import React, { useState, useEffect } from "react";
import AddIcon               from "@mui/icons-material/Add";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import CheckIcon             from "@mui/icons-material/Check";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import LinkOutlinedIcon      from "@mui/icons-material/LinkOutlined";
import StorageIcon           from "@mui/icons-material/Storage";
import type { FieldType } from "../../schema/types";
import { Badge, toPascalCase } from "./helpers";

export interface ListDomainPickerProps {
  domainNames:    string[];
  value:          string;
  suggestedName:  string;
  onChange:       (domainName: string) => void;
  onCreateDomain: (name: string, fields: QuickCreateField[]) => void;
}

export function ListDomainPicker({
  domainNames, value, suggestedName, onChange, onCreateDomain,
}: ListDomainPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState(suggestedName);

  useEffect(() => { setNewName(suggestedName); }, [suggestedName]);

  const validNew  = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(newName.trim());
  const canCommit = validNew;

  function handleSelect(val: string) {
    if (val === "__create__") { setShowCreate(true); }
    else { onChange(val); setShowCreate(false); }
  }

  function commitCreate() {
    if (!canCommit) return;
    const name = toPascalCase(newName);
    onCreateDomain(name, []);
    onChange(name);
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
              Domain name <span className="si-hint">{newName.trim() ? `saved as ${toPascalCase(newName)}` : "edit if needed"}</span>
              <input
                className={`si-form-input ${newName && !validNew ? "si-form-input--error" : ""}`}
                value={newName} onChange={e => setNewName(e.target.value)}
                onBlur={() => { if (newName.trim()) setNewName(toPascalCase(newName)); }}
                autoFocus />
              {newName && !validNew && (
                <span className="si-inline-error">Name can only contain letters, numbers, spaces, - and _</span>
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

export interface QuickCreateField { name: string; type: FieldType }

export interface RelationDomainPickerProps {
  domainNames: string[];
  value:       string;
  onChange:    (value: string) => void;
}

export function RelationDomainPicker({ domainNames, value, onChange }: RelationDomainPickerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState("");
  const [qcSaved,    setQcSaved]    = useState(false);

  const validNew  = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(newName.trim());
  const canCommit = validNew;

  const displayValue = value.startsWith("__new__:") ? value.split(":")[1] : value;

  function commitCreate() {
    if (!canCommit) return;
    const sentinel = `__new__:${toPascalCase(newName)}:${JSON.stringify([])}`;
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
              Domain name <span className="si-hint">{newName.trim() ? `saved as ${toPascalCase(newName)}` : "PascalCase"}</span>
              <input
                className={`si-form-input ${newName && !validNew ? "si-form-input--error" : ""}`}
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onBlur={() => { if (newName.trim()) setNewName(toPascalCase(newName)); }}
                placeholder="e.g. Category" autoFocus />
              {newName && !validNew && (
                <span className="si-inline-error">Name can only contain letters, numbers, spaces, - and _</span>
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