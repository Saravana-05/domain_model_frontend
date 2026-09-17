import React, { useRef, useState } from "react";
import ReactDOM from "react-dom";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import StorageIcon from "@mui/icons-material/Storage";
import { parseDomainModelImport, type DomainModelImportResult } from "./domainImport";

interface ImportDomainModelModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: DomainModelImportResult) => void;
}

const PLACEHOLDER = `{
  "domain_models": [
    {
      "name": "clinic",
      "attributes": [
        { "attribute_id": "name", "type": "text", "cardinality": "one" }
      ]
    }
  ]
}`;

export function ImportDomainModelModal({ open, onClose, onConfirm }: ImportDomainModelModalProps) {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<DomainModelImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function reset() {
    setRaw("");
    setResult(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleParse(text?: string) {
    const source = text ?? raw;
    try {
      const parsed = parseDomainModelImport(source);
      setResult(parsed);
      setError(null);
    } catch (err: any) {
      setResult(null);
      setError(err?.message ?? String(err));
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRaw(text);
      handleParse(text);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
    // allow re-selecting the same file later
    e.target.value = "";
  }

  function handleConfirm() {
    if (!result) return;
    onConfirm(result);
    reset();
  }

  return ReactDOM.createPortal(
    <div className="ldm-overlay" onClick={handleClose}>
      <div className="ldm-modal" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "92vw" }}>

        <div className="ldm-header">
          <CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />
          <span>Import Domain Model JSON</span>
          <button className="ldm-close" type="button" onClick={handleClose}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        </div>

        <div className="ldm-body">
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 0 }}>
            Paste JSON in the same shape as the <strong>Export → Domain model JSON</strong> card
            (domains, attributes, types, cardinality, and "integral"/"association" relations),
            or upload a <code>.json</code> file. Domain models will be created and shown in the
            Domain Model tab.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="btn btn-secondary" type="button" onClick={() => fileInputRef.current?.click()}>
              <CloudUploadOutlinedIcon sx={{ fontSize: 14 }} /> Upload .json file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>

          <textarea
            className="si-form-input"
            style={{ width: "100%", minHeight: 200, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            placeholder={PLACEHOLDER}
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setResult(null); setError(null); }}
          />

          {error && (
            <div style={{
              marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start",
              padding: "8px 10px", borderRadius: "var(--border-radius-md)",
              background: "#fef2f2", color: "#991b1b", fontSize: 12,
            }}>
              <span style={{ flexShrink: 0 }}>❌</span>
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 10 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                padding: "8px 10px", borderRadius: "var(--border-radius-md)",
                background: "#f0fdf4", color: "#166534", fontSize: 12,
              }}>
                <CheckIcon sx={{ fontSize: 15 }} />
                <span>
                  Parsed <strong>{result.totalDomains}</strong> domain model(s), <strong>{result.totalAttributes}</strong> attribute(s)
                  {result.skippedSynthesized > 0 ? ` — ${result.skippedSynthesized} synthesized reverse attribute(s) skipped (auto-derived)` : ""}.
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                {result.domains.map((d) => (
                  <div key={d.name} style={{
                    padding: "8px 10px", borderRadius: "var(--border-radius-md)",
                    border: "1px solid var(--color-border-secondary)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <StorageIcon sx={{ fontSize: 14, color: "#7e22ce" }} />
                      <strong style={{ fontSize: 13 }}>{d.name}</strong>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        {Object.keys(d.fields).length} field(s)
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {Object.entries(d.fields).map(([fname, f]) => (
                        <span key={fname} className={`si-badge si-badge--${f.type === "relation" ? "indigo" : "purple"}`} title={f.relatedDomain ? `${f.relationKind ?? "relation"} → ${f.relatedDomain}` : f.type}>
                          {fname}
                          {f.relatedDomain ? ` 🔗${f.relatedDomain}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {result.warnings.length > 0 && (
                <div style={{
                  marginTop: 8, display: "flex", flexDirection: "column", gap: 4,
                  padding: "8px 10px", borderRadius: "var(--border-radius-md)",
                  background: "#fffbeb", color: "#92400e", fontSize: 11,
                }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ flexShrink: 0 }}>⚠️</span>
                      <span>{w.domain}{w.attribute ? `.${w.attribute}` : ""}: {w.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ldm-footer ldm-footer--gap">
          {!result ? (
            <button className="btn btn-primary" type="button" onClick={() => handleParse()} disabled={!raw.trim()}>
              Preview
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={handleConfirm}>
              <CheckIcon sx={{ fontSize: 15 }} /> Import {result.totalDomains} domain model(s)
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={handleClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}