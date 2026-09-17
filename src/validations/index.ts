import type { ValidationRegistry } from "../core/schema/types";

// ── Validation Registry ───────────────────────────────────────────────────────
// Central catalog of named, reusable validation rules.
// Each key is a unique tag used in domain field definitions via validationRefs.
//
// Usage in a domain field:
//   validationRefs: ["required", "email-format"]
//
// Rules are resolved and merged into AllSchemas.validations by buildSchemas().
// Add inline one-offs directly on the field with validations: [...] instead.
//
// Two authoring shapes are both valid here, side by side:
//  - Legacy flat shape: { type, value, message } — every existing entry
//    below still uses this, unchanged.
//  - New kind-based shape: { kind, ... } — supports composite rules ("all",
//    grouping several checks under one tag), combined length/range bounds,
//    and cardinality (relation-count) rules. buildSchemas() flattens these
//    back into the legacy shape at build time, so referencing either kind
//    of tag from a field's validationRefs works identically either way.

export const validationRegistry: ValidationRegistry = {
  rules: {

    // ── Presence ──────────────────────────────────────────────────────────────
    "required":            { type: "required",  message: "This field is required",       category: "common" },
    "required-name":       { type: "required",  message: "Name is required",             category: "common" },
    "required-email":      { type: "required",  message: "Email is required",            category: "common" },
    "required-country":    { type: "required",  message: "Country is required",          category: "common" },
    "required-quantity":   { type: "required",  message: "Quantity is required",         category: "common" },

    // ── String length ─────────────────────────────────────────────────────────
    "min-length-2":        { type: "minLength", value: 2,   message: "At least 2 characters",   category: "common" },
    "min-length-3":        { type: "minLength", value: 3,   message: "At least 3 characters",   category: "common" },
    "min-length-8":        { type: "minLength", value: 8,   message: "At least 8 characters",   category: "common" },
    "max-length-50":       { type: "maxLength", value: 50,  message: "Maximum 50 characters",   category: "common" },
    "max-length-255":      { type: "maxLength", value: 255, message: "Maximum 255 characters",  category: "common" },

    // ── Numeric range ─────────────────────────────────────────────────────────
    "min-1":               { type: "min", value: 1,    message: "Minimum value is 1",      category: "common" },
    "min-0":               { type: "min", value: 0,    message: "Value cannot be negative", category: "common" },
    "max-100":             { type: "max", value: 100,  message: "Maximum value is 100",     category: "common" },
    "max-1000":            { type: "max", value: 1000, message: "Maximum value is 1000",    category: "common" },

    // ── Format patterns ───────────────────────────────────────────────────────
    "email-format":        { type: "pattern", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",  message: "Enter a valid email address",      category: "common" },
    "phone-format":        { type: "pattern", value: "^[+]?[0-9]{7,15}$",               message: "Enter a valid phone number",       category: "common" },
    "url-format":          { type: "pattern", value: "^https?:\\/\\/.+",                 message: "Enter a valid URL (https://...)", category: "common" },
    "alphanumeric":        { type: "pattern", value: "^[a-zA-Z0-9]+$",                  message: "Only letters and numbers allowed", category: "common" },
    "no-spaces":           { type: "pattern", value: "^\\S+$",                           message: "No spaces allowed",               category: "common" },

    // ── Custom / business rules ───────────────────────────────────────────────
    "must-be-positive":    { type: "custom",  value: "value > 0",     message: "Value must be greater than zero", category: "common" },
    "must-be-future-date": { type: "custom",  value: "value > today", message: "Date must be in the future",      category: "common" },

    // Domain-specific rules (valid_clinic_name, valid_branch_name,
    // valid_doctor_name) were removed — each was only ever used by exactly
    // one field in exactly one domain, so there was no cross-domain reuse
    // to justify a shared registry entry. That's exactly what Inline
    // Validations (in the field builder, right below Registry Rules) is
    // for — a rule scoped to one domain and used by only that domain's
    // field(s) belongs there instead. If a domain-specific rule is ever
    // actually reused by MULTIPLE fields within the same domain, "Create
    // new rule" in the field builder is still the right tool for that
    // (still tags it with that domain's category, e.g. category: "doctor").

  },
};