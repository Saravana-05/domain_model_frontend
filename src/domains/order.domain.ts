import type { DomainDefinition } from "../core/schema/types";

// ── Order domain — pure data model ────────────────────────────────────────────
// Validation rules referenced by tag from src/validations/index.ts
// UI config → src/ui-config/index.ts
// Access    → src/access-config/abac.ts + rbac.ts

export const orderDomain: DomainDefinition = {
  name: "order",
  fields: {

    quantity: {
      type:           "number",
      default:        1,
      validationRefs: ["required-quantity", "min-1", "max-100"],
    },

    price: {
      type:    "number",
      default: 99.99,
    },

    total: {
      type:     "number",
      default:  0,
      computed: true,
      computedExpr: {
        expression: "quantity * price",
        dependsOn:  ["quantity", "price"],
      },
    },

  },
};
