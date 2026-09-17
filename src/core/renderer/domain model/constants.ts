import type { FieldType, ComponentType, FontSize, FontWeight, TextAlign, FieldWidth } from "../../schema/types";

export const FIELD_TYPES: FieldType[] = ["string", "number", "decimal", "boolean", "date", "image", "relation"];
/** Display label only — the underlying FieldType value ("string"/"relation")
 *  stays exactly as-is everywhere else (backend requests, internal state,
 *  the FieldType union itself); this only changes what the person sees in
 *  the Type dropdown. Any type not listed here just shows its raw value,
 *  same as before. */
export const FIELD_TYPE_LABELS: Partial<Record<FieldType, string>> = {
  string: "text",
  relation: "domain model",
};
export const COMPONENTS:  ComponentType[] = ["text", "number", "select", "checkbox", "textarea", "date"];
export const FONT_SIZES:  FontSize[]      = ["xs", "sm", "base", "lg", "xl", "2xl"];
export const FONT_WEIGHTS: FontWeight[]   = ["light", "normal", "medium", "semibold", "bold"];
export const TEXT_ALIGNS: TextAlign[]     = ["left", "center", "right"];
export const FIELD_WIDTHS: FieldWidth[]   = ["auto", "quarter", "third", "half", "full"];
export const VAL_TYPES = ["required", "unique", "minLength", "maxLength", "min", "max", "pattern"] as const;

export interface DraftValidation { type: string; value: string; message: string }