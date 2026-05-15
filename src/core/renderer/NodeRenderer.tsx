import type { LayoutNode } from "../schema/types";
import { useEngine } from "./EngineContext";
import { Section } from "../components/layout/Section";
import { Row } from "../components/layout/Row";
import { Tabs } from "../components/layout/Tabs";
import { componentRegistry } from "./componentRegistry";

interface NodeRendererProps {
  node: LayoutNode;
}

export function NodeRenderer({ node }: NodeRendererProps) {
  const { screen } = useEngine();

  if (node.type === "field") {
    const field = screen.fields[node.field ?? ""];
    if (!field) return null;

    const Component = componentRegistry[field.component];
    if (!Component) {
      console.warn(`[Renderer] No component for type "${field.component}"`);
      return null;
    }

    return (
      <Component
        path={field.path}
        label={field.label}
        placeholder={field.placeholder}
        datasource={field.datasource}
        {...field.props}
      />
    );
  }

  if (node.type === "section") {
    return (
      <Section label={node.label}>
        {node.children?.map((child, i) => <NodeRenderer key={i} node={child} />)}
      </Section>
    );
  }

  if (node.type === "row") {
    return (
      <Row>
        {node.children?.map((child, i) => <NodeRenderer key={i} node={child} />)}
      </Row>
    );
  }

  if (node.type === "tabs" && node.tabs) {
    const tabs = node.tabs.map((tab) => ({
      id:       tab.id,
      label:    tab.title,
      children: <>{tab.children.map((child, i) => <NodeRenderer key={i} node={child} />)}</>,
    }));
    return <Tabs tabs={tabs} />;
  }

  return null;
}
