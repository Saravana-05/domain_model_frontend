import React, { useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import type { NamedValidationRule } from "../../schema/types";

const LEGACY_TYPES = ["required", "minLength", "maxLength", "min", "max", "pattern", "custom"] as const;

export interface NewValidationRuleModalProps {
  open: boolean;
  onClose: () => void;
  /** Tags already in the registry — used for the duplicate-tag check. */
  existingTags: string[];
  /**
   * Called with the finished (tag, rule) pair once the form validates.
   * The caller owns persistence (API call + local state update) — this
   * lets Validations tab and the field builder each hook it up to their
   * own existing save path instead of the modal picking one for them.
   * Throwing/rejecting here is caught and shown as an inline error.
   */
  onCreate: (tag: string, rule: NamedValidationRule) => void | Promise<void>;
}

const EMPTY = { tag: "", type: "required", value: "", message: "", category: "common" };

/**
 * Shared "create a new named validation rule" modal — same form used by
 * both the Validations tab's "+ New Rule" button and the field builder's
 * "Create new rule" button (Domain page), so there's exactly one place
 * this UI is defined instead of two drifting copies.
 */
export function NewValidationRuleModal({ open, onClose, existingTags, onCreate }: NewValidationRuleModalProps) {
  const [form, setForm]     = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  if (!open) return null;

  const needsValue = form.type !== "required" && form.type !== "custom";

  function update<K extends keyof typeof EMPTY>(key: K, val: typeof EMPTY[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function reset() {
    setForm(EMPTY);
    setError(null);
    setSaving(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleCreate() {
    setError(null);

    const tag = form.tag.trim();
    if (!tag)                      return setError("Tag is required.");
    if (existingTags.includes(tag)) return setError(`A rule with tag "${tag}" already exists.`);
    if (!form.message.trim())      return setError("Message is required.");

    let value: string | number | undefined = undefined;
    if (needsValue) {
      if (!form.value.trim()) return setError("Value is required for this rule type.");
      const numeric = ["minLength", "maxLength", "min", "max"].includes(form.type);
      value = numeric ? Number(form.value) : form.value;
      if (numeric && Number.isNaN(value as number)) {
        return setError("Value must be a number for this rule type.");
      }
    }

    const rule: NamedValidationRule = {
      type: form.type,
      ...(value !== undefined ? { value } : {}),
      message: form.message.trim(),
      category: form.category.trim() || "common",
    } as NamedValidationRule;

    setSaving(true);
    try {
      await onCreate(tag, rule);
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save rule.");
      setSaving(false);
    }
  }

  return (
    <div className="ldm-overlay" onClick={handleClose}>
      <div className="ldm-modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="ldm-header">
          <AddCircleOutlinedIcon sx={{ fontSize: 17, color: "#6366f1" }} />
          New validation rule
          <button type="button" className="ldm-close" onClick={handleClose} aria-label="Close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        <div className="ldm-body">
          <div className="si-add-form">
            <div className="si-form-row">
              <label className="si-form-label">
                Tag
                <input
                  className="si-form-input"
                  value={form.tag}
                  onChange={(e) => update("tag", e.target.value)}
                  placeholder="e.g. min-length-4"
                  autoFocus
                />
              </label>

              <label className="si-form-label">
                Type
                <select
                  className="si-form-select"
                  value={form.type}
                  onChange={(e) => update("type", e.target.value)}
                >
                  {LEGACY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="si-form-row">
              {needsValue && (
                <label className="si-form-label">
                  Value
                  <input
                    className="si-form-input"
                    value={form.value}
                    onChange={(e) => update("value", e.target.value)}
                    placeholder={form.type === "pattern" ? "regex, e.g. ^[a-z]+$" : "numeric value"}
                  />
                </label>
              )}
              <label className="si-form-label">
                Category
                <input
                  className="si-form-input"
                  value={form.category}
                  onChange={(e) => update("category", e.target.value)}
                  placeholder="common"
                />
              </label>
            </div>

            <div className="si-form-row">
              <label className="si-form-label si-form-label--full">
                Message
                <input
                  className="si-form-input"
                  value={form.message}
                  onChange={(e) => update("message", e.target.value)}
                  placeholder="Shown to the user when validation fails"
                />
              </label>
            </div>

            {error && <span className="si-inline-error">{error}</span>}
          </div>
        </div>

        <div className="ldm-footer ldm-footer--gap">
          <button
            type="button"
            className="si-btn-add"
            onClick={handleCreate}
            disabled={saving}
          >
            {saving && <span className="si-spinner" />}
            {saving ? "Saving…" : "Create rule"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}