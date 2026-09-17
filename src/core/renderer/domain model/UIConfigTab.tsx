import React, { useState } from "react";
import PaletteOutlinedIcon     from "@mui/icons-material/PaletteOutlined";
import DeleteOutlinedIcon      from "@mui/icons-material/DeleteOutlined";
import FormatPaintOutlinedIcon from "@mui/icons-material/FormatPaintOutlined";
import CheckIcon               from "@mui/icons-material/Check";
import SaveOutlinedIcon        from "@mui/icons-material/SaveOutlined";
import type {
  AllSchemas, ComponentType, FieldUIConfig, FontSize, FontWeight, TextAlign, FieldWidth,
} from "../../schema/types";
import { COMPONENTS, FONT_SIZES, FONT_WEIGHTS, TEXT_ALIGNS, FIELD_WIDTHS } from "./constants";
import { getAllFieldPaths, Badge, AddSection } from "./helpers";

export interface UIConfigTabProps {
  schemas:    AllSchemas;
  onAdd:      (path: string, hint: FieldUIConfig) => void;
  onRemove:   (path: string) => void;
  extraHints: Record<string, FieldUIConfig>;
}

export function UIConfigTab({ schemas, onAdd, onRemove, extraHints }: UIConfigTabProps) {
  const hints      = schemas.uiHints ?? {};
  const allPaths   = Object.keys(hints);
  const fieldPaths = getAllFieldPaths(schemas);

  const byDomain: Record<string, string[]> = {};
  for (const path of allPaths) {
    const domain = path.split(".")[0];
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(path);
  }

  return (
    <div className="si-domains">
      <div className="si-card">
        <AddSection label="Add UI Configuration for a field" icon={<PaletteOutlinedIcon sx={{ fontSize: 16 }} />}>
          <AddUIConfigForm fieldPaths={fieldPaths} onAdd={onAdd} />
        </AddSection>
      </div>

      {Object.keys(byDomain).length === 0 ? (
        <div className="si-card">
          <div className="si-empty">No UI configuration found — add one above or edit <code>src/ui-config/index.ts</code></div>
        </div>
      ) : (
        Object.entries(byDomain).map(([domain, paths]) => (
          <div className="si-card" key={domain}>
            <div className="si-card-header">
              <PaletteOutlinedIcon sx={{ fontSize: 16, color: "#0f766e" }} />
              <span className="si-domain-name">{domain}</span>
              <span className="si-field-count">{paths.length} fields configured</span>
              <span className="si-layer-tag si-layer-tag--ui">UI Config</span>
            </div>
            <table className="si-table">
              <thead>
                <tr>
                  <th>Field</th><th>Component</th><th>Label</th><th>Placeholder</th>
                  <th>Color</th><th>Bg Color</th><th>Font Size</th><th>Font Weight</th>
                  <th>Align</th><th>Width</th><th>Tooltip</th><th>Flags</th><th>Source</th>
                </tr>
              </thead>
              <tbody>
                {paths.map((fp) => {
                  const hint      = hints[fp];
                  const fieldName = fp.split(".").slice(1).join(".");
                  const isExtra   = fp in extraHints;
                  return (
                    <tr key={fp}>
                      <td className="si-field-name">{fieldName}</td>
                      <td>{hint.component ? <Badge label={hint.component} color="teal" /> : <span className="si-muted">—</span>}</td>
                      <td className="si-label-cell">{hint.label ?? <span className="si-muted">—</span>}</td>
                      <td className="si-mono si-muted-empty">{hint.placeholder ?? <span className="si-muted">—</span>}</td>
                      <td>{hint.color ? <span className="si-color-swatch" style={{ background: hint.color }} title={hint.color}>{hint.color}</span> : <span className="si-muted">—</span>}</td>
                      <td>{hint.backgroundColor ? <span className="si-color-swatch" style={{ background: hint.backgroundColor }} title={hint.backgroundColor}>{hint.backgroundColor}</span> : <span className="si-muted">—</span>}</td>
                      <td>{hint.fontSize   ? <Badge label={hint.fontSize}   color="blue"   /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.fontWeight ? <Badge label={hint.fontWeight} color="purple" /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.textAlign  ? <Badge label={hint.textAlign}  color="gray"   /> : <span className="si-muted">—</span>}</td>
                      <td>{hint.width      ? <Badge label={hint.width}      color="teal"   /> : <span className="si-muted">—</span>}</td>
                      <td className="si-label-cell">{hint.tooltip ?? <span className="si-muted">—</span>}</td>
                      <td>
                        <span className="si-val-list">
                          {hint.hidden   && <Badge label="hidden"   color="gray" />}
                          {hint.readOnly && <Badge label="readOnly" color="orange" />}
                        </span>
                      </td>
                      <td>
                        {isExtra
                          ? <span className="si-source-live"><span>live</span><button className="si-remove-btn" type="button" onClick={() => onRemove(fp)}><DeleteOutlinedIcon sx={{ fontSize: 13 }} /></button></span>
                          : <span className="si-muted">static</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

export function AddUIConfigForm({ fieldPaths, onAdd }: { fieldPaths: string[]; onAdd: (path: string, hint: FieldUIConfig) => void }) {
  const [path, setPath]               = useState("");
  const [component, setComponent]     = useState<ComponentType>("text");
  const [label, setLabel]             = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [color, setColor]             = useState("");
  const [bgColor, setBgColor]         = useState("");
  const [borderColor, setBorderColor] = useState("");
  const [fontSize, setFontSize]       = useState<FontSize | "">("");
  const [fontWeight, setFontWeight]   = useState<FontWeight | "">("");
  const [textAlign, setTextAlign]     = useState<TextAlign | "">("");
  const [width, setWidth]             = useState<FieldWidth | "">("");
  const [tooltip, setTooltip]         = useState("");
  const [hidden, setHidden]           = useState(false);
  const [readOnly, setReadOnly]       = useState(false);
  const [saved, setSaved]             = useState(false);

  function submit() {
    if (!path.trim()) return;
    const hint: FieldUIConfig = {};
    if (component)   hint.component       = component;
    if (label)       hint.label           = label;
    if (placeholder) hint.placeholder     = placeholder;
    if (color)       hint.color           = color;
    if (bgColor)     hint.backgroundColor = bgColor;
    if (borderColor) hint.borderColor     = borderColor;
    if (fontSize)    hint.fontSize        = fontSize as FontSize;
    if (fontWeight)  hint.fontWeight      = fontWeight as FontWeight;
    if (textAlign)   hint.textAlign       = textAlign as TextAlign;
    if (width)       hint.width           = width as FieldWidth;
    if (tooltip)     hint.tooltip         = tooltip;
    if (hidden)      hint.hidden          = true;
    if (readOnly)    hint.readOnly        = true;
    onAdd(path.trim(), hint);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setPath(""); setLabel(""); setPlaceholder(""); setColor(""); setBgColor("");
    setBorderColor(""); setFontSize(""); setFontWeight(""); setTextAlign(""); setWidth("");
    setTooltip(""); setHidden(false); setReadOnly(false);
  }

  return (
    <div className="si-layer-section si-layer-section--ui">
      <div className="si-form-row">
        <label className="si-form-label" style={{ flex: 2 }}>
          Field path <span className="si-hint">select existing or type new</span>
          <input className="si-form-input" list="ui-field-paths" value={path}
            onChange={(e) => setPath(e.target.value)} placeholder="user.email" />
          <datalist id="ui-field-paths">{fieldPaths.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="si-form-label">
          Component
          <select className="si-form-select" value={component} onChange={(e) => setComponent(e.target.value as ComponentType)}>
            {COMPONENTS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Label
          <input className="si-form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Email Address" />
        </label>
        <label className="si-form-label">
          Placeholder
          <input className="si-form-input" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} placeholder="john@example.com" />
        </label>
      </div>
      <div className="si-style-section-label"><FormatPaintOutlinedIcon sx={{ fontSize: 13 }} />Visual Styling</div>
      <div className="si-form-row">
        <label className="si-form-label">
          Text color
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={color || "#000000"} onChange={(e) => setColor(e.target.value)} />
            <input className="si-form-input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#374151" />
            {color && <button className="si-clear-btn" type="button" onClick={() => setColor("")}>×</button>}
          </div>
        </label>
        <label className="si-form-label">
          Background
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={bgColor || "#ffffff"} onChange={(e) => setBgColor(e.target.value)} />
            <input className="si-form-input" value={bgColor} onChange={(e) => setBgColor(e.target.value)} placeholder="#f8fafc" />
            {bgColor && <button className="si-clear-btn" type="button" onClick={() => setBgColor("")}>×</button>}
          </div>
        </label>
        <label className="si-form-label">
          Border color
          <div className="si-color-row">
            <input type="color" className="si-color-input" value={borderColor || "#e2e8f0"} onChange={(e) => setBorderColor(e.target.value)} />
            <input className="si-form-input" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} placeholder="#e2e8f0" />
            {borderColor && <button className="si-clear-btn" type="button" onClick={() => setBorderColor("")}>×</button>}
          </div>
        </label>
      </div>
      <div className="si-form-row">
        <label className="si-form-label">
          Font size
          <select className="si-form-select" value={fontSize} onChange={(e) => setFontSize(e.target.value as any)}>
            <option value="">— default —</option>{FONT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Font weight
          <select className="si-form-select" value={fontWeight} onChange={(e) => setFontWeight(e.target.value as any)}>
            <option value="">— default —</option>{FONT_WEIGHTS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Text align
          <select className="si-form-select" value={textAlign} onChange={(e) => setTextAlign(e.target.value as any)}>
            <option value="">— default —</option>{TEXT_ALIGNS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Width
          <select className="si-form-select" value={width} onChange={(e) => setWidth(e.target.value as any)}>
            <option value="">— default —</option>{FIELD_WIDTHS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="si-form-label">
          Tooltip
          <input className="si-form-input" value={tooltip} onChange={(e) => setTooltip(e.target.value)} placeholder="Help text shown on hover" />
        </label>
      </div>
      <div className="si-form-row">
        <label className="si-checkbox-label">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Hidden (not rendered)
        </label>
        <label className="si-checkbox-label">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />Read-only (display only)
        </label>
      </div>
      <div className="si-form-actions">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!path.trim()}>
          {saved ? <><CheckIcon sx={{ fontSize: 15 }} /> Saved</> : <><SaveOutlinedIcon sx={{ fontSize: 15 }} /> Save UI Config</>}
        </button>
      </div>
    </div>
  );
}