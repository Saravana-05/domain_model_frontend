import { toCamelCase } from "../../schema/casting";
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
 * Relationship metadata for a relation attribute:
 *  - linked_to         → the other domain model
 *  - relationship_type → "association" (loose reference, junction table) or
 *                        "integral" (composition — the child only exists
 *                        under its owner)
 *  - owned_by          → for integral links, the owning (parent) domain —
 *                        the same on both sides of the link; "NA" for
 *                        associations, which have no owner.
 */
export interface ExportedRelation {
  linked_to: string;
  relationship_type: "association" | "integral";
  owned_by: string;
}

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

/** Junction tables (`A_B` with exactly the two FK columns `AId` and `BId`)
 *  are an implementation detail of associations — recreated on import — so
 *  they're left out of the export. */
function isJunctionDomain(name: string, fields: Record<string, any>): boolean {
  const keys = Object.keys(fields);
  if (keys.length !== 2 || !name.includes("_")) return false;
  const [a, ...rest] = name.split("_");
  const b = rest.join("_");
  return keys.includes(`${a}Id`) && keys.includes(`${b}Id`);
}

/** A child-side integral FK is a single-valued "xId" field; the parent-side
 *  link is the to-many attribute (e.g. vehicleModels). */
function isChildFk(fieldName: string, fieldDef: any): boolean {
  return fieldDef.cardinality !== "list" && /Id$/.test(fieldName);
}

/** Resolves the related domain even when only the FK naming convention
 *  survives (the backend doesn't persist relatedDomain, so after a reload a
 *  FK like manufacturerId is a plain string with relationKind "integral"). */
function resolveRelatedDomain(fieldName: string, fieldDef: any, allDomains: AllSchemas["domains"]): string {
  if (fieldDef.relatedDomain) return fieldDef.relatedDomain;
  if (fieldName.endsWith("Id")) {
    const stem = fieldName.slice(0, -2).toLowerCase();
    const match = Object.keys(allDomains).find((d) => d.toLowerCase() === stem);
    if (match) return match;
  }
  return "";
}

/**
 * Synthesizes the parent-side attribute for every integral FK pointing AT
 * this domain (e.g. VehicleModel.manufacturerId → Manufacturer gives
 * Manufacturer a "vehicleModels" attribute), unless the parent already has
 * an explicit attribute linking to that child. It has no backing column —
 * it only makes the parent→children link visible from the parent's side.
 */
export function synthesizeReverseAttributes(domainName: string, allDomains: AllSchemas["domains"]): ExportedDomainField[] {
  const reverse: ExportedDomainField[] = [];
  const ownFields = allDomains[domainName]?.fields ?? {};
  for (const [childDomainName, childDef] of Object.entries(allDomains)) {
    if (childDomainName === domainName || isJunctionDomain(childDomainName, childDef.fields)) continue;
    const hasFkToMe = Object.entries(childDef.fields).some(([fn, fd]) =>
      (fd as any).relationKind === "integral" && isChildFk(fn, fd) && resolveRelatedDomain(fn, fd, allDomains) === domainName);
    if (!hasFkToMe) continue;
    const alreadyExplicit = Object.entries(ownFields).some(([fn, fd]) =>
      (fd as any).relationKind === "integral" && !isChildFk(fn, fd) && fd.relatedDomain === childDomainName);
    if (alreadyExplicit) continue;
    reverse.push({
      attribute_id: toCamelCase(pluralize(childDomainName)),
      type: "domain_model",
      cardinality: "many",
      related_domain_model: { linked_to: childDomainName, relationship_type: "integral", owned_by: domainName },
    });
  }
  return reverse;
}

export function buildDomainModelJson(schemas: AllSchemas): { domain_models: ExportedDomain[] } {
  const domain_models: ExportedDomain[] = Object.entries(schemas.domains)
    .filter(([domainName, def]) => !isJunctionDomain(domainName, def.fields))
    .map(([domainName, def]) => {
    const realAttributes: ExportedDomainField[] = Object.entries(def.fields).map(([fieldName, fieldDef]) => {
      const relationKind = (fieldDef as any).relationKind;
      const isRelation = fieldDef.type === "relation" || relationKind === "association" || relationKind === "integral";
      const out: ExportedDomainField = {
        attribute_id: fieldName,
        type: isRelation ? "domain_model" : fieldDef.type === "string" ? "text" : fieldDef.type,
        cardinality: fieldDef.cardinality === "list" || fieldDef.cardinality === "many" ? "many" : "one",
      };
      const relatedDomain = resolveRelatedDomain(fieldName, fieldDef, schemas.domains);
      if (relationKind === "association") {
        out.related_domain_model = { linked_to: relatedDomain, relationship_type: "association", owned_by: "NA" };
      } else if (relationKind === "integral") {
        // Child side (real stored FK): owner is the related domain.
        // Parent side (explicit to-many attribute): owner is this domain.
        const owner = isChildFk(fieldName, fieldDef) ? relatedDomain : domainName;
        out.related_domain_model = { linked_to: relatedDomain, relationship_type: "integral", owned_by: owner };
      }
      const validationRefs = schemas._layers?.validationRefs?.[`${domainName}.${fieldName}`];
      if (validationRefs && validationRefs.length > 0) out.validations = validationRefs;
      return out;
    });

    const reverseAttributes = synthesizeReverseAttributes(domainName, schemas.domains);

    // Every domain's table has an implicit primary key (the backend's own
    // "id" column) that never appears as a user-defined field. Surface it
    // as the first attribute — `<domain>Id`, unique + required — unless the
    // domain already declares its own (`<domain>Id` or `id`).
    const primaryKeyName = `${toCamelCase(domainName)}Id`;
    const hasOwnPrimaryKey = Object.keys(def.fields).some((f) => f === primaryKeyName || f === "id");
    const primaryKey: ExportedDomainField[] = hasOwnPrimaryKey ? [] : [{
      attribute_id: primaryKeyName,
      type: "text",
      cardinality: "one",
      validations: ["unique", "required"],
    }];

    return { name: domainName, attributes: [...primaryKey, ...realAttributes, ...reverseAttributes] };
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