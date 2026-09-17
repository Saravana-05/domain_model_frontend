import React, { useState } from "react";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CodeIcon         from "@mui/icons-material/Code";
import CheckIcon        from "@mui/icons-material/Check";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import type { AllSchemas, RBACFieldRule, ABACFieldRule } from "../../schema/types";
import { getAllFieldPaths, Badge, AddSection, CopyBlock } from "./helpers";
import { genRBACSnippet, genABACSnippet } from "./codeGenerators";

export interface AccessTabProps {
  schemas:       AllSchemas;
  onAddRBAC:     (path: string, rule: RBACFieldRule)  => void;
  onRemoveRBAC:  (path: string) => void;
  onAddABAC:     (path: string, rule: ABACFieldRule)  => void;
  onRemoveABAC:  (path: string) => void;
  extraRBACKeys: Set<string>;
  extraABACKeys: Set<string>;
}

export function AccessTab({
  schemas, onAddRBAC, onRemoveRBAC, onAddABAC, onRemoveABAC, extraRBACKeys, extraABACKeys,
}: AccessTabProps) {
  const [sub, setSub] = useState<"rbac" | "abac">("rbac");
  const rbac = schemas._layers?.rbac;
  const abac = schemas._layers?.abac;
  const fieldPaths = getAllFieldPaths(schemas);

  return (
    <div className="si-domains">
      <div className="si-sub-tabs">
        <button className={`si-sub-btn ${sub === "rbac" ? "si-sub-btn--active" : ""}`} type="button" onClick={() => setSub("rbac")}>
          <LockOutlinedIcon sx={{ fontSize: 15 }} />RBAC — Role-Based
        </button>
        <button className={`si-sub-btn ${sub === "abac" ? "si-sub-btn--active" : ""}`} type="button" onClick={() => setSub("abac")}>
          <CodeIcon sx={{ fontSize: 15 }} />ABAC — Attribute-Based
        </button>
      </div>

      {sub === "rbac" && (
        <>
          <div className="si-card">
            <AddSection label="Add RBAC Rule" icon={<LockOutlinedIcon sx={{ fontSize: 16 }} />}>
              <AddRBACForm fieldPaths={fieldPaths} onAdd={onAddRBAC} />
            </AddSection>
          </div>
          <div className="si-card">
            <div className="si-card-header">
              <LockOutlinedIcon sx={{ fontSize: 16, color: "#a16207" }} />
              <span className="si-domain-name">RBAC Rules</span>
              <span className="si-field-count">role arrays → compiled to auth expressions</span>
              <span className="si-layer-tag si-layer-tag--rbac">RBAC</span>
            </div>
            {!rbac || Object.keys(rbac.fields).length === 0 ? (
              <div className="si-empty">No RBAC rules — add one above or edit <code>src/access-config/rbac.ts</code></div>
            ) : (
              <table className="si-table">
                <thead>
                  <tr><th>Field</th><th>visible (roles)</th><th>read (roles)</th><th>write (roles)</th><th>disabled (roles)</th><th>Compiled</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {Object.entries(rbac.fields).map(([path, rule]) => {
                    const compiled = schemas.access[path];
                    const isExtra  = extraRBACKeys.has(path);
                    return (
                      <tr key={path}>
                        <td className="si-field-name">{path}</td>
                        <td>{renderRoles(rule.visible)}</td>
                        <td>{renderRoles(rule.read)}</td>
                        <td>{renderRoles(rule.write)}</td>
                        <td>{renderRoles(rule.disabled)}</td>
                        <td>
                          {compiled?.visible  !== undefined && <div><code className="si-expr">visible: {String(compiled.visible)}</code></div>}
                          {compiled?.write    !== undefined && <div><code className="si-expr">write: {String(compiled.write)}</code></div>}
                          {compiled?.disabled !== undefined && <div><code className="si-expr">disabled: {String(compiled.disabled)}</code></div>}
                        </td>
                        <td>
                          {isExtra
                            ? <span className="si-source-live"><span>live</span><button className="si-remove-btn" type="button" onClick={() => onRemoveRBAC(path)}><DeleteOutlinedIcon sx={{ fontSize: 13 }} /></button></span>
                            : <span className="si-muted">static</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {Object.keys(rbac?.fields ?? {}).length > 0 && (
            <CopyBlock title="Generated RBAC snippet" code={genRBACSnippet(rbac!.fields)} />
          )}
        </>
      )}

      {sub === "abac" && (
        <>
          <div className="si-card">
            <AddSection label="Add ABAC Rule" icon={<CodeIcon sx={{ fontSize: 16 }} />}>
              <AddABACForm fieldPaths={fieldPaths} onAdd={onAddABAC} />
            </AddSection>
          </div>
          <div className="si-card">
            <div className="si-card-header">
              <CodeIcon sx={{ fontSize: 16, color: "#c2410c" }} />
              <span className="si-domain-name">ABAC Rules</span>
              <span className="si-field-count">expression-based access evaluated at runtime</span>
              <span className="si-layer-tag si-layer-tag--abac">ABAC</span>
            </div>
            {!abac || Object.keys(abac.rules).length === 0 ? (
              <div className="si-empty">No ABAC rules — add one above or edit <code>src/access-config/abac.ts</code></div>
            ) : (
              <table className="si-table">
                <thead>
                  <tr><th>Field</th><th>visible</th><th>disabled</th><th>read</th><th>write</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {Object.entries(abac.rules).map(([path, rule]) => {
                    const isExtra = extraABACKeys.has(path);
                    return (
                      <tr key={path}>
                        <td className="si-field-name">{path}</td>
                        <td>{rule.visible  !== undefined ? <code className="si-expr">{String(rule.visible)}</code>  : <span className="si-muted">—</span>}</td>
                        <td>{rule.disabled !== undefined ? <code className="si-expr">{String(rule.disabled)}</code> : <span className="si-muted">—</span>}</td>
                        <td>{rule.read     !== undefined ? <code className="si-expr">{String(rule.read)}</code>     : <span className="si-muted">—</span>}</td>
                        <td>{rule.write    !== undefined ? <code className="si-expr">{String(rule.write)}</code>    : <span className="si-muted">—</span>}</td>
                        <td>
                          {isExtra
                            ? <span className="si-source-live"><span>live</span><button className="si-remove-btn" type="button" onClick={() => onRemoveABAC(path)}><DeleteOutlinedIcon sx={{ fontSize: 13 }} /></button></span>
                            : <span className="si-muted">static</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {Object.keys(abac?.rules ?? {}).length > 0 && (
            <CopyBlock title="Generated ABAC snippet" code={genABACSnippet(abac!.rules)} />
          )}
        </>
      )}
    </div>
  );
}

export function renderRoles(roles: string[] | undefined): React.ReactNode {
  if (roles === undefined) return <span className="si-muted">all</span>;
  if (roles.length === 0)  return <Badge label="∅ none" color="gray" />;
  return <span className="si-val-list">{roles.map((r) => <Badge key={r} label={r} color="purple" />)}</span>;
}

export function AddRBACForm({ fieldPaths, onAdd }: { fieldPaths: string[]; onAdd: (path: string, rule: RBACFieldRule) => void }) {
  const [path, setPath]       = useState("");
  const [visible, setVisible] = useState("");
  const [read, setRead]       = useState("");
  const [write, setWrite]     = useState("");
  const [disabled, setDis]    = useState("");
  const [saved, setSaved]     = useState(false);

  function parseRoles(s: string): string[] | undefined {
    const t = s.trim();
    return t === "" ? undefined : t.split(",").map((r) => r.trim()).filter(Boolean);
  }

  function submit() {
    if (!path.trim()) return;
    const rule: RBACFieldRule = {};
    const v = parseRoles(visible); if (v) rule.visible  = v;
    const r = parseRoles(read);    if (r) rule.read     = r;
    const w = parseRoles(write);   if (w) rule.write    = w;
    const d = parseRoles(disabled);if (d) rule.disabled = d;
    if (!Object.keys(rule).length) return;
    onAdd(path.trim(), rule);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setPath(""); setVisible(""); setRead(""); setWrite(""); setDis("");
  }

  return (
    <div className="si-layer-section si-layer-section--rbac">
      <div className="si-rbac-help">Leave blank = unrestricted (all roles). Enter comma-separated roles to restrict.</div>
      <div className="si-form-row">
        <label className="si-form-label" style={{ flex: 2 }}>
          Field path
          <input className="si-form-input" list="rbac-fp" value={path} onChange={(e) => setPath(e.target.value)} placeholder="user.role" />
          <datalist id="rbac-fp">{fieldPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="si-form-label">visible roles<input className="si-form-input" value={visible} onChange={(e) => setVisible(e.target.value)} placeholder="admin, manager" /></label>
        <label className="si-form-label">read roles<input className="si-form-input" value={read} onChange={(e) => setRead(e.target.value)} placeholder="admin" /></label>
        <label className="si-form-label">write roles<input className="si-form-input" value={write} onChange={(e) => setWrite(e.target.value)} placeholder="admin" /></label>
        <label className="si-form-label">disabled roles<input className="si-form-input" value={disabled} onChange={(e) => setDis(e.target.value)} placeholder="viewer" /></label>
      </div>
      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved ? <><CheckIcon sx={{ fontSize: 15 }} />Rule Added</> : <><LockOutlinedIcon sx={{ fontSize: 15 }} />Add RBAC Rule</>}
        </button>
      </div>
    </div>
  );
}

export function AddABACForm({ fieldPaths, onAdd }: { fieldPaths: string[]; onAdd: (path: string, rule: ABACFieldRule) => void }) {
  const [path, setPath]         = useState("");
  const [visible, setVisible]   = useState("");
  const [abacWrite, setWrite]   = useState<"" | "false">("");
  const [abacDis, setDisabled]  = useState<"" | "true">("");
  const [saved, setSaved]       = useState(false);

  function submit() {
    if (!path.trim()) return;
    const rule: ABACFieldRule = {};
    if (visible)   rule.visible  = visible;
    if (abacWrite) rule.write    = false;
    if (abacDis)   rule.disabled = true;
    if (!Object.keys(rule).length) return;
    onAdd(path.trim(), rule);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setPath(""); setVisible(""); setWrite(""); setDisabled("");
  }

  return (
    <div className="si-layer-section si-layer-section--abac">
      <div className="si-form-row">
        <label className="si-form-label" style={{ flex: 2 }}>
          Field path
          <input className="si-form-input" list="abac-fp" value={path} onChange={(e) => setPath(e.target.value)} placeholder="order.total" />
          <datalist id="abac-fp">{fieldPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="si-form-label" style={{ flex: 2 }}>
          Visible when <span className="si-hint">expression</span>
          <input className="si-form-input" value={visible} onChange={(e) => setVisible(e.target.value)} placeholder="user.country != ''" />
        </label>
        <label className="si-form-label">
          write
          <select className="si-form-select" value={abacWrite} onChange={(e) => setWrite(e.target.value as any)}>
            <option value="">no rule</option>
            <option value="false">false (read-only)</option>
          </select>
        </label>
        <label className="si-form-label">
          disabled
          <select className="si-form-select" value={abacDis} onChange={(e) => setDisabled(e.target.value as any)}>
            <option value="">no rule</option>
            <option value="true">true (always disabled)</option>
          </select>
        </label>
      </div>
      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved ? <><CheckIcon sx={{ fontSize: 15 }} />Rule Added</> : <><CodeIcon sx={{ fontSize: 15 }} />Add ABAC Rule</>}
        </button>
      </div>
    </div>
  );
}