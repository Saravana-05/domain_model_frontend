import type {
  DomainFieldCore, FieldUIConfig, ValidationRule, ABACFieldRule, RBACFieldRule,
  FontSize, FontWeight, TextAlign, FieldWidth,
} from "../../schema/types";
import type { FieldDraft } from "./fieldDraftTypes";
import { primaryLabel } from "./helpers";

export function draftToDomainFieldCore(draft: FieldDraft): DomainFieldCore {
  const refs   = draft.validationRefs.filter(Boolean);
  const vRules: ValidationRule[] = draft.validations.map((v) => ({
    type: v.type as ValidationRule["type"], value: v.value || undefined, message: v.message,
  }));
  return {
    type:           draft.type,
    default:        draft.default || undefined,
    computed:       draft.computed || undefined,
    datasource:     draft.datasource || undefined,
    relatedDomain:  draft.type === "relation" && draft.relatedDomain ? draft.relatedDomain : undefined,
    listDomain:     draft.type === "list"     && draft.listDomain     ? draft.listDomain     : undefined,
    validationRefs: refs.length ? refs : undefined,
    validations:    vRules.length ? vRules : undefined,
    cardinality:    (draft.cardinality as "one" | "many" | "list" | undefined) || undefined,
    computedExpr:   draft.exprStr ? {
      expression: draft.exprStr,
      dependsOn:  draft.depsStr.split(",").map((s) => s.trim()).filter(Boolean),
    } : undefined,
  };
}

export function draftToUIHint(draft: FieldDraft): FieldUIConfig {
  const hint: FieldUIConfig = {};
  if (draft.component)       hint.component       = draft.component;
  const __label = primaryLabel(draft.labels, "");
  if (__label)                hint.label           = __label;
  if (draft.placeholder)     hint.placeholder     = draft.placeholder;
  if (draft.color)           hint.color           = draft.color;
  if (draft.backgroundColor) hint.backgroundColor = draft.backgroundColor;
  if (draft.borderColor)     hint.borderColor     = draft.borderColor;
  if (draft.fontSize)        hint.fontSize        = draft.fontSize as FontSize;
  if (draft.fontWeight)      hint.fontWeight      = draft.fontWeight as FontWeight;
  if (draft.textAlign)       hint.textAlign       = draft.textAlign as TextAlign;
  if (draft.width)           hint.width           = draft.width as FieldWidth;
  if (draft.icon)            hint.icon            = draft.icon;
  if (draft.tooltip)         hint.tooltip         = draft.tooltip;
  if (draft.hidden)          hint.hidden          = true;
  if (draft.readOnly)        hint.readOnly        = true;
  return hint;
}

export function draftToABACRule(draft: FieldDraft): ABACFieldRule | null {
  const rule: ABACFieldRule = {};
  if (draft.abacVisible)          rule.visible  = draft.abacVisible;
  if (draft.abacWrite    !== null) rule.write    = draft.abacWrite;
  if (draft.abacDisabled !== null) rule.disabled = draft.abacDisabled;
  return Object.keys(rule).length ? rule : null;
}

export function draftToRBACRule(draft: FieldDraft): RBACFieldRule | null {
  function parseRoles(s: string): string[] | undefined {
    const t = s.trim();
    return t === "" ? undefined : t.split(",").map((r) => r.trim()).filter(Boolean);
  }
  const rule: RBACFieldRule = {};
  const v = parseRoles(draft.rbacVisible);  if (v) rule.visible  = v;
  const r = parseRoles(draft.rbacRead);     if (r) rule.read     = r;
  const w = parseRoles(draft.rbacWrite);    if (w) rule.write    = w;
  const d = parseRoles(draft.rbacDisabled); if (d) rule.disabled = d;
  return Object.keys(rule).length ? rule : null;
}