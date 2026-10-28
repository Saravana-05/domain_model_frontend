import { apiListRoles, apiListResources, apiGetRole, apiCreateResource, apiCreatePermission, apiSetRolePermissions } from "../../api/rbacApi";
import { apiGetDomainAbac, apiSaveDomainAbac } from "../../api/abacapi";
import type { ExportedDomainAccess } from "./exportJson";

// ════════════════════════════════════════════════════════════════════════════
// Domain-level RBAC / ABAC  ⇄  Domain Model JSON
//
// The "Access Control" screen stores its data in the backend:
//   RBAC → resources (one per domain model) × actions (create/view/edit/delete)
//          granted to roles
//   ABAC → per-domain rule list (GET/PUT /abac/domains/:name)
//
// loadDomainAccess()  reads both and returns them keyed by domain name, ready
//                     for buildDomainModelJson() to embed as `access`.
// applyDomainAccess() writes an imported `access` block back to the backend.
// ════════════════════════════════════════════════════════════════════════════

const uid = () => Math.random().toString(36).slice(2, 9);
const lc = (s: string) => String(s ?? "").trim().toLowerCase();
const ACTION_ORDER = ["create", "view", "read", "edit", "update", "delete", "approve", "reject"];
const sortAction = (a: string, b: string) => {
  const ai = ACTION_ORDER.indexOf(a), bi = ACTION_ORDER.indexOf(b);
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
};

const normalizeList = (val: any): any[] => {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") { try { return JSON.parse(val); } catch { return []; } }
  return [];
};

const ALL_ACTIONS = ["read", "create", "update", "delete"];
const OPERATORS = ["equals", "notEquals", "in", "notIn", "contains", "greaterThan", "lessThan"];

/** Backend condition → JSON condition. `source` is only written when it is "user" (record is the default);
 *  a literal value is written as `value`, an attribute comparison as `value_from: "user.x" | "record.x"`. */
function conditionToJson(c: any) {
  const out: Record<string, any> = {};
  if (c.source === "user") out.source = "user";
  out.attribute = c.attribute;
  out.operator = c.operator;
  if (c.valueKind === "userAttr") out.value_from = `user.${c.value}`;
  else if (c.valueKind === "recordField") out.value_from = `record.${c.value}`;
  else out.value = c.value;
  return out;
}

/** JSON condition → backend condition (with a fresh id). */
function conditionFromJson(c: any) {
  const m = typeof c?.value_from === "string" ? c.value_from.match(/^(user|record)\.(.+)$/) : null;
  return {
    id: uid(),
    source: c?.source === "user" ? "user" : "record",
    attribute: String(c?.attribute ?? ""),
    operator: OPERATORS.includes(c?.operator) ? c.operator : "equals",
    valueKind: m ? (m[1] === "user" ? "userAttr" : "recordField") : "literal",
    value: m ? m[2] : String(c?.value ?? ""),
  };
}

/** Backend ABAC rule → exported rule: no id, no actions; conditions included (when there are any).
 *  `fields` is kept here only so the exporter can place the rule under its attributes. */
function toExportRule(rule: any) {
  const out: Record<string, any> = {
    name: rule?.name ?? "",
    effect: rule?.effect ?? "allow",
    roles: Array.isArray(rule?.roles) ? rule.roles : [],
    fields: Array.isArray(rule?.fields) ? rule.fields : [],
  };
  if (Array.isArray(rule?.conditions) && rule.conditions.length) out.conditions = rule.conditions.map(conditionToJson);
  return out;
}

/**
 * Reads RBAC grants + ABAC rules from the backend for the given domain names.
 * Anything the current user isn't allowed to read (e.g. /rbac/roles is
 * admin-only) is simply left out instead of failing the whole export.
 */
export async function loadDomainAccess(domainNames: string[]): Promise<Record<string, ExportedDomainAccess>> {
  const out: Record<string, ExportedDomainAccess> = {};
  const byLower = new Map(domainNames.map((n) => [lc(n), n]));

  // ── RBAC: role → actions per resource ──────────────────────────────────────
  try {
    const [rolesRes, resRes] = await Promise.all([apiListRoles(), apiListResources()]);
    const roles: { id: string; name: string }[] = rolesRes.data ?? [];
    // permission id → { domain, action } (only for resources that are domain models here)
    const permInfo = new Map<string, { domain: string; action: string }>();
    for (const r of resRes.data ?? []) {
      const domain = byLower.get(lc(r.name));
      if (!domain) continue;
      for (const p of normalizeList(r.permissions)) permInfo.set(p.id, { domain, action: p.action });
    }
    const grants = await Promise.all(
      roles.map((r) =>
        apiGetRole(r.id)
          .then((res: any) => ({ role: r.name, perms: (res.data?.permissions ?? []).map((p: any) => p.id as string) }))
          .catch(() => ({ role: r.name, perms: [] as string[] }))
      )
    );
    for (const { role, perms } of grants) {
      const perDomain: Record<string, string[]> = {};
      for (const id of perms) {
        const info = permInfo.get(id);
        if (info) (perDomain[info.domain] ??= []).push(info.action);
      }
      for (const [domain, actions] of Object.entries(perDomain)) {
        ((out[domain] ??= {}).rbac ??= {})[role] = actions.sort(sortAction);
      }
    }
  } catch { /* not permitted / backend unreachable — RBAC left out */ }

  // ── ABAC: per-domain rules ─────────────────────────────────────────────────
  await Promise.all(domainNames.map(async (n) => {
    try {
      const rules = await apiGetDomainAbac(n);
      if (rules.length) (out[n] ??= {}).abac = rules.map(toExportRule);
    } catch { /* no rules / not permitted */ }
  }));

  return out;
}

