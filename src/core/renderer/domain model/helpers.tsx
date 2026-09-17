import React, { useState } from "react";
import ContentCopyIcon       from "@mui/icons-material/ContentCopy";
import CheckIcon             from "@mui/icons-material/Check";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import ExpandMoreIcon        from "@mui/icons-material/ExpandMore";
import ExpandLessIcon        from "@mui/icons-material/ExpandLess";
import type { AllSchemas, DomainDefinition } from "../../schema/types";
import type { BackendCreateResponse } from "../../api/datastoreApi";
import { toPascalCase, toCamelCase } from "../../schema/casting";

export { toPascalCase, toCamelCase };

export function dbLocation(res: BackendCreateResponse): string {
  if (res.db_backend === "postgresql" || res.pg_host) {
    const host = res.pg_host ?? "localhost";
    const db   = res.pg_db   ?? "";
    return `PostgreSQL (${host}${db ? `/${db}` : ""})`;
  }
  if (res.aws_region) return `DynamoDB (${res.aws_region})`;
  return "database";
}

export function buildJunctionDomain(
  parentDomainName: string,
  relatedDomainName: string,
): DomainDefinition {
  const junctionName = `${parentDomainName}_${relatedDomainName}`;
  const parentIdField  = `${parentDomainName}Id`;
  const relatedIdField = `${relatedDomainName}Id`;
  return {
    name: junctionName,
    fields: {
      [parentIdField]:  { type: "string" },
      [relatedIdField]: { type: "string" },
    },
  };
}

export function getAllFieldPaths(schemas: AllSchemas): string[] {
  return Object.entries(schemas.domains).flatMap(([domain, def]) =>
    Object.keys(def.fields).map((field) => `${domain}.${field}`)
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`si-badge si-badge--${color}`}>{label}</span>;
}

export function CopyBlock({ title, code }: { title: React.ReactNode; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="si-output">
      <div className="si-output-header">
        <span>{title}</span>
        <button
          className={`si-copy-btn ${copied ? "si-copy-btn--copied" : ""}`}
          type="button"
          onClick={() => navigator.clipboard.writeText(code).then(() => {
            setCopied(true); setTimeout(() => setCopied(false), 2000);
          })}
        >
          {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="si-code">{code}</pre>
    </div>
  );
}

export function AddSection({
  label, icon, children,
}: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="si-add-section">
      <button className="si-add-toggle" type="button" onClick={() => setOpen((o) => !o)}>
        {icon ?? <AddCircleOutlinedIcon sx={{ fontSize: 16 }} />}
        <span>{label}</span>
        {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </button>
      {open && <div className="si-add-body">{children}</div>}
    </div>
  );
}

export const LANG_ORDER: Array<"en" | "ta" | "ar"> = ["en", "ta", "ar"];

/** First non-empty label, preferring English, else field name as last resort. */
export function primaryLabel(labels: Record<"en" | "ta" | "ar", string>, fallback: string): string {
  for (const lang of LANG_ORDER) {
    if (labels[lang]?.trim()) return labels[lang].trim();
  }
  return fallback;
}