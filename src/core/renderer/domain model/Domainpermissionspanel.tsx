import React, { useState, useRef, useEffect } from "react";
import ShieldOutlinedIcon     from "@mui/icons-material/ShieldOutlined";
import AddCircleOutlinedIcon  from "@mui/icons-material/AddCircleOutlined";
import DeleteOutlineIcon      from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon       from "@mui/icons-material/EditOutlined";
import CheckIcon              from "@mui/icons-material/Check";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ExpandMoreIcon         from "@mui/icons-material/ExpandMore";

/* ------------------------------------------------------------------ */
/*  Types — put these in ../../schema/types if you prefer              */
/* ------------------------------------------------------------------ */

export type PermAction = "read" | "create" | "update" | "delete";

/** Where the left-hand side of a condition comes from. */
export type AttrSource = "user" | "record";

export type CondOperator =
  | "equals" | "notEquals" | "in" | "notIn" | "contains" | "greaterThan" | "lessThan";

/** "Value" can be typed in, or compared with another attribute (e.g. record.ownerId == user.id). */
export type CondValueKind = "literal" | "userAttr" | "recordField";

export interface PermCondition {
  id:        string;
  source:    AttrSource;      // user.* or record.*
  attribute: string;          // "department", "role", "ownerId" …
  operator:  CondOperator;
  valueKind: CondValueKind;
  value:     string;          // literal, or the name of the attribute to compare with
}

export interface DomainPermissionRule {
  id:         string;
  name:       string;
  effect:     "allow" | "deny";
  /** Roles allowed/denied by this rule. Empty = any role. */
  roles:      string[];
  actions:    PermAction[];
  /** ALL conditions must match (AND). No conditions = applies to every user. */
  conditions: PermCondition[];
}

