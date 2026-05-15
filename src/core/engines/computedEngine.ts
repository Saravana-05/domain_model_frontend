import type { ResolvedField } from "../schema/types";
import { evaluateExpression, buildDomainContext, type ExpressionContext } from "./expressionEngine";
import { useFormStore } from "../store/formStore";

export function evaluateComputed(
  field: ResolvedField,
  data: Record<string, any>,
  ctx: ExpressionContext = {}
): any {
  const cfg = field.computedConfig;
  if (!cfg) return undefined;

  // Domain-scoped: "quantity * price" evaluated with order.* as short names
  const context = cfg.domain
    ? buildDomainContext(data, cfg.domain, ctx)
    : { ...data, ...ctx };

  return evaluateExpression(cfg.expression, context as Record<string, any>, ctx);
}

export function applyComputedFields(
  fields: Record<string, ResolvedField>,
  data: Record<string, any>,
  ctx: ExpressionContext = {},
  affectedPaths?: string[]
): void {
  const store = useFormStore.getState();
  const paths = affectedPaths ?? Object.keys(fields);

  for (const path of paths) {
    const field = fields[path];
    if (!field?.computedConfig) continue;
    const result = evaluateComputed(field, data, ctx);
    if (result !== undefined) store.setFieldValue(path, result);
  }
}
