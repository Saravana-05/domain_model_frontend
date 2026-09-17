import type { DomainFieldCore, RBACFieldRule, ABACFieldRule, NamedValidationRule } from "../../schema/types";


export function genDomainFieldCode(name: string, def: DomainFieldCore): string {
  const i = "    ";
  const lines = [`${i}${name}: {`];
  lines.push(`${i}  type: "${def.type}",`);
  if (def.relatedDomain)
    lines.push(`${i}  relatedDomain: "${def.relatedDomain}",`);
  if (def.listDomain)
    lines.push(`${i}  listDomain: "${def.listDomain}",`);
  if (def.default !== undefined && def.default !== "")
    lines.push(`${i}  default: ${def.type === "number" ? Number(def.default) : def.type === "boolean" ? def.default : `"${def.default}"`},`);
  if (def.format)     lines.push(`${i}  format: "${def.format}",`);
  if (def.computed)   lines.push(`${i}  computed: true,`);
  if (def.datasource) lines.push(`${i}  datasource: "${def.datasource}",`);
  if (def.validationRefs?.length)
    lines.push(`${i}  validationRefs: [${def.validationRefs.map((r) => `"${r}"`).join(", ")}],`);
  if (def.validations?.length) {
    lines.push(`${i}  validations: [`);
    for (const v of def.validations) {
      const val = v.value !== undefined ? `, value: ${isNaN(Number(v.value)) ? `"${v.value}"` : v.value}` : "";
      lines.push(`${i}    { type: "${v.type}"${val}, message: "${v.message}" },`);
    }
    lines.push(`${i}  ],`);
  }
  if (def.computedExpr) {
    const deps = def.computedExpr.dependsOn.map((d) => `"${d}"`).join(", ");
    lines.push(`${i}  computedExpr: { expression: "${def.computedExpr.expression}", dependsOn: [${deps}] },`);
  }
  lines.push(`${i}},`);
  return lines.join("\n");
}

export function genDomainFile(domainName: string, fields: Record<string, DomainFieldCore>): string {
  const varName = `${domainName}Domain`;
  return [
    `import type { DomainDefinition } from "../core/schema/types";`,
    ``,
    `// No UI, no access — see src/ui-config/ and src/access-config/`,
    `export const ${varName}: DomainDefinition = {`,
    `  name: "${domainName}",`,
    `  fields: {`,
    Object.entries(fields).map(([n, d]) => genDomainFieldCode(n, d)).join("\n\n"),
    `  },`,
    `};`,
  ].join("\n");
}

export function genRBACSnippet(rules: Record<string, RBACFieldRule>): string {
  const lines = Object.entries(rules).map(([path, rule]) => {
    const parts: string[] = [];
    if (rule.visible  !== undefined) parts.push(`visible: [${rule.visible.map((r) => `"${r}"`).join(", ")}]`);
    if (rule.read     !== undefined) parts.push(`read: [${rule.read.map((r) => `"${r}"`).join(", ")}]`);
    if (rule.write    !== undefined) parts.push(`write: [${rule.write.map((r) => `"${r}"`).join(", ")}]`);
    if (rule.disabled !== undefined) parts.push(`disabled: [${rule.disabled.map((r) => `"${r}"`).join(", ")}]`);
    return parts.length ? `  "${path}": { ${parts.join(", ")} },` : null;
  }).filter(Boolean);
  return lines.length ? `// Add inside fields in src/access-config/rbac.ts\n${lines.join("\n")}` : "";
}

export function genABACSnippet(rules: Record<string, ABACFieldRule>): string {
  const lines = Object.entries(rules).map(([path, rule]) => {
    const parts: string[] = [];
    if (rule.visible  !== undefined) parts.push(`visible: ${typeof rule.visible === "string" ? `"${rule.visible}"` : rule.visible}`);
    if (rule.write    !== undefined) parts.push(`write: ${rule.write}`);
    if (rule.disabled !== undefined) parts.push(`disabled: ${rule.disabled}`);
    return parts.length ? `  "${path}": { ${parts.join(", ")} },` : null;
  }).filter(Boolean);
  return lines.length ? `// Add inside rules in src/access-config/abac.ts\n${lines.join("\n")}` : "";
}


export function genRegistryRuleSnippet(tag: string, rule: NamedValidationRule): string {
  const lines = [`"${tag}": {`];
  if (rule.version) lines.push(`  version: "${rule.version}",`);
  if (rule.description) lines.push(`  description: "${rule.description.replace(/"/g, '\\"')}",`);
  if (rule.category) lines.push(`  category: "${rule.category}",`);
  lines.push(`  kind: "${rule.kind}",`);
  if (rule.expression !== undefined) lines.push(`  expression: "${rule.expression.replace(/"/g, '\\"')}",`);
  if (rule.min !== undefined) lines.push(`  min: ${rule.min},`);
  if (rule.max !== undefined) lines.push(`  max: ${rule.max},`);
  lines.push(`},`);
  return lines.join("\n");
}