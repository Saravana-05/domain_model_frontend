import React from "react";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import CodeIcon               from "@mui/icons-material/Code";
import PaletteOutlinedIcon    from "@mui/icons-material/PaletteOutlined";
import type { DomainViewConfig } from "../../schema/types";

export interface ViewConfigFormProps {
  domainName:  string;
  current:     DomainViewConfig;
  fieldNames:  string[];
  onChange:    (cfg: DomainViewConfig) => void;
}

export function ViewConfigForm({ domainName, current, fieldNames, onChange }: ViewConfigFormProps) {
  const tv = current.tableView ?? { enabled: false };
  const fv = current.formView  ?? { enabled: false };
  const cv = current.cardView  ?? { enabled: false };

  function setTable(patch: Partial<typeof tv>) { onChange({ ...current, tableView: { ...tv, ...patch } }); }
  function setForm(patch: Partial<typeof fv>)  { onChange({ ...current, formView:  { ...fv, ...patch } }); }
  function setCard(patch: Partial<typeof cv>)  { onChange({ ...current, cardView:  { ...cv, ...patch } }); }

  return (
    <div className="si-view-config">
      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!tv.enabled} onChange={(e) => setTable({ enabled: e.target.checked })} />
          <TableChartOutlinedIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Table View</span>
          <span className="si-hint">Show {domainName} rows in a data grid</span>
        </label>
        {tv.enabled && (
          <div className="si-view-body">
            <div className="si-form-row">
              <label className="si-form-label">
                Page size
                <input className="si-form-input" type="number" min={5} max={200} step={5}
                  value={tv.pageSize ?? 25} onChange={(e) => setTable({ pageSize: Number(e.target.value) })} />
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.sortable} onChange={(e) => setTable({ sortable: e.target.checked })} />Sortable columns
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.filterable} onChange={(e) => setTable({ filterable: e.target.checked })} />Column filters
              </label>
              <label className="si-checkbox-label">
                <input type="checkbox" checked={!!tv.searchable} onChange={(e) => setTable({ searchable: e.target.checked })} />Global search
              </label>
            </div>
            <label className="si-form-label si-form-label--full">
              Visible fields <span className="si-hint">comma-separated; leave blank = all</span>
              <input className="si-form-input"
                value={(tv.visibleFields ?? []).join(", ")}
                onChange={(e) => setTable({ visibleFields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder={fieldNames.slice(0, 3).join(", ")} />
            </label>
          </div>
        )}
      </div>

      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!fv.enabled} onChange={(e) => setForm({ enabled: e.target.checked })} />
          <CodeIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Form View</span>
          <span className="si-hint">Create / edit instances in a form</span>
        </label>
        {fv.enabled && (
          <div className="si-view-body">
            <label className="si-form-label">
              Layout
              <select className="si-form-select" value={fv.layout ?? "single"} onChange={(e) => setForm({ layout: e.target.value as any })}>
                <option value="single">Single column</option>
                <option value="two-column">Two columns</option>
                <option value="multi-column">Multi-column</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="si-view-section">
        <label className="si-view-toggle">
          <input type="checkbox" checked={!!cv.enabled} onChange={(e) => setCard({ enabled: e.target.checked })} />
          <PaletteOutlinedIcon sx={{ fontSize: 15 }} />
          <span className="si-view-section-title">Card / Gallery View</span>
          <span className="si-hint">Show instances as visual cards</span>
        </label>
        {cv.enabled && (
          <div className="si-view-body">
            <div className="si-form-row">
              <label className="si-form-label">
                Title field
                <select className="si-form-select" value={cv.titleField ?? ""} onChange={(e) => setCard({ titleField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="si-form-label">
                Subtitle field
                <select className="si-form-select" value={cv.subtitleField ?? ""} onChange={(e) => setCard({ subtitleField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="si-form-label">
                Image field
                <select className="si-form-select" value={cv.imageField ?? ""} onChange={(e) => setCard({ imageField: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {fieldNames.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}