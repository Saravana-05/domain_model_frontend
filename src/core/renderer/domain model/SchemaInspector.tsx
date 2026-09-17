import React, { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import type {
  AllSchemas,
  FieldType,
  DomainDefinition,
  DomainFieldCore,
  DomainViewConfig,
  FieldUIConfig,
  NamedValidationRule,
  ABACFieldRule,
  RBACFieldRule,
} from "../../schema/types";
import {
  domainToBackendRequest,
  backendSchemaToFrontend,
  apiCreateDomain,
  apiListSchemas,
  apiSaveAttribute,
  apiSaveAttributeTranslation,
  apiListValidationRules,
  apiSaveValidationRule,
  type BackendSchemaEntry,
  type BackendValidationRule,
} from "../../api/datastoreApi";

import { type ExtraSchemaState, EMPTY_EXTRA, mergeAll } from "./mergeSchemas";
import { dbLocation, buildJunctionDomain, primaryLabel, LANG_ORDER } from "./helpers";
import { DomainModelTab } from "./DomainModelTab";
import { UIConfigTab } from "./UIConfigTab";
import { ValidationsTab } from "./ValidationsTab";
import { AccessTab } from "./AccessTab";
import { CreateDomainTab, type CreateDomainPayload } from "./CreateDomainTab";
import { DataTab } from "./DataTab";
import { TranslationsTab } from "./TranslationsTab";
import { ExportJsonTab } from "./ExportJsonTab";
import type { FieldDraft } from "./fieldDraftTypes";
import type { QuickCreateField } from "./DomainPickers";
import { draftToDomainFieldCore, draftToUIHint, draftToABACRule, draftToRBACRule } from "./draftConverters";
import { ImportDomainModelModal } from "./ImportDomainModelModal";
import type { DomainModelImportResult } from "./domainImport";
import { useProjectStore } from "../../store/projectStore";

// ════════════════════════════════════════════════════════════════════════════
// Main export — SchemaInspector
// ════════════════════════════════════════════════════════════════════════════

export type MainTab = "domain" | "ui" | "validations" | "access" | "create" | "data" | "tables" | "translations" | "export";

/**
 * Imperative handle so a parent (e.g. App.tsx's page header, next to the
 * "Domain Model Configurator" heading) can trigger the Import JSON modal
 * or jump straight to the Export tab without SchemaInspector needing to
 * lift its tab/modal state up as props. The "Export" tab was removed from
 * the visible tab bar below — this handle is now the only way to reach it,
 * matching the "Import JSON" button which was moved the same way.
 */
export interface SchemaInspectorHandle {
  openImportModal: () => void;
  loadFromBackend: () => void;
}

interface SchemaInspectorProps {
  schemas: AllSchemas;
  /** Sidebar-driven tab, e.g. from App.tsx's own state. When this changes,
   *  the component jumps to that tab — but internal navigation (redirect-
   *  to-create, jump back to "domain" after a successful import, etc.)
   *  still works exactly as before via the internal `tab` state below;
   *  this prop is purely an external "please go here" signal, not a
   *  fully controlled value the parent has to keep in perfect sync with
   *  every internal navigation. */
  activeTab?: MainTab;
  /** Fires whenever the internal tab changes, for any reason (sidebar
   *  click via activeTab above, or internal navigation like "Create
   *  {domain} domain") — so a parent tracking its own state for sidebar
   *  highlighting stays accurate even after an internal-only jump. */
  onTabChange?: (tab: MainTab) => void;
}

export const SchemaInspector = forwardRef<SchemaInspectorHandle, SchemaInspectorProps>(function SchemaInspector({ schemas, activeTab, onTabChange }, ref) {
  const [tab,   setTab]   = useState<MainTab>(activeTab ?? "domain");
  const [extra, setExtra] = useState<ExtraSchemaState>(EMPTY_EXTRA);
  const [backendLoadStatus, setBackendLoadStatus] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  useImperativeHandle(ref, () => ({
    openImportModal: () => setShowImportModal(true),
    loadFromBackend: () => handleLoadFromBackend(),
  }));

  // Sidebar (or any parent) asked to jump to a specific tab.
  useEffect(() => {
    if (activeTab !== undefined && activeTab !== tab) setTab(activeTab);
    // Only reacts to activeTab changing — internal setTab() calls
    // elsewhere in this component must NOT be interrupted by this effect
    // re-firing, so `tab` is deliberately left out of the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Let the parent know whenever the tab changes, whichever side caused it.
  useEffect(() => {
    onTabChange?.(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const [pendingDomainName, setPendingDomainName] = useState<string | null>(null);
  const [pendingParentDomain, setPendingParentDomain] = useState<string | null>(null);
  const [pendingRelationFieldName, setPendingRelationFieldName] = useState<string | null>(null);
  const [pendingFK, setPendingFK] = useState<{
  parentDomain: string;
  childDomain: string;
  fkFieldName: string;
} | null>(null);
  const baseSchemas = useMemo(
    () => ({ ...schemas, domains: {} as typeof schemas.domains }),
    [schemas],
  );

  const liveSchemas = useMemo(() => mergeAll(baseSchemas, extra), [baseSchemas, extra]);
  const liveDomainNames = useMemo(() => Object.keys(liveSchemas.domains), [liveSchemas]);

  // What the Domain Model page's project filter (top-right, App.tsx) should
  // actually show. Backend-sourced domains are already scoped server-side
  // (apiListSchemas' project_id query param) and pruned client-side in
  // handleLoadFromBackend below, but domains created locally and not yet
  // "Saved to Backend" only get their extra.projectIds tag set at creation
  // time (see handleQuickCreateDomain / handleRichCreateDomain /
  // handleDomainCreated) — they still live in liveSchemas.domains
  // regardless of the filter, so filter them here too. "All Projects"
  // (currentProjectId === null) shows everything, matching apiListSchemas()
  // returning the full unfiltered list in that case.
  const visibleSchemas = useMemo(() => {
    if (!currentProjectId) return liveSchemas;
    const domains: typeof liveSchemas.domains = {};
    for (const [name, def] of Object.entries(liveSchemas.domains)) {
      if (extra.projectIds[name] === currentProjectId) domains[name] = def;
    }
    return { ...liveSchemas, domains };
  }, [liveSchemas, extra.projectIds, currentProjectId]);

const didAutoLoad = useRef(false);

  // Names of domains that came from the backend on the most recent
  // handleLoadFromBackend() call. Used so that switching the project
  // filter (ProjectFilter in App.tsx → currentProjectId) *replaces* the
  // backend-sourced portion of extra.newDomains instead of merging on
  // top of it — otherwise domains fetched under a previously-selected
  // project lingered forever, since the loop below only ever
  // filters-then-appends by name and never removes anything that isn't
  // in the newest response.
  const lastBackendDomainNames = useRef<Set<string>>(new Set());

  // ── Local persistence for display-only relation markers ───────────────────
  // These are fields like clinic.branch (type: "relation", isPartOf: true)
  // that never become real Postgres columns — the backend has nothing to
  // return for them, so without this they vanish on every reload/HMR.
  const RELATION_MARKERS_KEY = "si_relation_markers";

  function loadRelationMarkers(): Record<string, Record<string, DomainFieldCore>> {
    try {
      const raw = localStorage.getItem(RELATION_MARKERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveRelationMarker(domainName: string, fieldName: string, field: DomainFieldCore) {
    try {
      const all = loadRelationMarkers();
      all[domainName] = { ...(all[domainName] ?? {}), [fieldName]: field };
      localStorage.setItem(RELATION_MARKERS_KEY, JSON.stringify(all));
    } catch { /* ignore quota errors */ }
  }

  function removeRelationMarker(domainName: string, fieldName: string) {
    try {
      const all = loadRelationMarkers();
      if (all[domainName]) {
        delete all[domainName][fieldName];
        if (Object.keys(all[domainName]).length === 0) delete all[domainName];
        localStorage.setItem(RELATION_MARKERS_KEY, JSON.stringify(all));
      }
    } catch { /* ignore */ }
  }
async function handleQuickCreateDomain(name: string, fields: QuickCreateField[]) {
  const domainFields: Record<string, DomainFieldCore> = {};
  for (const f of fields) { domainFields[f.name] = { type: f.type }; }

  const domainDef: DomainDefinition = { name, fields: domainFields };
    setExtra((prev) => ({
      ...prev,
      newDomains: [...prev.newDomains.filter((d) => d.name !== name), domainDef],
      dbBackends: { ...prev.dbBackends, [name]: "postgresql" },
      // Tag the domain with whichever project is currently selected so the
      // Domain Model page's project filter can hide it once you switch
      // away — otherwise it stays in extra.newDomains untagged forever and
      // shows up under every filter, since apiCreateDomain's own project
      // scoping only takes effect once "Save to Backend" is clicked and a
      // fresh backend reload happens. Left untouched ("no project") when
      // nothing is selected, matching the "All Projects" scope.
      projectIds: currentProjectId
        ? { ...prev.projectIds, [name]: currentProjectId }
        : prev.projectIds,
    }));

    // Also create the actual table in the backend
    try {
      const req = domainToBackendRequest({
        registry: liveSchemas._layers?.validationRegistry ?? {},
        domainName: name,
        fields:     domainFields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: "postgresql",
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "already existed";
        setBackendLoadStatus(`✅ Domain "${name}" ${action} in PostgreSQL.`);
      } else {
        setBackendLoadStatus(`⚠️ Domain "${name}" added to schema, but backend: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Domain "${name}" added to schema but backend unreachable: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 4000);
  }

  // ── Rich quick-create (LinkDomainModal's embedded compact FieldBuilder) ───
  // Separate from handleQuickCreateDomain above (legacy QuickCreateField[]
  // path, still used by the __new__: JSON-encoded flow elsewhere) — this
  // one receives full FieldDraft objects, so quick-created domains get
  // real labels, relation config, and (if provided) registry validation
  // refs, converted through the same draftToDomainFieldCore / draftToUIHint
  // / draftToRBACRule / draftToABACRule helpers CreateDomainTab.buildPayload
  // uses, instead of being limited to bare {name, type} fields.
  //
  // Scope note: this intentionally only handles (a) plain fields and
  // (b) relation fields pointing at an ALREADY-EXISTING domain (isPartOf
  // === "fk"). It does not attempt junction-table creation for brand-new
  // Association relations, or nested nothing-exists-yet relation chains —
  // those remain the full Create Domain tab's job. The compact
  // FieldBuilder inside the modal already hides the "Create {domain}
  // domain" button (see FieldBuilder's `compact` guard), so a field
  // relating to a domain that doesn't exist yet can't be produced from
  // this path in the first place.
  async function handleRichCreateDomain(
    name: string,
    fieldDrafts: Record<string, FieldDraft>,
    isPartOf: boolean,
    parentDomainName?: string,
  ) {
    const domainFields: Record<string, DomainFieldCore> = {};
    const uiHints: Record<string, FieldUIConfig>        = {};
    const rbacRules: Record<string, RBACFieldRule>      = {};
    const abacRules: Record<string, ABACFieldRule>      = {};
    const fieldLabels: Record<string, Record<"en" | "ta" | "ar", string>> = {};

    for (const [fieldName, d] of Object.entries(fieldDrafts)) {
      fieldLabels[fieldName] = d.labels;

      if (d.type === "relation" && d.relatedDomain && d.isPartOf === "fk") {
        // Belongs-to an existing domain — real FK column on THIS
        // (quick-created) domain, e.g. designation.branchId → branch.
        const fkFieldName = `${d.relatedDomain}Id`;
        domainFields[fkFieldName] = { type: "relation", relatedDomain: d.relatedDomain, relationKind: d.relationKind };
        const fp = `${name}.${fkFieldName}`;
        const hint = draftToUIHint(d);
        uiHints[fp] = Object.keys(hint).length ? hint : { label: primaryLabel(d.labels, fkFieldName) };
        const rbac = draftToRBACRule(d); if (rbac) rbacRules[fp] = rbac;
        const abac = draftToABACRule(d); if (abac) abacRules[fp] = abac;
        continue;
      }

      domainFields[fieldName] = draftToDomainFieldCore(d);
      const fp = `${name}.${fieldName}`;
      const hint = draftToUIHint(d);
      uiHints[fp] = Object.keys(hint).length ? hint : { label: primaryLabel(d.labels, fieldName) };
      const rbac = draftToRBACRule(d); if (rbac) rbacRules[fp] = rbac;
      const abac = draftToABACRule(d); if (abac) abacRules[fp] = abac;
    }

    // Composition — this new domain is "part of" a parent, so it gets the
    // parent's FK column (same convention as pendingFK / handleAddFieldToExisting).
    if (isPartOf && parentDomainName) {
      const parentIdField = `${parentDomainName}Id`;
      if (!domainFields[parentIdField]) {
        domainFields[parentIdField] = { type: "string", relationKind: "integral" };
        uiHints[`${name}.${parentIdField}`] = { label: parentIdField };
      }
    }

    const domainDef: DomainDefinition = { name, fields: domainFields };

    setExtra((prev) => ({
      ...prev,
      newDomains: [...prev.newDomains.filter((d) => d.name !== name), domainDef],
      uiHints:    { ...prev.uiHints,   ...uiHints   },
      rbacRules:  { ...prev.rbacRules, ...rbacRules },
      abacRules:  { ...prev.abacRules, ...abacRules },
      dbBackends: { ...prev.dbBackends, [name]: "postgresql" },
      projectIds: currentProjectId
        ? { ...prev.projectIds, [name]: currentProjectId }
        : prev.projectIds,
    }));

    // Persist relation markers (display-only, e.g. a "domain model" typed
    // field whose fkFieldName differs from the literal field name).
    for (const [fieldName, fieldDef] of Object.entries(domainFields)) {
      if (fieldDef.type === "relation" && fieldDef.relatedDomain && fieldName !== `${fieldDef.relatedDomain}Id`) {
        saveRelationMarker(name, fieldName, fieldDef);
      }
    }

    // Push the real table to the backend.
    const backendFields: Record<string, DomainFieldCore> = Object.fromEntries(
      Object.entries(domainFields)
        .filter(([k, f]) => !(f.type === "relation" && f.relatedDomain && k !== `${f.relatedDomain}Id`))
        .map(([k, f]) => [k, f.type === "relation" ? { ...f, type: "string" as FieldType } : f])
    );

    try {
      const req = domainToBackendRequest({
        registry:   liveSchemas._layers?.validationRegistry ?? {},
        domainName: name,
        fields:     backendFields as any,
        uiHints:    uiHints as any,
        rbacRules:  rbacRules as any,
        abacRules:  abacRules as any,
        db_backend: "postgresql",
      } as any);
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "already existed";
        setBackendLoadStatus(`✅ Domain "${name}" ${action} in ${dbLocation(res)} — ${Object.keys(domainFields).length} field(s).`);
      } else {
        setBackendLoadStatus(`⚠️ Domain "${name}" added to schema, but backend: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Domain "${name}" added to schema but backend unreachable: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 5000);

    // Save attribute labels/translations, same as handleDomainCreated does
    // for the full Create Domain tab path.
    for (const [fieldName, fieldDef] of Object.entries(domainFields)) {
      const fieldUiHint  = uiHints[`${name}.${fieldName}`];
      const draftLabels  = fieldLabels[fieldName];
      apiSaveAttribute(name, fieldName, fieldUiHint?.label || fieldName, fieldDef.type)
        .then(() => {
          if (!draftLabels) return;
          for (const lang of LANG_ORDER) {
            const text = draftLabels[lang]?.trim();
            if (!text) continue;
            apiSaveAttributeTranslation(name, fieldName, lang, text).catch(console.warn);
          }
        })
        .catch(console.warn);
    }
  }

  // ── Import a full Domain Model JSON (inverse of the Export tab) ────────────
  // Adds every parsed domain's fields into `extra.extraFields` (mergeAll()
  // already knows how to fold that into a brand-new domain OR merge into an
  // existing one), persists relation markers the same way "Link a Domain
  // Model" does, and best-effort creates a real backend table for each
  // domain's non-relation fields (relation fields never become columns —
  // they're display-only markers, same as everywhere else in this file).
  async function handleImportDomainModelJson(result: DomainModelImportResult) {
    setExtra((prev) => {
      const nextExtraFields = { ...prev.extraFields };
      const nextDbBackends = { ...prev.dbBackends };
      for (const domain of result.domains) {
        nextExtraFields[domain.name] = { ...(nextExtraFields[domain.name] ?? {}), ...domain.fields };
        if (!nextDbBackends[domain.name]) nextDbBackends[domain.name] = "postgresql";
      }
      return { ...prev, extraFields: nextExtraFields, dbBackends: nextDbBackends };
    });

    for (const [domName, markers] of Object.entries(result.relationMarkers)) {
      for (const [fieldName, fieldDef] of Object.entries(markers)) {
        saveRelationMarker(domName, fieldName, fieldDef);
      }
    }

    setTab("domain");
    setShowImportModal(false);

    let created = 0;
    let failed = 0;
    for (const domain of result.domains) {
      // Relation-marker fields never become real backend columns.
      const backendFields = Object.fromEntries(
        Object.entries(domain.fields).filter(([, f]) => f.type !== "relation")
      );
      if (Object.keys(backendFields).length === 0) continue;
      try {
        const req = domainToBackendRequest({
          registry:   liveSchemas._layers?.validationRegistry ?? {},
          domainName: domain.name,
          fields:     backendFields as any,
          uiHints:    {},
          rbacRules:  {},
          abacRules:  {},
          db_backend: "postgresql",
        });
        const res = await apiCreateDomain(req);
        if (res.status === "success") created++; else failed++;
      } catch {
        failed++;
      }
    }
    setBackendLoadStatus(
      `✅ Imported ${result.totalDomains} domain model(s), ${result.totalAttributes} attribute(s)` +
      (result.skippedSynthesized ? ` (${result.skippedSynthesized} synthesized attribute(s) skipped)` : "") +
      (failed ? ` — ${created} table(s) saved to backend, ${failed} failed (still available locally).` : ` — saved to backend.`)
    );
    setTimeout(() => setBackendLoadStatus(null), 6000);
  }

  // ── Redirect to Create Domain tab ─────────────────────────────────────────
const handleRedirectToCreate = (domainName: string, parentDomain?: string, fieldName?: string) => {
  setPendingDomainName(domainName);
  setPendingParentDomain(parentDomain || null);
  setPendingRelationFieldName(fieldName || null);
  // ✅ Ensure the parent's FK column gets injected into the new child
  // domain's fields when it's created, same as the handleAddFieldToExisting
  // path does. Without this, clicking "Create {domain} domain" straight
  // from the FieldBuilder button skips FK wiring entirely.
  if (parentDomain) {
    setPendingFK({
      parentDomain,
      childDomain: domainName,
      fkFieldName: `${parentDomain}Id`,
    });
  }
  setTab("create");
};
  // ── Core junction creation helper ─────────────────────────────────────────
async function ensureJunctionDomain(
  parentDomainName: string,
  relatedDomainName: string,
  dbBackend: string,
) {
  const pairKey = [parentDomainName, relatedDomainName].sort().join("__");
  if (extra.junctionPairs.has(pairKey)) return; // ✅ deduplicate

  const jd = buildJunctionDomain(parentDomainName, relatedDomainName);

  // Always build rd with parent fields
  // If cbranch was quick-created with empty fields, use parent fields
  // If cbranch already has its own fields, keep those
  const parentFields = liveSchemas.domains[parentDomainName]?.fields ?? {};
  const relatedExistingFields = liveSchemas.domains[relatedDomainName]?.fields ?? {};
  const hasExistingFields = Object.keys(relatedExistingFields).length > 0;

const rd: DomainDefinition = {
    name:   relatedDomainName,
    fields: hasExistingFields
      ? { ...relatedExistingFields } as Record<string, DomainFieldCore>
      : {} as Record<string, DomainFieldCore>,
  };
  // Always add both rd and jd to live schema
setExtra((prev) => {
    const nextPairs = new Set(prev.junctionPairs);
    nextPairs.add(pairKey);
    const toAdd = [jd]; // junction only — no parent ID in either table
    return {
      ...prev,
      newDomains: [
        ...prev.newDomains.filter((d) => !toAdd.find((n) => n.name === d.name)),
        ...toAdd,
      ],
      dbBackends: {
        ...prev.dbBackends,
        ...Object.fromEntries(toAdd.map((d) => [d.name, dbBackend])),
      },
      projectIds: currentProjectId
        ? { ...prev.projectIds, ...Object.fromEntries(toAdd.map((d) => [d.name, currentProjectId])) }
        : prev.projectIds,
      junctionPairs: nextPairs,
    };
  });

  // Always push both rd and jd to backend
  // apiCreateDomain returns table_created: false if already exists — safe to call always
const domainsToPush = [jd];
  for (const domain of domainsToPush) {
    const isJunction = true;
    try {
      const req = domainToBackendRequest({
        registry: liveSchemas._layers?.validationRegistry ?? {},
        domainName: domain.name,
        fields:     domain.fields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: dbBackend as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "already existed";
        const label  = isJunction ? "Junction table" : "Related domain";
        setBackendLoadStatus(`✅ ${label} "${domain.name}" ${action}.`);
      } else {
        setBackendLoadStatus(`⚠️ "${domain.name}" added to schema, but backend: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ "${domain.name}" backend unreachable: ${err?.message}`);
    }
  }
  setTimeout(() => setBackendLoadStatus(null), 5000);
}

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleAddFieldToExisting(domainName: string, fieldName: string, draft: FieldDraft) {
    console.log("handleAddFieldToExisting called — type:", draft.type, "isPartOf:", draft.isPartOf, "relatedDomain:", draft.relatedDomain);
    const fullPath = `${domainName}.${fieldName}`;
    const uiHint   = draftToUIHint(draft);
    const abac     = draftToABACRule(draft);
    const rbac     = draftToRBACRule(draft);
    const newField = draftToDomainFieldCore(draft);

setExtra((prev) => ({
      ...prev,
      // Belongs-to FK relations (isPartOf === "fk") skip adding the literal
      // field name here — the real fkFieldName (e.g. patientId) is added by
      // the dedicated "fk" branch below instead, so we don't want a
      // duplicate "patient" field sitting next to "patientId".
      // New parent→child relations (isPartOf === true) DO get added here —
      // for relations this is a display-only marker in the parent's field
      // list (it's never sent to the backend as a real column; the child
      // domain gets the real FK, handled further below).
      extraFields: (draft.type === "relation" && draft.isPartOf === "fk")
        ? prev.extraFields
        : { ...prev.extraFields, [domainName]: { ...(prev.extraFields[domainName] ?? {}), [fieldName]: newField } },
      uiHints:     Object.values(uiHint).some((v) => v !== undefined) ? { ...prev.uiHints, [fullPath]: uiHint } : prev.uiHints,
      abacRules:   abac ? { ...prev.abacRules, [fullPath]: abac } : prev.abacRules,
      rbacRules:   rbac ? { ...prev.rbacRules, [fullPath]: rbac } : prev.rbacRules,
    }));
    try {
      await apiSaveAttribute(domainName, fieldName, primaryLabel(draft.labels, fieldName), draft.type);
      for (const lang of LANG_ORDER) {
        const text = draft.labels[lang]?.trim();
        if (!text) continue;
        await apiSaveAttributeTranslation(domainName, fieldName, lang, text);
      }
    } catch (err: any) {
      console.warn("Could not save attribute/translations:", err?.message);
    }

    // Auto-create junction table if this is a relation field
if (draft.type === "relation" && draft.relatedDomain && !draft.relatedDomain.startsWith("__new__:")) {
      const dbBackend = extra.dbBackends[domainName] ?? "postgresql";
console.log("handleAddFieldToExisting — isPartOf:", draft.isPartOf, "domain:", domainName, "related:", draft.relatedDomain);

if (draft.isPartOf === "fk") {
        // ✅ Belongs-to — existing domain, no junction/no modal. THIS domain
        // (the one being edited, e.g. consultation) gets a real FK column,
        // e.g. consultation.patientId → patient. The related domain is left
        // untouched.
        const fkFieldName = `${draft.relatedDomain}Id`;
        // Keep type "relation" locally so the UI still shows the 🔗 badge and
        // renders a domain-picker in the Data tab; the physical DB column is
        // sent as "string", matching how FK columns are persisted elsewhere.
        const fkFieldLocal: DomainFieldCore = { type: "relation", relatedDomain: draft.relatedDomain, relationKind: draft.relationKind };
        setExtra((prev) => ({
          ...prev,
          extraFields: {
            ...prev.extraFields,
            [domainName]: {
              ...(prev.extraFields[domainName] ?? {}),
              [fkFieldName]: fkFieldLocal,
            },
          },
        }));
        try {
          const existingFields = liveSchemas.domains[domainName]?.fields ?? {};
          const updatedFields = {
            ...existingFields,
            // relationKind: "association" marks this as a reassignable
            // belongs-to FK (e.g. doctor.branchId → branch), so the
            // view-builder shows Add Existing / Remove actions for it.
            [fkFieldName]: { type: "string" as FieldType, relationKind: draft.relationKind },
          };
          const req = domainToBackendRequest({
            registry: liveSchemas._layers?.validationRegistry ?? {},
            domainName, fields: updatedFields as any, uiHints: liveSchemas.uiHints as any,
            rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
          });
          const res = await apiCreateDomain(req);
          if (res.status === "success") {
            setBackendLoadStatus(
              `✅ "${fkFieldName}" added to "${domainName}" — FK → "${draft.relatedDomain}" in ${dbLocation(res)}.`
            );
          } else {
            setBackendLoadStatus(`⚠️ "${fkFieldName}" added locally, but backend: ${res.message}`);
          }
        } catch (err: any) {
          setBackendLoadStatus(`⚠️ Could not add "${fkFieldName}" to "${domainName}": ${err?.message}`);
        }
        setTimeout(() => setBackendLoadStatus(null), 5000);
     } else if (draft.isPartOf) {
        // ✅ CHECKED — add parentId FK into child (relatedDomain) table
        const parentIdField = `${domainName}Id`;
        // Persist the display-only marker on THIS (parent) domain so it
        // survives a reload — the backend never sees a real "branch" column.
        saveRelationMarker(domainName, fieldName, newField);
        
        // 🔥 FIX: Check if child domain already exists
        const childExists = liveSchemas.domains[draft.relatedDomain] !== undefined;
        
        if (childExists) {
          // Child exists — add FK via API call
          setExtra((prev) => ({
            ...prev,
            extraFields: {
              ...prev.extraFields,
              [draft.relatedDomain]: {
                ...(prev.extraFields[draft.relatedDomain] ?? {}),
                [parentIdField]: { type: "string", relationKind: "integral" },
              },
            },
          }));
          try {
            const childExistingFields = liveSchemas.domains[draft.relatedDomain]?.fields ?? {};
            const childUpdatedFields = {
              ...childExistingFields,
              // relationKind: "integral" marks this as a composition FK
              // (e.g. branch.clinicId → clinic) — the child only ever
              // exists under its parent, so the view-builder hides
              // Add Existing / Remove for it and only allows Create.
              [parentIdField]: { type: "string" as FieldType, relationKind: "integral" },
            };
            const req = domainToBackendRequest({
              registry: liveSchemas._layers?.validationRegistry ?? {},
              domainName:  draft.relatedDomain,
              fields:      childUpdatedFields as any,
              uiHints:     {},
              rbacRules:   {},
              abacRules:   {},
              db_backend:  dbBackend as any,
            });
            const res = await apiCreateDomain(req);
            if (res.status === "success") {
              setBackendLoadStatus(
                `✅ "${parentIdField}" added to child table "${draft.relatedDomain}" — ${dbLocation(res)}`
              );
            } else {
              setBackendLoadStatus(`⚠️ "${parentIdField}" to "${draft.relatedDomain}": ${res.message}`);
            }
          } catch (err: any) {
            setBackendLoadStatus(`⚠️ Could not add "${parentIdField}" to "${draft.relatedDomain}": ${err?.message}`);
          }
        } else {
          // 🔥 NEW: Child doesn't exist yet — set pending FK to be added during domain creation
          setPendingFK({
            parentDomain: domainName,
            childDomain: draft.relatedDomain,
            fkFieldName: parentIdField,
          });
          // Redirect to create the child domain
          handleRedirectToCreate?.(draft.relatedDomain, domainName, fieldName);
        }
        setTimeout(() => setBackendLoadStatus(null), 5000);
      }
    }
  }

  async function handleEditField(domainName: string, oldName: string, newName: string, draft: FieldDraft) {
    const updatedField = draftToDomainFieldCore(draft);
    const uiHint       = draftToUIHint(draft);
    const abac         = draftToABACRule(draft);
    const rbac         = draftToRBACRule(draft);
    const oldPath      = `${domainName}.${oldName}`;
    const newPath      = `${domainName}.${newName}`;
    const isRename     = oldName !== newName;

    const domainInNewDomains = extra.newDomains.find((d) => d.name === domainName);

    setExtra((prev) => {
      const uiHints = { ...prev.uiHints };
      if (isRename && uiHints[oldPath]) { uiHints[newPath] = uiHints[oldPath]; delete uiHints[oldPath]; }
      if (Object.values(uiHint).some((v) => v !== undefined)) uiHints[newPath] = uiHint;

      const abacRules = { ...prev.abacRules };
      if (isRename && abacRules[oldPath]) { abacRules[newPath] = abacRules[oldPath]; delete abacRules[oldPath]; }
      if (abac) abacRules[newPath] = abac;

      const rbacRules = { ...prev.rbacRules };
      if (isRename && rbacRules[oldPath]) { rbacRules[newPath] = rbacRules[oldPath]; delete rbacRules[oldPath]; }
      if (rbac) rbacRules[newPath] = rbac;

      if (prev.newDomains.some((d) => d.name === domainName)) {
        const updatedNewDomains = prev.newDomains.map((d) => {
          if (d.name !== domainName) return d;
          const fields = { ...d.fields };
          if (isRename) delete fields[oldName];
          // ✅ relation fields never become columns in the parent domain
          if ((draft.type as string) === "relation") {
            delete fields[newName];
          } else {
            fields[newName] = updatedField;
          }
          return { ...d, fields };
        });
        const domainExtraFields = { ...(prev.extraFields[domainName] ?? {}) };
        if (isRename) delete domainExtraFields[oldName];
        delete domainExtraFields[newName];
        return { ...prev, newDomains: updatedNewDomains, extraFields: { ...prev.extraFields, [domainName]: domainExtraFields }, uiHints, abacRules, rbacRules };
      } else {
        const domainFields = { ...(prev.extraFields[domainName] ?? {}) };
        if (isRename) delete domainFields[oldName];
        // ✅ relation fields never become columns in the parent domain
        if ((draft.type as string) === "relation") {
          delete domainFields[newName];
        } else {
          domainFields[newName] = updatedField;
        }
        return { ...prev, extraFields: { ...prev.extraFields, [domainName]: domainFields }, uiHints, abacRules, rbacRules };
      }
    });

try {
      await apiSaveAttribute(domainName, newName, primaryLabel(draft.labels, newName), draft.type);
      for (const lang of LANG_ORDER) {
        const text = draft.labels[lang]?.trim();
        if (!text) continue;
        await apiSaveAttributeTranslation(domainName, newName, lang, text);
      }
    } catch (err: any) {
      console.warn("Could not save attribute/translations:", err?.message);
    }

if (draft.type === "relation" && draft.relatedDomain && !draft.relatedDomain.startsWith("__new__:")) {
      const dbBackend = extra.dbBackends[domainName] ?? "postgresql";
      console.log("HANDLER isPartOf:", draft.isPartOf, "relatedDomain:", draft.relatedDomain);

if (draft.isPartOf === "fk") {
        // ✅ Belongs-to — existing domain. THIS domain gets a real FK column,
        // e.g. consultation.patientId → patient. No junction table.
        const fkFieldName = `${draft.relatedDomain}Id`;
        const fkFieldLocal: DomainFieldCore = { type: "relation", relatedDomain: draft.relatedDomain, relationKind: draft.relationKind };
        setExtra((prev) => ({
          ...prev,
          extraFields: {
            ...prev.extraFields,
            [domainName]: {
              ...(prev.extraFields[domainName] ?? {}),
              [fkFieldName]: fkFieldLocal,
            },
          },
        }));
        try {
          const existingFields = liveSchemas.domains[domainName]?.fields ?? {};
          const updatedFields = {
            ...existingFields,
            // relationKind: "association" marks this as a reassignable
            // belongs-to FK (e.g. doctor.branchId → branch), so the
            // view-builder shows Add Existing / Remove actions for it.
            [fkFieldName]: { type: "string" as FieldType, relationKind: draft.relationKind },
          };
          const req = domainToBackendRequest({
            registry: liveSchemas._layers?.validationRegistry ?? {},
            domainName, fields: updatedFields as any, uiHints: liveSchemas.uiHints as any,
            rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
          });
          const res = await apiCreateDomain(req);
          if (res.status === "success") {
            setBackendLoadStatus(
              `✅ "${fkFieldName}" added to "${domainName}" — FK → "${draft.relatedDomain}" in ${dbLocation(res)}.`
            );
          } else {
            setBackendLoadStatus(`⚠️ "${fkFieldName}" added locally, but backend: ${res.message}`);
          }
        } catch (err: any) {
          setBackendLoadStatus(`⚠️ Could not add "${fkFieldName}" to "${domainName}": ${err?.message}`);
        }
        setTimeout(() => setBackendLoadStatus(null), 5000);
      } else if (!draft.isPartOf) {
        // ❌ UNCHECKED — create junction table
        await ensureJunctionDomain(domainName, draft.relatedDomain, dbBackend);
      } else {
        // ✅ CHECKED — add domainNameId into child (relatedDomain) table only
        const parentIdField = `${domainName}Id`;
        setExtra((prev) => ({
          ...prev,
          extraFields: {
            ...prev.extraFields,
            [draft.relatedDomain]: {
              ...(prev.extraFields[draft.relatedDomain] ?? {}),
              [parentIdField]: { type: "string", relationKind: "integral" },
            },
          },
        }));
        try {
          const childExistingFields = liveSchemas.domains[draft.relatedDomain]?.fields ?? {};
          const childUpdatedFields  = {
            ...childExistingFields,
            // relationKind: "integral" marks this as a composition FK
            // (e.g. branch.clinicId → clinic) — the child only ever
            // exists under its parent, so the view-builder hides
            // Add Existing / Remove for it and only allows Create.
            [parentIdField]: { type: "string" as FieldType, relationKind: "integral" },
          };
          const req = domainToBackendRequest({
            registry: liveSchemas._layers?.validationRegistry ?? {},
            domainName:  draft.relatedDomain,
            fields:      childUpdatedFields as any,
            uiHints:     {},
            rbacRules:   {},
            abacRules:   {},
            db_backend:  dbBackend as any,
          });
          const res = await apiCreateDomain(req);
          if (res.status === "success") {
            setBackendLoadStatus(
              `✅ "${parentIdField}" added to "${draft.relatedDomain}" — ${dbLocation(res)}.`
            );
          } else {
            setBackendLoadStatus(`⚠️ "${parentIdField}" added locally, backend: ${res.message}`);
          }
        } catch (err: any) {
          setBackendLoadStatus(`⚠️ Could not add "${parentIdField}" to backend: ${err?.message}`);
        }
        setTimeout(() => setBackendLoadStatus(null), 5000);

      } 
    }

    // Relation fields are fully handled by the branches above — each one
    // (fk / checked parent→child / unchecked junction) already sent its
    // own complete apiCreateDomain request with the correct field shape
    // (including relationKind). Running this generic trailing save for
    // relation fields too was a real bug: it read from `extra.extraFields`,
    // a React state snapshot that doesn't yet reflect the setExtra call
    // just made above (state updates aren't synchronous), so it would send
    // a stale/incomplete payload. Since the backend's save_schema does a
    // full replace (not a merge) of the schema JSON, this second call
    // would silently overwrite — and strip — the correct relationKind the
    // first call had just written. Skipping entirely for relation fields.
    if ((draft.type as string) === "relation") {
      return;
    }

    try {
      let rawFields: Record<string, DomainFieldCore>;
      if (domainInNewDomains) {
        rawFields = { ...domainInNewDomains.fields };
      } else {
        rawFields = { ...(extra.extraFields[domainName] ?? {}) } as Record<string, DomainFieldCore>;
      }
      if (isRename) delete rawFields[oldName];
      // ✅ relation fields never become columns in the parent table —
      // they're handled via the child FK or the junction table instead.
      if ((draft.type as string) === "relation") {
        delete rawFields[newName];
      } else {
        rawFields[newName] = updatedField;
      }

      const updatedUIHints = { ...(liveSchemas.uiHints ?? {}) };
      if (isRename && updatedUIHints[oldPath]) { updatedUIHints[newPath] = updatedUIHints[oldPath]; delete updatedUIHints[oldPath]; }
      if (Object.values(uiHint).some((v) => v !== undefined)) updatedUIHints[newPath] = uiHint;

      const req = domainToBackendRequest({
        registry: liveSchemas._layers?.validationRegistry ?? {},
        domainName, fields: rawFields as any, uiHints: updatedUIHints as any,
        rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action = res.table_created ? "created" : "schema updated";
        const label  = isRename ? `"${oldName}" → "${newName}"` : `"${newName}"`;
        setBackendLoadStatus(`✅ Field ${label} saved — table "${domainName}" ${action} in ${dbLocation(res)}.`);
      } else {
        setBackendLoadStatus(`⚠️ Field saved locally, but backend error: ${res.message}`);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Field saved locally, but backend unreachable: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 5000);
  }

function handleDomainCreated(payload: CreateDomainPayload) {
    // Persist display-only relation markers
    for (const [fieldName, fieldDef] of Object.entries(payload.domain.fields)) {
      if (fieldDef.type === "relation" && fieldDef.relatedDomain && fieldName !== `${fieldDef.relatedDomain}Id`) {
        saveRelationMarker(payload.domain.name, fieldName, fieldDef);
      }
    }
    
    // ✅ Add relation back to parent domain if this was from a redirect
    if (pendingParentDomain && pendingDomainName && pendingRelationFieldName) {
      const relationField: DomainFieldCore = {
        type: "relation",
        relatedDomain: pendingDomainName,
      };
      setExtra((prev) => ({
        ...prev,
        extraFields: {
          ...prev.extraFields,
          [pendingParentDomain]: {
            ...(prev.extraFields[pendingParentDomain] ?? {}),
            [pendingRelationFieldName]: relationField,
          },
        },
      }));
      // Clear pending state
      setPendingDomainName(null);
      setPendingParentDomain(null);
      setPendingRelationFieldName(null);
    }
    
    // 🔥 NEW: Add pending FK to the new domain if it exists
    if (pendingFK && pendingFK.childDomain === payload.domain.name) {
      // pendingFK is only ever queued from the "is part of" (composition)
      // flow, so this FK is always relationKind: "integral". The `as const`
      // keeps the literal narrowed to "integral" instead of widening to a
      // plain string, which is required by DomainFieldCore.relationKind's
      // "integral" | "association" union.
      const updatedFields = {
        ...payload.domain.fields,
        [pendingFK.fkFieldName]: { type: "string" as FieldType, relationKind: "integral" as const },
      };
      // Update the domain with the FK field
      payload.domain.fields = updatedFields;
      
      // Also add to extraFields to ensure merge works
      setExtra((prev) => ({
        ...prev,
        extraFields: {
          ...prev.extraFields,
          [pendingFK.childDomain]: {
            ...(prev.extraFields[pendingFK.childDomain] ?? {}),
            [pendingFK.fkFieldName]: { type: "string", relationKind: "integral" as const },
          },
        },
      }));
      
      // Clear pending FK
      setPendingFK(null);
    }
    
    setExtra((prev) => {
      const nextPairs = new Set(prev.junctionPairs);
      const newJunctionDomains: DomainDefinition[] = [];

      for (const jd of payload.junctionDomains ?? []) {
        const parts  = jd.name.split("_");
        const pairKey = parts.sort().join("__");
        if (!nextPairs.has(pairKey)) {
          nextPairs.add(pairKey);
          newJunctionDomains.push(jd);
        }
      }
      const newRelatedDomains = (payload as any).relatedDomains ?? [];
      const allNew = [payload.domain, ...newRelatedDomains, ...newJunctionDomains];
       return {
        ...prev,
        newDomains: [
          ...prev.newDomains.filter((d) => !allNew.find((n: DomainDefinition) => n.name === d.name)),
          ...allNew,
        ],
        uiHints:    { ...prev.uiHints,   ...payload.uiHints   },
        rbacRules:  { ...prev.rbacRules, ...payload.rbacRules },
        abacRules:  { ...prev.abacRules, ...payload.abacRules },
        dbBackends: {
          ...prev.dbBackends,
          ...Object.fromEntries(allNew.map((d: DomainDefinition) => [d.name, payload.dbBackend])),
        },
        // Same reasoning as handleQuickCreateDomain/handleRichCreateDomain —
        // tag every domain created in this flow (including any related /
        // junction domains it pulled in) with whichever project is active
        // right now, so the Domain Model page's project filter can hide
        // them once you switch away.
        projectIds: currentProjectId
          ? {
              ...prev.projectIds,
              ...Object.fromEntries(allNew.map((d: DomainDefinition) => [d.name, currentProjectId])),
            }
          : prev.projectIds,
        versioned: { ...prev.versioned, [payload.domain.name]: payload.versioned },
        junctionPairs: nextPairs,
      };
    });

   
for (const [fieldName, fieldDef] of Object.entries(payload.domain.fields)) {
      const fieldUiHint = payload.uiHints[`${payload.domain.name}.${fieldName}`];
      const draftLabels = payload.fieldLabels?.[fieldName];

      apiSaveAttribute(
        payload.domain.name, fieldName,
        fieldUiHint?.label || fieldName, fieldDef.type,
      ).then(() => {
        if (!draftLabels) return;
        for (const lang of LANG_ORDER) {
          const text = draftLabels[lang]?.trim();
          if (!text) continue;
          apiSaveAttributeTranslation(payload.domain.name, fieldName, lang, text).catch(console.warn);
        }
      }).catch(console.warn);
    }
  }

  function handleAddUIHint(path: string, hint: FieldUIConfig) {
    setExtra((prev) => ({ ...prev, uiHints: { ...prev.uiHints, [path]: hint } }));
  }
  /**
   * Adds a brand-new named validation rule at runtime — "Create new rule"
   * in the field builder, for exactly the case where you need a
   * domain-specific rule (e.g. valid_patient_name) but that domain didn't
   * exist yet when src/validations/index.ts was last written. Persisted to
   * the backend's validation_rules table via apiSaveValidationRule — the
   * local extra.extraValidationRules update happens immediately (so the
   * new rule is usable right away in this session's picker) and the
   * backend save happens alongside it, so a reload picks it back up via
   * handleLoadValidationRulesFromBackend() below instead of losing it.
   */
  async function handleAddValidationRule(tag: string, rule: NamedValidationRule) {
    setExtra((prev) => ({ ...prev, extraValidationRules: { ...prev.extraValidationRules, [tag]: rule } }));
    try {
      const res = await apiSaveValidationRule(tag, rule as Omit<BackendValidationRule, "tag">);
      if (res.status !== "success") {
        setBackendLoadStatus(`⚠️ Rule "${tag}" saved locally, but backend: ${res.message}`);
        setTimeout(() => setBackendLoadStatus(null), 5000);
      }
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Rule "${tag}" saved locally, but backend unreachable: ${err?.message}`);
      setTimeout(() => setBackendLoadStatus(null), 5000);
    }
  }

  /** Converts one DB row (tag + rule fields flattened together) back into
   *  the { [tag]: NamedValidationRule } shape the rest of the app expects —
   *  the inverse of what apiSaveValidationRule sends. */
  function backendRuleToNamed(row: BackendValidationRule): NamedValidationRule {
    const { tag, ...rest } = row;
    return rest as NamedValidationRule;
  }

  /** GET /datastore/validation-rules on mount — loads every rule stored in
   *  the DB and merges it into extra.extraValidationRules, the same layer
   *  "Create new rule" writes into. This is what makes a rule created via
   *  the field builder survive a reload, instead of only living in this
   *  session's React state. */
  async function handleLoadValidationRulesFromBackend() {
    try {
      const res = await apiListValidationRules();
      if (res.status !== "success" || !res.rules?.length) return;
      setExtra((prev) => {
        const next = { ...prev.extraValidationRules };
        for (const row of res.rules) next[row.tag] = backendRuleToNamed(row);
        return { ...prev, extraValidationRules: next };
      });
    } catch (err: any) {
      console.warn("Could not load validation rules from backend:", err?.message);
    }
  }
  function handleRemoveUIHint(path: string) {
    setExtra((prev) => { const n = { ...prev.uiHints }; delete n[path]; return { ...prev, uiHints: n }; });
  }
  function handleAddRBAC(path: string, rule: RBACFieldRule) {
    setExtra((prev) => ({ ...prev, rbacRules: { ...prev.rbacRules, [path]: rule } }));
  }
  function handleRemoveRBAC(path: string) {
    setExtra((prev) => { const n = { ...prev.rbacRules }; delete n[path]; return { ...prev, rbacRules: n }; });
  }
  function handleAddABAC(path: string, rule: ABACFieldRule) {
    setExtra((prev) => ({ ...prev, abacRules: { ...prev.abacRules, [path]: rule } }));
  }
  function handleRemoveABAC(path: string) {
    setExtra((prev) => { const n = { ...prev.abacRules }; delete n[path]; return { ...prev, abacRules: n }; });
  }
function handleViewConfig(domainName: string, cfg: DomainViewConfig) {
    setExtra((prev) => ({ ...prev, viewConfigs: { ...prev.viewConfigs, [domainName]: cfg } }));
  }

  async function handleSaveTranslation(domainName: string, fieldName: string, lang: "en" | "ta" | "ar", text: string) {
    try {
      await apiSaveAttributeTranslation(domainName, fieldName, lang, text);
      setBackendLoadStatus(`✅ Translation saved for "${domainName}.${fieldName}" [${lang.toUpperCase()}]`);
    } catch (err: any) {
      setBackendLoadStatus(`⚠️ Translation save failed: ${err?.message}`);
    }
    setTimeout(() => setBackendLoadStatus(null), 3000);
  }

  async function handleSaveDomainToBackend(domainName: string) {
    const domainDef = liveSchemas.domains[domainName];
    if (!domainDef) return;
    try {
      const req = domainToBackendRequest({
        registry: liveSchemas._layers?.validationRegistry ?? {},
        domainName, fields: domainDef.fields as any, uiHints: liveSchemas.uiHints as any,
        rbacRules: extra.rbacRules as any, abacRules: extra.abacRules as any,
      });
      const res = await apiCreateDomain(req);
      if (res.status === "success") {
        const action  = res.table_created ? "created" : "already existed";
        const loc     = dbLocation(res);
        const nFields = res.total_fields ?? Object.keys(domainDef.fields).length;
        setBackendLoadStatus(`✅ Table "${domainName}" ${action} in ${loc} — ${nFields} field(s).`);
      } else {
        setBackendLoadStatus(`❌ Backend error: ${res.message}`);
      }
      setTimeout(() => setBackendLoadStatus(null), 4000);
    } catch (err: any) {
      setBackendLoadStatus(`❌ Network error: ${err?.message ?? String(err)}`);
      setTimeout(() => setBackendLoadStatus(null), 5000);
    }
  }

  async function handleLoadFromBackend() {
    try {
      const res = await apiListSchemas();
      if (res.status !== "success" || !res.schemas?.length) {
        // The current filter/project scope has no domain models — clear
        // out anything left over from the previous scope so switching to
        // an empty project actually shows an empty list instead of
        // leaving the last-fetched project's domains on screen.
        if (lastBackendDomainNames.current.size > 0) {
          setExtra((prev) => ({
            ...prev,
            newDomains: prev.newDomains.filter((d) => !lastBackendDomainNames.current.has(d.name)),
          }));
        }
        lastBackendDomainNames.current = new Set();
        setBackendLoadStatus("ℹ️ No schemas found in backend.");
        setTimeout(() => setBackendLoadStatus(null), 3000);
        return;
      }
      let count = 0;
      const freshNames = new Set<string>();
      setExtra((prev) => {
        let next = { ...prev };

        // Drop anything that was backend-sourced under the *previous*
        // load (e.g. the previously-selected project filter) but isn't
        // present in this response — otherwise it just lingers in
        // newDomains forever, since the per-entry merge below only ever
        // adds/replaces by name and never removes. Domains the user
        // created locally and hasn't saved yet (never part of
        // lastBackendDomainNames) are left untouched.
        if (lastBackendDomainNames.current.size > 0) {
          next.newDomains = next.newDomains.filter(
            (d) => !lastBackendDomainNames.current.has(d.name),
          );
        }

        for (const entry of res.schemas as unknown as BackendSchemaEntry[]) {
          const converted = backendSchemaToFrontend(entry);
          count++;
          freshNames.add(converted.domainName);
          const domainDef: DomainDefinition = {
            name: converted.domainName,
            fields: Object.fromEntries(
              Object.entries(converted.fields).map(([k, v]) => [k, {
                type: v.type as FieldType,
                default: v.default,
                datasource: v.datasource,
                relationKind: (v as any).relationKind,
                // relatedDomain and cardinality were both missing from this
                // whitelist — every relation field's related domain and
                // every list field's cardinality silently reverted to
                // empty/"one" on every single load-from-backend, even
                // after backendSchemaToFrontend() (and the underlying
                // domainToBackendRequest write) were fixed to actually
                // carry them. This is the same class of bug that hit
                // relationKind/cardinality earlier in buildSchemas() —
                // just one more copy of the same whitelist, in a
                // different function.
                relatedDomain: (v as any).relatedDomain,
                cardinality: (v as any).cardinality,
                // Same gap, one more field: validationRefs (the tag
                // names, e.g. ["required-name"]) was never carried
                // through here either. Even with backendSchemaToFrontend
                // now reading it out of the raw backend response, this
                // whitelist would still have silently dropped it right
                // here on the way into domainDef.fields — the actual
                // enforceable rules were being saved (they run fine in a
                // live form), but the TAG IDENTITY was lost on every
                // reload, which is what the Domain Model tab's
                // "Validation Refs" column and the Export tab's
                // per-category Validations JSON both key off.
                validationRefs: (v as any).validationRefs,
              }])
            ),
          };
          const dbBackend = (entry as any).db_backend ?? "postgresql";
          const entryProjectId = (entry as any).project_id ?? null;
          next = {
            ...next,
            newDomains: [...next.newDomains.filter((d) => d.name !== converted.domainName), domainDef],
            uiHints:    { ...next.uiHints,   ...converted.uiHints   },
            rbacRules:  { ...next.rbacRules, ...converted.rbacRules },
            abacRules:  { ...next.abacRules, ...converted.abacRules },
            dbBackends: { ...next.dbBackends, [converted.domainName]: dbBackend },
            projectIds: entryProjectId
              ? { ...next.projectIds, [converted.domainName]: entryProjectId }
              : next.projectIds,
          };
        }
        return next;
      });
      lastBackendDomainNames.current = freshNames;
      // Re-merge display-only relation markers that the backend has no
      // record of (e.g. clinic.branch) — otherwise they'd vanish here since
      // this whole function just overwrote newDomains with backend truth.
      const savedMarkers = loadRelationMarkers();
      if (Object.keys(savedMarkers).length > 0) {
        setExtra((prev) => {
          const nextExtraFields = { ...prev.extraFields };
          for (const [domName, markerFields] of Object.entries(savedMarkers)) {
            // Only rehydrate markers for domains that actually exist —
            // avoids resurrecting stale markers for deleted/renamed domains.
            const domainKnown =
              prev.newDomains.some((d) => d.name === domName) ||
              Object.keys(nextExtraFields).includes(domName);
            if (!domainKnown) continue;
            nextExtraFields[domName] = { ...(nextExtraFields[domName] ?? {}), ...markerFields };
          }
          return { ...prev, extraFields: nextExtraFields };
        });
      }

      setBackendLoadStatus(`✅ Loaded ${count} schema(s) from backend.`);
      setTimeout(() => setBackendLoadStatus(null), 4000);
    } catch (err: any) {
      setBackendLoadStatus(`❌ Load failed: ${err?.message ?? String(err)}`);
      setTimeout(() => setBackendLoadStatus(null), 5000);
    }
  }

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    handleLoadFromBackend();
    handleLoadValidationRulesFromBackend();
  }, []);

  // Re-load the domain-model list whenever the selected project changes
  // (ProjectSelector.tsx) — skips the very first render, since the mount
  // effect above already loads with whatever project was selected on load.
  const skipInitialProjectReload = useRef(true);
  useEffect(() => {
    if (skipInitialProjectReload.current) {
      skipInitialProjectReload.current = false;
      return;
    }
    handleLoadFromBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  return (
    <div className="si-root">

      <ImportDomainModelModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onConfirm={handleImportDomainModelJson}
      />

      {backendLoadStatus && (
        <div className={`si-toast ${backendLoadStatus.startsWith("✅") ? "si-toast--ok" : backendLoadStatus.startsWith("ℹ️") ? "si-toast--info" : "si-toast--err"}`}>
          {backendLoadStatus}
        </div>
      )}

{tab === "domain" && (
        <DomainModelTab
          schemas={visibleSchemas}
          viewConfigs={extra.viewConfigs}
          dbBackends={extra.dbBackends}
          versioned={extra.versioned}
          projectIds={extra.projectIds}
         junctionDomains={new Set(
  Array.from(extra.junctionPairs).flatMap((pairKey) => {
    const parts = pairKey.split("__");
    const name1 = `${parts[0]}_${parts[1]}`;
    const name2 = `${parts[1]}_${parts[0]}`;
    return [name1, name2].filter((n) => n in visibleSchemas.domains);
  })
)}
          onAddField={handleAddFieldToExisting}
          onEditField={handleEditField}
          onViewConfig={handleViewConfig}
          onSaveBackend={handleSaveDomainToBackend}
          onQuickCreateDomain={handleQuickCreateDomain}
          onRichCreateDomain={handleRichCreateDomain}
          onRedirectToCreate={handleRedirectToCreate}
          onGoToCreateDomain={() => setTab("create")}
          onAddValidationRule={handleAddValidationRule}
        />
      )}
      {tab === "ui" && (
        <UIConfigTab schemas={liveSchemas} onAdd={handleAddUIHint} onRemove={handleRemoveUIHint} extraHints={extra.uiHints} />
      )}
      {tab === "validations" && <ValidationsTab schemas={liveSchemas} />}
      {tab === "access" && (
        <AccessTab
          schemas={liveSchemas}
          onAddRBAC={handleAddRBAC} onRemoveRBAC={handleRemoveRBAC}
          onAddABAC={handleAddABAC} onRemoveABAC={handleRemoveABAC}
          extraRBACKeys={new Set(Object.keys(extra.rbacRules))}
          extraABACKeys={new Set(Object.keys(extra.abacRules))}
        />
      )}
     {tab === "create" && (
  <CreateDomainTab
    onAdd={handleDomainCreated}
    registry={liveSchemas._layers?.validationRegistry ?? {}}
    domainNames={liveDomainNames}
    onQuickCreateDomain={handleQuickCreateDomain}
    onRichCreateDomain={handleRichCreateDomain}
    schemas={liveSchemas}
    initialDomainName={pendingDomainName || undefined}
    onRedirectToCreate={handleRedirectToCreate}
    pendingFK={pendingFK}
    onAddValidationRule={handleAddValidationRule}
    onGoToValidations={() => setTab("validations")}
  />
)}
      {tab === "data" && <DataTab schemas={liveSchemas} dbBackends={extra.dbBackends} />}
      {tab === "translations" && <TranslationsTab schemas={liveSchemas} onSave={handleSaveTranslation} />}
      {tab === "export" && <ExportJsonTab schemas={liveSchemas} />}

  
    </div>
  );
});