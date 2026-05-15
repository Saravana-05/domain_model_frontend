import type { UILayerConfig } from "../core/schema/types";

// ── UI Configuration ──────────────────────────────────────────────────────────
// Maps each field path to its rendering config: component, label, placeholder,
// datasource. Completely independent of the domain data model and access rules.
//
// Add a new field here whenever a domain field needs a UI representation.

export const uiConfig: UILayerConfig = {

  // ── Field UI hints ──────────────────────────────────────────────────────────
  fields: {
    // user domain
    "user.firstName": { component: "text",     label: "First Name", placeholder: "John"             },
    "user.lastName":  { component: "text",     label: "Last Name",  placeholder: "Doe"              },
    "user.email":     { component: "text",     label: "Email",      placeholder: "john@example.com" },
    "user.country":   { component: "select",   label: "Country",    datasource: "countries"         },
    "user.city":      { component: "select",   label: "City",       datasource: "cities"            },
    "user.agreed":    { component: "checkbox", label: "I accept the Terms & Conditions"             },

    // order domain
    "order.quantity": { component: "number",   label: "Quantity",             placeholder: "1" },
    "order.price":    { component: "number",   label: "Unit Price (USD)"                       },
    "order.total":    { component: "number",   label: "Total (auto-computed)"                  },
  },

  // ── Screen layouts ──────────────────────────────────────────────────────────
  // Layout only references field names — components/labels come from above.
  screens: {
    demo: {
      domain: "user",
      layout: [
        {
          type: "section",
          title: "Personal Information",
          children: [
            { type: "row", children: [{ field: "firstName" }, { field: "lastName" }] },
            { type: "row", children: [{ field: "email" }] },
            { type: "row", children: [{ field: "country" }, { field: "city" }] },
          ],
        },
        {
          type: "section",
          title: "Order Details",
          children: [
            { type: "row", children: [{ field: "order.quantity" }, { field: "order.price" }, { field: "order.total" }] },
          ],
        },
        {
          type: "section",
          title: "Agreement",
          children: [
            { type: "row", children: [{ field: "agreed" }] },
          ],
        },
      ],
    },
  },

};
