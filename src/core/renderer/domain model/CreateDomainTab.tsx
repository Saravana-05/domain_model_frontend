import React, { useState, useMemo, useEffect } from "react";
import AddCircleOutlinedIcon   from "@mui/icons-material/AddCircleOutlined";
import StorageIcon             from "@mui/icons-material/Storage";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import CheckIcon               from "@mui/icons-material/Check";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CodeIcon                from "@mui/icons-material/Code";
import ExpandMoreIcon          from "@mui/icons-material/ExpandMore";
import ExpandLessIcon          from "@mui/icons-material/ExpandLess";
import LabelIcon               from "@mui/icons-material/Label";
import LinkOutlinedIcon        from "@mui/icons-material/LinkOutlined";
import DeleteOutlinedIcon      from "@mui/icons-material/DeleteOutlined";
import SaveOutlinedIcon        from "@mui/icons-material/SaveOutlined";
import EditOutlinedIcon        from "@mui/icons-material/EditOutlined";
import type {
  AllSchemas, DomainDefinition, DomainFieldCore, FieldUIConfig,
  RBACFieldRule, ABACFieldRule, NamedValidationRule, FieldType,
} from "../../schema/types";
import {
  domainToBackendRequest, apiCreateDomain,
  apiSaveDraft, apiListDrafts, apiSubmitDraft, apiDeleteDraft,
  type BackendCreateResponse, type BackendCreateRequest, type BackendDraft,
} from "../../api/datastoreApi";
import { useProjectStore } from "../../store/projectStore";
import { dbLocation, Badge, CopyBlock, primaryLabel, toPascalCase, toCamelCase } from "./helpers";
import { genDomainFile } from "./codeGenerators";
import { FieldBuilder } from "./FieldBuilder";
import type { FieldDraft } from "./fieldDraftTypes";
import type { QuickCreateField } from "./DomainPickers";
import { draftToDomainFieldCore, draftToUIHint, draftToRBACRule, draftToABACRule } from "./draftConverters";

export interface CreateDomainTabProps {
  onAdd:      (payload: CreateDomainPayload) => void;
  registry?:  Record<string, NamedValidationRule>;
  domainNames?: string[];
  onQuickCreateDomain?: (name: string, fields: QuickCreateField[]) => void;
  /** Fires when a domain is created via the "rich" flow (LinkDomainModal's
   *  embedded compact FieldBuilder) — full FieldDraft objects per field,
   *  as opposed to onQuickCreateDomain's flattened {name,type}[] shape.
   *  Matches SchemaInspector's handleRichCreateDomain signature. Not
   *  currently invoked from within this tab itself, but accepted here so
   *  SchemaInspector can pass the same handler uniformly to every tab
   *  that touches domain creation. */
  onRichCreateDomain?: (
    name: string,
    fieldDrafts: Record<string, FieldDraft>,
    isPartOf: boolean,
    parentDomainName?: string,
  ) => void;
  schemas?: AllSchemas;
  initialDomainName?: string;
  onRedirectToCreate?: (domainName: string) => void;
  pendingFK?: { parentDomain: string; childDomain: string; fkFieldName: string } | null;
  onAddValidationRule?: (tag: string, rule: NamedValidationRule) => void;
  /** Lets the "create new registry rule" flow (or any other in-tab
   *  affordance) jump the user straight to the Validations tab. */
  onGoToValidations?: () => void;
}
export interface CreateDomainPayload {
  domain:    DomainDefinition;
  uiHints:   Record<string, FieldUIConfig>;
  rbacRules: Record<string, RBACFieldRule>;
  abacRules: Record<string, ABACFieldRule>;
  dbBackend: "postgresql" | "dynamodb";
  versioned: boolean;
  junctionDomains?: DomainDefinition[];
  relatedDomains?:  DomainDefinition[];
  fieldLabels?: Record<string, Record<"en" | "ta" | "ar", string>>;
}

/** Snapshot of everything CreateDomainTab's local form state needs to
 *  fully restore an in-progress (not-yet-created) domain build. Used by
 *  the pause/resume "domain stack" below. */
interface DomainDraft {
  fields:         Record<string, FieldDraft>;
  dbBackend:      "postgresql" | "dynamodb";
  versioned:      boolean;
  expandedFields: Record<string, boolean>;
}

