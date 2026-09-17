import type {
  AllSchemas, DomainDefinition, DomainFieldCore, FieldUIConfig,
  RBACFieldRule, ABACFieldRule, DomainViewConfig, NamedValidationRule,
} from "../../schema/types";
import { buildSchemas } from "../../schema/domainBuilder";

export interface ExtraSchemaState {
  newDomains:  DomainDefinition[];
  extraFields: Record<string, Record<string, DomainFieldCore>>;
  uiHints:     Record<string, FieldUIConfig>;
  rbacRules:   Record<string, RBACFieldRule>;
  abacRules:   Record<string, ABACFieldRule>;
  viewConfigs: Record<string, DomainViewConfig>;
  dbBackends:  Record<string, string>;
  versioned:   Record<string, boolean>;
  /** domainName -> project_id, as returned by GET /datastore/schemas.
   *  Populated in handleLoadFromBackend (SchemaInspector.tsx); undefined
   *  entries mean that domain model has no project (global/unassigned). */
  projectIds:  Record<string, string>;
  /**
   * Rules created on the spot via "Create new rule" in the field builder,
   * instead of being pre-written into src/validations/index.ts. Layered
   * on top of the static registry the same way extraFields/uiHints layer
   * on top of the static domain model — merged in mergeAll() below.
   * Persisted to the backend's validation_rules table (see
   * apiSaveValidationRule / handleAddValidationRule in
   * SchemaInspector.tsx) and reloaded into this same layer on mount via
   * handleLoadValidationRulesFromBackend(), so a rule created here
   * survives a page reload without needing to be manually copied into
   * src/validations/index.ts.
   */
  extraValidationRules: Record<string, NamedValidationRule>;

  /** Tracks which domain pairs already have a junction table to avoid duplicates */
  junctionPairs: Set<string>;
}

export const EMPTY_EXTRA: ExtraSchemaState = {
  newDomains: [], extraFields: {}, uiHints: {}, rbacRules: {}, abacRules: {},
  viewConfigs: {}, dbBackends: {}, versioned: {}, projectIds: {}, extraValidationRules: {}, junctionPairs: new Set(),
};
// ════════════════════════════════════════════════════════════════════════════
// Merge helper
// ════════════════════════════════════════════════════════════════════════════

export function mergeAll(base: AllSchemas, extra: ExtraSchemaState): AllSchemas {
  const isEmpty =
    extra.newDomains.length === 0 &&
    Object.keys(extra.extraFields).length === 0 &&
    Object.keys(extra.uiHints).length === 0 &&
    Object.keys(extra.rbacRules).length === 0 &&
    Object.keys(extra.abacRules).length === 0 &&
    Object.keys(extra.extraValidationRules).length === 0;
  if (isEmpty) return base;

  const newDomainNames = new Set(extra.newDomains.map((d) => d.name));
  const mergedNewDomains: DomainDefinition[] = extra.newDomains.map((dom) => ({
    ...dom,
    fields: { ...dom.fields, ...(extra.extraFields[dom.name] ?? {}) },
  }));
  const onlyExtraFieldDomains: DomainDefinition[] = Object.entries(extra.extraFields)
    .filter(([name]) => !newDomainNames.has(name))
    .map(([name, fields]) => ({ name, fields }));

  const allExtraDomains = [...mergedNewDomains, ...onlyExtraFieldDomains];

  // The registry passed here has to be the REAL, complete one — static
  // entries (base._layers?.validationRegistry) merged with session-only
  // "Create new rule" additions (extra.extraValidationRules) — the exact
  // same merge the final return statement below builds separately for
  // _layers.validationRegistry. Previously nothing was passed at all, so
  // buildSchemas() resolved every field's validationRefs against an empty
  // {} object regardless of whether the tag genuinely existed in the real
  // registry — and since baseSchemas always has domains: {} (deliberately
  // wiped above), EVERY domain's fields go through this exact call, not
  // just newly-created ones. That's why even a long-standing common tag
  // like "phone-format" never resolved to an actual enforceable rule
  // after a reload.
  const combinedRegistry = {
    ...(base._layers?.validationRegistry ?? {}),
    ...extra.extraValidationRules,
  };

  const extraBuilt = buildSchemas({
    domains: allExtraDomains,
    ui: { fields: extra.uiHints, screens: {} },
    access: {
      rbac: Object.keys(extra.rbacRules).length ? { fields: extra.rbacRules } : undefined,
      abac: Object.keys(extra.abacRules).length ? { rules: extra.abacRules } : undefined,
    },
    validations: { rules: combinedRegistry },
  });

  const mergedDomains = { ...base.domains };
  for (const [name, domDef] of Object.entries(extraBuilt.domains)) {
    if (mergedDomains[name]) {
      mergedDomains[name] = { fields: { ...mergedDomains[name].fields, ...domDef.fields } };
    } else {
      mergedDomains[name] = domDef;
    }
  }

  const mergedRBACFields: Record<string, RBACFieldRule> = {
    ...(base._layers?.rbac?.fields ?? {}),
    ...extra.rbacRules,
  };
  const mergedABACRules: Record<string, ABACFieldRule> = {
    ...(base._layers?.abac?.rules ?? {}),
    ...extra.abacRules,
  };

  return {
    domains:      mergedDomains,
    validations:  { ...base.validations,  ...extraBuilt.validations  },
    access:       { ...base.access,       ...extraBuilt.access       },
    uiExtensions: { ...base.uiExtensions, ...extraBuilt.uiExtensions },
    datasources:  base.datasources,
    ui:           base.ui,
    computed:     { ...base.computed,     ...extraBuilt.computed     },
    actions:      base.actions,
    env:          base.env,
    uiHints:      { ...(base.uiHints ?? {}), ...(extraBuilt.uiHints ?? {}) },
    _layers: {
      rbac: Object.keys(mergedRBACFields).length ? { fields: mergedRBACFields } : base._layers?.rbac,
      abac: Object.keys(mergedABACRules).length  ? { rules: mergedABACRules }  : base._layers?.abac,
      ui:   { ...(base._layers?.ui ?? {}), ...extra.uiHints },
      validationRegistry: combinedRegistry,
      validationRefs: { ...(base._layers?.validationRefs ?? {}), ...(extraBuilt._layers?.validationRefs ?? {}) },
    },
  };
}