export interface DomainPermissionsPanelProps {
  domainName:   string;
  /** Used to suggest record attributes when building conditions. */
  fieldNames:   string[];
  rules:        DomainPermissionRule[];
  /** Kept for compatibility; no longer used now that the "user matches" conditions were removed. */
  userAttributes?: string[];
  /** Role names from the Roles page (RBAC admin). Shown in the "Who can access" dropdown. */
  availableRoles?: string[];
  readOnly?:    boolean;
  onChange:     (rules: DomainPermissionRule[]) => void;
  /** Optional — persist to backend. Button is hidden if omitted. */
  onSave?:      (rules: DomainPermissionRule[]) => void | Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const ACTIONS: PermAction[] = ["read", "create", "update", "delete"];

const OPERATORS: { value: CondOperator; label: string }[] = [
  { value: "equals",      label: "is" },
  { value: "notEquals",   label: "is not" },
  { value: "in",          label: "is one of" },
  { value: "notIn",       label: "is none of" },
  { value: "contains",    label: "contains" },
  { value: "greaterThan", label: "is greater than" },
  { value: "lessThan",    label: "is less than" },
];

const uid = () => Math.random().toString(36).slice(2, 9);

const newRule = (): DomainPermissionRule => ({
  id: uid(), name: "", effect: "allow", roles: [], actions: [...ACTIONS], conditions: [],
});

const opLabel = (op: CondOperator) => OPERATORS.find((o) => o.value === op)?.label ?? op;

/** Plain-English summary shown under each rule so admins can check what they built. */
export function describeRule(r: DomainPermissionRule, domainName: string): string {
  const rolePart = r.roles?.length ? `Users with role ${r.roles.join(" or ")}` : "";
  const condPart = (r.conditions ?? []).map((c) => {
    const rhs = c.valueKind === "literal" ? `"${c.value || "…"}"`
              : c.valueKind === "userAttr" ? `user.${c.value || "…"}`
              : `record.${c.value || "…"}`;
    return `${c.source}.${c.attribute || "…"} ${opLabel(c.operator)} ${rhs}`;
  }).join(" and ");
  const who = rolePart && condPart ? `${rolePart} where ${condPart}`
            : rolePart            ? rolePart
            : condPart            ? `Users where ${condPart}`
            : "Every user";
  return `${who} — ${r.effect === "allow" ? "can" : "cannot"} access ${domainName}.`;
}

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

const selectStyle: React.CSSProperties = {
  height: 30, fontSize: 12, padding: "0 8px", borderRadius: 6,
  border: "1px solid var(--color-border-tertiary, #3b3552)",
  background: "var(--color-background-primary, #1f1b2e)",
  color: "var(--color-text-primary, #fff)",
};

function Chip({ label, active, onClick, disabled }: {
  label: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontSize: 12, padding: "3px 10px", borderRadius: 20, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${active ? "#8b5cf6" : "var(--color-border-tertiary, #3b3552)"}`,
        background: active ? "rgba(139,92,246,0.18)" : "transparent",
        color: active ? "#c4b5fd" : "var(--color-text-secondary, #b3abc7)",
      }}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Role dropdown (multi-select)                                       */
/* ------------------------------------------------------------------ */

function RoleDropdown({ roles, selected, onChange }: {
  roles: string[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc   = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  // Keep roles that were saved earlier even if they no longer exist in the list.
  const options = [...new Set([...roles, ...selected])];
  const toggle  = (r: string) => onChange(selected.includes(r) ? selected.filter((x) => x !== r) : [...selected, r]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", minWidth: 260 }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...selectStyle, width: "100%", height: 34, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected.length === 0 ? "Any role" : selected.join(", ")}
        </span>
        <ExpandMoreIcon sx={{ fontSize: 16 }} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          style={{
            position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, right: 0,
            maxHeight: 220, overflowY: "auto", padding: 6, borderRadius: 8,
            border: "1px solid var(--color-border-tertiary, #3b3552)",
            background: "var(--color-background-primary, #1f1b2e)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            Any role
          </label>
          {options.length === 0 && (
            <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--color-text-secondary, #b3abc7)" }}>
              No roles found. Create roles on the Roles page first.
            </div>
          )}
          {options.map((r) => (
            <label key={r} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(r)} onChange={() => toggle(r)} />
              {r}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rule editor                                                        */
/* ------------------------------------------------------------------ */

function RuleEditor({
  draft, setDraft, fieldNames, availableRoles, onSave, onCancel,
}: {
  draft: DomainPermissionRule;
  setDraft: (r: DomainPermissionRule) => void;
  fieldNames: string[];
  availableRoles: string[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const conditions = draft.conditions ?? [];
  const setConditions = (next: PermCondition[]) => setDraft({ ...draft, conditions: next });
  const updateCondition = (id: string, patch: Partial<PermCondition>) =>
    setConditions(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addCondition = () =>
    setConditions([...conditions, { id: uid(), source: "record", attribute: fieldNames[0] ?? "", operator: "equals", valueKind: "literal", value: "" }]);
  const conditionsValid = conditions.every((c) => c.attribute.trim() !== "" && c.value.trim() !== "");

  const valid = draft.name.trim() !== "" && conditionsValid;

  return (
    <div style={{
      border: "1px solid #8b5cf6", borderRadius: 10, padding: 14, marginTop: 10,
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      {/* Name + effect */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="si-form-input"
          style={{ height: 30, fontSize: 13, flex: "1 1 220px" }}
          placeholder="Rule name, e.g. Employee sees own library"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <div role="group" aria-label="Effect" style={{ display: "inline-flex", gap: 6 }}>
          <Chip label="Allow" active={draft.effect === "allow"} onClick={() => setDraft({ ...draft, effect: "allow" })} />
          <Chip label="Deny"  active={draft.effect === "deny"}  onClick={() => setDraft({ ...draft, effect: "deny" })} />
        </div>
        <div style={{ flexBasis: "100%", fontSize: 12, color: "var(--color-text-secondary, #b3abc7)" }}>
          {draft.effect === "allow"
            ? "Allow: the selected roles are given access."
            : "Deny: the selected roles are blocked, even if another rule allows them."}
        </div>
      </div>

      {/* Roles */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Who can access (roles)</div>
        <RoleDropdown
          roles={availableRoles}
          selected={draft.roles}
          onChange={(next) => setDraft({ ...draft, roles: next })}
        />
      </div>

      {/* Conditions */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Conditions (all must match)</div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary, #b3abc7)", marginBottom: 8 }}>
          Optional. With no conditions the rule applies to every user who has the selected roles.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {conditions.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <select aria-label="Condition source" style={selectStyle} value={c.source}
                onChange={(e) => updateCondition(c.id, { source: e.target.value as AttrSource })}>
                <option value="record">record</option>
                <option value="user">user</option>
              </select>
              {c.source === "record" && fieldNames.length > 0 ? (
                <select aria-label="Condition attribute" style={selectStyle} value={c.attribute}
                  onChange={(e) => updateCondition(c.id, { attribute: e.target.value })}>
                  {!fieldNames.includes(c.attribute) && <option value={c.attribute}>{c.attribute || "attribute…"}</option>}
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              ) : (
                <input className="si-form-input" aria-label="Condition attribute" style={{ height: 30, fontSize: 12, width: 140 }}
                  placeholder="attribute, e.g. department" value={c.attribute}
                  onChange={(e) => updateCondition(c.id, { attribute: e.target.value })} />
              )}
              <select aria-label="Condition operator" style={selectStyle} value={c.operator}
                onChange={(e) => updateCondition(c.id, { operator: e.target.value as CondOperator })}>
                {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select aria-label="Compare with" style={selectStyle} value={c.valueKind}
                onChange={(e) => updateCondition(c.id, { valueKind: e.target.value as CondValueKind })}>
                <option value="literal">a value</option>
                <option value="userAttr">user attribute</option>
                <option value="recordField">record field</option>
              </select>
              <input className="si-form-input" aria-label="Condition value" style={{ height: 30, fontSize: 12, width: 160 }}
                placeholder={c.valueKind === "literal" ? "value" : c.valueKind === "userAttr" ? "e.g. assignedLibraryId" : "field name"}
                value={c.value} onChange={(e) => updateCondition(c.id, { value: e.target.value })} />
              <button type="button" className="si-edit-btn si-edit-btn--danger" title="Remove condition"
                onClick={() => setConditions(conditions.filter((x) => x.id !== c.id))}>
                <DeleteOutlineIcon sx={{ fontSize: 13 }} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="si-icon-btn" style={{ marginTop: 8 }} onClick={addCondition}>
          <AddCircleOutlinedIcon sx={{ fontSize: 15 }} /><span>Add condition</span>
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        {!valid && (
          <span style={{ fontSize: 12, color: "var(--color-text-secondary, #b3abc7)", marginRight: "auto" }}>
            {draft.name.trim() === "" ? "Enter a rule name to save."
              : "Fill in every condition (attribute and value) or remove it."}
          </span>
        )}
        <button type="button" className="si-edit-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="si-edit-btn si-edit-btn--active" disabled={!valid} onClick={onSave}
          title={valid ? "Save rule" : "Add a rule name and complete every condition"}>
          <CheckIcon sx={{ fontSize: 13 }} /> Save rule
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export function DomainPermissionsPanel({
  domainName, fieldNames, rules, availableRoles = [], readOnly, onChange, onSave,
}: DomainPermissionsPanelProps) {
  const [draft, setDraft]   = useState<DomainPermissionRule | null>(null);
  const [isNew, setIsNew]   = useState(false);
  const [saving, setSaving] = useState(false);

  const commit = () => {
    if (!draft) return;
    // Rules apply to every action; drop any leftover `fields` from rules saved earlier.
    const { fields: _legacyFields, ...rest } = draft as DomainPermissionRule & { fields?: string[] };
    const saved: DomainPermissionRule = { ...rest, actions: [...ACTIONS] };
    onChange(isNew ? [...rules, saved] : rules.map((r) => (r.id === saved.id ? saved : r)));
    setDraft(null);
  };

  return (
    <div style={{
      borderTop: "0.5px solid var(--color-border-tertiary)",
      background: "var(--color-background-secondary)", padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <ShieldOutlinedIcon sx={{ fontSize: 16, color: "#8b5cf6" }} />
        <strong style={{ fontSize: 14 }}>Access rules for {domainName}</strong>
        <span className="si-field-count">{rules.length} {rules.length === 1 ? "rule" : "rules"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {!readOnly && (
            <button type="button" className="si-icon-btn" disabled={!!draft}
              onClick={() => { setDraft(newRule()); setIsNew(true); }}>
              <AddCircleOutlinedIcon sx={{ fontSize: 15 }} /><span>Add rule</span>
            </button>
          )}
          {onSave && !readOnly && (
            <button type="button" className="si-icon-btn si-icon-btn--cloud" disabled={saving}
              onClick={async () => { setSaving(true); try { await onSave(rules); } finally { setSaving(false); } }}>
              <CloudUploadOutlinedIcon sx={{ fontSize: 15 }} /><span>{saving ? "Saving…" : "Save permissions"}</span>
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary, #b3abc7)", marginBottom: 10 }}>
        Rules are checked against the signed-in user's roles and attributes. A deny always wins over an allow.
      </div>

      {rules.length === 0 && !draft && (
        <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: "var(--color-text-secondary, #b3abc7)" }}>
          No rules yet. Add one to control who can read or change this domain.
        </div>
      )}

      {/* Existing rules */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rules.map((r) => (
          draft && !isNew && draft.id === r.id ? (
            <RuleEditor key={r.id} draft={draft} setDraft={setDraft} fieldNames={fieldNames}
              availableRoles={availableRoles} onSave={commit} onCancel={() => setDraft(null)} />
          ) : (
            <div key={r.id} style={{
              display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 8,
              border: "0.5px solid var(--color-border-tertiary)",
              borderLeft: `3px solid ${r.effect === "allow" ? "#10b981" : "#ef4444"}`,
              background: "var(--color-background-primary)",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.name}{" "}
                  <span style={{ fontSize: 11, fontWeight: 500, color: r.effect === "allow" ? "#10b981" : "#ef4444" }}>
                    {r.effect === "allow" ? "Allow" : "Deny"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary, #b3abc7)", marginTop: 2 }}>
                  {describeRule(r, domainName)}
                </div>
              </div>
              {!readOnly && (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button type="button" className="si-edit-btn" title="Edit rule" disabled={!!draft}
                    onClick={() => { setDraft(JSON.parse(JSON.stringify(r))); setIsNew(false); }}>
                    <EditOutlinedIcon sx={{ fontSize: 13 }} /> Edit
                  </button>
                  <button type="button" className="si-edit-btn si-edit-btn--danger" title="Delete rule"
                    onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
                    <DeleteOutlineIcon sx={{ fontSize: 13 }} /> Delete
                  </button>
                </span>
              )}
            </div>
          )
        ))}
      </div>

      {/* New rule */}
      {draft && isNew && (
        <RuleEditor draft={draft} setDraft={setDraft} fieldNames={fieldNames}
          availableRoles={availableRoles} onSave={commit} onCancel={() => setDraft(null)} />
      )}
    </div>
  );
}