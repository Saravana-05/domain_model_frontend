import React, { useState, useRef, useEffect } from "react";
import AddCircleOutlinedIcon   from "@mui/icons-material/AddCircleOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import AddIcon                 from "@mui/icons-material/Add";
import LinkOutlinedIcon        from "@mui/icons-material/LinkOutlined";
import LabelIcon               from "@mui/icons-material/Label";
import type { FieldType, NamedValidationRule } from "../../schema/types";
import { FIELD_TYPES, FIELD_TYPE_LABELS, VAL_TYPES, type DraftValidation } from "./constants";
import { type FieldDraft, BLANK_DRAFT } from "./fieldDraftTypes";
import type { QuickCreateField } from "./DomainPickers";
import { ValidationRefPicker } from "./ValidationRefPicker";
import { NewRegistryRuleForm } from "./NewRegistryRuleForm";
import { toPascalCase, toCamelCase } from "./helpers";

export interface FieldBuilderProps {
  submitLabel:    string;
  initialName?:   string;
  initialDraft?:  FieldDraft;
  onSubmit:       (name: string, draft: FieldDraft) => void;
  onCancel?:      () => void;
  showAllLayers?: boolean;
  /** Show just the language-aware Label input, even when showAllLayers is false */
  showLabelOnly?: boolean;
  registry?:      Record<string, NamedValidationRule>;
  domainNames?:   string[];
  parentDomainName?: string;
  /** Legacy path — still used by DomainPickers' own __new__: JSON-encoded
   *  quick-create flow elsewhere. Untouched, unrelated to the button below. */
  onNewDomainFromRelation?: (name: string, fields: QuickCreateField[]) => void;
  /**
   * Fires when "Create {domain} domain" is clicked. Carries the field
   * currently being built (name + draft) so the caller can commit it to
   * the current domain before switching context — see CreateDomainTab's
   * handleCreateRelatedDomain, which pauses the current domain as a
   * resumable draft and swaps the whole builder over to the new one.
   */
  onCreateRelatedDomain?: (fieldName: string, draft: FieldDraft) => void;
  onAddValidationRule?: (tag: string, rule: NamedValidationRule) => void;
  /** Escape hatch to the full Create Domain tab — same purpose as
   *  onCreateRelatedDomain but used by the compact modal flow (e.g.
   *  LinkDomainModal / DomainModelTab's inline edit forms), which pass
   *  this straight through so the "open in full editor" link can hand
   *  off there when a relation target doesn't exist yet. */
  onRedirectToCreate?: (domainName: string, parentDomain?: string, fieldName?: string) => void;
  /** Compact rendering mode used inside LinkDomainModal — hides the
   *  validation-rule sections so the embedded builder stays small enough
   *  for a modal instead of a full page. */
  compact?: boolean;
}

/** The Integral / Association picker is hidden for now: every linked domain
 *  is saved as an "association". Flip to true to bring the picker back. */
const SHOW_RELATION_KIND_SELECTOR = false;

