import React from "react";
import StorageIcon             from "@mui/icons-material/Storage";
import PaletteOutlinedIcon     from "@mui/icons-material/PaletteOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import type { AllSchemas } from "../../schema/types";
import { Badge, CopyBlock } from "./helpers";
import { buildDomainModelJson, buildUiConfigJson, buildValidationsJsonSplit } from "./exportJson";

export function ExportJsonTab({ schemas }: { schemas: AllSchemas }) {
  const domainModelJson = buildDomainModelJson(schemas);
  const uiConfigJson = buildUiConfigJson(schemas);
  const { common: commonValidations, byCategory: validationsByCategory } = buildValidationsJsonSplit(schemas);
  const realAttrCount = domainModelJson.domain_models.reduce(
    (sum, d) => sum + d.attributes.filter(a => !(a.related_domain_model && "contains" in a.related_domain_model)).length, 0
  );
  const synthesizedCount = domainModelJson.domain_models.reduce(
    (sum, d) => sum + d.attributes.filter(a => a.related_domain_model && "contains" in a.related_domain_model).length, 0
  );

  return (
    <div className="si-domains">
      <div className="si-card">
        <div className="si-card-header">
          <StorageIcon sx={{ fontSize: 16, color: "#7e22ce" }} />
          <span className="si-domain-name">Domain Model</span>
          <span className="si-field-count">
            {domainModelJson.domain_models.length} domain model(s) — {realAttrCount} real attribute(s)
            {synthesizedCount > 0 ? ` + ${synthesizedCount} synthesized reverse attribute(s)` : ""} — no UI/label data, no duplication
          </span>
        </div>
        <div style={{ padding: "0 16px 16px 16px" }}>
          <CopyBlock title="Domain model JSON" code={JSON.stringify(domainModelJson, null, 2)} />
        </div>
      </div>

      <div className="si-card">
        <div className="si-card-header">
          <PaletteOutlinedIcon sx={{ fontSize: 16, color: "#0f766e" }} />
          <span className="si-domain-name">UI Config</span>
          <span className="si-field-count">{Object.keys(uiConfigJson).length} attribute(s) with UI settings — keyed "domain.attribute_id"</span>
        </div>
        <div style={{ padding: "0 16px 16px 16px" }}>
          <CopyBlock title="UI config JSON" code={JSON.stringify(uiConfigJson, null, 2)} />
        </div>
      </div>

      {/* Common validations — one shared block, exported ONCE regardless
          of how many domains reference any given rule. Split out from the
          per-category blocks below specifically so a rule like
          "required-name" never gets duplicated across clinic's AND
          doctor's AND every other domain's JSON just because they all
          happen to use it. */}
      <div className="si-card">
        <div className="si-card-header">
          <CheckCircleOutlinedIcon sx={{ fontSize: 16, color: "#334155" }} />
          <span className="si-domain-name">Common — Validations</span>
          <span className="si-field-count">{commonValidations.validations.length} rule(s) — reusable across any domain</span>
        </div>
        <div style={{ padding: "0 16px 16px 16px" }}>
          <CopyBlock title="Common validations JSON" code={JSON.stringify(commonValidations, null, 2)} />
        </div>
      </div>

      {/* One card per category (domain-specific rules only) — grouped by
          the rule's own `category`, not by which domain's fields happen
          to reference it, so nothing here overlaps with the Common block
          above. A category only appears here once it has at least one
          rule — there's no forced empty card for every domain anymore. */}
      {Object.entries(validationsByCategory).map(([category, categoryValidations]) => {
        const cardinalityCount = categoryValidations.validations.filter(v => v.kind === "cardinality").length;
        return (
          <div className="si-card" key={category}>
            <div className="si-card-header">
              <CheckCircleOutlinedIcon sx={{ fontSize: 16, color: "#92400e" }} />
              <span className="si-domain-name">{category} — Validations</span>
              <span className="si-field-count">
                {categoryValidations.validations.length} rule(s)
                {cardinalityCount > 0 ? ` — ${cardinalityCount} "cardinality" (authored, not yet enforced)` : ""}
              </span>
            </div>
            <div style={{ padding: "0 16px 16px 16px" }}>
              <CopyBlock title={`${category} validations JSON`} code={JSON.stringify(categoryValidations, null, 2)} />
            </div>
          </div>
        );
      })}

      <div className="si-tip">
        <span>
          💡 Every attribute always carries <code>cardinality</code> (<code>"one"</code> by default, <code>"many"</code> when List is
          checked). <code>related_domain_model</code> only appears on actual relation attributes, and its key names the
          relationship directly instead of a generic role: <code>linked_with</code> for an association (either direction),
          <code>part_of</code> on the real stored FK (this domain is the child, e.g. <code>branch.clinic_id</code>), or
          <code>contains</code> on the synthesized reverse attribute on the parent domain (e.g. <code>clinic.branches</code> —
          this one has no real backing column, it's generated purely to make the relationship visible from the parent's own
          side). UI Config is a completely separate structure, referenced by the same <code>"domain.attribute_id"</code>{" "}
          key — nothing is duplicated between the two. Validations are split by <code>category</code>, not by which domain's
          fields reference a tag — a rule with <code>category: "common"</code> exports exactly once in the shared Common
          block no matter how many domains use it, while a domain-specific category (e.g. <code>"clinic"</code>) gets its own
          block with nothing overlapping the common one. <code>kind: "cardinality"</code> rules are exported correctly but
          aren't enforced by any field yet — there's no relation-count validation engine wired up to actually run them.
        </span>
      </div>
    </div>
  );
}