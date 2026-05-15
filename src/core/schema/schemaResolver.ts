import type {
  AllSchemas,
  AccessRule,
  LayoutNode,
  LayoutFieldNode,
  LayoutContainerNode,
  ResolvedField,
  ResolvedScreen,
} from "./types";

function isFieldNode(node: LayoutNode): node is LayoutFieldNode {
  return "field" in node && typeof (node as LayoutFieldNode).field === "string";
}

function toFullPath(fieldName: string, primaryDomain: string): string {
  return fieldName.includes(".") ? fieldName : `${primaryDomain}.${fieldName}`;
}

function mergeAccess(
  baseAccess: AccessRule | undefined,
  uiExt: { visibleWhen?: string; disabledWhen?: string } | undefined
): AccessRule | undefined {
  const merged: AccessRule = { ...(baseAccess ?? {}) };

  if (uiExt?.visibleWhen  !== undefined) merged.visible  = uiExt.visibleWhen;
  if (uiExt?.disabledWhen !== undefined) merged.disabled = uiExt.disabledWhen;

  // write:false collapses to disabled when no explicit disabled rule set
  if (merged.write === false && merged.disabled === undefined) merged.disabled = true;

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function resolveScreen(screenId: string, schemas: AllSchemas): ResolvedScreen | null {
  const screenDef = schemas.ui.screens[screenId];
  if (!screenDef) return null;

  const { domain: primaryDomain } = screenDef;
  const fields: Record<string, ResolvedField> = {};

  function resolveNode(node: LayoutNode): LayoutNode {
    if (isFieldNode(node)) {
      const fullPath = toFullPath(node.field, primaryDomain);
      const dotIdx   = fullPath.indexOf(".");
      const domain   = fullPath.slice(0, dotIdx);
      const name     = fullPath.slice(dotIdx + 1);

      const fieldDef = schemas.domains[domain]?.fields[name];
      if (fieldDef) {
        const hint = schemas.uiHints?.[fullPath];
        fields[fullPath] = {
          path:        fullPath,
          domain,
          name,
          type:        fieldDef.type,
          default:     fieldDef.default,
          computed:    fieldDef.computed,
          format:      fieldDef.format,
          component:   node.component ?? hint?.component ?? "text",
          label:       node.label     ?? hint?.label,
          placeholder: node.placeholder ?? hint?.placeholder,
          props:       node.props,
          datasource:  node.datasource ?? hint?.datasource,
          validations: schemas.validations[fullPath] ?? [],
          access:      mergeAccess(schemas.access[fullPath], schemas.uiExtensions[fullPath]),
          computedConfig: schemas.computed[fullPath],
        };
      }

      // Normalise — full path + explicit type for renderer
      return { ...node, type: "field", field: fullPath } as LayoutFieldNode;
    }

    const c = node as LayoutContainerNode;
    return {
      ...c,
      children: c.children?.map(resolveNode),
      tabs:     c.tabs?.map((t) => ({ ...t, children: t.children.map(resolveNode) })),
    };
  }

  return {
    screenId,
    domain:  primaryDomain,
    fields,
    layout:  screenDef.layout.map(resolveNode),
  };
}
