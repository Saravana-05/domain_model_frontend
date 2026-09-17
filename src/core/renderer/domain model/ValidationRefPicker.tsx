import React from "react";
import LabelIcon from "@mui/icons-material/Label";
import CheckIcon from "@mui/icons-material/Check";
import type { NamedValidationRule } from "../../schema/types";

/**
 * Groups registry entries by which domain "owns" them — "common" for
 * anything reusable (required, email-format, etc.), or the specific
 * domain name for rules that only make sense for that one domain's
 * fields (valid_clinic_name, valid_doctor_name...). Replaces the earlier
 * type/kind-based grouping (Presence/Length/Numeric/Format) — that told
 * you WHAT KIND of check a rule was, not WHO it belongs to, which is what
 * actually matters when browsing "is there already a rule for this
 * domain's field, or do I need a common one." Defaults to "common" for
 * any entry that predates this field (nothing needs to be touched to
 * keep working the same way).
 */
export function groupForRule(rule: NamedValidationRule): string {
  return rule.category?.trim() || "common";
}

export function ValidationRefPicker({ selected, registry, onChange }: {
  selected: string[];
  registry: Record<string, NamedValidationRule>;
  onChange: (tags: string[]) => void;
}) {
const groups: Record<string, Array<[string, NamedValidationRule]>> = {};
  const mergedRegistry = { unique: { type: "required", message: "Value must be unique" } as NamedValidationRule, ...registry };
  for (const [tag, rule] of Object.entries(mergedRegistry)) {
    const g = groupForRule(rule);
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
                    onClick={() => toggle(tag)} title={rule.message ?? rule.description}>
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