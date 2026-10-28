import type { DomainDefinition, DomainFieldCore, FieldType, RBACFieldRule, ABACFieldRule } from "../../schema/types";
import { toPascalCase, toCamelCase } from "../../schema/casting";

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
// Each domain may also carry domain-level access control:
//   "access": {
//     "rbac": { "Admin": ["create","view","edit","delete"], "Viewer": ["view"] },   // role → actions
//     "abac": [ { "name": "...", "effect": "allow"|"deny", "roles": [...], "conditions"?: [...], "fields": [...] } ]
//   }
//
// Each attribute:
//   {
//     "attribute_id": "clinicId",
//     "type": "text" | "number" | "boolean" | "date" | "list" | "image" | "domain model",
//     "cardinality": "one" | "many",
//     "related_domain_model"?: { "linked_to": "VehicleModel",
//                                "relationship_type": "integral" | "association",
//                                "owned_by": "Manufacturer" | "NA" }
//                             (legacy shapes below are still accepted)
//                             { "kind": "association", "linked_with": "clinic" }
//                             | { "kind": "integral",    "part_of":    "clinic" }
//                             | { "kind": "integral",    "contains":   "branch" },
//     "validations"?: ["required-name", ...],
//     "access"?: {
//       "rbac"?: { "visible"?: ["admin"], "read"?: [...], "write"?: [...], "disabled"?: [...] },   // field-level roles
//       "abac"?: [ { "name": "...", "effect": "allow"|"deny", "roles": [...], "conditions"?: [...] } ], // ABAC rules targeting THIS attribute
//       "abac_expression"?: { "visible"?: "user.country != ''", "write"?: false, ... }             // field-level expressions
//     }
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
  /** Association pairs that need a junction table (deduplicated). */
  associations: { a: string; b: string }[];
  /** RBAC rules pulled from each attribute's inline `access.rbac`, keyed "Domain.attribute". */
  rbacRules: Record<string, RBACFieldRule>;
  /** ABAC rules pulled from each attribute's inline `access.abac`, keyed "Domain.attribute". */
  abacRules: Record<string, ABACFieldRule>;
  /** Domain-level access from each domain's `access` block, keyed by PascalCase domain name. */
  domainAccess: Record<string, { rbac?: Record<string, string[]>; abac?: Record<string, any>[] }>;
  totalDomains: number;
  totalAttributes: number;
  skippedSynthesized: number;
  warnings: ImportedAttributeWarning[];
}

function mapImportedType(rawType: string): FieldType {
  if (rawType === "domain model" || rawType === "domain_model") return "relation" as FieldType; // see note in types.ts — "relation" isn't in the FieldType union but is used everywhere as a de-facto field type
  if (rawType === "text") return "string";
  return rawType as FieldType;
}

const RBAC_KEYS = ["visible", "read", "write", "disabled"] as const;
const ABAC_KEYS = ["visible", "read", "write", "disabled"] as const;

/** Validates an inline `access.rbac` block: each key must be an array of role strings. */
function parseRbacBlock(raw: any, warn: (msg: string) => void): RBACFieldRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { warn("access.rbac must be an object — ignored."); return null; }
  const rule: RBACFieldRule = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(RBAC_KEYS as readonly string[]).includes(k)) { warn(`Unknown access.rbac key "${k}" — ignored.`); continue; }
    if (!Array.isArray(v) || v.some((r) => typeof r !== "string")) { warn(`access.rbac.${k} must be an array of role names — ignored.`); continue; }
    (rule as any)[k] = v;
  }
  return Object.keys(rule).length ? rule : null;
}

/** Validates an inline `access.abac` block: each key is an expression string or a boolean. */
function parseAbacBlock(raw: any, warn: (msg: string) => void): ABACFieldRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { warn("access.abac must be an object — ignored."); return null; }
  const rule: ABACFieldRule = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(ABAC_KEYS as readonly string[]).includes(k)) { warn(`Unknown access.abac key "${k}" — ignored.`); continue; }
    if (typeof v !== "string" && typeof v !== "boolean") { warn(`access.abac.${k} must be an expression string or boolean — ignored.`); continue; }
    (rule as any)[k] = v;
  }
  return Object.keys(rule).length ? rule : null;
}

/** Accepts either `{ domain_models: [...] }` or a bare `[...]` array. */
function extractDomainModelsArray(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.domain_models)) return parsed.domain_models;
  throw new Error(
    'Expected an object with a "domain_models" array (or a bare array of domain models).'
  );
}

type RelationRole = "association" | "parent" | "child" | "synthesized";
interface NormalizedRelation { role: RelationRole; related: string }

/**
 * Normalizes every supported related_domain_model shape into a role:
 *
 *  Current shape:
 *    { linked_to, relationship_type: "association" | "integral", owned_by }
 *      association                          → association with linked_to
 *      integral, owned_by === this domain   → "parent": this domain owns linked_to
 *      integral, owned_by === linked_to     → "child":  this field is the FK to its owner
 *      integral, owned_by missing / "NA"    → decided by cardinality (many = parent)
 *
 *  Legacy export shape:
 *    { kind: "association", linked_with } | { kind: "integral", part_of } | { kind: "integral", contains }
 */
