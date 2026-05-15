import type { AllSchemas, DatasourceConfig } from "../schema/types";
import { getFieldValue } from "../../utils/nested";
import { useFormStore } from "../store/formStore";

const apiCache = new Map<string, Array<{ label: string; value: any }>>();

type Resolver = (
  params: Record<string, any>
) => Array<{ label: string; value: any }> | Promise<Array<{ label: string; value: any }>>;

// Registry: config "resolver" string key → JS function
const resolverRegistry = new Map<string, Resolver>();

export function registerDatasourceResolver(name: string, fn: Resolver): void {
  resolverRegistry.set(name, fn);
}

function buildParams(config: DatasourceConfig, data: Record<string, any>): Record<string, any> {
  const params: Record<string, any> = {};

  if (config.paramMap) {
    for (const [fieldPath, paramName] of Object.entries(config.paramMap)) {
      params[paramName] = getFieldValue(data, fieldPath);
    }
  }

  // Expose dependsOn field values as short names
  if (config.dependsOn) {
    for (const dep of config.dependsOn) {
      const key = dep.slice(dep.indexOf(".") + 1); // "user.country" → "country"
      params[key] = getFieldValue(data, dep);
    }
  }

  return params;
}

async function fetchApi(
  name: string,
  config: DatasourceConfig,
  params: Record<string, any>
): Promise<Array<{ label: string; value: any }>> {
  const cacheKey = `${name}:${JSON.stringify(params)}`;
  if (apiCache.has(cacheKey)) return apiCache.get(cacheKey)!;

  const url = new URL(config.url!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Datasource "${name}" fetch failed: ${res.status}`);
  const json = await res.json();
  apiCache.set(cacheKey, json);
  return json;
}

export async function loadDatasource(
  name: string,
  schemas: AllSchemas,
  data: Record<string, any>
): Promise<void> {
  const store  = useFormStore.getState();
  const config = schemas.datasources[name];
  if (!config) return;

  // Static — just set options (spec uses "data" key)
  if (config.type === "static") {
    store.setDatasourceOptions(name, config.data ?? []);
    return;
  }

  // Resolve which JS function to call:
  // 1. config.resolver string → look up in registry
  // 2. Fallback: name itself → look up in registry
  const resolverKey = config.resolver ?? name;
  const resolverFn  = resolverRegistry.get(resolverKey);

  store.setLoading(name, true);
  try {
    const params = buildParams(config, data);

    if (resolverFn) {
      const options = await resolverFn(params);
      store.setDatasourceOptions(name, options);
    } else if (config.url) {
      const options = await fetchApi(name, config, params);
      store.setDatasourceOptions(name, options);
    }
  } catch (e) {
    console.error(`[DatasourceEngine] "${name}" failed`, e);
    store.setDatasourceOptions(name, []);
  } finally {
    store.setLoading(name, false);
  }
}

export async function loadAllStaticDatasources(schemas: AllSchemas): Promise<void> {
  const store = useFormStore.getState();
  for (const [name, config] of Object.entries(schemas.datasources)) {
    if (config.type === "static") {
      store.setDatasourceOptions(name, config.data ?? []);
    }
  }
}
