import type { AllSchemas, FieldUIConfig, NamedValidationRule } from "../../schema/types";

//
// Two independent, attribute_id-referenced structures, matching the layer
// separation the rest of this app already has conceptually (Domain Model
// tab vs UI Config tab) but that the backend's stored `schema` column
// doesn't yet enforce — component/label currently gets persisted twice
// (once at the field's top level, once again inside its ui_config). This
// export doesn't change persistence; it's a read-only projection of
// whatever's currently loaded, in the shape it *should* eventually be
// stored in.

/**
 * Instead of a generic role: "parent"|"child" enum, the KEY NAME itself
 * carries the relationship semantics:
 *  - association → { kind: "association", linked_with: <domain> }
 *  - integral, this domain is the child (the real stored FK) →
 *      { kind: "integral", part_of: <parent domain> }
 *  - integral, this domain is the parent (the synthesized reverse
 *    attribute — see synthesizeReverseAttributes below) →
 *      { kind: "integral", contains: <child domain> }
 * Each variant only ever has ONE of linked_with/part_of/contains — never
 * more than one, and the key itself is enough to tell which side/kind of
 * relationship this is without a separate role field.
 */
export type ExportedRelation =
  | { kind: "association"; linked_with: string }
  | { kind: "integral"; part_of: string }
  | { kind: "integral"; contains: string };

export interface ExportedDomainField {
  attribute_id: string;
  type: string;
  /** "one" when the field has no cardinality set, "many" when it's a list
   *  — every attribute gets this, not just relations. */
  cardinality: "one" | "many";
  /** Only present on actual relation attributes — everything else omits it. */
  related_domain_model?: ExportedRelation;
  /** Validation tags attached to this attribute (via the registry) — only
   *  present when non-empty, matching how branch.active (no validations)
   *  omits the key entirely rather than showing an empty array. */
  validations?: string[];
}

export interface ExportedDomain {
  name: string;
  attributes: ExportedDomainField[];
}

/** Naive English pluralization for synthesized reverse-attribute names
 *  (e.g. "branch" → "branches", "clinic" → "clinics"). Good enough for
 *  typical domain names; irregular plurals (e.g. "child" → "children")
 *  won't come out right — if that matters, rename the synthesized
 *  attribute_id by hand after exporting. */