function normalizeRelation(domainName: string, attr: any, relation: any): NormalizedRelation | null {
  if (!relation || typeof relation !== "object") return null;

  // ── legacy ──
  if (relation.kind) {
    if (relation.kind === "association" && relation.linked_with)
      return { role: "association", related: toPascalCase(relation.linked_with) };
    if (relation.kind === "integral" && relation.part_of)
      return { role: "child", related: toPascalCase(relation.part_of) };
    if (relation.kind === "integral" && relation.contains)
      return { role: "synthesized", related: toPascalCase(relation.contains) };
    return null;
  }

  // ── current ──
  const linkedTo = typeof relation.linked_to === "string" ? relation.linked_to.trim() : "";
  if (!linkedTo) return null;
  const related = toPascalCase(linkedTo);
  const type = String(relation.relationship_type ?? "").toLowerCase();

  if (type === "association") return { role: "association", related };
  if (type === "integral") {
    const ownerRaw = typeof relation.owned_by === "string" ? relation.owned_by.trim() : "";
    const owner = ownerRaw && ownerRaw.toUpperCase() !== "NA" ? toPascalCase(ownerRaw) : "";
    if (owner && owner === domainName && related !== domainName) return { role: "parent", related };
    if (owner && owner === related && owner !== domainName) return { role: "child", related };
    return { role: attr?.cardinality === "many" ? "parent" : "child", related };
  }
  return null;
}

