export type FieldType = "string" | "number" | "decimal" | "boolean" | "date" | "list" | "image" | "relation";
export type ComponentType = "text" | "number" | "select" | "checkbox" | "textarea" | "date";
export type FieldFormat   = "email" | "phone" | "url" | "currency" | "percentage";
export type HttpMethod    = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// ── UI Styling primitives ─────────────────────────────────────────────────────
export type FontSize   = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";
export type FontWeight = "light" | "normal" | "medium" | "semibold" | "bold";
export type TextAlign  = "left" | "center" | "right";
export type FieldWidth = "auto" | "quarter" | "third" | "half" | "full";

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationRule {
  type: "required" | "min" | "max" | "minLength" | "maxLength" | "pattern" | "custom";
  value?: any;
  message: string;
  when?: string; // conditional — only run when expression is true
}

// ── Named validation registry entries (richer, composite-capable) ────────────
//
// The registry can now author rules in this richer shape — composite ("all",
// grouping several sub-rules under one name), combined-range kinds ("length"
// for min+max string length together, "range" for min+max numeric value
// together instead of two separate tags), and "cardinality" (how many
// related child records exist — a relation-count check, not a scalar field
// check at all).
//
// This is deliberately a SEPARATE, additive type from ValidationRule above,
// not a replacement — every existing registry entry (and the runtime
// validator in formplugin.tsx's validateField, which only ever understands
// the flat {type, value, message} shape) keeps working completely
// unchanged. buildSchemas() flattens any NamedValidationRule using the new
// `kind`-based shape back down into one or more plain ValidationRule
// objects before they reach a field's resolved validations[] — see
// flattenNamedValidationRule in domainBuilder.ts. The one exception is
// "cardinality": it can't be flattened into a scalar-field check (there's
// no such thing as "the string value of this field has at least 2 related
// rows"), so it's preserved as-is for documentation/export purposes, but
// nothing currently *enforces* it at runtime — that would need a genuinely
// new relation-count validation engine, which doesn't exist yet.
export type ValidationKind =
  | "required" | "pattern" | "length" | "range" | "cardinality" | "custom" | "all";

export interface NamedValidationRule {
  /** Human documentation only — not used by any resolution logic. */
  version?:     string;
  description?: string;
  /**
   * Which domain "owns" this rule, for grouping in the picker: "common"
   * for anything reusable across any domain (required, email-format,
   * etc.), or a specific domain name ("doctor", "clinic", "branch"...)
   * for rules that only make sense for that one domain's fields. Defaults
   * to "common" when omitted, so every pre-existing entry that predates
   * this field doesn't need to be touched to keep working the same way.
   */
  category?: string;

  /**
   * Which shape this entry uses. Omit entirely to use the legacy flat
   * shape below (type/value/message) instead — both are valid on the same
   * registry, so existing entries never need to be rewritten.
   */
  kind?: ValidationKind;

  // "pattern" | "custom" — the regex (pattern) or expression (custom)
  expression?: string;
  // "length" | "range" | "cardinality" — either bound can be omitted
  min?: number;
  max?: number;
  // "all" — nested sub-rules, each following this same shape (typically
  // without their own version/description — those belong on the parent)
  validations?: NamedValidationRule[];

  // ── Legacy flat shape — identical to ValidationRule, kept inline here
  // so an existing registry entry written the old way is still a fully
  // valid NamedValidationRule with no changes needed. ──────────────────────
  type?:    "required" | "min" | "max" | "minLength" | "maxLength" | "pattern" | "custom";
  value?:   any;
  message?: string;
}

// ── Access rule (resolved — used internally by engines) ───────────────────────

export interface AccessRule {
  visible?:  string | boolean;
  disabled?: string | boolean;
  read?:     string | boolean; // false → mask value
  write?:    string | boolean; // false → read-only
}

// ── Datasource ────────────────────────────────────────────────────────────────

export interface DatasourceConfig {
  type: "static" | "api" | "dependent";
  data?: Array<{ label: string; value: any }>;
  url?: string;
  dependsOn?: string[];
  paramMap?: Record<string, string>;
  resolver?: string;
}

// ── Computed ──────────────────────────────────────────────────────────────────

