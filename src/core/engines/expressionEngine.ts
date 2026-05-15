import { Parser } from "expr-eval";

const parser = new Parser({
  operators: { logical: true, comparison: true, in: true, assignment: false },
});

const compiledCache = new Map<string, ReturnType<Parser["parse"]>>();

function compile(expression: string) {
  if (!compiledCache.has(expression)) {
    compiledCache.set(expression, parser.parse(expression));
  }
  return compiledCache.get(expression)!;
}

export interface ExpressionContext {
  env?:    Record<string, any>;
  auth?:   Record<string, any>;
  record?: Record<string, any>; // current domain's fields as shorthand
}

/**
 * Evaluate expression against nested store data.
 * data shape: { user: { email: "" }, order: { quantity: 1 } }
 *
 * Context available in expressions:
 *   user.email, order.quantity   — full domain.field paths
 *   record.email                 — shorthand for the current domain (when provided)
 *   env.mode                     — environment variables
 *   auth.role                    — auth context
 */
export function evaluateExpression(
  expression: string | boolean,
  data: Record<string, any>,
  ctx: ExpressionContext = {},
  debug = false
): any {
  if (typeof expression === "boolean") return expression;

  try {
    const ast     = compile(expression);
    const context = {
      ...data,                    // user: {...}, order: {...}
      record: ctx.record ?? {},
      env:    ctx.env    ?? {},
      auth:   ctx.auth   ?? {},
    };
    const result = ast.evaluate(context);
    if (debug) console.log(`[Expr] "${expression}"`, { context, result });
    return result;
  } catch (e) {
    if (debug) console.warn(`[Expr] Error: "${expression}"`, e);
    return undefined;
  }
}

/**
 * Build context for a domain-scoped computed expression.
 * Injects domain fields as short names so "quantity * price" works
 * without the "order." prefix.
 */
export function buildDomainContext(
  data: Record<string, any>,
  domain: string,
  ctx: ExpressionContext = {}
): Record<string, any> {
  const domainData = data[domain] ?? {};
  return {
    ...data,           // full access: order.quantity, user.email etc.
    ...domainData,     // short names: quantity, price etc.
    record: domainData,
    env:    ctx.env  ?? {},
    auth:   ctx.auth ?? {},
  };
}

/** Scan expression string for known field paths (regex boundary match). */
export function extractFieldRefs(expression: string, allPaths: string[]): string[] {
  if (typeof expression !== "string") return [];
  return allPaths.filter((path) => {
    const escaped = path.replace(/\./g, "\\.");
    return new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`).test(expression);
  });
}
