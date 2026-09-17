import React, { useState } from "react";
import { useAuthStore } from "../../../store/authStore";
import AddIcon                   from "@mui/icons-material/Add";
import StorageIcon               from "@mui/icons-material/Storage";
import SaveOutlinedIcon          from "@mui/icons-material/SaveOutlined";
import TableChartOutlinedIcon    from "@mui/icons-material/TableChartOutlined";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import type { AllSchemas } from "../../schema/types";
import { apiInsertRow, apiListRows } from "../../api/datastoreApi";
import { Badge } from "./helpers";

export function DataTab({ schemas, dbBackends = {} }: { schemas: AllSchemas; dbBackends?: Record<string, string> }) {
  const domainNames    = Object.keys(schemas.domains);
  const hasPermission  = useAuthStore((s) => s.hasPermission);
  const [selectedDomain, setSelectedDomain] = useState(domainNames[0] ?? "");
  const [formValues,     setFormValues]     = useState<Record<string, string>>({});
  const [rows,           setRows]           = useState<Record<string, any>[] | null>(null);
  const [status,         setStatus]         = useState<{ state: "idle" | "loading" | "ok" | "err"; msg: string }>({ state: "idle", msg: "" });
  const [loadingRows,    setLoadingRows]    = useState(false);

  const activeBackend = dbBackends[selectedDomain] ?? "postgresql";
  const dbLabel = activeBackend === "dynamodb" ? "DynamoDB" : "PostgreSQL";

  const canCreate = !selectedDomain || hasPermission(selectedDomain, "create");
  const canView   = !selectedDomain || hasPermission(selectedDomain, "view");

  const domainFields = selectedDomain ? Object.entries(schemas.domains[selectedDomain]?.fields ?? {}) : [];

  function selectDomain(name: string) {
    setSelectedDomain(name); setFormValues({}); setRows(null); setStatus({ state: "idle", msg: "" });
  }

  function setField(fieldName: string, value: string) {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleInsert() {
    if (!selectedDomain) return;
    setStatus({ state: "loading", msg: "Inserting row…" });
    try {
      const row: Record<string, any> = {};
      for (const [fieldName, fieldDef] of domainFields) {
        const raw = formValues[fieldName] ?? "";
        if (raw === "") continue;
        if (fieldDef.type === "number") row[fieldName] = Number(raw);
        else if (fieldDef.type === "boolean") row[fieldName] = raw === "true";
        else row[fieldName] = raw;
      }
      const res = await apiInsertRow(selectedDomain, row);
      if (res.status === "success") {
        setStatus({ state: "ok", msg: `✅ Row inserted! ID: ${res.record_id}` });
        setFormValues({});
        await loadRows();
      } else {
        setStatus({ state: "err", msg: `❌ Insert failed: ${res.message}` });
      }
    } catch (err: any) {
      setStatus({ state: "err", msg: `❌ Error: ${err?.message ?? String(err)}` });
    }
  }

  async function loadRows() {
    if (!selectedDomain) return;
    setLoadingRows(true);
    try {
      const res = await apiListRows(selectedDomain);
      if (res.status === "success") setRows(res.data ?? []);
      else setRows([]);
    } catch { setRows([]); }
    finally { setLoadingRows(false); }
  }

  const rowColumns = ["id", ...domainFields.map(([k]) => k), "created_at"];

  return (
    <div className="si-data-tab">
      <div className="si-data-domain-bar">
        <span className="si-data-label">Domain (table):</span>
        <div className="si-data-domain-pills">
          {domainNames.length === 0 ? (
            <span className="si-data-empty-hint">No domains yet — create one in "Create Domain" tab first.</span>
          ) : (
            domainNames.map((name) => {
              const backend = dbBackends[name] ?? "postgresql";
              return (
                <button key={name} type="button"
                  className={`si-data-pill ${selectedDomain === name ? "si-data-pill--active" : ""}`}
                  onClick={() => selectDomain(name)}>
                  <StorageIcon sx={{ fontSize: 12 }} />
                  {name}
                  <Badge label={backend === "dynamodb" ? "DynamoDB" : "PostgreSQL"} color={backend === "dynamodb" ? "orange" : "teal"} />
                </button>
              );
            })
          )}
        </div>
      </div>

      {selectedDomain && (
        <>
          <div className="si-data-section">
            <div className="si-data-section-title">
              <AddIcon sx={{ fontSize: 14 }} />
              Insert a new row into <strong>{selectedDomain}</strong>
              <Badge label={dbLabel} color={activeBackend === "dynamodb" ? "orange" : "teal"} />
            </div>
            {!canCreate ? (
              <p className="si-data-empty-hint" style={{ color: "#b91c1c" }}>
                🔒 You don't have <strong>create</strong> permission for <strong>{selectedDomain}</strong>.
              </p>
            ) : domainFields.length === 0 ? (
              <p className="si-data-empty-hint">This domain has no fields defined yet.</p>
            ) : (
              <div className="si-data-form">
                {domainFields.map(([fieldName, fieldDef]) => {
                  const uiHint = schemas.uiHints?.[`${selectedDomain}.${fieldName}`];
                  const label  = uiHint?.label ?? fieldName;
                  const ph     = uiHint?.placeholder ?? "";
                  const isRelation = fieldDef.type === "relation";
                  const isList     = fieldDef.type === "list";
                  return (
                    <div key={fieldName} className="si-data-field-row">
                      <label className="si-data-field-label">
                        {label}
                        <span className="si-data-field-type">
                          {isRelation ? <><Badge label="relation" color="indigo" /> → {(fieldDef as any).relatedDomain ?? "?"}</>
                            : isList ? <><Badge label="list" color="green" /> → {(fieldDef as any).listDomain ?? "?"}</>
                            : fieldDef.type}
                        </span>
                      </label>
                      {fieldDef.type === "boolean" ? (
                        <select className="si-data-input" value={formValues[fieldName] ?? ""} onChange={(e) => setField(fieldName, e.target.value)}>
                          <option value="">— select —</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type={fieldDef.type === "number" ? "number" : fieldDef.type === "date" ? "date" : "text"}
                          className="si-data-input"
                          placeholder={isRelation ? `ID of related ${(fieldDef as any).relatedDomain ?? "record"}` : isList ? `Comma-separated IDs from ${(fieldDef as any).listDomain ?? "domain"}` : (ph || `Enter ${label}…`)}
                          value={formValues[fieldName] ?? ""} onChange={(e) => setField(fieldName, e.target.value)} />
                      )}
                    </div>
                  );
                })}
                <div className="si-data-form-actions">
                  <button type="button" className="btn si-data-insert-btn" onClick={handleInsert} disabled={status.state === "loading"}>
                    {status.state === "loading" ? <><span className="si-spinner" /> Inserting…</> : <><SaveOutlinedIcon sx={{ fontSize: 14 }} /> Insert Row</>}
                  </button>
                  {status.state !== "idle" && status.state !== "loading" && (
                    <span className={`si-data-status ${status.state === "ok" ? "si-data-status--ok" : "si-data-status--err"}`}>{status.msg}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="si-data-section">
            <div className="si-data-section-title" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <TableChartOutlinedIcon sx={{ fontSize: 14 }} />
                Rows in <strong>{selectedDomain}</strong>
                {rows !== null && <span className="si-tab-count">{rows.length}</span>}
              </span>
              {canView && (
                <button type="button" className="btn btn-backend" onClick={loadRows} disabled={loadingRows} style={{ fontSize: 12, padding: "4px 10px" }}>
                  {loadingRows ? <><span className="si-spinner" /> Loading…</> : <><CloudDownloadOutlinedIcon sx={{ fontSize: 13 }} /> Load Rows</>}
                </button>
              )}
            </div>
            {!canView ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0", color: "#b91c1c" }}>
                🔒 You don't have <strong>view</strong> permission for <strong>{selectedDomain}</strong>.
              </div>
            ) : rows === null ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0" }}>Click <strong>Load Rows</strong> to fetch data from {dbLabel}.</div>
            ) : rows.length === 0 ? (
              <div className="si-data-empty-hint" style={{ padding: "20px 0" }}>No rows yet — insert one above.</div>
            ) : (
              <div className="si-data-rows-wrap">
                <table className="si-table si-data-rows-table">
                  <thead>
                    <tr>{rowColumns.map((col) => <th key={col}>{col === "id" ? "ID" : col === "created_at" ? "Created" : col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {rowColumns.map((col) => {
                          const val = row[col];
                          return (
                            <td key={col} title={String(val ?? "")}>
                              {col === "id" ? <code className="si-data-id">{String(val ?? "").slice(0, 8)}…</code>
                                : col === "created_at" ? <span className="si-data-date">{val ? new Date(val).toLocaleString() : "—"}</span>
                                : val === undefined || val === null || val === "" ? <span className="si-data-empty">—</span>
                                : <span>{String(val)}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}