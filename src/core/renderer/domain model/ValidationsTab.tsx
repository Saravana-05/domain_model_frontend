import React, { useState } from "react";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import LabelIcon               from "@mui/icons-material/Label";
import AddIcon                 from "@mui/icons-material/Add";
import DeleteOutlinedIcon      from "@mui/icons-material/DeleteOutlined";
import type { AllSchemas, NamedValidationRule } from "../../schema/types";
import { Badge } from "./helpers";
import { apiSaveValidationRule, apiDeleteValidationRule } from "../../api/datastoreApi"; // adjust path if different
import { NewValidationRuleModal } from "./NewValidationRuleModal";

export function ValidationsTab({ schemas }: { schemas: AllSchemas }) {
  const registry = schemas._layers?.validationRegistry ?? {};
  const refs     = schemas._layers?.validationRefs     ?? {};

  const [showModal, setShowModal]     = useState(false);
  const [localRules, setLocalRules]   = useState<Record<string, any>>({});
  // Tags deleted this session — hidden from the table even though they
  // still exist in the static `registry` prop (which only refreshes on
  // reload). Deleting a backend-created rule removes it from the DB right
  // away; deleting one of the original static defaults from
  // src/validations/index.ts only hides it here (that file is untouched).
  const [deletedTags, setDeletedTags] = useState<Set<string>>(new Set());
  const [deletingTag, setDeletingTag] = useState<string | null>(null);

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

  const allRules = Object.fromEntries(
    Object.entries({ ...registry, ...localRules }).filter(([tag]) => !deletedTags.has(tag))
  );

  async function handleCreate(tag: string, rule: NamedValidationRule) {
    await apiSaveValidationRule(tag, rule as any);
    setLocalRules((prev) => ({ ...prev, [tag]: rule }));
    setDeletedTags((prev) => {
      if (!prev.has(tag)) return prev;
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
  }

  async function handleDelete(tag: string) {
    const inUse = (usedBy[tag] ?? []).length > 0;
    const confirmMsg = inUse
      ? `"${tag}" is used by ${usedBy[tag].length} field(s): ${usedBy[tag].join(", ")}. Delete it anyway?`
      : `Delete validation rule "${tag}"? This can't be undone.`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingTag(tag);
    try {
      const res = await apiDeleteValidationRule(tag);
      if (res.status !== "success") {
        window.alert(`Could not delete "${tag}": ${res.message ?? "unknown error"}`);
        return;
      }
      setDeletedTags((prev) => new Set(prev).add(tag));
      setLocalRules((prev) => {
        if (!(tag in prev)) return prev;
        const next = { ...prev };
        delete next[tag];
        return next;
      });
    } catch (e: any) {
      window.alert(`Could not delete "${tag}": ${e?.message ?? String(e)}`);
    } finally {
      setDeletingTag(null);
    }
  }

  return (
    <div className="si-card">
      <div className="si-card-header">
        <CheckCircleOutlinedIcon sx={{ fontSize: 16, color: "#92400e" }} />
        <span className="si-domain-name">Validation Registry</span>
        <span className="si-field-count">{Object.keys(allRules).length} named rules</span>
        <span className="si-layer-tag si-layer-tag--val">Validations</span>
        <button
          type="button"
          className="si-btn-add"
          onClick={() => setShowModal(true)}
        >
          <AddIcon sx={{ fontSize: 15 }} />
          New Rule
        </button>
      </div>

      {Object.keys(allRules).length === 0 ? (
        <div className="si-empty">No rules in registry — edit <code>src/validations/index.ts</code></div>
      ) : (
        <table className="si-table">
          <thead><tr><th>Tag</th><th>Type</th><th>Value</th><th>Message</th><th>Used by</th><th></th></tr></thead>
          <tbody>
            {Object.entries(allRules).map(([tag, rule]) => (
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
                <td>
                  <button
                    type="button"
                    className="si-remove-btn"
                    onClick={() => handleDelete(tag)}
                    disabled={deletingTag === tag}
                    title={`Delete "${tag}"`}
                  >
                    <DeleteOutlinedIcon sx={{ fontSize: 14 }} />
                    {deletingTag === tag ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewValidationRuleModal
        open={showModal}
        onClose={() => setShowModal(false)}
        existingTags={Object.keys(allRules)}
        onCreate={handleCreate}
      />
    </div>
  );
}