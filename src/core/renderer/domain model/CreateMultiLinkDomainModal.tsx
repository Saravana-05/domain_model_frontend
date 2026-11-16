import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import CloseIcon from "@mui/icons-material/Close";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import { toPascalCase } from "./helpers";

interface CreateMultiLinkDomainModalProps {
  open: boolean;
  domainNames: string[];
  onClose: () => void;
  onCreate: (name: string, linkedDomains: string[]) => Promise<void>;
}

export function CreateMultiLinkDomainModal({
  open,
  domainNames,
  onClose,
  onCreate,
}: CreateMultiLinkDomainModalProps) {
  const selectableDomains = domainNames;
  const [name, setName] = useState("");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setSelectedDomains([]);
    setNameTouched(false);
    setBusy(false);
    setError("");
  }, [open]);

  if (!open) return null;

  const normalizedName = toPascalCase(name);
  const validName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedName);
  const canSubmit = !busy && selectedDomains.length >= 2 && validName;

  function toggleDomain(domain: string) {
    setSelectedDomains((current) => {
      const next = current.includes(domain)
        ? current.filter((value) => value !== domain)
        : [...current, domain];
      if (!nameTouched) setName(next.join(""));
      return next;
    });
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(normalizedName, selectedDomains);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return ReactDOM.createPortal(
    <div className="ldm-overlay" onClick={() => !busy && onClose()}>
      <form
        className="ldm-modal"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 520, maxWidth: "92vw" }}
      >
        <div className="ldm-header">
          <LinkOutlinedIcon sx={{ fontSize: 16 }} />
          <span>Create multi-link domain</span>
          <button className="ldm-close" type="button" onClick={onClose} disabled={busy}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        </div>

        <div className="ldm-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, color: "var(--color-text-secondary)", fontSize: 13 }}>
            Create one associative domain containing an ID field for each selected domain.
            Each row represents one complete link.
          </p>

          <label className="si-form-label">
            <span className="si-form-label-text">Multi-link domain name *</span>
            <input
              className="si-form-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
                setError("");
              }}
              placeholder="e.g. OutputTaskUser"
              required
            />
            {name && !validName && (
              <span className="si-inline-error">Use letters, numbers, and underscores; start with a letter or underscore.</span>
            )}
          </label>

          <div className="si-form-label">
            <span className="si-form-label-text">Domains to link * (select at least two)</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, maxHeight: 220, overflowY: "auto", padding: 8, border: "1px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)" }}>
              {selectableDomains.map((domain) => (
                <label key={domain} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedDomains.includes(domain)}
                    onChange={() => toggleDomain(domain)}
                  />
                  <span>{domain}</span>
                </label>
              ))}
              {selectableDomains.length === 0 && (
                <span className="si-data-empty-hint">Create or load domains before creating a multi-link domain.</span>
              )}
            </div>
          </div>

          {selectedDomains.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              Fields created: {selectedDomains.map((domain) => `${domain}Id`).join(", ")}
            </div>
          )}
          {error && <div className="si-inline-error">{error}</div>}
        </div>

        <div className="ldm-footer ldm-footer--gap">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            {busy ? "Creating…" : "Create multi-link domain"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
