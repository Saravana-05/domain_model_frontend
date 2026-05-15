import type { DomainDefinition } from "../core/schema/types";

// ── User domain — pure data model ─────────────────────────────────────────────
// Validation rules referenced by tag from src/validations/index.ts
// UI config → src/ui-config/index.ts
// Access    → src/access-config/abac.ts + rbac.ts

export const userDomain: DomainDefinition = {
  name: "user",
  fields: {

    firstName: {
      type:           "string",
      default:        "",
      validationRefs: ["required-name", "min-length-2"],
    },

    lastName: {
      type:           "string",
      default:        "",
      validationRefs: ["required-name"],
    },

    email: {
      type:           "string",
      default:        "",
      format:         "email",
      validationRefs: ["required-email", "email-format"],
    },

    country: {
      type:           "string",
      default:        "",
      validationRefs: ["required-country"],
    },

    city: {
      type:    "string",
      default: "",
    },

    role: {
      type:    "string",
      default: "guest",
    },

    agreed: {
      type:           "boolean",
      default:        false,
      validationRefs: ["terms-accepted"],
    },

  },
};
