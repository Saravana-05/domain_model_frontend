import React from "react";
import ReactDOM from "react-dom";
import CodeIcon  from "@mui/icons-material/Code";
import CloseIcon from "@mui/icons-material/Close";
import { CopyBlock } from "./helpers";

interface DomainJsonModalProps {
  open:       boolean;
  domainName: string | null;
  json:       string;
  onClose:    () => void;
}

/**
 * Small, focused modal for the per-domain "Export" button in
 * DomainModelTab — shows exactly one domain's slice of the same JSON the
 * main Export tab produces (see buildDomainModelJson in exportJson.ts),
 * with the same CopyBlock copy-to-clipboard button. Mirrors the overlay/
 * modal styling already used by LinkDomainModal / ImportDomainModelModal
 * so it looks consistent with the rest of the app.
 */
export function DomainJsonModal({ open, domainName, json, onClose }: DomainJsonModalProps) {
  if (!open || !domainName) return null;

  return ReactDOM.createPortal(
    <div className="ldm-overlay" onClick={onClose}>
      <div className="ldm-modal" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: "92vw" }}>

        <div className="ldm-header">
          <CodeIcon sx={{ fontSize: 16 }} />
          <span>Domain model JSON — {domainName}</span>
          <button className="ldm-close" type="button" onClick={onClose}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        </div>

        <div className="ldm-body">
          <CopyBlock title={<>Domain model JSON — <code>{domainName}</code></>} code={json} />
        </div>

        <div className="ldm-footer ldm-footer--gap">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}