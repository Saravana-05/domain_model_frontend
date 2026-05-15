import { buildSchemas } from "../core/schema/domainBuilder";
import { userDomain, orderDomain }   from "../domains";
import { uiConfig }                  from "../ui-config";
import { accessConfig }              from "../access-config";
import { validationRegistry }        from "../validations";

export const allSchemas = buildSchemas({

  // ── Layer 1: Domain model ──────────────────────────────────────────────────
  domains: [userDomain, orderDomain],

  // ── Layer 2: UI configuration ──────────────────────────────────────────────
  ui: uiConfig,

  // ── Layer 3: Access control (RBAC + ABAC) ─────────────────────────────────
  access: accessConfig,

  // ── Validation Registry ────────────────────────────────────────────────────
  validations: validationRegistry,

  // ── Datasources ────────────────────────────────────────────────────────────
  datasources: {
    countries: {
      type: "static",
      data: [
        { label: "India",          value: "IN" },
        { label: "United States",  value: "US" },
        { label: "United Kingdom", value: "UK" },
        { label: "Germany",        value: "DE" },
      ],
    },
    cities: {
      type:      "dependent",
      dependsOn: ["user.country"],
      resolver:  "fetchCities",
    },
  },

  // ── Actions ────────────────────────────────────────────────────────────────
  actions: {
    submitOrder: { type: "api", url: "/api/orders",  method: "POST", payload: "order" },
    submitUser:  { type: "api", url: "/api/users",   method: "POST", payload: "user"  },
    submitAll:   { type: "api", url: "/api/submit",  method: "POST", payload: "all"   },
  },

  // ── Environment ────────────────────────────────────────────────────────────
  env: {
    mode:    "development",
    version: "2.0.0",
  },

});
