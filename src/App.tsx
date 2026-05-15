import { SchemaInspector } from "./core/renderer/SchemaInspector";
import { allSchemas } from "./schemas";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brand">
          <div className="app-header-icon">⚙</div>
          <div>
            <h1 className="app-title">Schema Inspector</h1>
            <p className="app-subtitle">
              Domain Model · UI Configuration · Access Control (RBAC / ABAC) · Validation Registry
            </p>
          </div>
        </div>
        <div className="app-header-meta">
          <span className="app-version-badge">v{allSchemas.env?.version ?? "—"}</span>
          <span className="app-env-badge app-env-badge--dev">{allSchemas.env?.mode ?? "—"}</span>
        </div>
      </header>

      <main className="app-main">
        <SchemaInspector schemas={allSchemas} />
      </main>
    </div>
  );
}
