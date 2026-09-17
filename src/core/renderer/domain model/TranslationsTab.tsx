import React, { useState } from "react";
import StorageIcon      from "@mui/icons-material/Storage";
import CheckIcon        from "@mui/icons-material/Check";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import type { AllSchemas } from "../../schema/types";

export interface TranslationsTabProps {
  schemas: AllSchemas;
  onSave:  (domainName: string, fieldName: string, lang: "en" | "ta" | "ar", text: string) => void;
}

export function TranslationsTab({ schemas, onSave }: TranslationsTabProps) {
  const [edits, setEdits] = useState<Record<string, Record<"en" | "ta" | "ar", string>>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

const langs: Array<{ code: "ta" | "ar"; label: string; dir?: string }> = [
    { code: "ta", label: "Tamil (TA)" },
    { code: "ar", label: "Arabic (AR)", dir: "rtl" },
  ];

function getEdit(path: string, lang: "ta" | "ar"): string {
    // Only use stored edit value — don't fall back to shared label
    // (shared label causes both TA and AR to show same value and clear together)
    return edits[path]?.[lang] ?? "";
  }

function setEdit(path: string, lang: "ta" | "ar", value: string) {
    setEdits((prev) => ({
      ...prev,
      [path]: { ...(prev[path] ?? { ta: "", ar: "" }), [lang]: value },
    }));
  }

async function handleSave(domainName: string, fieldName: string, path: string) {
    const langEdits = edits[path] ?? {};
    for (const lang of (["ta", "ar"] as const)) {
      const text = langEdits[lang];
      if (text !== undefined && text.trim()) {
        await onSave(domainName, fieldName, lang, text.trim());
      }
    }
    setSaved((prev) => ({ ...prev, [path]: true }));
    setTimeout(() => setSaved((prev) => ({ ...prev, [path]: false })), 2000);
  }

  return (
    <div className="si-domains">
      {Object.entries(schemas.domains).map(([domainName, domainDef]) => (
        <div className="si-card" key={domainName}>
          <div className="si-card-header">
            <StorageIcon sx={{ fontSize: 16, color: "#7e22ce" }} />
            <span className="si-domain-name">{domainName}</span>
            <span className="si-field-count">{Object.keys(domainDef.fields).length} fields</span>
            <span className="si-layer-tag si-layer-tag--ui">Translations</span>
          </div>

          <table className="si-table">
            <thead>
              <tr>
                <th>Field</th>
                {langs.map((l) => <th key={l.code}>{l.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(domainDef.fields).map((fieldName) => {
                const path = `${domainName}.${fieldName}`;
                return (
                  <tr key={fieldName}>
                    <td className="si-field-name">{fieldName}</td>
                    {langs.map((l) => (
                      <td key={l.code}>
                        <input
                          className="si-form-input"
                          style={{ minWidth: 140 }}
                          value={getEdit(path, l.code)}
                          onChange={(e) => setEdit(path, l.code, e.target.value)}
                          placeholder={
                            l.code === "ta" ? "தமிழ்" :
                            l.code === "ar" ? "ا العربية" :
                            "English "
                          }
                          dir={l.dir}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className={`btn ${saved[path] ? "btn-secondary" : "btn-primary"}`}
                        type="button"
                        style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
                        onClick={() => handleSave(domainName, fieldName, path)}
                      >
                        {saved[path]
                          ? <><CheckIcon sx={{ fontSize: 13 }} /> Saved</>
                          : <><SaveOutlinedIcon sx={{ fontSize: 13 }} /> Save</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {Object.keys(schemas.domains).length === 0 && (
        <div className="si-card">
          <div className="si-empty">No domains yet — create one in "Create Domain" tab first.</div>
        </div>
      )}
    </div>
  );
}