export interface ComputedConfig {
  expression: string;
  dependsOn:  string[];
  domain?:    string;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export interface ActionDef {
  type: "api" | "navigate" | "reset";
  url?: string;
  method?: HttpMethod;
  payload?: string;
  onSuccess?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Validation Registry  (separate, reusable, tagged rules)
// ════════════════════════════════════════════════════════════════════════════

// A registry entry is a normal ValidationRule stored under a unique string tag.
// Tags are referenced in DomainFieldCore.validationRefs.
export interface ValidationRegistry {
  rules: Record<string, NamedValidationRule>; // tag → rule
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 1 — Domain Model  (pure data: type, default, validations, computed)
// ════════════════════════════════════════════════════════════════════════════

export interface DomainFieldCore {
  type:             FieldType;
  default?:         any;
  format?:          FieldFormat;
  computed?:        boolean;
  /** Datasource key for select/autocomplete fields (moved from UI layer) */
  datasource?:      string;
  /**
   * When type === "relation", the name of the domain this field references.
   * Acts like a foreign-key pointer to another domain model.
   */
  relatedDomain?:   string;
  /**
   * Only meaningful for FK relation fields pointing at an EXISTING domain
   * (the "belongs-to" case, e.g. branch.clinicId → clinic). Tags whether
   * the relationship is structural ("integral" — the record only ever
   * exists under its related domain, no Add Existing/Remove downstream)
   * or a normal reassignable reference ("association" — Add Existing/
   * Remove shown downstream). Persisted through to the backend schema
   * field so the view-builder can read it.
   */
  relationKind?:    "integral" | "association";
  /**
   * For "relation" fields — whether this field points to a single related
   * record ("one") or a collection of them ("many"/"list"). Used by
   * exportJson.ts and draftConverters.ts to decide how to serialize the
   * relation (single FK vs. to-many).
   */
  cardinality?:     "one" | "many" | "list";
  /**
   * When type === "list", the name of the domain whose IDs this field stores.
   * Stores string[] of record IDs at runtime. Auto-created as
   * parentDomain_fieldName when the target domain does not yet exist.
   */
  listDomain?:      string;
  // Reusable rules — resolved from ValidationRegistry at build time
  validationRefs?:  string[];
  // Inline one-off rules (appended after refs)
  validations?:     ValidationRule[];
  computedExpr?:    { expression: string; dependsOn: string[] };
}

// ── Domain-level view configuration ───────────────────────────────────────────
export interface DomainViewConfig {
  /** How domain instances (rows) are displayed in table/grid view */
  tableView?: {
    enabled:       boolean;
    visibleFields?: string[];    // field names to show (omit = all)
    sortable?:     boolean;
    filterable?:   boolean;
    searchable?:   boolean;
    pageSize?:     number;
  };
  /** How domain instances are displayed in form/edit view */
  formView?: {
    enabled:  boolean;
    layout?:  "single" | "two-column" | "multi-column";
  };
  /** How domain instances are displayed in card/gallery view */
  cardView?: {
    enabled:        boolean;
    titleField?:    string;
    subtitleField?: string;
    imageField?:    string;
  };
}

export interface DomainDefinition {
  name:        string;
  fields:      Record<string, DomainFieldCore>;
  viewConfig?: DomainViewConfig;
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 2 — UI Configuration  (component, label, placeholder, datasource)
// ════════════════════════════════════════════════════════════════════════════

export interface FieldUIConfig {
  component?:       ComponentType;
  label?:           string;
  placeholder?:     string;
  /** @deprecated moved to DomainFieldCore.datasource; kept for backward compat */
  datasource?:      string;
  // ── Visual styling ─────────────────────────────────────────────────────────
  color?:           string;          // text color (CSS value, e.g. "#ef4444")
  backgroundColor?: string;          // background color
  borderColor?:     string;          // border color
  fontSize?:        FontSize;        // xs | sm | base | lg | xl | 2xl
  fontWeight?:      FontWeight;      // light | normal | medium | semibold | bold
  textAlign?:       TextAlign;       // left | center | right
  width?:           FieldWidth;      // auto | quarter | third | half | full
  icon?:            string;          // icon name/key
  tooltip?:         string;          // tooltip text
  hidden?:          boolean;         // hide from UI
  readOnly?:        boolean;         // render as read-only
  order?:           number;          // display order
  // ── Extra props passed through to renderer ─────────────────────────────────
  props?:           Record<string, any>;
}

export interface UILayerConfig {
  fields?:  Record<string, FieldUIConfig>; // "domain.field" → UI hint
  screens:  Record<string, ScreenDef>;
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 3 — Access Control
// ════════════════════════════════════════════════════════════════════════════

// ── RBAC: field-level role arrays ─────────────────────────────────────────────
// Each key is a list of roles that are ALLOWED to perform the action.
// [] (empty) = no role is allowed → always denied.
// Omitted   = no restriction → all roles allowed.

export interface RBACFieldRule {
  visible?:  string[]; // roles that can see this field
  read?:     string[]; // roles that can read the value
  write?:    string[]; // roles that can write
  disabled?: string[]; // roles for which field is rendered as disabled
}

export interface RBACConfig {
  fields: Record<string, RBACFieldRule>; // "domain.field" → rule
}

// ── ABAC: attribute/expression-based rules ────────────────────────────────────
// Expressions are evaluated against live data + auth context.
// e.g. visible: "user.country != ''"  |  write: "auth.role == 'admin'"

export interface ABACFieldRule {
  visible?:  string | boolean;
  disabled?: string | boolean;
  read?:     string | boolean;
  write?:    string | boolean;
}

export interface ABACConfig {
  rules: Record<string, ABACFieldRule>; // "domain.field" → rule
}

export interface AccessConfig {
  rbac?: RBACConfig;
  abac?: ABACConfig;
}

// ── Builder input ─────────────────────────────────────────────────────────────

export interface BuildSchemasInput {
  domains:      DomainDefinition[];
  ui:           UILayerConfig;
  access?:      AccessConfig;
  validations?: ValidationRegistry;   // named rule registry
  datasources?: Record<string, DatasourceConfig>;
  actions?:     Record<string, ActionDef>;
  env?:         Record<string, any>;
}

// ════════════════════════════════════════════════════════════════════════════
// Internal AllSchemas (compiled output — consumed by engines)
// ════════════════════════════════════════════════════════════════════════════

export interface DomainFieldDef {
  type:           FieldType;
  default?:       any;
  computed?:      boolean;
  format?:        FieldFormat;
  relatedDomain?: string;
  listDomain?:    string;
  /**
   * For "relation" fields — mirrors DomainFieldCore.cardinality. Added so
   * exportJson.ts can read fieldDef.cardinality off the compiled output,
   * not just the raw draft/core shape.
   */
  cardinality?:   "one" | "many" | "list";
}

export interface DomainDef {
  fields: Record<string, DomainFieldDef>;
}

export interface UIExtension {
  visibleWhen?:  string;
  disabledWhen?: string;
}

export interface AllSchemas {
  domains:      Record<string, DomainDef>;
  validations:  Record<string, ValidationRule[]>;
  access:       Record<string, AccessRule>;
  uiExtensions: Record<string, UIExtension>;
  datasources:  Record<string, DatasourceConfig>;
  ui:           { screens: Record<string, ScreenDef> };
  computed:     Record<string, ComputedConfig>;
  actions?:     Record<string, ActionDef>;
  env?:         Record<string, any>;
  uiHints?:     Record<string, FieldUIConfig>;
  // Source layers preserved for the Schema Inspector
  _layers?: {
    rbac?:               RBACConfig;
    abac?:               ABACConfig;
    ui?:                 Record<string, FieldUIConfig>;
    validationRegistry?: Record<string, NamedValidationRule>; // the raw registry
    validationRefs?:     Record<string, string[]>;       // field path → tags used
  };
}

// ════════════════════════════════════════════════════════════════════════════
// UI schema — layout types
// ════════════════════════════════════════════════════════════════════════════

export interface LayoutFieldNode {
  field:        string;
  component?:   ComponentType;
  label?:       string;
  placeholder?: string;
  datasource?:  string;
  props?:       Record<string, any>;
  type?:        "field";
}

export interface LayoutContainerNode {
  type:      "section" | "row" | "tabs";
  id?:       string;
  title?:    string;
  label?:    string;
  children?: LayoutNode[];
  tabs?:     Array<{ id: string; title: string; children: LayoutNode[] }>;
}

export type LayoutNode = LayoutFieldNode | LayoutContainerNode;

export interface ScreenDef {
  domain: string;
  layout: LayoutNode[];
}

// ════════════════════════════════════════════════════════════════════════════
// Resolver output
// ════════════════════════════════════════════════════════════════════════════

export interface ResolvedField {
  path:          string;
  domain:        string;
  name:          string;
  type:          FieldType;
  default?:      any;
  computed?:     boolean;
  format?:       FieldFormat;
  component:     ComponentType;
  label?:        string;
  placeholder?:  string;
  props?:        Record<string, any>;
  datasource?:   string;
  relatedDomain?: string;
  listDomain?:    string;
  validations:   ValidationRule[];
  access?:       AccessRule;
  computedConfig?: ComputedConfig;
}

export interface ResolvedScreen {
  screenId: string;
  domain:   string;
  fields:   Record<string, ResolvedField>;
  layout:   LayoutNode[];
}

export type DependencyGraph = Record<string, string[]>;