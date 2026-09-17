import React, { useState } from "react";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import type { NamedValidationRule } from "../../schema/types";
import { NewValidationRuleModal } from "./NewValidationRuleModal";

export interface NewRegistryRuleFormProps {
  /** Tags already in the registry — passed straight through to the modal
   *  for the duplicate-tag check. */
  existingTags: string[];
  /** Called once the modal successfully creates a rule. The field builder
   *  uses this both to persist the rule (via onAddValidationRule) and to
   *  attach the new tag to the field currently being built. */
  onCreate: (tag: string, rule: NamedValidationRule) => void | Promise<void>;
}

/**
 * "Create new rule" in the field builder (Domain page) opens the same
 * modal the Validations tab's "+ New Rule" button uses — one shared form,
 * two entry points — instead of duplicating the creation UI or navigating
 * the user away from the field they're building.
 */
export function NewRegistryRuleForm({ existingTags, onCreate }: NewRegistryRuleFormProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <AddCircleOutlinedIcon sx={{ fontSize: 14 }} /> Create new rule
      </button>

      <NewValidationRuleModal
        open={open}
        onClose={() => setOpen(false)}
        existingTags={existingTags}
        onCreate={onCreate}
      />
    </>
  );
}