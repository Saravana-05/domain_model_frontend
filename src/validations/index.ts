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

export const validationRegistry: ValidationRegistry = {
  rules: {

    // ── Presence ──────────────────────────────────────────────────────────────
    "required":            { type: "required",  message: "This field is required"      },
    "required-name":       { type: "required",  message: "Name is required"            },
    "required-email":      { type: "required",  message: "Email is required"           },
    "required-country":    { type: "required",  message: "Country is required"         },
    "required-quantity":   { type: "required",  message: "Quantity is required"        },

    // ── String length ─────────────────────────────────────────────────────────
    "min-length-2":        { type: "minLength", value: 2,   message: "At least 2 characters"   },
    "min-length-3":        { type: "minLength", value: 3,   message: "At least 3 characters"   },
    "min-length-8":        { type: "minLength", value: 8,   message: "At least 8 characters"   },
    "max-length-50":       { type: "maxLength", value: 50,  message: "Maximum 50 characters"   },
    "max-length-255":      { type: "maxLength", value: 255, message: "Maximum 255 characters"  },

    // ── Numeric range ─────────────────────────────────────────────────────────
    "min-1":               { type: "min", value: 1,    message: "Minimum value is 1"     },
    "min-0":               { type: "min", value: 0,    message: "Value cannot be negative"},
    "max-100":             { type: "max", value: 100,  message: "Maximum value is 100"   },
    "max-1000":            { type: "max", value: 1000, message: "Maximum value is 1000"  },

    // ── Format patterns ───────────────────────────────────────────────────────
    "email-format":        { type: "pattern", value: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",  message: "Enter a valid email address"       },
    "phone-format":        { type: "pattern", value: "^[+]?[0-9]{7,15}$",               message: "Enter a valid phone number"        },
    "url-format":          { type: "pattern", value: "^https?:\\/\\/.+",                 message: "Enter a valid URL (https://...)"   },
    "alphanumeric":        { type: "pattern", value: "^[a-zA-Z0-9]+$",                  message: "Only letters and numbers allowed"  },
    "no-spaces":           { type: "pattern", value: "^\\S+$",                           message: "No spaces allowed"                },

    // ── Custom / business rules ───────────────────────────────────────────────
    "terms-accepted":      { type: "custom",  value: "value == true", message: "You must accept the Terms & Conditions" },
    "must-be-positive":    { type: "custom",  value: "value > 0",     message: "Value must be greater than zero"        },
    "must-be-future-date": { type: "custom",  value: "value > today", message: "Date must be in the future"            },

  },
};
