import type {
  BuildSchemasInput,
  AllSchemas,
  DomainDef,
  DomainFieldDef,
  ValidationRule,
  AccessRule,
  ComputedConfig,
  FieldUIConfig,
  RBACFieldRule,
} from "./types";

// ── RBAC → expression conversion ─────────────────────────────────────────────
// An empty array means "no role is allowed" → false (always denied).
// A non-empty array produces an OR-chain of auth.role equality checks.

function rolesToExpr(roles: string[]): string | false {
  if (roles.length === 0) return false;
  return roles.map((r) => `auth.role == '${r}'`).join(" || ");
}

function applyRBACField(
  path: string,
  rule: RBACFieldRule,
  access: Record<string, AccessRule>
): void {
  const merged: AccessRule = { ...(access[path] ?? {}) };

  if (rule.visible  !== undefined) {
    const expr = rolesToExpr(rule.visible);
    merged.visible = expr === false ? false : expr;
  }
  if (rule.read !== undefined) {
    const expr = rolesToExpr(rule.read);
    merged.read = expr === false ? false : expr;
  }
  if (rule.write !== undefined) {
    const expr = rolesToExpr(rule.write);
    merged.write = expr === false ? false : expr;
  }
  if (rule.disabled !== undefined) {
    const expr = rolesToExpr(rule.disabled);
    merged.disabled = expr === false ? true : expr; // disabled=[] → always disabled
  }

  access[path] = merged;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildSchemas(input: BuildSchemasInput): AllSchemas {
  const domains:      Record<string, DomainDef>       = {};
  const validations:  Record<string, ValidationRule[]> = {};
  const access:       Record<string, AccessRule>       = {};
  const uiExtensions: Record<string, { visibleWhen?: string; disabledWhen?: string }> = {};
  const computed:     Record<string, ComputedConfig>   = {};
  const uiHints:      Record<string, FieldUIConfig>    = {};

  const validationRefs: Record<string, string[]> = {}; // field path → tags (for _layers)
  const registry = input.validations?.rules ?? {};

  // ── Layer 1: Domain model ───────────────────────────────────────────────────
  for (const domainDef of input.domains) {
    const { name: domainName, fields: fieldDefs } = domainDef;
    const domainFields: Record<string, DomainFieldDef> = {};

    for (const [fieldName, fieldDef] of Object.entries(fieldDefs)) {
      const fullPath = `${domainName}.${fieldName}`;

      // Stripped core stored in AllSchemas.domains
      // For relation fields we also preserve relatedDomain so the
      // Domain Model tab can render the reference badge.
      const fieldEntry: DomainFieldDef = {
        type:     fieldDef.type,
        default:  fieldDef.default,
        computed: fieldDef.computed,
        format:   fieldDef.format,
      };
      if (fieldDef.type === "relation" && fieldDef.relatedDomain) {
        fieldEntry.relatedDomain = fieldDef.relatedDomain;
      }
      if (fieldDef.type === "list" && fieldDef.listDomain) {
        fieldEntry.listDomain = fieldDef.listDomain;
      }
      domainFields[fieldName] = fieldEntry;

      // Resolve validationRefs from registry, then append inline validations
      const resolved: ValidationRule[] = [];

      if (fieldDef.validationRefs?.length) {
        validationRefs[fullPath] = fieldDef.validationRefs;
        for (const tag of fieldDef.validationRefs) {
          const rule = registry[tag];
          if (rule) {
            resolved.push(rule);
          } else {
            console.warn(`[buildSchemas] Validation tag "${tag}" not found in registry (field: ${fullPath})`);
          }
        }
      }

      if (fieldDef.validations?.length) {
        resolved.push(...fieldDef.validations);
      }

      if (resolved.length) {
        validations[fullPath] = resolved;
      }

      // Computed expression
      if (fieldDef.computedExpr) {
        computed[fullPath] = {
          expression: fieldDef.computedExpr.expression,
          dependsOn:  fieldDef.computedExpr.dependsOn.map((dep) =>
            dep.includes(".") ? dep : `${domainName}.${dep}`
          ),
          domain: domainName,
        };
      }
    }

    domains[domainName] = { fields: domainFields };
  }

  // ── Layer 2: UI configuration ───────────────────────────────────────────────
  for (const [path, hint] of Object.entries(input.ui.fields ?? {})) {
    uiHints[path] = hint;
  }

  // ── Layer 3a: ABAC rules ────────────────────────────────────────────────────
  for (const [path, rule] of Object.entries(input.access?.abac?.rules ?? {})) {
    const merged: AccessRule = { ...(access[path] ?? {}) };

    if (rule.visible  !== undefined) {
      // String expressions go into uiExtensions.visibleWhen for the resolver;
      // boolean false goes directly into access.visible.
      if (typeof rule.visible === "string") {
        uiExtensions[path] = { ...uiExtensions[path], visibleWhen: rule.visible };
      } else {
        merged.visible = rule.visible;
      }
    }
    if (rule.disabled !== undefined) {
      if (typeof rule.disabled === "string") {
        uiExtensions[path] = { ...uiExtensions[path], disabledWhen: rule.disabled };
      } else {
        merged.disabled = rule.disabled;
      }
    }
    if (rule.read  !== undefined) merged.read  = rule.read;
    if (rule.write !== undefined) merged.write = rule.write;

    if (Object.keys(merged).length) access[path] = merged;
  }

  // ── Layer 3b: RBAC rules (converted to auth expressions) ───────────────────
  for (const [path, rule] of Object.entries(input.access?.rbac?.fields ?? {})) {
    applyRBACField(path, rule, access);
  }

  // write: false → collapse into disabled when no explicit disabled rule set
  for (const [path, rule] of Object.entries(access)) {
    if (rule.write === false && rule.disabled === undefined) {
      access[path] = { ...rule, disabled: true };
    }
  }

  return {
    domains,
    validations,
    access,
    uiExtensions,
    datasources: input.datasources ?? {},
    ui:          { screens: input.ui.screens },
    computed,
    actions:     input.actions,
    env:         input.env,
    uiHints,
    // Preserve source layers so SchemaInspector can render each separately
    _layers: {
      rbac:               input.access?.rbac,
      abac:               input.access?.abac,
      ui:                 input.ui.fields,
      validationRegistry: registry,
      validationRefs,
    },
  };
}