/** Removes trailing commas before } or ] (outside of string literals). */
function stripTrailingCommas(raw: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      out += c;
      if (c === "\\") { out += raw[++i] ?? ""; }
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === "}" || raw[j] === "]") continue;
    }
    out += c;
  }
  return out;
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
    try {
      // Be lenient with trailing commas, a common hand-editing slip.
      parsed = JSON.parse(stripTrailingCommas(raw));
    } catch {
      throw new Error(`Invalid JSON: ${err?.message ?? String(err)}`);
    }
  }

  const rawDomains = extractDomainModelsArray(parsed);
  if (rawDomains.length === 0) {
    throw new Error("No domain models found in the JSON.");
  }

  const domains: DomainDefinition[] = [];
  const relationMarkers: Record<string, Record<string, DomainFieldCore>> = {};
  const warnings: ImportedAttributeWarning[] = [];
  const rbacRules: Record<string, RBACFieldRule> = {};
  const abacRules: Record<string, ABACFieldRule> = {};
  const domainAccess: DomainModelImportResult["domainAccess"] = {};
  // ABAC rules found under individual attributes: domain → [{ field, rule }]. Merged into
  // domainAccess[domain].abac (as one rule with a `fields` list) just before returning.
  const attrAbac: Record<string, { field: string; rule: Record<string, any> }[]> = {};
  let totalAttributes = 0;
  let skippedSynthesized = 0;
  const parentLinks: { parent: string; child: string }[] = [];
  const childFkDomains = new Set<string>(); // "Child->Parent" pairs that already have an explicit FK
  const associations: { a: string; b: string }[] = [];

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

    // Domain-level access (RBAC role → actions, ABAC rule list).
    if (rawDomain.access && typeof rawDomain.access === "object") {
      const dWarn = (message: string) => warnings.push({ domain: domainName, attribute: "", message });
      const acc: { rbac?: Record<string, string[]>; abac?: Record<string, any>[] } = {};
      const rawRbac = rawDomain.access.rbac;
      if (rawRbac !== undefined) {
        if (!rawRbac || typeof rawRbac !== "object" || Array.isArray(rawRbac)) dWarn("access.rbac must be an object of role → actions — ignored.");
        else {
          const rbac: Record<string, string[]> = {};
          for (const [role, actions] of Object.entries(rawRbac)) {
            if (!Array.isArray(actions) || actions.some((a) => typeof a !== "string")) { dWarn(`access.rbac["${role}"] must be an array of action names — ignored.`); continue; }
            rbac[role] = actions as string[];
          }
          if (Object.keys(rbac).length) acc.rbac = rbac;
        }
      }
      const rawAbac = rawDomain.access.abac;
      if (rawAbac !== undefined) {
        if (!Array.isArray(rawAbac) || rawAbac.some((r) => !r || typeof r !== "object")) dWarn("access.abac must be an array of rule objects — ignored.");
        else if (rawAbac.length) acc.abac = rawAbac;
      }
      if (acc.rbac || acc.abac) domainAccess[domainName] = acc;
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

      // Legacy "contains" attributes (synthesized reverse side) are skipped —
      // they have no real column and are re-derived from the child's FK.
      const rawRelation = attr.related_domain_model;
      const relation = normalizeRelation(domainName, attr, rawRelation);
      if (relation?.role === "synthesized") {
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
        field.type = "relation" as FieldType;
        field.relatedDomain = relation.related;
        field.relationKind = relation.role === "association" ? "association" : "integral";
        if (relation.role === "parent") parentLinks.push({ parent: domainName, child: relation.related });
        if (relation.role === "child") childFkDomains.add(`${domainName}->${relation.related}`);
        if (relation.role === "association") associations.push({ a: domainName, b: relation.related });
      } else if (rawRelation) {
        warnings.push({ domain: domainName, attribute: attributeId, message: `Unrecognized related_domain_model shape — relation dropped: ${JSON.stringify(rawRelation)}` });
      }

      if (Array.isArray(attr.validations) && attr.validations.length > 0) {
        field.validationRefs = attr.validations.filter((v: any) => typeof v === "string");
      }

      if (field.type === "relation" && !field.relatedDomain) {
        warnings.push({ domain: domainName, attribute: attributeId, message: `type "domain model" but no related_domain_model — relation target unknown.` });
      }

      fields[attributeId] = field;

      // Inline field-level access control → "Domain.attribute"-keyed rules,
      // the same shape the rbac / abac configs and extra.rbacRules use.
      if (attr.access && typeof attr.access === "object") {
        const warn = (message: string) => warnings.push({ domain: domainName, attribute: attributeId, message });
        const path = `${domainName}.${attributeId}`;
        if (attr.access.rbac !== undefined) {
          const rbac = parseRbacBlock(attr.access.rbac, warn);
          if (rbac) rbacRules[path] = rbac;
        }
        // `abac` as an ARRAY = ABAC rules targeting this attribute (backend rules).
        // `abac_expression` (or, from older exports, `abac` as an OBJECT) = field-level expressions.
        const rawAbac = attr.access.abac;
        if (Array.isArray(rawAbac)) {
          for (const rule of rawAbac) {
            if (!rule || typeof rule !== "object") { warn("access.abac entries must be rule objects — ignored."); continue; }
            const { fields: _ignored, ...body } = rule as any;
            (attrAbac[domainName] ??= []).push({ field: attributeId, rule: body });
          }
        } else if (rawAbac !== undefined) {
          const abac = parseAbacBlock(rawAbac, warn);
          if (abac) abacRules[path] = abac;
        }
        if (attr.access.abac_expression !== undefined) {
          const abac = parseAbacBlock(attr.access.abac_expression, warn);
          if (abac) abacRules[path] = abac;
        }
      }

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

  // ── Second pass: wire relations across domains ────────────────────────────
  const byName = new Map(domains.map((d) => [d.name, d]));

  // Every relation target must exist in this import (or already in the app).
  for (const d of domains) {
    for (const [fname, f] of Object.entries(d.fields)) {
      if (f.relatedDomain && !byName.has(f.relatedDomain)) {
        warnings.push({ domain: d.name, attribute: fname, message: `Links to "${f.relatedDomain}", which isn't in this JSON — it must already exist in the app.` });
      }
    }
  }

  // Integral (composition): the owning side's attribute implies a real FK on
  // the child. If the JSON didn't declare that FK explicitly, add it.
  for (const { parent, child } of parentLinks) {
    const childDomain = byName.get(child);
    if (!childDomain || childFkDomains.has(`${child}->${parent}`)) continue;
    const fkName = `${parent}Id`;
    if (childDomain.fields[fkName]) continue;
    const fk: DomainFieldCore = { type: "relation" as FieldType, relatedDomain: parent, relationKind: "integral" };
    childDomain.fields[fkName] = fk;
    relationMarkers[child] = { ...(relationMarkers[child] ?? {}), [fkName]: fk };
    childFkDomains.add(`${child}->${parent}`);
    totalAttributes++;
    warnings.push({ domain: child, attribute: fkName, message: `Added foreign key to "${parent}" (implied by ${parent}'s integral link to ${child}).` });
  }

  // Associations need a junction table; dedupe unordered pairs.
  const seenPairs = new Set<string>();
  const uniqueAssociations = associations.filter(({ a, b }) => {
    const key = [a, b].sort().join("__");
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });


  // Fold per-attribute ABAC rules into each domain's rule list. Identical rules
  // (same body) collapse into one rule whose `fields` lists every attribute it was found on;
  // a rule already covering ALL fields (empty `fields`) absorbs identical per-attribute copies.
  for (const [domain, entries] of Object.entries(attrAbac)) {
    const acc = (domainAccess[domain] ??= {});
    const rules: Record<string, any>[] = (acc.abac ??= []);
    for (const { field, rule } of entries) {
      const stable = (o: Record<string, any>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
      const key = stable(rule);
      const sameBody = (r: Record<string, any>) => {
        const { fields: _f, ...body } = r;
        return stable(body) === key;
      };
      const existing = rules.find(sameBody);
      if (!existing) rules.push({ ...rule, fields: [field] });
      else if (Array.isArray(existing.fields) && existing.fields.length > 0 && !existing.fields.includes(field)) existing.fields.push(field);
    }
  }

  return {
    domains,
    relationMarkers,
    associations: uniqueAssociations,
    rbacRules,
    abacRules,
    domainAccess,
    totalDomains: domains.length,
    totalAttributes,
    skippedSynthesized,
    warnings,
  };
}