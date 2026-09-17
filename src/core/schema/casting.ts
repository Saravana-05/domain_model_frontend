// ════════════════════════════════════════════════════════════════════════════
// Naming convention helpers
//
// The app stores domain model names PascalCase and attribute/field names
// camelCase, regardless of how a person typed or imported them. These are
// the single source of truth for that conversion — used by the interactive
// builders (CreateDomainTab, FieldBuilder, DomainPickers, MiniRelationModal,
// LinkDomainModal) AND by JSON import (domainImport.ts), so a name is
// reformatted the same way no matter which path it came in through.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Splits a freely-typed name into its constituent "words", regardless of
 * how it was written — camelCase, PascalCase, snake_case, kebab-case,
 * space separated, or any mix of these.
 */
function splitIntoWords(raw: string): string[] {
  return raw
    .trim()
    // insert a boundary between a lower/digit and a following upper
    // ("userName" -> "user Name")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // insert a boundary inside runs of caps followed by a lowercase
    // ("USERName" -> "USER Name")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    // any explicit separators become boundaries too
    .split(/[\s_\-.]+/)
    .filter(Boolean);
}

/** Formats freely-typed text as PascalCase — the convention domain model
 *  names are stored in (e.g. "user profile" / "user_profile" /
 *  "userProfile" all become "UserProfile"). */
export function toPascalCase(raw: string): string {
  return splitIntoWords(raw)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** Formats freely-typed text as camelCase — the convention attribute/field
 *  names are stored in (e.g. "First Name" / "first_name" / "FirstName" all
 *  become "firstName"). */
export function toCamelCase(raw: string): string {
  const pascal = toPascalCase(raw);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}