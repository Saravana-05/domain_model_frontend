import type { ResolvedField, ValidationRule } from "../schema/types";
import { evaluateExpression, type ExpressionContext } from "./expressionEngine";
import { getFieldValue } from "../../utils/nested";
import { useFormStore } from "../store/formStore";

function runRule(
  rule: ValidationRule,
  value: any,
  data: Record<string, any>,
  ctx: ExpressionContext
): string | null {
  if (rule.when && !evaluateExpression(rule.when, data, ctx)) return null;

  switch (rule.type) {
    case "required":
      if (value === null || value === undefined || value === "") return rule.message;
      break;
    case "min":
      if (typeof value === "number" && value < rule.value) return rule.message;
      break;
    case "max":
      if (typeof value === "number" && value > rule.value) return rule.message;
      break;
    case "minLength":
      if (typeof value === "string" && value.length < rule.value) return rule.message;
      break;
    case "maxLength":
      if (typeof value === "string" && value.length > rule.value) return rule.message;
      break;
    case "pattern":
      if (typeof value === "string" && !new RegExp(rule.value).test(value)) return rule.message;
      break;
    case "custom":
      if (rule.value && !evaluateExpression(rule.value, { value, ...data }, ctx)) return rule.message;
      break;
  }
  return null;
}

export function validateField(
  field: ResolvedField,
  data: Record<string, any>,
  ctx: ExpressionContext = {}
): string | null {
  const value = getFieldValue(data, field.path);
  for (const rule of field.validations) {
    const err = runRule(rule, value, data, ctx);
    if (err) return err;
  }
  return null;
}

export function applyValidation(
  field: ResolvedField,
  data: Record<string, any>,
  ctx: ExpressionContext = {}
): void {
  const error = validateField(field, data, ctx);
  useFormStore.getState().setError(field.path, error);
}
