import type { ABACConfig } from "../core/schema/types";

// ── Attribute-Based Access Control ────────────────────────────────────────────
// Rules are evaluated as expressions against live field data and the auth context.
// Available in expressions:
//   - Any field path:  user.country, order.quantity, ...
//   - auth.*          auth.role, auth.userId, auth.permissions, ...
//   - env.*           env.mode, env.version, ...
//
// Rule properties:
//   visible:  show/hide the field          (default: true)
//   disabled: disable input                (default: false)
//   read:     allow reading the value      (default: true)
//   write:    allow editing the value      (default: true)

export const abacConfig: ABACConfig = {
  rules: {

    // City is only visible once a country is selected
    "user.city": {
      visible: "user.country != ''",
    },

    // Price is a fixed reference value — no one can edit it in the demo
    "order.price": {
      write: false,
    },

    // Total is always computed — enforced read-only regardless of role
    "order.total": {
      write: false,
    },

    // ── Examples (uncomment to activate) ────────────────────────────────────
    // Only allow quantity edits when price is above zero
    // "order.quantity": {
    //   disabled: "order.price <= 0",
    // },

    // Mask email value for non-admin users (data privacy)
    // "user.email": {
    //   read: "auth.role == 'admin'",
    // },

  },
};
