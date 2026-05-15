/**
 * Split "domain.fieldName" → ["domain", "fieldName"]
 * Always splits on the FIRST dot only — field names never contain dots.
 */
export function splitPath(path: string): [string, string] {
  const dot = path.indexOf(".");
  if (dot === -1) throw new Error(`Invalid field path (missing domain): "${path}"`);
  return [path.slice(0, dot), path.slice(dot + 1)];
}

/** Read data[domain][name] from a nested store. */
export function getFieldValue(data: Record<string, any>, path: string): any {
  const [domain, name] = splitPath(path);
  return data[domain]?.[name];
}

/** Immutably set data[domain][name] = value. */
export function setFieldValue(
  data: Record<string, any>,
  path: string,
  value: any
): Record<string, any> {
  const [domain, name] = splitPath(path);
  return {
    ...data,
    [domain]: { ...(data[domain] ?? {}), [name]: value },
  };
}

/** Seed nested data from flat fields map. */
export function initNestedData(
  fields: Record<string, { domain: string; name: string; default?: any }>
): Record<string, any> {
  const data: Record<string, any> = {};
  for (const field of Object.values(fields)) {
    if (!data[field.domain]) data[field.domain] = {};
    data[field.domain][field.name] = field.default ?? null;
  }
  return data;
}