export function FieldBuilder({
  submitLabel, initialName = "", initialDraft, onSubmit, onCancel,
  showAllLayers = true, showLabelOnly = false, registry = {}, domainNames = [],
  parentDomainName = "", onNewDomainFromRelation, onCreateRelatedDomain, onAddValidationRule,
  onRedirectToCreate, compact = false,
}: FieldBuilderProps) {
const [fieldName, setFieldName] = useState(initialName);
  // Extra existing domains linked alongside draft.relatedDomain (adding a
  // new field only — editing a field keeps its single relation).
  const [extraDomains, setExtraDomains] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);
  const [enFieldName, setEnFieldName] = useState(initialName);
  // Business label ("First Name"). Follows what is typed in the name box
  // until the user edits it by hand; when editing an existing field the
  // saved label is never overwritten by retyping the name.
  const [labelTouched, setLabelTouched] = useState(!!initialName);
  const [draft,     setDraft]     = useState<FieldDraft>(initialDraft ? { ...initialDraft } : { ...BLANK_DRAFT });
  const [draftVal,  setDraftVal]  = useState<DraftValidation>({ type: "required", value: "", message: "" });
  const [labelLang, setLabelLang] = useState<"en" | "ta" | "ar">("en");
  const isPartOfRef = useRef<boolean | "fk">(initialDraft ? initialDraft.isPartOf : true);



  function set<K extends keyof FieldDraft>(key: K, val: FieldDraft[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function setLabelForLang(lang: "en" | "ta" | "ar", value: string) {
    setDraft((d) => ({ ...d, labels: { ...d.labels, [lang]: value } }));
  }

  function addValidation() {
    if (!draftVal.message.trim()) return;
    set("validations", [...draft.validations, { ...draftVal }]);
    setDraftVal({ type: "required", value: "", message: "" });
  }

  function resolveRelatedDomain(raw: string): string {
    if (!raw.startsWith("__new__:")) return raw;
    const colonIdx   = raw.indexOf(":", 7);
    const domainName = toPascalCase(raw.slice(7, colonIdx));
    const fieldsJson = raw.slice(colonIdx + 1);
    try {
      const fields = JSON.parse(fieldsJson) as QuickCreateField[];
      onNewDomainFromRelation?.(domainName, fields.map((f) => ({ ...f, name: toCamelCase(f.name) })));
    } catch { /* ignore */ }
    return domainName;
  }

  /** Shared by the normal "Add field" submit and the "Create {domain}
   *  domain" button — both need the same finished {name, draft} pair,
   *  just handed to a different callback. */
  function buildFinalDraft(): { technicalName: string; finalDraft: FieldDraft } | null {
    if (!fieldName.trim()) return null;

    let finalDraft = { ...draft, isPartOf: isPartOfRef.current };
    // No label typed → keep the name exactly as the user typed it (e.g.
    // "First Name") instead of falling back to the camelCase storage name.
    if (!finalDraft.labels.en?.trim()) {
      finalDraft = { ...finalDraft, labels: { ...finalDraft.labels, en: fieldName.trim() } };
    }
    // The storage name always comes from the "Field name" box, never from the
    // label — the label is a separate business name (same as the domain model).
    const rawTechnicalName = fieldName.trim();
    if (!rawTechnicalName) return null;
    // Attribute names are stored camelCase, however they were typed.
    const technicalName = toCamelCase(rawTechnicalName);

    if (finalDraft.type === "relation" && finalDraft.relatedDomain) {
      finalDraft = {
        ...finalDraft,
        // "__new__:..." sentinels resolve (and PascalCase) inside
        // resolveRelatedDomain; plain picks are an existing domain name
        // already stored correctly, so PascalCase is a no-op there.
        relatedDomain: finalDraft.relatedDomain.startsWith("__new__:")
          ? resolveRelatedDomain(finalDraft.relatedDomain)
          : toPascalCase(finalDraft.relatedDomain),
        isPartOf: isPartOfRef.current,
        // Editing keeps an existing multi-domain list only while the primary
        // domain is unchanged; adding builds the list in submit() instead.
        relatedDomains:
          initialDraft?.relatedDomains && initialDraft.relatedDomains[0] === finalDraft.relatedDomain
            ? initialDraft.relatedDomains
            : undefined,
        // Every linked domain is an association while the picker is hidden.
        // Editing a field that is already integral keeps its kind, so
        // existing data isn't silently converted.
        relationKind: SHOW_RELATION_KIND_SELECTOR || initialDraft?.relationKind === "integral"
          ? finalDraft.relationKind
          : "association",
      };
    }

    return { technicalName, finalDraft };
  }

  // ── Multi-domain linking ─────────────────────────────────────────────────
  // Only offered when ADDING a relation field to an EXISTING target (a
  // not-yet-created domain still goes through the single "Create … domain"
  // flow). Derived on every render from domainNames, so a stale pick (domain
  // deleted, or later chosen as the primary one) can never leak through.
  const canMultiLink =
    !initialName &&
    draft.type === "relation" &&
    !!draft.relatedDomain &&
    domainNames.includes(draft.relatedDomain) &&
    draft.isPartOf !== "fk";
  const linkedExtras = canMultiLink
    ? Array.from(new Set(extraDomains)).filter(
        (d) => d !== draft.relatedDomain && d !== parentDomainName && !d.includes("_") && domainNames.includes(d),
      )
    : [];
  const isMulti = linkedExtras.length > 0;
  const allLinked = isMulti ? [draft.relatedDomain, ...linkedExtras] : [];

  // Checkbox picker (adding a field only). The first selected domain is
  // draft.relatedDomain; the rest live in extraDomains.
  // Junction tables (named "A_B" — domain names themselves never contain an
  // underscore, they're stored PascalCase) can't be a relation target.
  const pickableDomains = domainNames.filter((d) => d !== parentDomainName && !d.includes("_"));
  const selectedDomains = canMultiLink ? [draft.relatedDomain, ...linkedExtras] : [];
  const pendingNewDomain = draft.relatedDomain !== "" && !domainNames.includes(draft.relatedDomain);

  function toggleDomain(d: string) {
    if (selectedDomains.includes(d)) {
      const rest = selectedDomains.filter((x) => x !== d);
      if (rest.length === 0) { set("relatedDomain", ""); setExtraDomains([]); }
      else { set("relatedDomain", rest[0]); setExtraDomains(rest.slice(1)); }
      return;
    }
    // Association is the default the moment any domain is picked.
    isPartOfRef.current = false;
    set("isPartOf", false);
    if (selectedDomains.length === 0) { set("relatedDomain", d); setExtraDomains([]); }
    else setExtraDomains([...selectedDomains.slice(1), d]);
  }

  function pickNewDomain() {
    const suggestion = fieldName.trim() && fieldName.trim() !== parentDomainName ? fieldName.trim() : "";
    set("relatedDomain", suggestion);
    isPartOfRef.current = false;
    set("isPartOf", false);
    setExtraDomains([]);
    setPickerOpen(false);
  }

  function resetAfterSubmit() {
    if (initialName) return;
    setFieldName("");
    setEnFieldName("");
    setLabelTouched(false);
    setLabelLang("en");
    setDraft({ ...BLANK_DRAFT });
    setExtraDomains([]);
  }

  function submit() {
    const built = buildFinalDraft();
    if (!built) return;
    // Several domains → still ONE field (named as typed). It carries the full
    // list; the caller creates a junction table for each domain in it.
    const finalDraft = isMulti
      ? { ...built.finalDraft, relatedDomain: allLinked[0], relatedDomains: allLinked }
      : built.finalDraft;
    onSubmit(built.technicalName, finalDraft);
    resetAfterSubmit();
  }

  // Shared by both the "existing domain" and "create new domain" rows
  // below — two-way choice for the relationship's physical shape.
  // "References" (this domain gets a real column pointing at the
  // related domain, named exactly as typed) is the default the moment a
  // domain is picked — no button needed for it, see the info chip below.
  // These two buttons let you override that default:
  //  - Integral:     the RELATED domain gets a real `${this}Id` column
  //                   pointing back at this one (e.g. "designation only
  //                   ever exists as part of grade" → designation gets
  //                   gradeId). Safe for an already-existing target —
  //                   merged into its existing fields, never replacing
  //                   them.
  //  - Association:  a junction table is created; neither domain gets a
  //                   direct column.
  const relationShapeSelector = (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:2,
      border:"1px solid var(--color-border-secondary)", borderRadius:"var(--border-radius-md)",
      padding:2, background:"var(--color-background-primary)",
    }}>
      <button type="button"
        onClick={() => { isPartOfRef.current = true; set("isPartOf", true); set("relationKind", "integral"); }}
        title={`${draft.relatedDomain || "The related domain"} stores a reference back to ${parentDomainName || "this domain"} — e.g. it only ever exists as part of it`}
        style={{
          fontSize:11, fontWeight:600, padding:"5px 9px", borderRadius:"calc(var(--border-radius-md) - 2px)",
          border:"none", cursor:"pointer",
          background: draft.isPartOf !== "fk" && draft.relationKind === "integral" ? "#4338ca" : "transparent",
          color: draft.isPartOf !== "fk" && draft.relationKind === "integral" ? "#fff" : "var(--color-text-secondary)",
        }}>
        Integral
      </button>
      <button type="button"
        onClick={() => { isPartOfRef.current = true; set("isPartOf", true); set("relationKind", "association"); }}
        title="Many-to-many — a junction table is created; neither domain gets a direct column"
        style={{
          fontSize:11, fontWeight:600, padding:"5px 9px", borderRadius:"calc(var(--border-radius-md) - 2px)",
          border:"none", cursor:"pointer",
          background: draft.isPartOf !== "fk" && draft.relationKind === "association" ? "#4338ca" : "transparent",
          color: draft.isPartOf !== "fk" && draft.relationKind === "association" ? "#fff" : "var(--color-text-secondary)",
        }}>
        Association
      </button>
    </div>
  );

  return (
    <div className="si-field-builder">
      {/* Layer 1 */}
      <div className="si-layer-section si-layer-section--domain">
        <div className="si-layer-section-label">Layer 1 — Domain Model</div>
        <div className="si-form-row">
          <label className="si-form-label">
            <span className="si-form-label-text">Field name (EN) * {fieldName.trim() && <span className="si-hint">saved as {toCamelCase(fieldName)}</span>}</span>
            <input
              className="si-form-input"
              value={fieldName}
              onChange={(e) => {
                const val = e.target.value;
                setFieldName(val);
                setEnFieldName(val);
                if (!labelTouched) setLabelForLang("en", val);
                // Field name no longer auto-drives relatedDomain — which
                // domain to point at is now an explicit choice via the
                // "Select Domain" dropdown below, decoupled from whatever
                // this field happens to be named.
              }}
              placeholder="e.g. First Name"
            />
          </label>
          <label className="si-form-label">
            <span className="si-form-label-text">Label (business name)</span>
            <input
              className="si-form-input"
              value={draft.labels.en ?? ""}
              onChange={(e) => { setLabelTouched(true); setLabelForLang("en", e.target.value); }}
              placeholder="e.g. First Name"
            />
          </label>
        
           <label className="si-form-label">
            <span className="si-form-label-text">Type</span>
           <select
              className="si-form-select"
              value={draft.type}
              onChange={(e) => {
                const selectedType = e.target.value as FieldType;
                set("type", selectedType);
                if (selectedType !== "relation") {
                  set("relatedDomain", "");
                  set("listDomain", "");
                  setExtraDomains([]);
                } else if (!draft.relatedDomain) {
                  // Fresh switch to relation, nothing chosen yet — leave
                  // relatedDomain blank so the dropdown starts on
                  // "-- Select domain --" rather than guessing.
                  set("relatedDomain", "");
                }
              }}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{FIELD_TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          </label>
          <label className="si-form-label">
              <span className="si-form-label-text">Cardinality</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 10px", border: "1px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", background: "var(--color-background-primary)" }}>
                <input
                  type="checkbox"
                  checked={draft.cardinality === "list"}
                  onChange={(e) => set("cardinality", e.target.checked ? "list" : "")}
                  style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#6366f1", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>List</span>
              </label>
            </label>

          {draft.type === "relation" && !initialName && (
            <div className="si-form-label" ref={pickerRef} style={{ position: "relative" }}>
              <span className="si-form-label-text">
                Select Domain{selectedDomains.length > 1 ? ` (${selectedDomains.length} selected)` : ""}
              </span>
              <button
                type="button"
                className="si-form-select"
                onClick={() => setPickerOpen((o) => !o)}
                style={{ textAlign: "left", cursor: "pointer", minWidth: 190, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {selectedDomains.length > 0
                  ? selectedDomains.join(", ")
                  : pendingNewDomain ? `New: ${draft.relatedDomain}` : "-- Select domain(s) --"}
              </button>
              {pickerOpen && (
                <div className="si-multi-menu">
                  {pickableDomains.length === 0 && (
                    <div className="si-multi-empty">No other domains yet</div>
                  )}
                  {pickableDomains.map((d) => (
                    <label key={d} className="si-multi-item">
                      <input type="checkbox" checked={selectedDomains.includes(d)} onChange={() => toggleDomain(d)} />
                      <span>{d}</span>
                    </label>
                  ))}
                  <button type="button" className="si-multi-new" onClick={pickNewDomain}>
                    ➕ Create New Domain
                  </button>
                </div>
              )}
            </div>
          )}

          {draft.type === "relation" && !!initialName && (
            <label className="si-form-label">
              <span className="si-form-label-text">Select Domain</span>
              <select
                className="si-form-select"
                value={
                  !draft.relatedDomain ? ""
                  : domainNames.includes(draft.relatedDomain) ? draft.relatedDomain
                  : "__new__"
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    set("relatedDomain", "");
                    isPartOfRef.current = false;
                    set("isPartOf", false);
                  } else if (val === "__new__") {
                    // Suggest the field name as a starting point for the
                    // new domain's name — editable in the input that
                    // appears below, not tied to it after this.
                    const suggestion = fieldName.trim() && fieldName.trim() !== parentDomainName ? fieldName.trim() : "";
                    set("relatedDomain", suggestion);
                    // Default is an association (junction table, no
                    // column on either side) either way — the Integral/Association
                    // toggle below lets you switch direction, regardless
                    // of whether the target exists yet or is about to be
                    // created.
                    isPartOfRef.current = false;
                    set("isPartOf", false);
                  } else {
                    set("relatedDomain", val);
                    isPartOfRef.current = false;
                    set("isPartOf", false);
                  }
                }}
              >
                <option value="">-- Select domain --</option>
                {domainNames.filter((d) => d !== parentDomainName).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
                <option value="__new__">➕ Create New Domain</option>
              </select>
            </label>
          )}


          {draft.type === "relation" && draft.relatedDomain && domainNames.includes(draft.relatedDomain) && !isMulti && (
  <div style={{ display:"flex", alignItems:"flex-end", gap:6 }}>
    <span style={{
      display:"inline-flex", alignItems:"center", gap:6,
      whiteSpace:"nowrap", fontSize:12, padding:"7px 0",
      color:"var(--indigo-text)",
    }}>
      <LinkOutlinedIcon sx={{ fontSize: 13 }} />
      {draft.isPartOf === "fk" ? (
        <>Links to <strong>{draft.relatedDomain}</strong> — adds <code>{fieldName.trim() || "…"}</code> here</>
      ) : draft.relationKind === "association" ? (
        <>Association with <strong>{isMulti ? allLinked.join(", ") : draft.relatedDomain}</strong> — {isMulti ? "one junction table each" : "junction table"}, no column on either side</>
      ) : (
        <>Integral — adds <code>{parentDomainName}Id</code> to <strong>{draft.relatedDomain}</strong></>
      )}
    </span>
    {SHOW_RELATION_KIND_SELECTOR && relationShapeSelector}
    <button type="button"
      onClick={() => { set("relatedDomain",""); set("listDomain",""); set("type","string"); set("isPartOf", true); isPartOfRef.current = true; setExtraDomains([]); }}
      style={{ fontSize:13, color:"#9ca3af", background:"none", border:"none",
        cursor:"pointer", lineHeight:1, padding:"0 4px" }}>
      ×
    </button>
  </div>
)}

          {/* "➕ Create New Domain" picked in the dropdown above — name it
              here (independent of the field name) and confirm. Confirming
              commits this field and hands off to CreateDomainTab's
              pause/switch flow, same as before. Optional — if you skip
              this and just create the parent domain directly, a minimal
              stub table still gets auto-created so nothing dangles; this
              button is the convenient path to give the new domain proper
              attributes instead of a bare stub. */}
          {draft.type === "relation" && draft.relatedDomain !== "" && !domainNames.includes(draft.relatedDomain) && (
            (() => {
              const trimmed = draft.relatedDomain.trim();
              const validNewDomainName = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(trimmed);
              const isSelfReference = !!parentDomainName && toPascalCase(trimmed) === toPascalCase(parentDomainName);
              const canCreate = validNewDomainName && !isSelfReference;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display:"flex", alignItems:"flex-end", gap:6 }}>
                    <label className="si-form-label" style={{ marginBottom: 0 }}>
                      <span className="si-form-label-text">New domain name {trimmed && <span className="si-hint">saved as {toPascalCase(trimmed)}</span>}</span>
                      <input
                        className={`si-form-input ${trimmed && !canCreate ? "si-form-input--error" : ""}`}
                        value={draft.relatedDomain}
                        onChange={(e) => set("relatedDomain", e.target.value)}
                        onBlur={() => { if (draft.relatedDomain.trim()) set("relatedDomain", toPascalCase(draft.relatedDomain)); }}
                        placeholder="e.g. Designation"
                        style={{ minWidth: 160 }}
                      />
                    </label>
                    {SHOW_RELATION_KIND_SELECTOR && relationShapeSelector}
                    {!compact && (
                      <button type="button" className="btn btn-primary"
                        disabled={!canCreate}
                        onClick={() => {
                          const built = buildFinalDraft();
                          if (!built) return;
                          onCreateRelatedDomain?.(built.technicalName, built.finalDraft);
                        }}
                        style={{ whiteSpace:"nowrap", fontSize:12 }}>
                        <AddIcon sx={{ fontSize: 13 }} />
                        Create {trimmed || "…"} domain
                      </button>
                    )}
                    {compact && onRedirectToCreate && (
                      <button type="button" className="btn btn-primary"
                        disabled={!canCreate}
                        onClick={() => {
                          const built = buildFinalDraft();
                          if (!built) return;
                          onRedirectToCreate(trimmed, parentDomainName || undefined, built.technicalName);
                        }}
                        style={{ whiteSpace:"nowrap", fontSize:12 }}>
                        <AddIcon sx={{ fontSize: 13 }} />
                        Create {trimmed || "…"} in full editor
                      </button>
                    )}
                    <button type="button"
                      onClick={() => { set("relatedDomain",""); set("listDomain",""); set("type","string"); set("isPartOf", true); isPartOfRef.current = true; setExtraDomains([]); }}
                      style={{ fontSize:13, color:"#9ca3af", background:"none", border:"none",
                        cursor:"pointer", lineHeight:1, padding:"0 4px" }}>
                      ×
                    </button>
                  </div>
                  {isSelfReference && (
                    <span className="si-inline-error">A domain can't relate to itself — pick a different name.</span>
                  )}
                  {trimmed && !validNewDomainName && !isSelfReference && (
                    <span className="si-inline-error">Name can only contain letters, numbers, spaces, - and _</span>
                  )}
                </div>
              );
            })()
          )}
        </div>

        {isMulti && (
          <div className="si-multi-summary">
            <div className="si-multi-summary-title">
              Linking {allLinked.length} domains — one junction table each
            </div>
            <div className="si-multi-summary-tags">
              {allLinked.map((dom) => (
                <span key={dom} className="si-badge si-badge--indigo">
                  <LinkOutlinedIcon sx={{ fontSize: 11 }} />
                  {parentDomainName || "…"}_{dom}
                  {dom !== draft.relatedDomain && (
                    <button
                      type="button"
                      className="si-multi-remove"
                      title={`Don't link ${dom}`}
                      onClick={() => setExtraDomains((prev) => prev.filter((d) => d !== dom))}
                    >×</button>
                  )}
                </span>
              ))}
            </div>
            <div className="si-hint" style={{ marginLeft: 0 }}>
              Saved as one field <strong>{fieldName.trim() ? toCamelCase(fieldName) : "…"}</strong> linked to all {allLinked.length} domains.
            </div>
          </div>
        )}

        {!compact && (
        <div className="si-val-builder">
          <div className="si-val-section-header">
            <CheckCircleOutlinedIcon sx={{ fontSize: 14 }} />
            <span className="si-form-sublabel">Validation Rules</span>
          </div>
          <div className="si-val-subsection">
            <div className="si-val-subsection-label">Registry rules <span className="si-hint">click to attach named rules</span></div>
            <ValidationRefPicker selected={draft.validationRefs} registry={registry} onChange={(tags) => set("validationRefs", tags)} />

            {onAddValidationRule && (
              <div style={{ marginTop: 10 }}>
                <NewRegistryRuleForm
                  existingTags={Object.keys(registry)}
                  onCreate={(tag, rule) => {
                    onAddValidationRule(tag, rule);
                    if (!draft.validationRefs.includes(tag)) {
                      set("validationRefs", [...draft.validationRefs, tag]);
                    }
                  }}
                />
              </div>
            )}
          </div>

          <div className="si-val-subsection">
            <div className="si-val-subsection-label">
              Inline validations <span className="si-hint">specific to just this field — no registry entry needed</span>
            </div>

            {draft.validations.length > 0 && (
              <div className="si-val-tags si-val-tags--selected" style={{ marginBottom: 8 }}>
                {draft.validations.map((v, i) => (
                  <span key={i} className="si-val-tag si-val-tag--ref">
                    <LabelIcon sx={{ fontSize: 11 }} />
                    {v.type}{v.value ? `: ${v.value}` : ""} — {v.message}
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => set("validations", draft.validations.filter((_, idx) => idx !== i))}
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="si-inline-val-row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="si-form-input"
                style={{ maxWidth: 140 }}
                value={draftVal.type}
                onChange={(e) => setDraftVal((d) => ({ ...d, type: e.target.value }))}
              >
                {VAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="custom">custom</option>
              </select>

              {draftVal.type !== "required" && (
                <input
                  className="si-form-input"
                  style={{ maxWidth: 180 }}
                  placeholder={
                    draftVal.type === "pattern" ? "regex, e.g. ^[A-Z]+$"
                    : draftVal.type === "custom" ? "expression, e.g. value > 0"
                    : "value, e.g. 8"
                  }
                  value={draftVal.value}
                  onChange={(e) => setDraftVal((d) => ({ ...d, value: e.target.value }))}
                />
              )}

              <input
                className="si-form-input"
                style={{ flex: 1, minWidth: 160 }}
                placeholder="Error message shown to the user"
                value={draftVal.message}
                onChange={(e) => setDraftVal((d) => ({ ...d, message: e.target.value }))}
              />

              <button
                type="button"
                className="btn btn-secondary"
                onClick={addValidation}
                disabled={!draftVal.message.trim()}
              >
                <AddCircleOutlinedIcon sx={{ fontSize: 14 }} /> Add
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      <div className="si-form-actions si-form-actions--gap">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={!fieldName.trim()}>
          <AddCircleOutlinedIcon sx={{ fontSize: 16 }} />{isMulti ? `${submitLabel} (${allLinked.length} domains)` : submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </div>
  );
}