/**
 * Writes imported domain-level access back to the backend.
 *  - RBAC: ensures the domain's resource + actions exist, then ADDS the
 *    listed actions to each named role (existing grants are kept). Roles that
 *    don't exist are skipped with a warning — roles are never created here.
 *  - ABAC: replaces the domain's rule list (rules without `actions` apply to all actions).
 */
export async function applyDomainAccess(
  access: Record<string, ExportedDomainAccess>,
  scopeFor: (domain: string) => { projectId?: string | null; moduleId?: string | null },
): Promise<{ rbacRoles: number; abacDomains: number; warnings: string[] }> {
  const warnings: string[] = [];
  let rbacRoles = 0, abacDomains = 0;
  const entries = Object.entries(access);
  if (!entries.length) return { rbacRoles, abacDomains, warnings };

  // ── RBAC ──
  const needsRbac = entries.some(([, a]) => a.rbac && Object.keys(a.rbac).length);
  if (needsRbac) {
    try {
      const roles: { id: string; name: string }[] = (await apiListRoles()).data ?? [];
      const roleByName = new Map(roles.map((r) => [lc(r.name), r]));
      let resources: any[] = (await apiListResources()).data ?? [];

      // 1. make sure resource + actions exist
      for (const [domain, a] of entries) {
        if (!a.rbac) continue;
        const wanted = new Set(Object.values(a.rbac).flat().map(lc));
        const existing = resources.find((r) => lc(r.name) === lc(domain));
        try {
          let id: string | undefined = existing?.id;
          if (!id) id = (await apiCreateResource(domain, `Domain model: ${domain}`)).data.id as string;
          const have = new Set(normalizeList(existing?.permissions).map((p: any) => lc(p.action)));
          for (const action of wanted) if (!have.has(action)) await apiCreatePermission(id!, action);
        } catch (e: any) { warnings.push(`RBAC resource "${domain}": ${e?.message ?? e}`); }
      }
      resources = (await apiListResources()).data ?? [];
      const permId = new Map<string, string>();
      for (const r of resources) for (const p of normalizeList(r.permissions)) permId.set(`${lc(r.name)}|${lc(p.action)}`, p.id);

      // 2. collect new permission ids per role
      const addByRole = new Map<string, Set<string>>();
      for (const [domain, a] of entries) {
        for (const [roleName, actions] of Object.entries(a.rbac ?? {})) {
          const role = roleByName.get(lc(roleName));
          if (!role) { warnings.push(`RBAC skipped: role "${roleName}" does not exist (${domain}).`); continue; }
          for (const action of actions) {
            const id = permId.get(`${lc(domain)}|${lc(action)}`);
            if (id) (addByRole.get(role.id) ?? addByRole.set(role.id, new Set()).get(role.id)!).add(id);
            else warnings.push(`RBAC skipped: ${roleName} › ${domain} › ${action} could not be created.`);
          }
        }
      }

      // 3. additive write: existing grants ∪ imported grants
      for (const [roleId, add] of addByRole) {
        try {
          const current = ((await apiGetRole(roleId)).data?.permissions ?? []).map((p: any) => p.id as string);
          await apiSetRolePermissions(roleId, [...new Set([...current, ...add])]);
          rbacRoles++;
        } catch (e: any) { warnings.push(`RBAC grants for role ${roleId}: ${e?.message ?? e}`); }
      }
    } catch (e: any) { warnings.push(`RBAC import failed: ${e?.message ?? e}`); }
  }

  // ── ABAC ──
  for (const [domain, a] of entries) {
    if (!a.abac?.length) continue;
    try {
      // Exported rules carry no actions → a rule applies to every action; conditions are rebuilt with ids.
      const fresh = a.abac.map((r: any) => ({
        id: uid(),
        name: r.name ?? "",
        effect: r.effect === "deny" ? "deny" : "allow",
        roles: Array.isArray(r.roles) ? r.roles : [],
        actions: Array.isArray(r.actions) && r.actions.length ? r.actions : ALL_ACTIONS,
        fields: Array.isArray(r.fields) ? r.fields : [],
        conditions: Array.isArray(r.conditions) ? r.conditions.map(conditionFromJson) : [],
      }));
      await apiSaveDomainAbac(domain, fresh, scopeFor(domain));
      abacDomains++;
    } catch (e: any) { warnings.push(`ABAC rules for "${domain}": ${e?.message ?? e}`); }
  }

  return { rbacRoles, abacDomains, warnings };
}