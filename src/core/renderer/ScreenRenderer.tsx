import { useEngine } from "./EngineContext";
import { NodeRenderer } from "./NodeRenderer";

export function ScreenRenderer() {
  const { screen } = useEngine();

  return (
    <div className="screen">
      {screen.layout.map((node, i) => (
        <NodeRenderer key={i} node={node} />
      ))}
    </div>
  );
}
