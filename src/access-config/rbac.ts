import type { RBACConfig } from "../core/schema/types";

// ── Role-Based Access Control ─────────────────────────────────────────────────
// Each entry specifies which ROLES are allowed to perform an action on a field.
//
//   visible:  [] → hidden from ALL roles
//   visible:  ["admin", "manager"] → only those roles can see it
//   write:    [] → read-only for ALL roles
//   write:    ["admin"] → only admin can edit
//   Omitted  → no restriction (any role can perform the action)
//
// RBAC rules are converted to auth expressions at build time:
//   write: ["admin"] → access.write = "auth.role == 'admin'"
//   write: []        → access.write = false

export const rbacConfig: RBACConfig = {
  fields: {

    // "role" is an internal system field — hidden from every role in the UI
    "user.role": {
      visible: [],
    },

    // ── Examples (uncomment to activate) ────────────────────────────────────
    // Only admin can edit the unit price
    // "order.price": {
    //   write: ["admin"],
    // },

    // Only managers and admins see the total
    // "order.total": {
    //   visible: ["admin", "manager"],
    // },

  },
};