export function pluralize(word: string): string {
  if (/[sxz]$|[^aeiou]h$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * For every domain, finds every OTHER domain with an "integral" relation
 * pointing AT it (e.g. branch.clinic_id → clinic) and synthesizes a
 * virtual "many" attribute representing the reverse direction (e.g.
 * clinic gets a synthesized "branches" attribute, tagged `contains:
 * "branch"`). This attribute has no real backing column anywhere — it
 * exists only in this export, to make the parent→children relationship
 * visible from the parent's own side too, not just discoverable by
 * scanning every other domain for FKs. No `validations` key is added
 * here — there's no real validation registry entry for a field that
 * doesn't actually exist, so nothing is fabricated for it.
 */
export function synthesizeReverseAttributes(domainName: string, allDomains: AllSchemas["domains"]): ExportedDomainField[] {
  const reverse: ExportedDomainField[] = [];
  for (const [childDomainName, childDef] of Object.entries(allDomains)) {
    if (childDomainName === domainName) continue;
    for (const fieldDef of Object.values(childDef.fields)) {
      const relationKind = (fieldDef as any).relationKind;
      if (relationKind === "integral" && fieldDef.relatedDomain === domainName) {
        reverse.push({
          attribute_id: pluralize(childDomainName),
          type: "text",
          cardinality: "many",
          related_domain_model: { kind: "integral", contains: childDomainName },
        });
      }
    }
  }
  return reverse;
}

export function buildDomainModelJson(schemas: AllSchemas): { domain_models: ExportedDomain[] } {
  const domain_models: ExportedDomain[] = Object.entries(schemas.domains).map(([domainName, def]) => {
    const realAttributes: ExportedDomainField[] = Object.entries(def.fields).map(([fieldName, fieldDef]) => {
      const out: ExportedDomainField = {
        attribute_id: fieldName,
        type: fieldDef.type === "relation" ? "domain model" : fieldDef.type === "string" ? "text" : fieldDef.type,
        cardinality: fieldDef.cardinality === "list" ? "many" : "one",
      };
      const relationKind = (fieldDef as any).relationKind;
      const relatedDomain = fieldDef.relatedDomain ?? "";
      if (relationKind === "association") {
        out.related_domain_model = { kind: "association", linked_with: relatedDomain };
      } else if (relationKind === "integral") {
        // This is always the real stored FK (the child side) — the
        // synthesized reverse/parent side is added separately below via
        // synthesizeReverseAttributes, never here.
        out.related_domain_model = { kind: "integral", part_of: relatedDomain };
      }
      const validationRefs = schemas._layers?.validationRefs?.[`${domainName}.${fieldName}`];
      if (validationRefs && validationRefs.length > 0) out.validations = validationRefs;
      return out;
    });

    const reverseAttributes = synthesizeReverseAttributes(domainName, schemas.domains);

    return { name: domainName, attributes: [...realAttributes, ...reverseAttributes] };
  });
  return { domain_models };
}

/** Keyed "domainName.attribute_id" → just the UI-facing properties, no
 *  duplication with the Domain Model JSON above (no type/cardinality/
 *  relation here — those live in the other file). */
export function buildUiConfigJson(schemas: AllSchemas): Record<string, FieldUIConfig> {
  const out: Record<string, FieldUIConfig> = {};
  const hints = schemas.uiHints ?? {};
  for (const [path, hint] of Object.entries(hints)) {
    if (hint && Object.keys(hint).length > 0) out[path] = hint;
  }
  return out;
}

// ── Validation Registry JSON ─────────────────────────────────────────────────
// Third export section — the named validation registry itself (not tied to
// any particular domain/field), in the same kind-based shape whether an
// entry was authored the new way or the old flat way. Legacy entries get
// converted into the new vocabulary purely for a uniform export — the
// underlying registry storage isn't touched, this is read-only same as the
// other two exports.

/** Converts one rule (either shape) into just its kind-specific fields —
 *  no validation_id/version/description, since those only apply at the
 *  top level (a nested sub-rule inside "all" doesn't repeat them). */
export function exportValidationRuleShape(rule: NamedValidationRule): Record<string, any> {
  // Legacy flat shape — translate into the new kind vocabulary so the
  // export is uniform regardless of how the entry was authored.
  if (rule.type) {
    switch (rule.type) {
      case "required":  return { kind: "required" };
      case "pattern":   return { kind: "pattern", expression: rule.value };
      case "custom":    return { kind: "custom", expression: rule.value };
      case "minLength": return { kind: "length", min: rule.value };
      case "maxLength": return { kind: "length", max: rule.value };
      case "min":       return { kind: "range", min: rule.value };
      case "max":       return { kind: "range", max: rule.value };
      default:          return { kind: rule.type };
    }
  }

  const out: Record<string, any> = { kind: rule.kind };
  if (rule.expression !== undefined) out.expression = rule.expression;
  if (rule.min !== undefined) out.min = rule.min;
  if (rule.max !== undefined) out.max = rule.max;
  if (rule.kind === "all" && rule.validations?.length) {
    out.validations = rule.validations.map(exportValidationRuleShape);
  }
  return out;
}

/**
 * Split by the rule's own `category` — NOT by which domain's fields
 * happen to reference it. This is the key difference from the earlier
 * per-domain approach: a rule with category "common" (required,
 * email-format, etc.) is only ever exported ONCE, in the shared common
 * block, even if ten different domains use it. Rules with a specific
 * category ("clinic", "doctor", "patient"...) go in that category's own
 * block instead. Nothing is ever duplicated across files, and each rule
 * lives in exactly one place — the common block if it's meant to be
 * reused anywhere, or its own domain's block if it's specific to one.
 */
export function buildValidationsJsonSplit(schemas: AllSchemas): {
  common: { validations: Record<string, any>[] };
  byCategory: Record<string, { validations: Record<string, any>[] }>;
} {
  const registry = schemas._layers?.validationRegistry ?? {};
  const common: Record<string, any>[] = [];
  const byCategory: Record<string, Record<string, any>[]> = {};

  for (const [tag, rule] of Object.entries(registry)) {
    const category = rule.category?.trim() || "common";
    const entry = {
      validation_id: tag,
      version: rule.version ?? "1.0",
      description: rule.description ?? rule.message ?? "",
      ...exportValidationRuleShape(rule),
    };
    if (category === "common") {
      common.push(entry);
    } else {
      (byCategory[category] ??= []).push(entry);
    }
  }

  return {
    common: { validations: common },
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { validations: v }])),
  };
}