import type {
  BuildSchemasInput,
  AllSchemas,
  DomainDef,
  DomainFieldDef,
  ValidationRule,
  NamedValidationRule,
  AccessRule,
  ComputedConfig,
  FieldUIConfig,
  RBACFieldRule,
} from "./types";

// ── Named validation registry rules → flat ValidationRule[] ──────────────────
// Every field-level runtime check (formplugin.tsx's validateField) only ever
// understands the old flat {type, value, message} shape. Rather than teach
// every call site the new composite/kind-based registry format, we flatten
// it back down to that shape right here, once, at build time — so nothing
// downstream of buildSchemas() needs to change at all.

function flattenNamedValidationRule(
  rule: NamedValidationRule,
  tag: string
): ValidationRule[] {
  // Legacy shape — already exactly a ValidationRule, pass through unchanged.
  if (rule.type) {
    return [{ type: rule.type, value: rule.value, message: rule.message ?? "" }];
  }

  const desc = rule.description ?? "";

  switch (rule.kind) {
    case "required":
      return [{ type: "required", message: desc || "This field is required" }];

    case "pattern":
      return rule.expression
        ? [{ type: "pattern", value: rule.expression, message: desc || "Invalid format" }]
        : [];

    case "custom":
      return rule.expression
        ? [{ type: "custom", value: rule.expression, message: desc || "Invalid value" }]
        : [];

    case "length": {
      const out: ValidationRule[] = [];
      if (rule.min !== undefined) out.push({ type: "minLength", value: rule.min, message: desc || `At least ${rule.min} characters` });
      if (rule.max !== undefined) out.push({ type: "maxLength", value: rule.max, message: desc || `At most ${rule.max} characters` });
      return out;
    }

    case "range": {
      const out: ValidationRule[] = [];
      if (rule.min !== undefined) out.push({ type: "min", value: rule.min, message: desc || `Minimum value is ${rule.min}` });
      if (rule.max !== undefined) out.push({ type: "max", value: rule.max, message: desc || `Maximum value is ${rule.max}` });
      return out;
    }

    case "cardinality":
      // Not a scalar-field check — "does this parent have at least N
      // related child rows" needs a relation-count validation engine that
      // doesn't exist yet. Rather than silently drop it with zero trace,
      // warn so it's obvious in the console why it isn't being enforced,
      // and skip contributing anything to the flat validations[] array.
      console.warn(
        `[buildSchemas] Validation tag "${tag}" is kind:"cardinality" — this is preserved for documentation/export but not enforced at runtime yet (no relation-count validation engine exists). It contributes no field-level check.`
      );
      return [];

    case "all":
      return (rule.validations ?? []).flatMap((sub) => flattenNamedValidationRule(sub, tag));

    default:
      return [];
  }
}

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
      // relatedDomain used to require fieldDef.type === "relation" — but
      // after a reload from the backend, a relation field's type comes
      // back as "string"/"text" (the backend never stores a literal
      // "relation" type; that's only ever a transient frontend-editing
      // concept). That type check meant relatedDomain got silently
      // dropped on every reload even once it was actually being sent to
      // and stored by the backend correctly (see the datastoreApi.ts
      // fix) — this only checks for the value's presence now, matching
      // how cardinality/relationKind are already checked just below.
      if (fieldDef.relatedDomain) {
        fieldEntry.relatedDomain = fieldDef.relatedDomain;
      }
      if (fieldDef.type === "list" && fieldDef.listDomain) {
        fieldEntry.listDomain = fieldDef.listDomain;
      }
      // cardinality and relationKind were both missing from this whitelist
      // entirely — every field silently reported cardinality "one" (even
      // actual List fields) and never carried relationKind past this point
      // at all, no matter what was set upstream. Any consumer reading from
      // AllSchemas.domains (like the Export tab) was seeing neither, ever.
      if ((fieldDef as any).cardinality) {
        (fieldEntry as any).cardinality = (fieldDef as any).cardinality;
      }
      if ((fieldDef as any).relationKind) {
        (fieldEntry as any).relationKind = (fieldDef as any).relationKind;
      }
      domainFields[fieldName] = fieldEntry;

      // Resolve validationRefs from registry, then append inline validations
      const resolved: ValidationRule[] = [];

      if (fieldDef.validationRefs?.length) {
        validationRefs[fullPath] = fieldDef.validationRefs;
        for (const tag of fieldDef.validationRefs) {
          const rule = registry[tag];
          if (rule) {
            resolved.push(...flattenNamedValidationRule(rule, tag));
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