export function CreateDomainTab({ onAdd, registry = {}, domainNames = [], onQuickCreateDomain, schemas, initialDomainName, onRedirectToCreate, pendingFK, onAddValidationRule }: CreateDomainTabProps) {
  const [domainName, setDomainName] = useState(initialDomainName || "");

  useEffect(() => {
    if (initialDomainName) {
      setDomainName(initialDomainName);
    }
  }, [initialDomainName]);
  const [dbBackend,  setDbBackend]  = useState<"postgresql" | "dynamodb">("postgresql");
  const [fields,     setFields]     = useState<Record<string, FieldDraft>>({});
  const [generated,  setGenerated]  = useState(false);
  const [versioned, setVersioned] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({});

  // ── Project scoping — which Project this domain (and any related /
  //    junction domains created alongside it) is created under. Defaults
  //    to whatever's globally selected in ProjectSelector, but can be
  //    overridden per-creation right here without disturbing the global
  //    selection elsewhere in the app. ─────────────────────────────────
  const projects            = useProjectStore((s) => s.projects);
  const projectsLoading     = useProjectStore((s) => s.loading);
  const globalProjectId     = useProjectStore((s) => s.currentProjectId);
  const fetchProjects       = useProjectStore((s) => s.fetchProjects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(globalProjectId);

  useEffect(() => {
    if (projects.length === 0) fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Domain stack — "pause current domain, switch to building a related
  //    one, come back later" ────────────────────────────────────────────
  // `drafts` holds paused domains keyed by name; `draftOrder` is the
  // resume order (most recently paused last). Nothing here touches the
  // backend — a paused domain hasn't been created yet, it's just parked
  // in memory so its half-built fields aren't lost while you go build
  // something it depends on.
  const [drafts,     setDrafts]     = useState<Record<string, DomainDraft>>({});
  const [draftOrder, setDraftOrder] = useState<string[]>([]);

  // ── Persisted drafts — saved in the database, no tables generated ──
  // Unlike the in-memory stack above, these survive a reload. A draft
  // holds the complete domain model definition but deliberately creates
  // nothing: submitting it (submitDraft below) is what generates the
  // domain model tables. `activeDraftId` is the draft currently open in
  // this form, if any, so re-saving updates it instead of forking a copy.
  const [savedDrafts,   setSavedDrafts]   = useState<BackendDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  type Status = { state: "idle" | "loading" | "ok" | "err"; msg: string };
  const [status, setStatus] = useState<Status>({ state: "idle", msg: "" });

  // No case restriction while typing — type it however you like. It's
  // reformatted to PascalCase at the point it's actually stored (see
  // buildPayloadFor / genDomainFile below). This just guards against an
  // empty name or stray punctuation that wouldn't survive that reformat.
  const validName = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(domainName.trim());
  const hasFields = Object.keys(fields).length > 0;
  const canCreate = validName && hasFields && status.state !== "loading";

  // Compute which junction domains will be created (from relation fields)
  const pendingJunctions: Array<{ parent: string; related: string; junctionName: string }> = useMemo(() => {
    if (!validName) return [];
    return Object.entries(fields)
      .filter(([, d]) => d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:"))
      .map(([, d]) => {
        const related = d.relatedDomain;
        return { parent: domainName, related, junctionName: `${domainName}_${related}` };
      });
  }, [fields, domainName, validName]);

  // NOTE: there used to be a useEffect here that force-upgraded any
  // relation field to isPartOf:"fk" once its target domain existed. That
  // silently overwrote an explicit "Referenced by" choice the moment the
  // target got created — which is exactly the bug reported. Direction
  // ("References" / "Referenced by" / "Many-to-many") is now resolved
  // entirely inside buildPayloadFor at the moment a domain is actually
  // created, by checking `schemas` (plus, for Create All, a running
  // knownFields map — see below) — so nothing needs to reach in and
  // mutate `fields` behind the user's back anymore.

  function handleAddField(rawName: string, draft: FieldDraft) {
    // Attribute names are stored camelCase regardless of how they were
    // typed in FieldBuilder — no restriction on the UI side.
    const name = toCamelCase(rawName);
    setFields((p) => ({ ...p, [name]: draft }));
    if (draft.type === "relation" && draft.relatedDomain) {
      setExpandedFields((prev) => ({ ...prev, [name]: true }));
    }
    setStatus({ state: "idle", msg: "" });
    setGenerated(false);
  }
  function removeField(name: string) {
    setFields((p) => { const n = { ...p }; delete n[name]; return n; });
    setStatus({ state: "idle", msg: "" });
    setGenerated(false);
  }

  /**
   * "Create {domain} domain" was clicked from inside FieldBuilder, while
   * building `fieldName` on the CURRENT domain (e.g. adding "designation"
   * to "grade"). This:
   *  1. Commits that in-progress field onto the current domain's field
   *     list (so it isn't lost).
   *  2. Parks the current domain (with that field included) as a
   *     resumable draft.
   *  3. Swaps Step 1 + Step 2 over to building the related domain instead
   *     — restoring its own paused draft if one already exists (e.g. you
   *     switched away from it once before).
   */
  function handleCreateRelatedDomain(rawFieldName: string, draft: FieldDraft) {
    const relatedDomainName = draft.relatedDomain ? toPascalCase(draft.relatedDomain) : draft.relatedDomain;
    if (!relatedDomainName || !validName) return;

    const fieldName = toCamelCase(rawFieldName);
    const fieldsWithCommitted = { ...fields, [fieldName]: { ...draft, relatedDomain: relatedDomainName } };

    setDrafts((prev) => ({
      ...prev,
      [domainName]: { fields: fieldsWithCommitted, dbBackend, versioned, expandedFields },
    }));
    setDraftOrder((prev) => [...prev.filter((n) => n !== domainName), domainName]);

    const existing = drafts[relatedDomainName];
    setDomainName(relatedDomainName);
    setFields(existing ? existing.fields : {});
    setDbBackend(existing?.dbBackend ?? "postgresql");
    setVersioned(existing?.versioned ?? false);
    setExpandedFields(existing?.expandedFields ?? {});
    setGenerated(false);
    setStatus({ state: "idle", msg: "" });
  }

  /** Clicking a paused-domain chip — saves whatever's currently in
   *  progress (so switching back and forth never loses anything) and
   *  restores the chosen draft. */
  function handleResumeDraft(name: string) {
    const target = drafts[name];
    if (!target) return;

    setDrafts((prev) => {
      const next = { ...prev };
      delete next[name];
      next[domainName] = { fields, dbBackend, versioned, expandedFields };
      return next;
    });
    setDraftOrder((prev) => [...prev.filter((n) => n !== name), domainName]);

    setDomainName(name);
    setFields(target.fields);
    setDbBackend(target.dbBackend);
    setVersioned(target.versioned);
    setExpandedFields(target.expandedFields);
    setGenerated(false);
    setStatus({ state: "idle", msg: "" });
  }

  function buildPayload(): CreateDomainPayload {
    return buildPayloadFor(domainName, fields, dbBackend, versioned);
  }

  /**
   * Same logic as buildPayload but parameterized — lets Create All build
   * a payload for each paused domain in the stack, not just the
   * currently active one.
   *
   * `externalKnownFields` supplements the live `schemas` prop with fields
   * we already know exist for a domain but that `schemas` doesn't reflect
   * yet — specifically, domains created moments earlier in the SAME
   * Create All batch (the `schemas` prop only updates on the next React
   * render, which doesn't happen mid-loop). Single "Create Domain" clicks
   * just pass {} and rely on `schemas` alone.
   *
   * Three relation shapes, chosen per-field via FieldDraft.isPartOf /
   * relationKind (see FieldBuilder's "References / Referenced by /
   * Many-to-many" selector):
   *  - References (isPartOf === "fk"): THIS domain gets a real column,
   *    using the field name exactly as typed — never renamed.
   *  - Referenced by (relationKind === "integral", isPartOf !== "fk"):
   *    the RELATED domain gets a real `${name}Id` column pointing back
   *    at this one. Merged into whatever fields that domain already has
   *    (from `schemas` + `externalKnownFields`) so an existing domain's
   *    other attributes are never wiped out. THIS domain gets no real
   *    column — just a display-only marker under the typed field name,
   *    excluded from the backend payload (see isMarkerOnly below).
   *  - Many-to-many (relationKind === "association"): junction table;
   *    neither domain gets a direct column. Also gets a marker on THIS
   *    domain for display.
   */
  function buildPayloadFor(
    rawName: string,
    fieldsArg: Record<string, FieldDraft>,
    dbBackendArg: "postgresql" | "dynamodb",
    versionedArg: boolean,
    externalKnownFields: Record<string, Record<string, DomainFieldCore>> = {},
  ): CreateDomainPayload {
    // Domain model names are stored PascalCase, however they were typed.
    const name = toPascalCase(rawName);
    const domainFields: Record<string, DomainFieldCore> = {};
    const uiHints: Record<string, FieldUIConfig>        = {};
    const rbacRules: Record<string, RBACFieldRule>      = {};
    const abacRules: Record<string, ABACFieldRule>      = {};
    const junctionDomains: DomainDefinition[] = [];
    const relatedDomains:  DomainDefinition[] = [];

    function upsertRelatedDomain(targetName: string, extraFields: Record<string, DomainFieldCore>) {
      const existingKnownFields = {
        ...(schemas?.domains?.[targetName]?.fields ?? {}),
        ...(externalKnownFields[targetName] ?? {}),
      };
      const idx = relatedDomains.findIndex((r) => r.name === targetName);
      const mergedFields = { ...existingKnownFields, ...extraFields };
      if (idx >= 0) {
        relatedDomains[idx] = { ...relatedDomains[idx], fields: { ...relatedDomains[idx].fields, ...mergedFields } };
      } else {
        relatedDomains.push({ name: targetName, fields: mergedFields });
      }
    }

    for (const [n, d] of Object.entries(fieldsArg)) {
      if (d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:")) {
        // ── References ── THIS domain gets a real column, named exactly
        // as typed. Doesn't require the target to already exist — if it
        // doesn't, a minimal stub table is auto-created so nothing
        // dangles (you can still give it real attributes later via the
        // "Create {domain} domain" button or the Domain Model tab).
        if (d.isPartOf === "fk") {
          domainFields[n] = { type: "relation", relatedDomain: d.relatedDomain, relationKind: d.relationKind };
          const fp = `${name}.${n}`;
          const hint = draftToUIHint(d);
          uiHints[fp] = Object.keys(hint).length ? hint : { label: primaryLabel(d.labels, n) };
          const rbac = draftToRBACRule(d); if (rbac) rbacRules[fp] = rbac;
          const abac = draftToABACRule(d); if (abac) abacRules[fp] = abac;

          const targetKnown = !!schemas?.domains?.[d.relatedDomain] || !!externalKnownFields[d.relatedDomain];
          if (!targetKnown && !relatedDomains.find((r) => r.name === d.relatedDomain)) {
            relatedDomains.push({ name: d.relatedDomain, fields: {} });
          }
          continue;
        }

        // ── Referenced by ── the RELATED domain gets `${name}Id`,
        // merged safely into its existing fields. THIS domain gets a
        // display-only marker (typed name preserved), not a real column.
        if (d.relationKind === "integral") {
          const parentIdField = `${name}Id`;
          upsertRelatedDomain(d.relatedDomain, { [parentIdField]: { type: "string", relationKind: "integral" } });

          domainFields[n] = { type: "relation", relatedDomain: d.relatedDomain, relationKind: "integral", isMarkerOnly: true } as any;
          const fp = `${name}.${n}`;
          uiHints[fp] = { label: primaryLabel(d.labels, n) };
          continue;
        }

        // ── Many-to-many ── purely creates the junction table. Nothing
        // gets added to THIS domain's own field list — no marker, no
        // column — the junction table itself is the complete record of
        // the relationship, same as the original (pre-marker) behavior.
        const junctionName = `${name}_${d.relatedDomain}`;
        if (!junctionDomains.find((j) => j.name === junctionName)) {
          junctionDomains.push({
            name: junctionName,
            fields: {
              [`${name}Id`]:            { type: "string" },
              [`${d.relatedDomain}Id`]: { type: "string" },
            },
          });
        }
        const targetKnown = !!schemas?.domains?.[d.relatedDomain] || !!externalKnownFields[d.relatedDomain];
        if (!targetKnown && !relatedDomains.find((r) => r.name === d.relatedDomain)) {
          relatedDomains.push({ name: d.relatedDomain, fields: {} });
        }
        continue;
      }

      // Plain attribute (non-relation)
      domainFields[n] = draftToDomainFieldCore(d);
      const fp = `${name}.${n}`;

      const hint = draftToUIHint(d);
      uiHints[fp] = Object.keys(hint).length ? hint : { label: primaryLabel(d.labels, n) };

      const rbac = draftToRBACRule(d);
      if (rbac) rbacRules[fp] = rbac;

      const abac = draftToABACRule(d);
      if (abac) abacRules[fp] = abac;
    }
    if (versionedArg) {
      domainFields["isActive"]  = { type: "boolean", default: "true" };
      domainFields["fromDate"]  = { type: "date" };
      domainFields["toDate"]    = { type: "date" };
      domainFields["versionOf"] = { type: "string" };
      uiHints[`${name}.isActive`]  = { label: "Active Version" };
      uiHints[`${name}.fromDate`]  = { label: "Valid From" };
      uiHints[`${name}.toDate`]    = { label: "Valid To" };
      uiHints[`${name}.versionOf`] = { label: "Version Of", hidden: true };
    }

    if (pendingFK && pendingFK.childDomain === name) {
      domainFields[pendingFK.fkFieldName] = { type: "string", relationKind: "integral" };
      const fp = `${name}.${pendingFK.fkFieldName}`;
      uiHints[fp] = { label: pendingFK.fkFieldName };
    }

    const fieldLabels: Record<string, Record<"en" | "ta" | "ar", string>> = {};
    for (const [n, d] of Object.entries(fieldsArg)) fieldLabels[n] = d.labels;

    return { domain: { name, fields: domainFields }, uiHints, rbacRules, abacRules, dbBackend: dbBackendArg, versioned: versionedArg, junctionDomains, relatedDomains, fieldLabels };
  }

  /**
   * Every backend create-request one domain's payload implies — main
   * table, any auto-created/merged related domains, any junction tables
   * — built but NOT sent.
   *
   * Split out from createDomainFromPayload below so the exact same
   * requests can either be executed immediately ("Create Domain") or
   * stored untouched on a draft ("Save as Draft") and replayed later by
   * the backend on submit. Both paths therefore produce byte-identical
   * tables; a draft isn't a second, parallel way of describing a domain
   * model, it's the same description held back until submit.
   *
   * Each entry carries a `label` used only for the status messages —
   * the rest is the wire request itself.
   */
  function buildBackendRequests(
    payload: CreateDomainPayload,
  ): Array<{ label: string; req: BackendCreateRequest }> {
    const out: Array<{ label: string; req: BackendCreateRequest }> = [];

    // Only fields that are genuinely real columns on THIS domain go to
    // the backend — display-only markers (isMarkerOnly, from the
    // "Referenced by" / "Many-to-many" shapes) are dropped here. This
    // check is now based on the explicit flag set in buildPayloadFor,
    // not on guessing from the field's name, so a "References" column
    // keeps whatever name you actually typed.
    const backendFields: Record<string, DomainFieldCore> = Object.fromEntries(
      Object.entries(payload.domain.fields)
        .filter(([, f]) => !(f.type === "relation" && (f as any).isMarkerOnly))
        .map(([k, f]) => [
          k, f.type === "relation" ? { ...f, type: "string" as FieldType } : f,
        ])
    );
    const req = domainToBackendRequest({
      domainName: payload.domain.name,
      fields:     backendFields as any,
      uiHints:    payload.uiHints    as any,
      rbacRules:  payload.rbacRules  as any,
      abacRules:  payload.abacRules  as any,
      db_backend: payload.dbBackend,
      versioned:  payload.versioned,
      registry,
    } as any);
    req.project_id = selectedProjectId;
    out.push({ label: "Main table", req });

    for (const rd of payload.relatedDomains ?? []) {
      const rdReq = domainToBackendRequest({
        domainName: rd.name,
        fields:     rd.fields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: payload.dbBackend,
        registry,
      });
      rdReq.project_id = selectedProjectId;
      out.push({
        label: `Related domain "${rd.name}" (${Object.keys(rd.fields).length} field(s))`,
        req:   rdReq,
      });
    }

    for (const jd of payload.junctionDomains ?? []) {
      const jReq = domainToBackendRequest({
        domainName: jd.name,
        fields:     jd.fields as any,
        uiHints:    {},
        rbacRules:  {},
        abacRules:  {},
        db_backend: payload.dbBackend,
        registry,
      });
      jReq.project_id = selectedProjectId;
      out.push({ label: `Junction table "${jd.name}"`, req: jReq });
    }

    return out;
  }

  /** The actual backend calls for one domain's payload — main table, any
   *  auto-created/merged related domains, any junction tables. Extracted
   *  so both the single "Create Domain" button and "Create All" can
   *  share it. */
  async function createDomainFromPayload(payload: CreateDomainPayload): Promise<string[]> {
    const messages: string[] = [];

    for (const { label, req } of buildBackendRequests(payload)) {
      try {
        const res = await apiCreateDomain(req);
        if (res.status === "success") {
          const action = res.table_created ? "created" : "already existed";
          messages.push(
            label === "Main table"
              ? `✅ "${res.table_name}" ${action} in ${dbLocation(res)}`
              : `✅ ${label} ${action}`,
          );
        } else {
          messages.push(`❌ ${label} error: ${res.message}`);
        }
      } catch (err: any) {
        messages.push(`⚠️ ${label} backend unreachable: ${err?.message ?? String(err)}`);
      }
    }

    return messages;
  }

  async function createDomain() {
    if (!canCreate) return;
    setStatus({ state: "loading", msg: "Creating tables in database..." });

    const payload = buildPayload();
    const messages = await createDomainFromPayload(payload);

    onAdd(payload);
    const hasErr = messages.some((m) => m.startsWith("❌") || m.startsWith("⚠️"));
    setStatus({
      state: hasErr ? "err" : "ok",
      msg: messages.join(" · "),
    });

    if (!hasErr) {
      // This domain was open from a saved draft and has now genuinely
      // been created — the draft has served its purpose, so clear it
      // rather than leaving a stale "not yet created" entry pointing at
      // tables that now exist.
      if (activeDraftId) {
        const open = savedDrafts.find((d) => d.id === activeDraftId);
        if (open) await discardDraft(open);
        setActiveDraftId(null);
      }

      if (draftOrder.length > 0) {
        const parentName  = draftOrder[draftOrder.length - 1];
        const parentDraft = drafts[parentName];
        setDraftOrder((prev) => prev.slice(0, -1));
        setDrafts((prev) => { const n = { ...prev }; delete n[parentName]; return n; });
        if (parentDraft) {
          setDomainName(parentName);
          setFields(parentDraft.fields);
          setDbBackend(parentDraft.dbBackend);
          setVersioned(parentDraft.versioned);
          setExpandedFields(parentDraft.expandedFields);
          setGenerated(false);
        }
      } else {
        setDomainName("");
        setFields({});
        setGenerated(false);
        setVersioned(false);
        setExpandedFields({});
      }
    }
  }

  /**
   * Creates the whole paused chain in one action — the current domain
   * first, then each paused parent in turn. Maintains a running
   * `knownFieldsMap` of what's actually been sent for each domain so far
   * in THIS batch (since the `schemas` prop won't reflect a domain
   * created moments ago mid-loop), so a "Referenced by" merge later in
   * the chain correctly builds on top of what an earlier step in the
   * same batch just created instead of overwriting it. Stops at the
   * first domain that errors; whatever's left unbuilt stays available to
   * fix and retry.
   */
  async function createAllDomains() {
    if (!canCreate) return;

    const chain: Array<{ name: string; fields: Record<string, FieldDraft>; dbBackend: "postgresql" | "dynamodb"; versioned: boolean }> = [
      { name: toPascalCase(domainName), fields, dbBackend, versioned },
      ...draftOrder.slice().reverse().map((n) => {
        const d = drafts[n]!;
        return { name: toPascalCase(n), fields: d.fields, dbBackend: d.dbBackend, versioned: d.versioned };
      }),
    ];

    setStatus({ state: "loading", msg: `Creating ${chain.length} domain(s): ${chain.map((c) => c.name).join(" → ")}...` });

    const knownFieldsMap: Record<string, Record<string, DomainFieldCore>> = {};
    const allMessages: string[] = [];
    let anyErr = false;

    for (const unit of chain) {
      const payload = buildPayloadFor(unit.name, unit.fields, unit.dbBackend, unit.versioned, knownFieldsMap);
      const messages = await createDomainFromPayload(payload);
      allMessages.push(`${unit.name}: ${messages.join(" · ")}`);
      onAdd(payload);

      // Record what this unit's own table ended up with, plus anything
      // it merged into OTHER (related) domains, so later units in the
      // same batch see accurate state.
      knownFieldsMap[unit.name] = { ...(knownFieldsMap[unit.name] ?? {}), ...payload.domain.fields };
      for (const rd of payload.relatedDomains ?? []) {
        knownFieldsMap[rd.name] = { ...(knownFieldsMap[rd.name] ?? {}), ...rd.fields };
      }

      const errored = messages.some((m) => m.startsWith("❌") || m.startsWith("⚠️"));
      if (errored) {
        anyErr = true;
        break;
      }
    }

    setStatus({ state: anyErr ? "err" : "ok", msg: allMessages.join("  |  ") });

    if (!anyErr) {
      setDrafts({});
      setDraftOrder([]);
      setDomainName("");
      setFields({});
      setGenerated(false);
      setVersioned(false);
      setExpandedFields({});
    }
  }


  // ── Saved drafts (persisted) ────────────────────────────────────────
  // Distinct from the in-memory `drafts` stack above: those are domains
  // paused mid-build for this session only. These live in the database
  // (domain_model_drafts) and survive reloads, but — crucially — saving
  // one creates NO tables. The domain model becomes real tables only
  // when the draft is submitted, which is the one call that runs the
  // stored create-requests.

  async function refreshSavedDrafts() {
    try {
      const res = await apiListDrafts(selectedProjectId, "draft");
      setSavedDrafts(res.drafts ?? []);
    } catch {
      // A drafts-list failure must never block building a domain —
      // leave the list as-is and stay silent.
    }
  }

  useEffect(() => {
    refreshSavedDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  /** Save what's currently in the form as a draft. Persists the field
   *  map (so it reopens exactly as left), the full CreateDomainPayload
   *  (replayed locally after submit so UI hints / RBAC / ABAC / labels
   *  land as they would have), and the create-requests themselves. */
  async function saveDraft() {
    if (!validName || !hasFields) return;
    setStatus({ state: "loading", msg: "Saving draft..." });

    const payload = buildPayload();
    const tables  = buildBackendRequests(payload).map(({ req }) => req);

    try {
      const res = await apiSaveDraft({
        domain_name: payload.domain.name,
        project_id:  selectedProjectId,
        tables,
        fields,
        payload:     payload as any,
        db_backend:  dbBackend,
        versioned,
      });
      setActiveDraftId(res.draft_id ?? null);
      await refreshSavedDrafts();
      setStatus({
        state: "ok",
        msg: `💾 Draft "${payload.domain.name}" saved — ${tables.length} table(s) will be created when you submit it. Nothing has been created yet.`,
      });
    } catch (err: any) {
      setStatus({ state: "err", msg: `❌ Could not save draft: ${err?.message ?? String(err)}` });
    }
  }

  /** Reopen a saved draft in the form. Purely local — touches nothing
   *  in the backend, so an accidental click can't create anything. */
  function openDraft(draft: BackendDraft) {
    const p = draft.payload ?? ({} as any);
    setDomainName(draft.domain_name);
    setFields((p.fields ?? {}) as Record<string, FieldDraft>);
    setDbBackend((p.db_backend as "postgresql" | "dynamodb") ?? "postgresql");
    setVersioned(!!p.versioned);
    setExpandedFields({});
    setSelectedProjectId(draft.project_id ?? null);
    setActiveDraftId(draft.id);
    setGenerated(false);
    setStatus({ state: "idle", msg: `Editing draft "${draft.domain_name}" — not yet submitted.` });
  }

  /** Submit a draft — the only path that turns it into real tables.
   *  The backend creates them from the stored requests; onAdd then
   *  replays the stored payload into the local layers so the rest of
   *  the app sees the new domain exactly as it would have after a
   *  direct "Create Domain". */
  async function submitDraft(draft: BackendDraft) {
    setStatus({ state: "loading", msg: `Submitting "${draft.domain_name}" — creating tables...` });
    try {
      const res = await apiSubmitDraft(draft.id);
      const results = res.results ?? [];
      const made = results.map((r) =>
        r.status === "success"
          ? `✅ "${r.table_name}" ${r.created ? "created" : "already existed"}`
          : `❌ "${r.table_name}": ${r.message}`
      );

      const storedPayload = (draft.payload as any)?.payload as CreateDomainPayload | undefined;
      if (storedPayload) onAdd(storedPayload);

      await refreshSavedDrafts();
      if (activeDraftId === draft.id) {
        setActiveDraftId(null);
        setDomainName("");
        setFields({});
        setVersioned(false);
        setExpandedFields({});
        setGenerated(false);
      }
      setStatus({ state: "ok", msg: made.join(" · ") });
    } catch (err: any) {
      setStatus({ state: "err", msg: `❌ Submit failed: ${err?.message ?? String(err)}` });
    }
  }

  async function discardDraft(draft: BackendDraft) {
    try {
      await apiDeleteDraft(draft.id);
      if (activeDraftId === draft.id) setActiveDraftId(null);
      await refreshSavedDrafts();
    } catch (err: any) {
      setStatus({ state: "err", msg: `❌ Could not discard draft: ${err?.message ?? String(err)}` });
    }
  }

  const codeGenFields: Record<string, DomainFieldCore> = {};
  for (const [n, d] of Object.entries(fields)) { codeGenFields[n] = draftToDomainFieldCore(d); }

  return (
    <div className="si-add-panel">
      <div className="si-card-header">
        <AddCircleOutlinedIcon sx={{ fontSize: 18, color: "#6366f1" }} />
        <span className="si-domain-name">Create new domain</span>
        <span className="si-field-count">Defines the Domain Model (Layer 1) and creates a table in the configured database</span>
      </div>

      <div className="si-add-form">
        {/* Saved drafts — persisted in the database, but not yet real.
            None of these has a table behind it: the schema is stored,
            the DDL is not run until "Submit". Editing one reopens it
            here; submitting is the single action that creates tables. */}
        {savedDrafts.length > 0 && (
          <div className="si-step">
            <div className="si-step-label">
              Saved drafts — stored in the database, no tables created yet
            </div>
            <table className="si-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Tables on submit</th>
                  <th>Last saved</th>
                  <th style={{ width: 260 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedDrafts.map((d) => {
                  const tables = (d.payload as any)?.tables ?? [];
                  return (
                    <tr key={d.id}>
                      <td className="si-field-name">
                        {d.domain_name}
                        <span style={{
                          fontSize: 10, background: "#fef3c7", color: "#92400e",
                          borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 600,
                        }}>DRAFT</span>
                      </td>
                      <td style={{ fontSize: 12, color: "#6b7280" }}>
                        {tables.map((t: any) => t.table_name).join(", ") || "—"}
                      </td>
                      <td style={{ fontSize: 11, color: "#6b7280" }}>
                        {d.updated_at ? new Date(d.updated_at).toLocaleString() : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            style={{ fontSize: 12 }}
                            onClick={() => openDraft(d)}
                            title="Reopen this draft in the form — nothing is created"
                          >
                            <EditOutlinedIcon sx={{ fontSize: 14 }} />Edit
                          </button>
                          <button
                            className="btn btn-create-domain"
                            type="button"
                            style={{ fontSize: 12 }}
                            onClick={() => submitDraft(d)}
                            disabled={status.state === "loading" || tables.length === 0}
                            title={`Submit — creates ${tables.length} table(s) in the database`}
                          >
                            <CloudUploadOutlinedIcon sx={{ fontSize: 14 }} />Submit
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            style={{ fontSize: 12 }}
                            onClick={() => discardDraft(d)}
                            title="Discard this draft"
                          >
                            <DeleteOutlinedIcon sx={{ fontSize: 14 }} />Discard
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paused domains — click to jump back and keep adding to it.
            Nothing here is created in the backend until its own
            "Create Domain" is clicked; this is purely local, in-progress
            state being parked. */}
        {draftOrder.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Paused — building <strong>{domainName}</strong> for:</span>
            {draftOrder.map((name) => (
              <button
                key={name}
                type="button"
                className="btn btn-secondary"
                onClick={() => handleResumeDraft(name)}
                style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
                title={`Resume building "${name}"`}
              >
                <AddCircleOutlinedIcon sx={{ fontSize: 14 }} />
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Project scope */}
        <div className="si-step">
          <div className="si-step-label">Project</div>
          <div className="si-form-row si-form-row--inline">
            <label className="si-form-label" style={{ maxWidth: 320 }}>
              Which project is this domain under?
              <select
                className="si-form-select"
                value={selectedProjectId ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
              >
                <option value="">— No project (global) —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {projectsLoading && <span className="si-hint">Loading projects…</span>}
          </div>
        </div>

        {/* Step 1 */}
        <div className="si-step">
          <div className="si-step-label">Step 1 — Domain name &amp; storage</div>
          <div className="si-form-row">
            <label className="si-form-label" style={{ maxWidth: 280 }}>
              {/* Type it however you like — saved as <code>{domainName.trim() ? toPascalCase(domainName) : "PascalCase"}</code> */}
              <input
                className={`si-form-input ${domainName && !validName ? "si-form-input--error" : ""}`}
                value={domainName}
                onChange={(e) => { setDomainName(e.target.value); setStatus({ state: "idle", msg: "" }); setGenerated(false); }}
                onBlur={() => { if (domainName.trim()) setDomainName(toPascalCase(domainName)); }}
                placeholder="product" />
            </label>
            {domainName && !validName && <span className="si-inline-error">Name can only contain letters, numbers, spaces, - and _</span>}
          </div>
          <div className="si-form-sublabel" style={{ marginBottom: 8 }}>Select database backend</div>
          <div className="si-db-selector">
            <label className={`si-db-option ${dbBackend === "postgresql" ? "si-db-option--active" : ""}`}>
              <input type="radio" name="dbBackend" value="postgresql" checked={dbBackend === "postgresql"} onChange={() => setDbBackend("postgresql")} />
              <StorageIcon sx={{ fontSize: 18, color: dbBackend === "postgresql" ? "#0f766e" : "#6b7280" }} />
              <span className="si-db-option-text"><strong>PostgreSQL</strong><span className="si-hint">Relational, fast queries</span></span>
            </label>
            <label className={`si-db-option ${dbBackend === "dynamodb" ? "si-db-option--active" : ""}`}>
              <input type="radio" name="dbBackend" value="dynamodb" checked={dbBackend === "dynamodb"} onChange={() => setDbBackend("dynamodb")} />
              <StorageIcon sx={{ fontSize: 18, color: dbBackend === "dynamodb" ? "#c2410c" : "#6b7280" }} />
              <span className="si-db-option-text"><strong>DynamoDB</strong><span className="si-hint">AWS NoSQL, auto-scale</span></span>
            </label>
            <label className={`si-db-option ${versioned ? "si-db-option--active" : ""}`}>
              <input type="checkbox" checked={versioned} onChange={(e) => setVersioned(e.target.checked)} />
              <CheckCircleOutlinedIcon sx={{ fontSize: 18, color: versioned ? "#0f766e" : "#6b7280" }} />
              <span className="si-db-option-text">
                <strong>Enable Versioning</strong>
              </span>
            </label>
          </div>
        </div>

        {/* Step 2 */}
        <div className="si-step">
          <div className="si-step-label">Step 2 — Add fields</div>

          {hasFields && (
            <div className="si-field-list">
              <div className="si-form-sublabel">Fields added ({Object.keys(fields).length})</div>
              <div className="si-card">
                <table className="si-table">
                  <thead>
                    <tr><th>Field</th><th>Type</th><th>Related Domain</th><th>Default</th><th>Datasource</th><th>Computed</th><th>Val Refs</th><th></th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(fields).map(([name, d]) => {
                      const isRelation = d.type === "relation" && d.relatedDomain && !d.relatedDomain.startsWith("__new__:");
                      const parentIdField = `${domainName}Id`;
                      return (
                        <React.Fragment key={name}>
                          <tr>
                            <td className="si-field-name">
                             {isRelation && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedFields(prev => ({ ...prev, [name]: !prev[name] }))}
                                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px 0 0", color: "#6366f1", display: "inline-flex", alignItems: "center" }}
                                >
                                  {expandedFields[name]
                                    ? <ExpandLessIcon sx={{ fontSize: 14 }} />
                                    : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                                </button>
                              )}
                              {name}
                            </td>
                            <td>
                              {d.type === "relation" ? <Badge label="relation" color="indigo" />
                                : d.type === "list" ? <Badge label="list" color="green" />
                                : <Badge label={d.type} color="purple" />}
                            </td>
                            <td>
                              {d.relatedDomain ? (
                                <span className="si-relation-cell">
                                  <LinkOutlinedIcon sx={{ fontSize: 11 }} />
                                  <Badge label={d.relatedDomain.startsWith("__new__:") ? d.relatedDomain.split(":")[1] + " (pending)" : d.relatedDomain} color="indigo" />
                                  {draftOrder.includes(d.relatedDomain) && !domainNames.includes(d.relatedDomain) && (
                                    <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 4 }}>(paused — not created yet)</span>
                                  )}
                                </span>
                              ) : d.listDomain ? (
                                <span className="si-list-cell">
                                  <LinkOutlinedIcon sx={{ fontSize: 11 }} />
                                  <Badge label={d.listDomain} color="green" />
                                  <span className="si-list-many-tag">[ ] many</span>
                                </span>
                              ) : <span className="si-muted">—</span>}
                            </td>
                            <td>{d.default ? <code style={{ fontSize: 11 }}>{d.default}</code> : <span className="si-muted">—</span>}</td>
                            <td>{d.datasource ? <Badge label={d.datasource} color="blue" /> : <span className="si-muted">—</span>}</td>
                            <td>{d.computed ? <Badge label="yes" color="teal" /> : <span className="si-muted">—</span>}</td>
                            <td>{d.validationRefs.length > 0
                              ? <span className="si-val-list">{d.validationRefs.map((t) => <span key={t} className="si-val-ref"><LabelIcon sx={{ fontSize: 10 }} />{t}</span>)}</span>
                              : <span className="si-muted">—</span>}</td>
                            <td>
                              <button className="si-remove-btn" type="button" onClick={() => removeField(name)}>
                                <DeleteOutlinedIcon sx={{ fontSize: 14 }} />Remove
                              </button>
                            </td>
                          </tr>

                          {isRelation && expandedFields[name] && (() => {
                            const relatedExists = domainNames.includes(d.relatedDomain);
                            const fkFieldName = relatedExists ? `${d.relatedDomain}Id` : parentIdField;
                            return (
                            <tr>
                              <td colSpan={8} style={{ padding: "0 0 0 24px", background: "var(--color-background-secondary)" }}>
                                <div style={{
                                  margin: "8px 12px 8px 0",
                                  border: "1px solid #c7d2fe",
                                  borderRadius: "var(--border-radius-md)",
                                  overflow: "hidden",
                                  background: "var(--color-background-primary)",
                                }}>
                                  <div style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "8px 12px",
                                    background: "#eef2ff",
                                    borderBottom: "1px solid #c7d2fe",
                                  }}>
                                    <StorageIcon sx={{ fontSize: 14, color: "#4f46e5" }} />
                                    <span style={{ fontSize: 13, fontWeight: 600, color: "#3730a3" }}>
                                      {d.relatedDomain}
                                    </span>
                                    <span style={{
                                      fontSize: 11, background: "#e0e7ff", color: "#3730a3",
                                      borderRadius: 20, padding: "1px 8px", fontWeight: 500,
                                    }}>
                                      {relatedExists ? "existing domain" : "not created yet"}
                                    </span>
                                    <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>
                                      {relatedExists
                                        ? `no changes to "${d.relatedDomain}"`
                                        : draftOrder.includes(d.relatedDomain)
                                          ? "paused — resume it above to finish building it"
                                          : "will be created with FK column"}
                                    </span>
                                  </div>

                                  <table className="si-table" style={{ margin: 0 }}>
                                    <thead>
                                      <tr>
                                        <th>Field</th>
                                        <th>Type</th>
                                        <th>Note</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr style={{ background: "#f5f3ff" }}>
                                        <td className="si-field-name" style={{ color: "#4f46e5" }}>
                                          {fkFieldName}
                                          <span style={{
                                            fontSize: 10, background: "#e0e7ff", color: "#3730a3",
                                            borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 600,
                                          }}>FK</span>
                                        </td>
                                        <td><Badge label="string" color="purple" /></td>
                                        <td style={{ fontSize: 11, color: "#6366f1" }}>
                                          {relatedExists
                                            ? <>Added to <strong>{domainName}</strong> (this domain) → references <strong>{d.relatedDomain}</strong></>
                                            : <>Auto-added to <strong>{d.relatedDomain}</strong> → references <strong>{domainName}</strong></>}
                                        </td>
                                      </tr>
                                      {relatedExists && Object.entries(schemas?.domains?.[d.relatedDomain]?.fields ?? {}).map(([cf, cfd]) => (
                                        <tr key={cf}>
                                          <td className="si-field-name">{cf}</td>
                                          <td><Badge label={(cfd as any).type} color="purple" /></td>
                                          <td style={{ fontSize: 11, color: "#6b7280" }}>existing field</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                            );
                          })()}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* key={domainName} forces a full remount whenever the active
              domain being built changes (fresh switch, resume) — without
              it, FieldBuilder's own local field-name/type draft would
              linger from whatever was being typed for the previous
              domain. */}
          <FieldBuilder
            key={domainName}
            submitLabel="Add field" onSubmit={handleAddField} showAllLayers={false} showLabelOnly
            registry={registry} domainNames={domainNames} parentDomainName={domainName}
            onNewDomainFromRelation={onQuickCreateDomain}
            onCreateRelatedDomain={handleCreateRelatedDomain}
            onAddValidationRule={onAddValidationRule}
          />
        </div>
        {/* Step 3 */}
        <div className="si-step">
          <div className="si-form-actions si-form-actions--gap">
            <button className="btn btn-create-domain" type="button" onClick={createDomain} disabled={!canCreate}>
              {status.state === "loading"
                ? <><span className="si-spinner" />Creating tables...</>
                : status.state === "ok"
                  ? <><CheckIcon sx={{ fontSize: 16 }} />Domains Created</>
                  : <><CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />Create Domain</>}
            </button>
            {draftOrder.length > 0 && (
              <button
                className="btn btn-create-domain"
                type="button"
                onClick={createAllDomains}
                disabled={!canCreate}
                title={`Creates ${domainName}, then ${draftOrder.slice().reverse().join(", ")} — in that order`}
                style={{ background: "#0f766e" }}
              >
                {status.state === "loading"
                  ? <><span className="si-spinner" />Creating all...</>
                  : <><CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />Create All ({draftOrder.length + 1})</>}
              </button>
            )}
            {/* Saves the definition to the database and stops there —
                no CREATE TABLE, no columns, nothing in the schema list.
                Submit the draft (below) when it's ready to become real
                tables. */}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={saveDraft}
              disabled={!validName || !hasFields || status.state === "loading"}
              title="Save this domain model as a draft — stored in the database, no tables created until you submit it"
            >
              <SaveOutlinedIcon sx={{ fontSize: 16 }} />
              {activeDraftId ? "Update Draft" : "Save as Draft"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setGenerated(true)} disabled={!validName || !hasFields}>
              <CodeIcon sx={{ fontSize: 16 }} />Generate Files
            </button>
          </div>
          {status.state === "ok"  && <div className="si-backend-notice si-backend-notice--ok">{status.msg}</div>}
          {status.state === "err" && <div className="si-backend-notice si-backend-notice--err">{status.msg}</div>}
        </div>

        {generated && hasFields && (
          <div className="si-generated-layers">
            <div className="si-generated-header">Generated — Domain Model (Layer 1)</div>
            <div className="si-generated-layer">
              <div className="si-layer-label si-layer-label--domain"><StorageIcon sx={{ fontSize: 11 }} style={{ marginRight: 4 }} />Layer 1 · Domain Model</div>
              <CopyBlock title={<>Save as <code>src/domains/{toPascalCase(domainName)}.domain.ts</code></>} code={genDomainFile(toPascalCase(domainName), codeGenFields)} />
              {pendingJunctions.map(({ junctionName, parent, related }) => (
                <CopyBlock
                  key={junctionName}
                  title={<>Junction table — save as <code>src/domains/{junctionName}.domain.ts</code></>}
                  code={genDomainFile(junctionName, {
                    [`${parent}Id`]:  { type: "string" },
                    [`${related}Id`]: { type: "string" },
                  })}
                />
              ))}
              <div className="si-register-steps">
                <CopyBlock title={<>Add to <code>src/domains/index.ts</code></>} code={`export { ${domainName}Domain } from "./${domainName}.domain";`} />
                <CopyBlock title={<>Add to <code>src/schemas/index.ts</code> → domains array</>} code={`// domains: [ ...existing, ${domainName}Domain ]`} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}