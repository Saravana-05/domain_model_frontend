import type { DomainDefinition, DomainFieldCore, FieldType } from "./types";
import { toPascalCase, toCamelCase } from "./casting";

// ════════════════════════════════════════════════════════════════════════════
// Domain Model JSON import
//
// This is the exact inverse of buildDomainModelJson() / ExportedDomain in
// SchemaInspector.tsx (see the "Export" tab → "Domain model JSON" card).
// Anything that comes out of that export should round-trip back in here.
//
// Shape expected (either form is accepted):
//   { "domain_models": [ { "name": "...", "attributes": [ ... ] }, ... ] }
//   [ { "name": "...", "attributes": [ ... ] }, ... ]
//
// Each attribute:
//   {
//     "attribute_id": "clinicId",
//     "type": "text" | "number" | "boolean" | "date" | "list" | "image" | "domain model",
//     "cardinality": "one" | "many",
//     "related_domain_model"?: { "kind": "association", "linked_with": "clinic" }
//                             | { "kind": "integral",    "part_of":    "clinic" }
//                             | { "kind": "integral",    "contains":   "branch" },
//     "validations"?: ["required-name", ...]
//   }
//
// "integral" + "contains" attributes are the export's *synthesized* reverse
// side (e.g. clinic.branches, standing for "clinic contains branch") — they
// have no backing column anywhere and are re-derived automatically by
// synthesizeReverseAttributes() from the real child-side FK, so they are
// skipped on import rather than recreated as fake fields.
// ════════════════════════════════════════════════════════════════════════════

export interface ImportedAttributeWarning {
  domain: string;
  attribute: string;
  message: string;
}

export interface DomainModelImportResult {
  /** One DomainDefinition per imported domain, ready to merge into extraFields/newDomains. */
  domains: DomainDefinition[];
  /**
   * Fields (keyed by domain → fieldName) that are display-only relation
   * markers — type "relation" fields that never become a real backend
   * column. Mirrors what handleDomainCreated() persists via
   * saveRelationMarker() so they survive a reload the same way.
   */
  relationMarkers: Record<string, Record<string, DomainFieldCore>>;
  totalDomains: number;
  totalAttributes: number;
  skippedSynthesized: number;
  warnings: ImportedAttributeWarning[];
}

function mapImportedType(rawType: string): FieldType {
  if (rawType === "domain model") return "relation" as FieldType; // see note in types.ts — "relation" isn't in the FieldType union but is used everywhere as a de-facto field type
  if (rawType === "text") return "string";
  return rawType as FieldType;
}

/** Accepts either `{ domain_models: [...] }` or a bare `[...]` array. */
function extractDomainModelsArray(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.domain_models)) return parsed.domain_models;
  throw new Error(
    'Expected an object with a "domain_models" array (or a bare array of domain models).'
  );
}

/**
 * Parses a Domain Model export JSON (raw string) back into DomainDefinition[]
 * ready to be merged into the app's live schema state.
 * Throws Error with a human-readable message on malformed input.
 */
export function parseDomainModelImport(raw: string): DomainModelImportResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Invalid JSON: ${err?.message ?? String(err)}`);
  }

  const rawDomains = extractDomainModelsArray(parsed);
  if (rawDomains.length === 0) {
    throw new Error("No domain models found in the JSON.");
  }

  const domains: DomainDefinition[] = [];
  const relationMarkers: Record<string, Record<string, DomainFieldCore>> = {};
  const warnings: ImportedAttributeWarning[] = [];
  let totalAttributes = 0;
  let skippedSynthesized = 0;

  rawDomains.forEach((rawDomain: any, di: number) => {
    const rawDomainName = typeof rawDomain?.name === "string" ? rawDomain.name.trim() : "";
    if (!rawDomainName) {
      throw new Error(`Domain model at index ${di} is missing a "name".`);
    }
    // Domain model names are stored PascalCase regardless of how they
    // arrive in the imported JSON.
    const domainName = toPascalCase(rawDomainName);
    if (domainName !== rawDomainName) {
      warnings.push({ domain: domainName, attribute: "", message: `Domain name "${rawDomainName}" reformatted to PascalCase ("${domainName}") on import.` });
    }

    const rawAttributes: any[] = Array.isArray(rawDomain.attributes) ? rawDomain.attributes : [];
    const fields: Record<string, DomainFieldCore> = {};

    for (const attr of rawAttributes) {
      const rawAttributeId = typeof attr?.attribute_id === "string" ? attr.attribute_id.trim() : "";
      if (!rawAttributeId) {
        warnings.push({ domain: domainName, attribute: "", message: "Attribute missing attribute_id — skipped." });
        continue;
      }
      // Attribute names are stored camelCase regardless of how they
      // arrive in the imported JSON.
      const attributeId = toCamelCase(rawAttributeId);
      if (attributeId !== rawAttributeId) {
        warnings.push({ domain: domainName, attribute: attributeId, message: `Attribute "${rawAttributeId}" reformatted to camelCase ("${attributeId}") on import.` });
      }

      // Skip synthesized reverse attributes (the parent-side "contains" view
      // of another domain's integral FK) — they have no real column and are
      // re-derived automatically once the child domain's real FK is imported.
      const relation = attr.related_domain_model;
      if (relation && relation.kind === "integral" && "contains" in relation) {
        skippedSynthesized++;
        continue;
      }

      totalAttributes++;

      const field: DomainFieldCore = {
        type: mapImportedType(attr.type),
      };

      if (attr.cardinality === "many") {
        (field as any).cardinality = "list";
      }

      if (relation) {
        if (relation.kind === "association" && relation.linked_with) {
          field.relatedDomain = toPascalCase(relation.linked_with);
          field.relationKind = "association";
        } else if (relation.kind === "integral" && relation.part_of) {
          field.relatedDomain = toPascalCase(relation.part_of);
          field.relationKind = "integral";
        } else {
          warnings.push({ domain: domainName, attribute: attributeId, message: `Unrecognized related_domain_model shape — relation dropped: ${JSON.stringify(relation)}` });
        }
      }

      if (Array.isArray(attr.validations) && attr.validations.length > 0) {
        field.validationRefs = attr.validations.filter((v: any) => typeof v === "string");
      }

      if (field.type === "relation" && !field.relatedDomain) {
        warnings.push({ domain: domainName, attribute: attributeId, message: `type "domain model" but no related_domain_model — relation target unknown.` });
      }

      fields[attributeId] = field;

      // Relation fields never become real backend columns (same rule the
      // rest of the app follows — see handleAddFieldToExisting /
      // handleDomainCreated in SchemaInspector.tsx). Persist them as a
      // display-only marker so they survive a reload the same way fields
      // created via "Link a Domain Model" do.
      if (field.type === "relation" && field.relatedDomain) {
        relationMarkers[domainName] = { ...(relationMarkers[domainName] ?? {}), [attributeId]: field };
      }
    }

    domains.push({ name: domainName, fields });
  });

  return {
    domains,
    relationMarkers,
    totalDomains: domains.length,
    totalAttributes,
    skippedSynthesized,
    warnings,
  };
}