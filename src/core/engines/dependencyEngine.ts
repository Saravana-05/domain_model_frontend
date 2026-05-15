import type { AllSchemas, DependencyGraph, ResolvedField } from "../schema/types";
import { extractFieldRefs } from "./expressionEngine";

type DependentTag =
  | `computed:${string}`
  | `visibility:${string}`
  | `disabled:${string}`
  | `validation:${string}`
  | `datasource:${string}`;

function addEdge(graph: DependencyGraph, source: string, target: DependentTag) {
  if (!graph[source]) graph[source] = [];
  if (!graph[source].includes(target)) graph[source].push(target);
}

/**
 * Build a dependency graph from resolved fields + datasource configs.
 * Called once at init — O(fields * expressions), not per render.
 */
export function buildDependencyGraph(
  fields: Record<string, ResolvedField>,
  datasources: AllSchemas["datasources"]
): DependencyGraph {
  const graph: DependencyGraph = {};
  const allPaths = Object.keys(fields);

  for (const field of Object.values(fields)) {
    // Computed fields declare their deps explicitly via computedConfig
    if (field.computedConfig) {
      for (const dep of field.computedConfig.dependsOn) {
        addEdge(graph, dep, `computed:${field.path}`);
      }
    }

    // Visibility expressions — scan for referenced field paths
    if (field.access?.visible && typeof field.access.visible === "string") {
      for (const ref of extractFieldRefs(field.access.visible, allPaths)) {
        addEdge(graph, ref, `visibility:${field.path}`);
      }
    }

    // Disabled expressions
    if (field.access?.disabled && typeof field.access.disabled === "string") {
      for (const ref of extractFieldRefs(field.access.disabled, allPaths)) {
        addEdge(graph, ref, `disabled:${field.path}`);
      }
    }

    // Conditional validations (when clause)
    for (const rule of field.validations) {
      if (rule.when) {
        for (const ref of extractFieldRefs(rule.when, allPaths)) {
          addEdge(graph, ref, `validation:${field.path}`);
        }
      }
    }
  }

  // Datasource dependencies (explicit dependsOn array)
  for (const [dsName, dsConfig] of Object.entries(datasources)) {
    if (dsConfig.dependsOn) {
      for (const dep of dsConfig.dependsOn) {
        addEdge(graph, dep, `datasource:${dsName}`);
      }
    }
  }

  return graph;
}

export function getAffectedNodes(graph: DependencyGraph, changedPath: string): string[] {
  return graph[changedPath] ?? [];
}

export function debugGraph(graph: DependencyGraph): void {
  console.group("[DependencyGraph]");
  for (const [source, targets] of Object.entries(graph)) {
    console.log(`  ${source} →`, targets);
  }
  console.groupEnd();
}
