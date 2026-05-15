import type { ResolvedField } from "../schema/types";
import { evaluateExpression, type ExpressionContext } from "./expressionEngine";
import { useFormStore } from "../store/formStore";

export function evaluateAccess(
  field: ResolvedField,
  data: Record<string, any>,
  ctx: ExpressionContext = {}
): { visible: boolean; disabled: boolean; canRead: boolean } {
  const { access } = field;

  let visible  = true;
  let disabled = false;
  let canRead  = true;

  if (access?.visible  !== undefined) visible  = Boolean(evaluateExpression(access.visible,  data, ctx));
  if (access?.disabled !== undefined) disabled = Boolean(evaluateExpression(access.disabled, data, ctx));
  if (access?.read     !== undefined) canRead  = Boolean(evaluateExpression(access.read,     data, ctx));

  // write:false → disable the field input
  if (access?.write !== undefined && !Boolean(evaluateExpression(access.write, data, ctx))) {
    disabled = true;
  }

  return { visible, disabled, canRead };
}

export function applyAccessRules(
  fields: Record<string, ResolvedField>,
  data: Record<string, any>,
  ctx: ExpressionContext = {},
  affectedPaths?: string[]
): void {
  const store = useFormStore.getState();
  const paths = affectedPaths ?? Object.keys(fields);

  for (const path of paths) {
    const field = fields[path];
    if (!field) continue;
    const { visible, disabled } = evaluateAccess(field, data, ctx);
    store.setVisible(path, visible);
    store.setDisabled(path, disabled);
  }
}
