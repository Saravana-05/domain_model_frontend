import { useState, type ReactNode } from "react";

interface TabDef {
  id: string;
  label: string;
  children: ReactNode;
}

export function Tabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  if (!tabs.length) return null;

  return (
    <div className="tabs">
      <div className="tab-headers">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-header ${active === tab.id ? "tab-header--active" : ""}`}
            onClick={() => setActive(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tabs.find((t) => t.id === active)?.children}
      </div>
    </div>
  );
}
